package expo.modules.perfrecorder

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

// Native owner of persistence, per-dump analysis and rolling stats. The JS
// capture loop only serialises a V5 profiling export and hands it to
// `ingestDump`; everything below runs on a single-threaded executor, off the JS
// thread. In-memory rolling state survives Fast Refresh (the native runtime is
// not restarted on a JS reload); raw dumps are also ring-buffered to disk.
class PerfRecorderModule : Module() {
  private val worker = Executors.newSingleThreadExecutor()
  private val topN = 15

  // Rolling state (only touched on `worker`).
  private var maxDumps = 50
  private var dumpCount = 0
  private var totalCommits = 0
  private var totalReactCommitMs = 0.0
  private val rollingByName = HashMap<String, DoubleArray>() // name -> [ms, count] (actual)
  private val rollingSelfByName = HashMap<String, DoubleArray>() // name -> [ms, count] (self)
  private val rollingTriggers = HashMap<String, DoubleArray>() // name -> [times, ms, cascade]
  private var lastDump: JSONObject? = null

  override fun definition() = ModuleDefinition {
    Name("PerfRecorder")

    AsyncFunction("configure") { value: Int, promise: Promise ->
      worker.execute {
        maxDumps = if (value < 1) 1 else value
        promise.resolve(null)
      }
    }

    AsyncFunction("ingestDump") { json: String, promise: Promise ->
      worker.execute {
        try {
          ingest(json)
        } catch (e: Exception) {
          // Never crash the dev app over a malformed dump.
        }
        promise.resolve(null)
      }
    }

    AsyncFunction("getStats") { promise: Promise ->
      worker.execute { promise.resolve(statsJson()) }
    }

    AsyncFunction("clear") { promise: Promise ->
      worker.execute {
        dumpCount = 0
        totalCommits = 0
        totalReactCommitMs = 0.0
        rollingByName.clear()
        rollingSelfByName.clear()
        rollingTriggers.clear()
        lastDump = null
        clearRing()
        promise.resolve(null)
      }
    }

    AsyncFunction("listDumps") { promise: Promise ->
      worker.execute { promise.resolve(listDumpsJson()) }
    }

    AsyncFunction("getDumpSummary") { name: String, promise: Promise ->
      worker.execute {
        val out = try {
          dumpSummaryJson(name)
        } catch (e: Exception) {
          "null"
        }
        promise.resolve(out)
      }
    }
  }

  // MARK: analysis

  private class Analysis(
    val summary: JSONObject,
    val aggMs: HashMap<Int, Double>,
    val aggCount: HashMap<Int, Int>,
    val selfMs: HashMap<Int, Double>,
    val selfCount: HashMap<Int, Int>,
    val triggers: HashMap<String, DoubleArray>, // name -> [times, ms, cascade]
    val nameById: HashMap<Int, String>,
    val commits: Int,
    val reactMs: Double,
  )

  // Pure analysis of a V5 export. No state mutation, so it is reused by both
  // ingest() and getDumpSummary() (re-analysing a persisted dump).
  private fun analyze(top: JSONObject): Analysis? {
    val roots = top.optJSONArray("dataForRoots") ?: return null

    var commits = 0
    var fiberRecords = 0
    var reactMs = 0.0
    var tMin = Double.MAX_VALUE
    var tMax = -Double.MAX_VALUE
    val nameById = HashMap<Int, String>()
    val aggMs = HashMap<Int, Double>()
    val aggCount = HashMap<Int, Int>()
    val selfMs = HashMap<Int, Double>()
    val selfCount = HashMap<Int, Int>()
    val triggers = HashMap<String, DoubleArray>() // name -> [times, ms, cascade]

    for (ri in 0 until roots.length()) {
      val r = roots.optJSONObject(ri) ?: continue

      r.optJSONObject("snapshots")?.let { snaps ->
        val keys = snaps.keys()
        while (keys.hasNext()) {
          val k = keys.next()
          val m = snaps.optJSONObject(k) ?: continue
          val dn = m.optString("displayName", "")
          val id = k.toIntOrNull()
          if (dn.isNotEmpty() && id != null) nameById[id] = dn
        }
      }

      val commitData = r.optJSONArray("commitData") ?: continue
      for (ci in 0 until commitData.length()) {
        val com = commitData.optJSONObject(ci) ?: continue
        commits++
        val dur = com.optDouble("duration", 0.0)
        reactMs += dur
        val ts = com.optDouble("timestamp", Double.NaN)
        if (!ts.isNaN()) {
          if (ts < tMin) tMin = ts
          if (ts > tMax) tMax = ts
        }
        val cascade = com.optJSONArray("fiberActualDurations")?.length() ?: 0
        com.optJSONArray("updaters")?.let { updaters ->
          // Distinct updater names per commit, each credited the commit cost.
          val seen = HashSet<String>()
          for (ui in 0 until updaters.length()) {
            val u = updaters.optJSONObject(ui) ?: continue
            val id = u.optInt("id", -1)
            val dn = u.optString("displayName", "")
            if (id >= 0 && dn.isNotEmpty()) nameById[id] = dn
            if (dn.isNotEmpty() && seen.add(dn)) {
              val t = triggers.getOrPut(dn) { doubleArrayOf(0.0, 0.0, 0.0) }
              t[0] += 1
              t[1] += dur
              t[2] += cascade
            }
          }
        }
        com.optJSONArray("fiberActualDurations")?.let { fad ->
          for (fi in 0 until fad.length()) {
            val pair = fad.optJSONArray(fi) ?: continue
            if (pair.length() < 2) continue
            val id = pair.optInt(0, -1)
            val ms = pair.optDouble(1, Double.NaN)
            if (id < 0 || ms.isNaN()) continue
            aggMs[id] = (aggMs[id] ?: 0.0) + ms
            aggCount[id] = (aggCount[id] ?: 0) + 1
            fiberRecords++
          }
        }
        com.optJSONArray("fiberSelfDurations")?.let { fsd ->
          for (fi in 0 until fsd.length()) {
            val pair = fsd.optJSONArray(fi) ?: continue
            if (pair.length() < 2) continue
            val id = pair.optInt(0, -1)
            val ms = pair.optDouble(1, Double.NaN)
            if (id < 0 || ms.isNaN()) continue
            selfMs[id] = (selfMs[id] ?: 0.0) + ms
            selfCount[id] = (selfCount[id] ?: 0) + 1
          }
        }
      }
    }

    val wallSec = if (tMax > tMin) (tMax - tMin) / 1000.0 else 0.0

    val summary = JSONObject().apply {
      put("ingestedAt", System.currentTimeMillis())
      put("roots", roots.length())
      put("commits", commits)
      put("fiberRecords", fiberRecords)
      put("reactCommitMs", reactMs)
      put("wallSec", wallSec)
      put("topFibers", fiberListFromIds(aggMs, aggCount, nameById)) // subtree (actual)
      put("topBySelf", fiberListFromIds(selfMs, selfCount, nameById)) // self-time
      put("triggers", triggerListJson(triggers)) // why it renders
    }
    return Analysis(
      summary, aggMs, aggCount, selfMs, selfCount, triggers, nameById, commits, reactMs
    )
  }

  // Top-N named fibers from id→ms / id→count maps, descending by ms.
  private fun fiberListFromIds(
    ms: Map<Int, Double>,
    count: Map<Int, Int>,
    nameById: Map<Int, String>,
  ): JSONArray {
    val arr = JSONArray()
    ms.keys
      .map { id -> Triple(nameById[id] ?: "(unnamed)", ms[id] ?: 0.0, count[id] ?: 0) }
      .sortedByDescending { it.second }
      .take(topN)
      .forEach { arr.put(fiberObj(it.first, it.second, it.third)) }
    return arr
  }

  private fun triggerListJson(map: Map<String, DoubleArray>): JSONArray {
    val arr = JSONArray()
    map.entries
      .sortedByDescending { it.value[1] } // by totalCommitMs
      .take(topN)
      .forEach { arr.put(triggerObj(it.key, it.value[0].toInt(), it.value[1], it.value[2].toInt())) }
    return arr
  }

  private fun ingest(json: String) {
    val a = analyze(JSONObject(json)) ?: return

    // Fold into rolling aggregates, keyed by NAME (ids reset on every reload).
    for (id in a.aggMs.keys) {
      val name = a.nameById[id] ?: "(unnamed)"
      val cur = rollingByName.getOrPut(name) { doubleArrayOf(0.0, 0.0) }
      cur[0] += a.aggMs[id] ?: 0.0
      cur[1] += (a.aggCount[id] ?: 0).toDouble()
    }
    for (id in a.selfMs.keys) {
      val name = a.nameById[id] ?: "(unnamed)"
      val cur = rollingSelfByName.getOrPut(name) { doubleArrayOf(0.0, 0.0) }
      cur[0] += a.selfMs[id] ?: 0.0
      cur[1] += (a.selfCount[id] ?: 0).toDouble()
    }
    for ((name, t) in a.triggers) {
      val cur = rollingTriggers.getOrPut(name) { doubleArrayOf(0.0, 0.0, 0.0) }
      cur[0] += t[0]
      cur[1] += t[1]
      cur[2] += t[2]
    }

    dumpCount++
    totalCommits += a.commits
    totalReactCommitMs += a.reactMs
    lastDump = a.summary

    persistRaw(json)
  }

  private fun fiberObj(name: String, ms: Double, count: Int): JSONObject =
    JSONObject().apply {
      put("name", name)
      put("cumulativeMs", ms)
      put("renderCount", count)
      put("avgMs", if (count > 0) ms / count else 0.0)
    }

  private fun triggerObj(name: String, times: Int, ms: Double, cascade: Int): JSONObject =
    JSONObject().apply {
      put("name", name)
      put("timesTriggered", times)
      put("totalCommitMs", ms)
      put("avgCascadeFibers", if (times > 0) cascade.toDouble() / times else 0.0)
    }

  // Top-N from a rolling name->[ms, count] map, descending by ms.
  private fun rollingFiberList(map: Map<String, DoubleArray>): JSONArray {
    val arr = JSONArray()
    map.entries
      .sortedByDescending { it.value[0] }
      .take(topN)
      .forEach { arr.put(fiberObj(it.key, it.value[0], it.value[1].toInt())) }
    return arr
  }

  private fun statsJson(): String {
    return JSONObject().apply {
      put("dumpCount", dumpCount)
      put("totalCommits", totalCommits)
      put("totalReactCommitMs", totalReactCommitMs)
      put("topFibers", rollingFiberList(rollingByName)) // subtree (actual)
      put("topBySelf", rollingFiberList(rollingSelfByName)) // self-time
      put("triggers", triggerListJson(rollingTriggers)) // why renders happen
      put("lastDump", lastDump ?: JSONObject.NULL)
    }.toString()
  }

  // MARK: disk ring buffer

  private fun ringDir(): File? {
    val ctx = appContext.reactContext ?: return null
    val dir = File(ctx.cacheDir, "perf-recorder")
    if (!dir.exists()) dir.mkdirs()
    return dir
  }

  private fun persistRaw(json: String) {
    val dir = ringDir() ?: return
    File(dir, "dump-${System.currentTimeMillis()}.json").writeText(json)
    pruneRing(dir)
  }

  private fun pruneRing(dir: File) {
    val files = dir.listFiles { f -> f.name.startsWith("dump-") } ?: return
    if (files.size <= maxDumps) return
    files.sortedBy { it.name }
      .take(files.size - maxDumps)
      .forEach { it.delete() }
  }

  private fun clearRing() {
    ringDir()?.deleteRecursively()
  }

  // Reject anything that isn't a bare `dump-<digits>.json` basename — guards
  // getDumpSummary against path traversal out of the ring dir.
  private val dumpNameRe = Regex("^dump-\\d+\\.json$")

  private fun timestampFromName(name: String): Long =
    name.removePrefix("dump-").removeSuffix(".json").toLongOrNull() ?: 0L

  private fun listDumpsJson(): String {
    val dir = ringDir() ?: return "[]"
    val files = dir.listFiles { f -> f.name.startsWith("dump-") } ?: return "[]"
    val arr = JSONArray()
    files.sortedByDescending { it.name }.forEach { f -> // newest first
      arr.put(JSONObject().apply {
        put("name", f.name)
        put("sizeBytes", f.length())
        put("ingestedAt", timestampFromName(f.name))
      })
    }
    return arr.toString()
  }

  private fun dumpSummaryJson(name: String): String {
    if (!dumpNameRe.matches(name)) return "null"
    val dir = ringDir() ?: return "null"
    val f = File(dir, name)
    if (!f.exists()) return "null"
    val a = analyze(JSONObject(f.readText())) ?: return "null"
    a.summary.put("ingestedAt", timestampFromName(name)) // dump's own time
    return a.summary.toString()
  }
}

import ExpoModulesCore
import Foundation

// Native owner of persistence, per-dump analysis and rolling stats. The JS
// capture loop only serialises a V5 profiling export and hands it to
// `ingestDump`; everything below runs on a private serial queue, off the JS
// thread. In-memory rolling state survives Fast Refresh (the native runtime is
// not restarted on a JS reload); raw dumps are also ring-buffered to disk.
public class PerfRecorderModule: Module {
  private let queue = DispatchQueue(label: "com.artshin.perfrecorder.analyze")
  private let topN = 15

  // Rolling state (guarded by `queue`).
  private var maxDumps = 50
  private var dumpCount = 0
  private var totalCommits = 0
  private var totalReactCommitMs = 0.0
  private var rollingByName: [String: (ms: Double, count: Int)] = [:]       // actual
  private var rollingSelfByName: [String: (ms: Double, count: Int)] = [:]    // self-time
  private var rollingTriggers: [String: (times: Int, ms: Double, cascade: Int)] = [:]
  private var lastDump: [String: Any]?

  public func definition() -> ModuleDefinition {
    Name("PerfRecorder")

    AsyncFunction("configure") { (maxDumps: Int, promise: Promise) in
      self.queue.async {
        self.maxDumps = max(1, maxDumps)
        promise.resolve(nil)
      }
    }

    AsyncFunction("ingestDump") { (json: String, promise: Promise) in
      self.queue.async {
        self.ingest(json)
        promise.resolve(nil)
      }
    }

    AsyncFunction("getStats") { (promise: Promise) in
      self.queue.async {
        promise.resolve(self.statsJSON())
      }
    }

    AsyncFunction("clear") { (promise: Promise) in
      self.queue.async {
        self.dumpCount = 0
        self.totalCommits = 0
        self.totalReactCommitMs = 0
        self.rollingByName.removeAll()
        self.rollingSelfByName.removeAll()
        self.rollingTriggers.removeAll()
        self.lastDump = nil
        self.clearRing()
        promise.resolve(nil)
      }
    }

    AsyncFunction("listDumps") { (promise: Promise) in
      self.queue.async {
        promise.resolve(self.listDumpsJSON())
      }
    }

    AsyncFunction("getDumpSummary") { (name: String, promise: Promise) in
      self.queue.async {
        promise.resolve(self.dumpSummaryJSON(name))
      }
    }
  }

  // MARK: - Analysis

  private struct Analysis {
    let summary: [String: Any]
    let aggById: [Int: (ms: Double, count: Int)] // actual (subtree)
    let selfById: [Int: (ms: Double, count: Int)] // self-time
    let triggers: [String: (times: Int, ms: Double, cascade: Int)] // updater → cascade
    let nameById: [Int: String]
    let commits: Int
    let reactMs: Double
  }

  // Pure analysis of a V5 export's top-level object. No state mutation, so it is
  // reused by both ingest() and getDumpSummary() (re-analysing a persisted dump).
  private func analyze(_ top: [String: Any]) -> Analysis? {
    guard let roots = top["dataForRoots"] as? [[String: Any]] else { return nil }

    var commits = 0
    var fiberRecords = 0
    var reactMs = 0.0
    var tMin = Double.greatestFiniteMagnitude
    var tMax = -Double.greatestFiniteMagnitude
    var nameById: [Int: String] = [:]
    var aggById: [Int: (ms: Double, count: Int)] = [:]
    var selfById: [Int: (ms: Double, count: Int)] = [:]
    var triggers: [String: (times: Int, ms: Double, cascade: Int)] = [:]

    for r in roots {
      if let snaps = r["snapshots"] as? [String: Any] {
        for (k, v) in snaps {
          if let m = v as? [String: Any],
             let dn = m["displayName"] as? String,
             let id = Int(k) {
            nameById[id] = dn
          }
        }
      }
      guard let commitData = r["commitData"] as? [[String: Any]] else { continue }
      for com in commitData {
        commits += 1
        let dur = (com["duration"] as? NSNumber)?.doubleValue ?? 0
        reactMs += dur
        if let ts = (com["timestamp"] as? NSNumber)?.doubleValue {
          tMin = min(tMin, ts)
          tMax = max(tMax, ts)
        }
        let cascade = (com["fiberActualDurations"] as? [[Any]])?.count ?? 0
        if let updaters = com["updaters"] as? [[String: Any]] {
          // Distinct updater names per commit, each credited the commit cost —
          // "why this commit happened" (the trigger view).
          var seen = Set<String>()
          for u in updaters {
            if let id = (u["id"] as? NSNumber)?.intValue,
               let dn = u["displayName"] as? String {
              nameById[id] = dn
              if seen.insert(dn).inserted {
                var t = triggers[dn] ?? (times: 0, ms: 0, cascade: 0)
                t.times += 1
                t.ms += dur
                t.cascade += cascade
                triggers[dn] = t
              }
            }
          }
        }
        if let fad = com["fiberActualDurations"] as? [[Any]] {
          for pair in fad where pair.count >= 2 {
            guard
              let id = (pair[0] as? NSNumber)?.intValue,
              let ms = (pair[1] as? NSNumber)?.doubleValue
            else { continue }
            var cur = aggById[id] ?? (ms: 0, count: 0)
            cur.ms += ms
            cur.count += 1
            aggById[id] = cur
            fiberRecords += 1
          }
        }
        if let fsd = com["fiberSelfDurations"] as? [[Any]] {
          for pair in fsd where pair.count >= 2 {
            guard
              let id = (pair[0] as? NSNumber)?.intValue,
              let ms = (pair[1] as? NSNumber)?.doubleValue
            else { continue }
            var cur = selfById[id] ?? (ms: 0, count: 0)
            cur.ms += ms
            cur.count += 1
            selfById[id] = cur
          }
        }
      }
    }

    let wallSec = tMax > tMin ? (tMax - tMin) / 1000.0 : 0

    let summary: [String: Any] = [
      "ingestedAt": Date().timeIntervalSince1970 * 1000,
      "roots": roots.count,
      "commits": commits,
      "fiberRecords": fiberRecords,
      "reactCommitMs": reactMs,
      "wallSec": wallSec,
      "topFibers": topFiberList(aggById, nameById), // subtree (actual)
      "topBySelf": topFiberList(selfById, nameById), // self-time ("what's expensive")
      "triggers": triggerList(triggers), // updaters ("why it renders")
    ]
    return Analysis(
      summary: summary, aggById: aggById, selfById: selfById, triggers: triggers,
      nameById: nameById, commits: commits, reactMs: reactMs
    )
  }

  // Top-N named fibers from an id→(ms,count) map, descending by ms.
  private func topFiberList(
    _ agg: [Int: (ms: Double, count: Int)], _ nameById: [Int: String]
  ) -> [[String: Any]] {
    return agg
      .map { (id, v) in (nameById[id] ?? "(unnamed)", v.ms, v.count) }
      .sorted { $0.1 > $1.1 }
      .prefix(topN)
      .map { fiberDict(name: $0.0, ms: $0.1, count: $0.2) }
  }

  private func triggerList(
    _ triggers: [String: (times: Int, ms: Double, cascade: Int)]
  ) -> [[String: Any]] {
    return triggers
      .sorted { $0.value.ms > $1.value.ms }
      .prefix(topN)
      .map { triggerDict(name: $0.key, t: $0.value) }
  }

  private func ingest(_ json: String) {
    guard
      let data = json.data(using: .utf8),
      let top = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let a = analyze(top)
    else { return }

    // Fold into rolling aggregates, keyed by NAME (ids reset on every reload).
    for (id, v) in a.aggById {
      let name = a.nameById[id] ?? "(unnamed)"
      var cur = rollingByName[name] ?? (ms: 0, count: 0)
      cur.ms += v.ms
      cur.count += v.count
      rollingByName[name] = cur
    }
    for (id, v) in a.selfById {
      let name = a.nameById[id] ?? "(unnamed)"
      var cur = rollingSelfByName[name] ?? (ms: 0, count: 0)
      cur.ms += v.ms
      cur.count += v.count
      rollingSelfByName[name] = cur
    }
    for (name, t) in a.triggers {
      var cur = rollingTriggers[name] ?? (times: 0, ms: 0, cascade: 0)
      cur.times += t.times
      cur.ms += t.ms
      cur.cascade += t.cascade
      rollingTriggers[name] = cur
    }

    dumpCount += 1
    totalCommits += a.commits
    totalReactCommitMs += a.reactMs
    lastDump = a.summary

    persistRaw(json)
  }

  private func fiberDict(name: String, ms: Double, count: Int) -> [String: Any] {
    [
      "name": name,
      "cumulativeMs": ms,
      "renderCount": count,
      "avgMs": count > 0 ? ms / Double(count) : 0,
    ]
  }

  private func triggerDict(
    name: String, t: (times: Int, ms: Double, cascade: Int)
  ) -> [String: Any] {
    [
      "name": name,
      "timesTriggered": t.times,
      "totalCommitMs": t.ms,
      "avgCascadeFibers": t.times > 0 ? Double(t.cascade) / Double(t.times) : 0,
    ]
  }

  private func rollingFiberList(
    _ rolling: [String: (ms: Double, count: Int)]
  ) -> [[String: Any]] {
    return rolling
      .sorted { $0.value.ms > $1.value.ms }
      .prefix(topN)
      .map { fiberDict(name: $0.key, ms: $0.value.ms, count: $0.value.count) }
  }

  private func statsJSON() -> String {
    let triggers = rollingTriggers
      .sorted { $0.value.ms > $1.value.ms }
      .prefix(topN)
      .map { triggerDict(name: $0.key, t: $0.value) }

    let stats: [String: Any] = [
      "dumpCount": dumpCount,
      "totalCommits": totalCommits,
      "totalReactCommitMs": totalReactCommitMs,
      "topFibers": rollingFiberList(rollingByName), // subtree (actual)
      "topBySelf": rollingFiberList(rollingSelfByName), // self-time
      "triggers": Array(triggers), // why renders happen
      "lastDump": lastDump as Any,
    ]
    guard
      let data = try? JSONSerialization.data(withJSONObject: stats),
      let str = String(data: data, encoding: .utf8)
    else { return "{}" }
    return str
  }

  // MARK: - Disk ring buffer

  private func ringDir() -> URL? {
    guard let caches = FileManager.default.urls(
      for: .cachesDirectory, in: .userDomainMask
    ).first else { return nil }
    let dir = caches.appendingPathComponent("perf-recorder", isDirectory: true)
    try? FileManager.default.createDirectory(
      at: dir, withIntermediateDirectories: true
    )
    return dir
  }

  private func persistRaw(_ json: String) {
    guard let dir = ringDir() else { return }
    let file = dir.appendingPathComponent("dump-\(Int(Date().timeIntervalSince1970 * 1000)).json")
    try? json.data(using: .utf8)?.write(to: file)
    pruneRing(dir)
  }

  private func pruneRing(_ dir: URL) {
    guard let files = try? FileManager.default.contentsOfDirectory(
      at: dir, includingPropertiesForKeys: nil
    ).filter({ $0.lastPathComponent.hasPrefix("dump-") }) else { return }
    if files.count <= maxDumps { return }
    let sorted = files.sorted { $0.lastPathComponent < $1.lastPathComponent }
    for url in sorted.prefix(files.count - maxDumps) {
      try? FileManager.default.removeItem(at: url)
    }
  }

  private func clearRing() {
    guard let dir = ringDir() else { return }
    try? FileManager.default.removeItem(at: dir)
  }

  // Reject anything that isn't a bare `dump-<digits>.json` basename — guards
  // getDumpSummary against path traversal out of the ring dir.
  private func isValidDumpName(_ name: String) -> Bool {
    return !name.contains("/") && !name.contains("..")
      && name.hasPrefix("dump-") && name.hasSuffix(".json")
  }

  private func timestampFromName(_ name: String) -> Double {
    let trimmed = name.dropFirst("dump-".count).dropLast(".json".count)
    return Double(trimmed) ?? 0
  }

  private func listDumpsJSON() -> String {
    guard
      let dir = ringDir(),
      let urls = try? FileManager.default.contentsOfDirectory(
        at: dir, includingPropertiesForKeys: [.fileSizeKey]
      )
    else { return "[]" }
    let entries: [[String: Any]] = urls
      .filter { $0.lastPathComponent.hasPrefix("dump-") }
      .sorted { $0.lastPathComponent > $1.lastPathComponent } // newest first
      .map { url in
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        return [
          "name": url.lastPathComponent,
          "sizeBytes": size,
          "ingestedAt": timestampFromName(url.lastPathComponent),
        ]
      }
    guard
      let data = try? JSONSerialization.data(withJSONObject: entries),
      let str = String(data: data, encoding: .utf8)
    else { return "[]" }
    return str
  }

  private func dumpSummaryJSON(_ name: String) -> String {
    guard isValidDumpName(name), let dir = ringDir() else { return "null" }
    let file = dir.appendingPathComponent(name)
    guard
      let data = try? Data(contentsOf: file),
      let top = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let a = analyze(top)
    else { return "null" }
    var summary = a.summary
    summary["ingestedAt"] = timestampFromName(name) // dump's own time, not now
    guard
      let out = try? JSONSerialization.data(withJSONObject: summary),
      let str = String(data: out, encoding: .utf8)
    else { return "null" }
    return str
  }
}

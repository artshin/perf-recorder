Pod::Spec.new do |s|
  s.name           = 'PerfRecorder'
  s.version        = '1.0.0'
  s.summary        = 'Continuous background React profiler recorder (dev-only)'
  s.description    = 'Persists, analyses and aggregates React DevTools profiling dumps natively, off the JS thread.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '15.1',
    :tvos => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end

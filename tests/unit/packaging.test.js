const test = require('node:test')
const assert = require('node:assert/strict')

const { build } = require('../../package.json')

// security-report.md L2 (2026-10-13): with Electron's default fuses the shipped binary ran any
// script as plain Node (`ELECTRON_RUN_AS_NODE=1 MDV -e …`, measured on v1.4.0), and
// NODE_OPTIONS and --inspect did the same. Code already running as the user could then borrow
// whatever macOS file-access grants MDV holds. These three are launch-time doors MDV never uses.
// The setting is one JSON block that is easy to drop in a cleanup, and nothing else would notice,
// because the test suite runs the unpackaged Electron from node_modules. Hence this pin.
test('the packaged app turns off the fuses that let it run as plain Node', () => {
  assert.deepEqual(
    {
      runAsNode: build.electronFuses?.runAsNode,
      enableNodeOptionsEnvironmentVariable: build.electronFuses?.enableNodeOptionsEnvironmentVariable,
      enableNodeCliInspectArguments: build.electronFuses?.enableNodeCliInspectArguments,
    },
    { runAsNode: false, enableNodeOptionsEnvironmentVariable: false, enableNodeCliInspectArguments: false },
  )
})

// Flipping a fuse rewrites the Electron binary, so its original linker signature no longer
// matches. The build skips code signing (CSC_IDENTITY_AUTO_DISCOVERY=false), so nothing else
// re-signs it, and on Apple Silicon a binary whose signature does not match is killed at launch.
test('flipping fuses re-signs the app ad hoc, or the arm64 build would not launch', () => {
  assert.equal(build.electronFuses?.resetAdHocDarwinSignature, true)
})

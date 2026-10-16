// Rebuilds node-pty against Electron's ABI where it has no prebuilt binary (Linux). Windows and
// macOS use node-pty's N-API prebuilds, which need no rebuild and no compiler toolchain.
import { spawnSync } from 'node:child_process'

if (process.platform !== 'linux') {
  console.log(`postinstall: ${process.platform} usa los binarios precompilados de node-pty`)
  process.exit(0)
}
const result = spawnSync('electron-rebuild', ['-f', '-o', 'node-pty'], {
  stdio: 'inherit',
  shell: true,
})
process.exit(result.status ?? 1)

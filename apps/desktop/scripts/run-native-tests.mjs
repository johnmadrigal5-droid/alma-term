// Runs native tests with Electron's Node so node-pty matches Electron's ABI.
import { spawn } from 'node:child_process'
import electronPath from 'electron'

const child = spawn(
  electronPath,
  ['./node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.native.config.ts'],
  { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
)
child.on('exit', (code) => process.exit(code ?? 1))

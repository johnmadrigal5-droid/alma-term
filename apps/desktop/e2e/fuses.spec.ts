import { spawnSync } from 'node:child_process'
import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses'
import { expect, test } from '@playwright/test'

// Only meaningful against a packaged binary: the dev Electron has every fuse at its default.
const executable = process.env['ALMA_E2E_EXECUTABLE']
test.skip(!executable, 'Sin ALMA_E2E_EXECUTABLE: no hay binario empaquetado')

test('the packaged binary has the electron fuses of the spec', async () => {
  const wire = await getCurrentFuseWire(executable as string)
  expect(wire[FuseV1Options.RunAsNode]).toBe(FuseState.DISABLE)
  expect(wire[FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(FuseState.DISABLE)
  expect(wire[FuseV1Options.OnlyLoadAppFromAsar]).toBe(FuseState.ENABLE)
  expect(wire[FuseV1Options.EnableCookieEncryption]).toBe(FuseState.ENABLE)
})

function runPackaged(extraEnv: Record<string, string>, args: string[] = []) {
  const noSandbox = process.env['ALMA_E2E_NO_SANDBOX'] === '1' ? ['--no-sandbox'] : []
  return spawnSync(executable as string, [...noSandbox, ...args], {
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
    timeout: 60_000,
  })
}

test('ELECTRON_RUN_AS_NODE does not turn the packaged app into a Node interpreter', () => {
  const result = runPackaged({ ELECTRON_RUN_AS_NODE: '1', ALMA_SMOKE_TEST: '1' }, [
    '-e',
    'process.exit(7)',
  ])
  // With the fuse on, "-e" would run and exit 7. With it off the app just starts (and, in smoke
  // mode, stops by itself).
  expect(result.status).not.toBe(7)
})

test('the packaged binary starts: window loaded, host answering', () => {
  const result = runPackaged({ ALMA_SMOKE_TEST: '1' })
  expect(result.stdout).toContain('ALMA_SMOKE_OK')
  expect(result.status).toBe(0)
})

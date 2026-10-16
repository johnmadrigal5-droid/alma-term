import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { launchOptions } from './launch'

let home: string
let app: ElectronApplication
let page: Page

function launchEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  return {
    ...env,
    HOME: home,
    XAUTHORITY: env['XAUTHORITY'] ?? join(homedir(), '.Xauthority'),
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DOCUMENTS_DIR: join(home, 'Documents'),
    ALMA_DISABLE_WEBGL: '1',
    SHELL: '/bin/bash',
  }
}

test.beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'alma-e2e-log-'))
  // Without a Documents folder Electron falls back to the home folder.
  mkdirSync(join(home, 'Documents'))
  app = await electron.launch(launchOptions(launchEnv()))
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterEach(async () => {
  await app.close().catch(() => undefined)
  rmSync(home, { recursive: true, force: true })
})

test('writes what a local terminal printed to a text log in the documents folder', async () => {
  await page.getByRole('button', { name: 'Abrir terminal local' }).first().click()
  const rows = page.locator('section:not([hidden]) .xterm-rows')
  await expect(rows).toBeVisible()
  await page.locator('section:not([hidden]) .xterm').click()
  await page.keyboard.type('echo registro-$((40+2))')
  await page.keyboard.press('Enter')
  await expect(rows).toContainText('registro-42')
  await page.keyboard.type('exit')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'La sesión terminó' })).toBeVisible()

  const dir = join(home, 'Documents', 'Alma Term', 'logs')
  await expect.poll(() => readdirSync(dir).length).toBe(1)
  const [file] = readdirSync(dir)
  expect(file).toMatch(/^local_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.log$/)
  const text = readFileSync(join(dir, file ?? ''), 'utf8')
  expect(text).toMatch(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] registro-42$/m)
  // Plain text: no escape sequences.
  expect(text).not.toContain('\x1b')
})

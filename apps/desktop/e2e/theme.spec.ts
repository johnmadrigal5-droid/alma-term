import { mkdtempSync, rmSync } from 'node:fs'
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

test.describe.configure({ mode: 'serial' })

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
    ALMA_DISABLE_WEBGL: '1',
    SHELL: '/bin/bash',
  }
}

async function launch() {
  app = await electron.launch(launchOptions(launchEnv()))
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
}

test.beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'alma-e2e-theme-'))
})
test.afterAll(() => {
  rmSync(home, { recursive: true, force: true })
})

const theme = (p: Page) => p.evaluate(() => document.documentElement.dataset['theme'])

test('starts dark and switches an open terminal to the light theme without reloading', async () => {
  await launch()
  expect(await theme(page)).toBe('dark')
  await page.getByRole('button', { name: 'Abrir terminal local' }).first().click()
  await expect(page.locator('section:not([hidden]) .xterm-rows')).toBeVisible()
  await page.getByRole('button', { name: 'Cambiar a tema claro' }).click()
  await expect.poll(() => theme(page)).toBe('light')
  await expect(page.getByRole('button', { name: 'Cambiar a tema oscuro' })).toBeVisible()
  // The terminal that was already open follows: white background in the light theme.
  await expect(page.locator('section:not([hidden]) .xterm-viewport')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  )
})

test('the saved theme is there from the first paint after a restart', async () => {
  await app.close()
  await launch()
  expect(await theme(page)).toBe('light')
  await expect(page.getByRole('button', { name: 'Cambiar a tema oscuro' })).toBeVisible()
  await page.getByRole('button', { name: 'Cambiar a tema oscuro' }).click()
  await expect.poll(() => theme(page)).toBe('dark')
})

// eslint-disable-next-line no-empty-pattern
test.afterEach(async ({}, testInfo) => {
  if (testInfo.title.startsWith('the saved')) await app.close()
})

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
import {
  dockerAvailable,
  SSH_TEST_PASSWORD,
  SSH_TEST_USER,
  startTestSshServer,
  type TestSshServer,
} from './ssh-server'

test.skip(!dockerAvailable(), 'Docker no disponible: E2E MultiExec omitido')
test.describe.configure({ mode: 'serial' })

let server: TestSshServer
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

const visibleRows = (p: Page) => p.locator('section:not([hidden]) .xterm-rows')
const bar = (p: Page) => p.getByRole('region', { name: 'MultiExec' })

async function connect(p: Page, first: boolean) {
  const before = await p.getByRole('tab').count()
  await p.getByRole('button', { name: 'Nueva sesión SSH' }).click()
  const form = p.getByRole('dialog', { name: 'Nueva sesión SSH' })
  await form.getByLabel('Host').fill(server.host)
  await form.getByLabel('Puerto').fill(String(server.port))
  await form.getByLabel('Usuario').fill(SSH_TEST_USER)
  await form.getByLabel('Contraseña (opcional)').fill(SSH_TEST_PASSWORD)
  await form.getByRole('button', { name: 'Conectar', exact: true }).click()
  if (first)
    await p
      .getByRole('dialog', { name: /Primera conexión/ })
      .getByRole('button', { name: 'Confiar y conectar' })
      .click()
  await expect(p.getByRole('tab')).toHaveCount(before + 1)
  await expect(p.locator('section:not([hidden]) .xterm-rows').last()).toContainText('$')
}

test.beforeAll(async () => {
  test.setTimeout(120_000)
  home = mkdtempSync(join(tmpdir(), 'alma-e2e-multiexec-'))
  server = await startTestSshServer()
  app = await electron.launch(launchOptions(launchEnv()))
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
  server?.stop()
  rmSync(home, { recursive: true, force: true })
})

test('criterion 1: four SSH sessions in 2×2 run one command through MultiExec', async () => {
  test.setTimeout(120_000)
  for (let i = 0; i < 4; i++) await connect(page, i === 0)
  await page.getByRole('radio', { name: '2×2' }).click()
  await expect(visibleRows(page)).toHaveCount(4)

  await page.keyboard.press('Control+Shift+M')
  await expect(bar(page).getByLabel('Comando para MultiExec')).toBeFocused()
  await bar(page).getByRole('button', { name: 'Todas' }).click()
  await bar(page).getByLabel('Comando para MultiExec').fill('echo multi-$((6*7))')
  await bar(page).getByRole('button', { name: 'Ejecutar en 4' }).click()
  for (let i = 0; i < 4; i++) await expect(visibleRows(page).nth(i)).toContainText('multi-42')
})

test('keystroke broadcast types in every target once', async () => {
  await bar(page).getByRole('switch', { name: 'Broadcast de teclas' }).click()
  await expect(page.getByText('Recibe MultiExec')).toHaveCount(3)
  await page.locator('section:not([hidden]) .xterm').first().click()
  await page.keyboard.type('echo bc-$((5+5))')
  await page.keyboard.press('Enter')
  for (let i = 0; i < 4; i++) await expect(visibleRows(page).nth(i)).toContainText('bc-10')
  // The active session got its keys once.
  await expect(visibleRows(page).first()).not.toContainText('eecchhoo')
})

test('arrow keys reach targets in their own cursor mode', async () => {
  // History recall with Up works in every target: the arrow arrives in a form each shell reads.
  await page.locator('section:not([hidden]) .xterm').first().click()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  for (let i = 0; i < 4; i++)
    await expect(visibleRows(page).nth(i)).toContainText(/multi-42[\s\S]*bc-10[\s\S]*multi-42/)
  await bar(page).getByRole('button', { name: 'Ocultar MultiExec' }).click()
  await expect(page.getByText('Recibe MultiExec')).toHaveCount(0)
})

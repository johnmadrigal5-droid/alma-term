import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

test.skip(!dockerAvailable(), 'Docker no disponible: E2E SCP omitido')
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

async function answerNextOpenDialog(paths: string[]) {
  await app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths })
  }, paths)
}

const panel = (p: Page) => p.getByRole('region', { name: 'Archivos remotos' })

test.beforeAll(async () => {
  test.setTimeout(120_000)
  home = mkdtempSync(join(tmpdir(), 'alma-e2e-scp-'))
  server = await startTestSshServer()
  // Connections made after this have no SFTP subsystem: the panel must fall back to scp.
  await server.disableSftp()
  app = await electron.launch(launchOptions(launchEnv()))
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  server?.stop()
  rmSync(home, { recursive: true, force: true })
})

test('browses a server without SFTP in scp mode, with a notice', async () => {
  await page.getByRole('button', { name: 'Nueva sesión SSH' }).first().click()
  const form = page.getByRole('dialog', { name: 'Nueva sesión SSH' })
  await form.getByLabel('Host').fill(server.host)
  await form.getByLabel('Puerto').fill(String(server.port))
  await form.getByLabel('Usuario').fill(SSH_TEST_USER)
  await form.getByLabel('Contraseña (opcional)').fill(SSH_TEST_PASSWORD)
  await form.getByRole('button', { name: 'Conectar', exact: true }).click()
  await page
    .getByRole('dialog', { name: /Primera conexión/ })
    .getByRole('button', { name: 'Confiar y conectar' })
    .click()
  await expect(panel(page).getByRole('status')).toContainText('Modo SCP, funciones limitadas')
  await expect(panel(page).getByRole('grid')).toBeVisible()
})

test('uploads a file over scp and it shows up in the listing', async () => {
  const local = join(home, 'local')
  mkdirSync(local)
  const source = join(local, 'por-scp.bin')
  writeFileSync(source, randomBytes(512 * 1024))
  await answerNextOpenDialog([source])
  await panel(page).getByRole('button', { name: 'Subir archivos' }).click()
  await expect(panel(page).getByRole('row', { name: /^por-scp\.bin,/ })).toBeVisible({
    timeout: 20_000,
  })
  // Sizes and dates are unknown over scp: a dash, not "0 B".
  await expect(
    panel(page)
      .getByRole('row', { name: /^por-scp\.bin,/ })
      .getByText('—')
      .first(),
  ).toBeVisible()
})

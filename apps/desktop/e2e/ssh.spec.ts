import { mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchOptions } from './launch'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import {
  dockerAvailable,
  SSH_TEST_PASSWORD,
  SSH_TEST_USER,
  startTestSshServer,
  type TestSshServer,
} from './ssh-server'

test.skip(!dockerAvailable(), 'Docker no disponible: E2E SSH omitido')
// Later tests rely on the host key trusted by the first one (persisted in userData).
test.describe.configure({ mode: 'serial' })

let server: TestSshServer
let home: string
let app: ElectronApplication
let page: Page

// A throwaway HOME isolates userData (trusted keys) and ~/.ssh/known_hosts from the developer's.
function launchEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  return {
    ...env,
    HOME: home,
    // X11 looks for ~/.Xauthority under HOME; keep the real one so the display still opens.
    XAUTHORITY: env['XAUTHORITY'] ?? join(homedir(), '.Xauthority'),
    XDG_CONFIG_HOME: join(home, '.config'),
    ALMA_DISABLE_WEBGL: '1',
    SHELL: '/bin/bash',
  }
}

test.beforeAll(async () => {
  test.setTimeout(120_000)
  home = mkdtempSync(join(tmpdir(), 'alma-e2e-home-'))
  server = await startTestSshServer()
})

test.afterAll(() => {
  server?.stop()
  rmSync(home, { recursive: true, force: true })
})

test.beforeEach(async () => {
  app = await electron.launch(launchOptions(launchEnv()))
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterEach(async () => {
  await app.close()
})

const activeRows = (p: Page) => p.locator('section:not([hidden]) .xterm-rows')

async function connect(p: Page, password: string) {
  await p.getByRole('button', { name: 'Nueva sesión SSH' }).click()
  const form = p.getByRole('dialog', { name: 'Nueva sesión SSH' })
  await form.getByLabel('Host').fill(server.host)
  await form.getByLabel('Puerto').fill(String(server.port))
  await form.getByLabel('Usuario').fill(SSH_TEST_USER)
  await form.getByLabel('Contraseña (opcional)').fill(password)
  await form.getByRole('button', { name: 'Conectar', exact: true }).click()
}

async function run(p: Page, command: string) {
  await p.locator('section:not([hidden]) .xterm').click()
  await p.keyboard.type(command)
  await p.keyboard.press('Enter')
}

test('connects with a password after trusting a new host key', async () => {
  await connect(page, SSH_TEST_PASSWORD)
  const hostKey = page.getByRole('dialog', { name: /Primera conexión/ })
  await expect(hostKey).toBeVisible()
  await expect(hostKey).toContainText('SHA256:')
  await hostKey.getByRole('button', { name: 'Confiar y conectar' }).click()
  await expect(activeRows(page)).toBeVisible()
  await run(page, 'echo alma-$((40+2))')
  await expect(activeRows(page)).toContainText('alma-42')
})

test('does not ask again for a trusted host', async () => {
  await connect(page, SSH_TEST_PASSWORD)
  await expect(activeRows(page)).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await run(page, 'echo otra-$((1+1))')
  await expect(activeRows(page)).toContainText('otra-2')
})

test('reports a wrong password with an edit action', async () => {
  await connect(page, 'contraseña-incorrecta')
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('No se pudo autenticar')
  await expect(alert.getByRole('button', { name: 'Editar sesión' })).toBeVisible()
  await alert.getByRole('button', { name: 'Editar sesión' }).click()
  await expect(
    page.getByRole('dialog', { name: 'Nueva sesión SSH' }).getByLabel('Host'),
  ).toHaveValue(server.host)
})

test('shows the closed state when the remote shell exits', async () => {
  await connect(page, SSH_TEST_PASSWORD)
  await expect(activeRows(page)).toBeVisible()
  await run(page, 'exit')
  await expect(page.getByRole('heading', { name: 'La sesión terminó' })).toBeVisible()
})

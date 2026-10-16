import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

test.skip(!dockerAvailable(), 'Docker no disponible: E2E SFTP omitido')
test.describe.configure({ mode: 'serial' })

let server: TestSshServer
let home: string
let app: ElectronApplication
let page: Page

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')

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

/** The next native open dialog answers with these paths instead of asking. */
async function answerNextOpenDialog(paths: string[]) {
  await app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths })
  }, paths)
}

const panel = (p: Page) => p.getByRole('region', { name: 'Archivos remotos' })
const row = (p: Page, name: string) => panel(p).getByRole('row', { name: new RegExp(`^${name},`) })

async function rowAction(p: Page, name: string, action: string) {
  await panel(p)
    .getByRole('button', { name: `Acciones de ${name}` })
    .click()
  await p.getByRole('menuitem', { name: action }).click()
}

async function connect(p: Page) {
  await p.getByRole('button', { name: 'Nueva sesión SSH' }).click()
  const form = p.getByRole('dialog', { name: 'Nueva sesión SSH' })
  await form.getByLabel('Host').fill(server.host)
  await form.getByLabel('Puerto').fill(String(server.port))
  await form.getByLabel('Usuario').fill(SSH_TEST_USER)
  await form.getByLabel('Contraseña (opcional)').fill(SSH_TEST_PASSWORD)
  await form.getByRole('button', { name: 'Conectar', exact: true }).click()
  const hostKey = p.getByRole('dialog', { name: /Primera conexión/ })
  await hostKey.getByRole('button', { name: 'Confiar y conectar' }).click()
}

test.beforeAll(async () => {
  test.setTimeout(120_000)
  home = mkdtempSync(join(tmpdir(), 'alma-e2e-sftp-'))
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

test('browses the server over the same connection without asking again', async () => {
  await connect(page)
  await expect(panel(page).getByRole('grid', { name: 'Archivos de /config' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('scrolls the file list sideways and brings the panel back after hiding it', async () => {
  const grid = panel(page).getByRole('grid', { name: /^Archivos de/ })
  const sizes = await grid.evaluate((el) => {
    el.scrollLeft = 10_000
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, left: el.scrollLeft }
  })
  expect(sizes.scrollWidth).toBeGreaterThan(sizes.clientWidth)
  expect(sizes.left).toBeGreaterThan(0)
  // The panel fits the window, so the list (not the page) is what scrolls vertically.
  const fits = await panel(page).evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight)
  expect(fits).toBe(true)

  await panel(page).getByRole('button', { name: 'Ocultar panel' }).click()
  await expect(panel(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Mostrar SFTP' }).click()
  await expect(panel(page)).toBeVisible()
})

test('creates a folder and enters it', async () => {
  await panel(page).getByRole('button', { name: 'Nueva carpeta' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nueva carpeta' })
  await dialog.getByLabel('Nombre').fill('alma-e2e')
  await dialog.getByRole('button', { name: 'Crear' }).click()
  await row(page, 'alma-e2e').dblclick()
  await expect(panel(page).getByText('Carpeta vacía, arrastra archivos aquí')).toBeVisible()
})

test('uploads and downloads a 2 MiB file with the same SHA-256', async () => {
  const local = join(home, 'local')
  const downloads = join(home, 'descargas')
  mkdirSync(local)
  mkdirSync(downloads)
  const source = join(local, 'subida.bin')
  writeFileSync(source, randomBytes(2 * 1024 * 1024))

  await answerNextOpenDialog([source])
  await panel(page).getByRole('button', { name: 'Subir archivos' }).click()
  await page.getByRole('button', { name: /^Transferencias/ }).click()
  await expect(page.getByRole('progressbar', { name: 'Progreso de subida.bin' })).toHaveAttribute(
    'aria-valuenow',
    '100',
  )
  await expect(row(page, 'subida.bin')).toBeVisible()

  await answerNextOpenDialog([downloads])
  await rowAction(page, 'subida.bin', 'Descargar')
  await expect(
    page.getByRole('list', { name: 'Transferencias' }).getByText('Completada', { exact: true }),
  ).toHaveCount(2)
  await expect
    .poll(() => sha256(join(downloads, 'subida.bin')), { timeout: 10_000 })
    .toBe(sha256(source))
})

test('renames and deletes the file', async () => {
  await rowAction(page, 'subida.bin', 'Renombrar')
  const rename = page.getByRole('dialog', { name: /Renombrar/ })
  await rename.getByLabel('Nombre').fill('renombrado.bin')
  await rename.getByRole('button', { name: 'Renombrar' }).click()
  await expect(row(page, 'renombrado.bin')).toBeVisible()

  await rowAction(page, 'renombrado.bin', 'Eliminar')
  await page
    .getByRole('dialog', { name: 'Eliminar «renombrado.bin»' })
    .getByRole('button', { name: 'Eliminar' })
    .click()
  await expect(panel(page).getByText('Carpeta vacía, arrastra archivos aquí')).toBeVisible()
})

test('Ctrl+Shift+F hides and shows the panel', async () => {
  await page.locator('section:not([hidden]) .xterm').click()
  await page.keyboard.press('Control+Shift+F')
  await expect(panel(page)).toHaveCount(0)
  await page.keyboard.press('Control+Shift+F')
  await expect(panel(page)).toBeVisible()
})

test('closing the tab cancels an upload in progress', async () => {
  const big = join(home, 'local', 'grande.bin')
  writeFileSync(big, randomBytes(256 * 1024 * 1024))
  await answerNextOpenDialog([big])
  await panel(page).getByRole('button', { name: 'Subir archivos' }).click()
  const progress = page.getByRole('progressbar', { name: 'Progreso de grande.bin' })
  await expect(progress).toBeVisible()
  await page.locator('[role=tab][aria-selected=true] [data-close]').click()
  // The upload is running: closing the tab asks first.
  await page
    .getByRole('dialog', { name: 'Cerrar la pestaña' })
    .getByRole('button', { name: 'Cerrar pestaña' })
    .click()
  await expect(page.getByRole('list', { name: 'Transferencias' })).toContainText('Cancelada')
})

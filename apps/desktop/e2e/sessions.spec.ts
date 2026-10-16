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

test.skip(!dockerAvailable(), 'Docker no disponible: E2E de sesiones omitido')
// The tests build on each other: the first saves the session the others reuse.
test.describe.configure({ mode: 'serial' })

// CI runs a real keyring (gnome-keyring in dbus-run-session); locally safeStorage may fall
// back to basic_text, where the app must refuse to remember secrets.
const keyring = process.env['ALMA_E2E_EXPECT_KEYRING'] === '1'

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

async function launch(): Promise<void> {
  app = await electron.launch(launchOptions(launchEnv()))
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
}

test.beforeAll(async () => {
  test.setTimeout(120_000)
  home = mkdtempSync(join(tmpdir(), 'alma-e2e-sessions-'))
  server = await startTestSshServer()
  mkdirSync(join(home, '.ssh'))
  writeFileSync(
    join(home, '.ssh', 'config'),
    [
      // A different user than the saved session, so both aliases import as new bookmarks.
      'Host *',
      '  User importado',
      'Host docker-a docker-b',
      `  HostName ${server.host}`,
      `  Port ${server.port}`,
      '',
    ].join('\n'),
  )
})

test.afterAll(() => {
  server?.stop()
  rmSync(home, { recursive: true, force: true })
})

test.beforeEach(launch)
// Playwright insists on an object pattern for the fixtures argument, even an empty one.
// eslint-disable-next-line no-empty-pattern
test.afterEach(async ({}, testInfo) => {
  // A failure in CI is only readable from what the app showed: keep a screenshot and the tree.
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('screenshot', {
      body: await page.screenshot().catch(() => Buffer.from('')),
      contentType: 'image/png',
    })
    await testInfo.attach('aria', {
      body: await page
        .locator('body')
        .ariaSnapshot()
        .catch(() => ''),
      contentType: 'text/plain',
    })
    if (keyring) {
      const backend = await app
        .evaluate(({ safeStorage }) =>
          process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'n/a',
        )
        .catch(() => 'desconocido')
      await testInfo.attach('safeStorage', { body: String(backend), contentType: 'text/plain' })
      console.log(`[e2e] safeStorage backend: ${String(backend)}`)
    }
  }
  await app.close()
})

const activeRows = (p: Page) => p.locator('section:not([hidden]) .xterm-rows')
const tree = (p: Page) => p.getByRole('tree', { name: 'Sesiones guardadas' })

async function run(p: Page, command: string) {
  await p.locator('section:not([hidden]) .xterm').click()
  await p.keyboard.type(command)
  await p.keyboard.press('Enter')
}

async function trustIfAsked(p: Page) {
  const hostKey = p.getByRole('dialog', { name: /Primera conexión/ })
  if (await hostKey.isVisible().catch(() => false))
    await hostKey.getByRole('button', { name: 'Confiar y conectar' }).click()
}

test('saves a session and reconnects to it with one click after a restart', async () => {
  await page.getByRole('button', { name: 'Nueva sesión SSH' }).click()
  const form = page.getByRole('dialog', { name: 'Nueva sesión SSH' })
  await form.getByLabel('Nombre').fill('Docker')
  await form.getByLabel('Host').fill(server.host)
  await form.getByLabel('Puerto').fill(String(server.port))
  await form.getByLabel('Usuario').fill(SSH_TEST_USER)
  await form.getByLabel('Contraseña (opcional)').fill(SSH_TEST_PASSWORD)
  const remember = form.getByLabel('Recordar contraseña')
  if (keyring) await remember.check()
  else {
    await expect(remember).toBeDisabled()
    await expect(form).toContainText('no tiene un llavero disponible')
  }
  await form.getByRole('button', { name: 'Guardar y conectar' }).click()
  await expect(page.getByRole('dialog', { name: /Primera conexión/ })).toBeVisible()
  await trustIfAsked(page)
  await run(page, 'echo alma-$((40+2))')
  await expect(activeRows(page)).toContainText('alma-42')

  await app.close()
  await launch()

  await tree(page)
    .getByRole('treeitem', { name: /Docker/ })
    .dblclick()
  if (!keyring) {
    const prompt = page.getByRole('dialog', { name: /Contraseña de/ })
    await expect(prompt).toBeVisible()
    await expect(prompt.getByLabel(/Recordar/)).toHaveCount(0)
    await prompt.getByLabel('Contraseña').fill(SSH_TEST_PASSWORD)
    await prompt.getByRole('button', { name: 'Continuar' }).click()
  }
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await run(page, 'echo uno-$((0+1))')
  await expect(activeRows(page)).toContainText('uno-1')
})

test('imports the hosts of ~/.ssh/config into their own folder', async () => {
  await page.getByRole('button', { name: 'Importar ~/.ssh/config' }).click()
  const dialog = page.getByRole('dialog', { name: 'Importar ~/.ssh/config' })
  await expect(dialog.getByRole('checkbox', { name: /docker-a/ })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: /docker-b/ })).toBeChecked()
  await dialog.getByRole('button', { name: 'Importar 2' }).click()
  await expect(dialog).toHaveCount(0)
  const folder = tree(page).getByRole('treeitem', { name: /Importadas de ~\/\.ssh\/config/ })
  await expect(folder).toHaveAttribute('aria-expanded', 'true')
  for (const alias of ['docker-a', 'docker-b'])
    await expect(tree(page).getByRole('treeitem', { name: new RegExp(alias) })).toHaveAttribute(
      'aria-level',
      '2',
    )
})

test('connects from the Ctrl K palette', async () => {
  await page.locator('body').click()
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: 'Paleta de comandos' })
  await expect(palette).toBeVisible()
  await page.keyboard.type('Docker')
  await page.keyboard.press('Enter')
  await expect(palette).toHaveCount(0)
  if (!keyring) {
    const prompt = page.getByRole('dialog', { name: /Contraseña de/ })
    await prompt.getByLabel('Contraseña').fill(SSH_TEST_PASSWORD)
    await prompt.getByRole('button', { name: 'Continuar' }).click()
  }
  await run(page, 'echo dos-$((1+1))')
  await expect(activeRows(page)).toContainText('dos-2')
})

test('deleting a folder moves its sessions to the root', async () => {
  await page.getByRole('button', { name: 'Nueva carpeta' }).click()
  const name = page.getByRole('dialog', { name: 'Nueva carpeta' })
  await name.getByLabel('Nombre').fill('Temporal')
  await name.getByRole('button', { name: 'Guardar' }).click()

  await tree(page).getByRole('button', { name: 'Acciones de Docker' }).click()
  await page.getByRole('menuitem', { name: 'Editar' }).click()
  const edit = page.getByRole('dialog', { name: 'Editar sesión' })
  await edit.getByLabel('Carpeta').selectOption({ label: 'Temporal' })
  await edit.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(edit).toHaveCount(0)

  const folder = tree(page).getByRole('treeitem', { name: /Temporal/ })
  await folder.click()
  await expect(folder).toHaveAttribute('aria-expanded', 'true')
  await expect(tree(page).getByRole('treeitem', { name: /Docker/ })).toHaveAttribute(
    'aria-level',
    '2',
  )
  await folder.focus()
  await page.keyboard.press('Delete')
  const confirm = page.getByRole('dialog', { name: 'Eliminar «Temporal»' })
  await expect(confirm).toContainText('pasan a la raíz')
  await confirm.getByRole('button', { name: 'Eliminar' }).click()
  await expect(tree(page).getByRole('treeitem', { name: /Temporal/ })).toHaveCount(0)
  await expect(tree(page).getByRole('treeitem', { name: /Docker/ })).toHaveAttribute(
    'aria-level',
    '1',
  )
})

test('a reload while connecting leaves no orphan session', async () => {
  // A fresh port keeps the host key unknown, so the connection waits on the trust prompt.
  const other = await startTestSshServer()
  try {
    await page.getByRole('button', { name: 'Nueva sesión SSH' }).click()
    const form = page.getByRole('dialog', { name: 'Nueva sesión SSH' })
    await form.getByLabel('Host').fill(other.host)
    await form.getByLabel('Puerto').fill(String(other.port))
    await form.getByLabel('Usuario').fill(SSH_TEST_USER)
    await form.getByRole('button', { name: 'Conectar', exact: true }).click()
    await expect(page.getByRole('dialog', { name: /Primera conexión/ })).toBeVisible()

    expect(other.established()).toBe(1)

    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('tab')).toHaveCount(0)
    // The reloaded renderer lost that tab: main must cancel the open, closing the socket.
    await expect.poll(() => other.established(), { timeout: 5000 }).toBe(0)
  } finally {
    other.stop()
  }
})

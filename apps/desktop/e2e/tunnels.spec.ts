import { mkdtempSync, rmSync } from 'node:fs'
import { connect as tcpConnect, createServer, type Server } from 'node:net'
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

test.skip(!dockerAvailable(), 'Docker no disponible: E2E de túneles omitido')
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
    // This spec checks the real close warning, so the dialog must not answer by itself.
    ALMA_E2E_AUTO_CONFIRM_CLOSE: '0',
  }
}

const sidebar = (p: Page) => p.getByRole('complementary', { name: 'Navegación y sesiones' })
const dialog = (p: Page) => p.getByRole('dialog', { name: 'Nuevo túnel' })

async function connectSsh(p: Page) {
  await p.getByRole('button', { name: 'Nueva sesión SSH' }).click()
  const form = p.getByRole('dialog', { name: 'Nueva sesión SSH' })
  await form.getByLabel('Host').fill(server.host)
  await form.getByLabel('Puerto').fill(String(server.port))
  await form.getByLabel('Usuario').fill(SSH_TEST_USER)
  await form.getByLabel('Contraseña (opcional)').fill(SSH_TEST_PASSWORD)
  await form.getByRole('button', { name: 'Conectar', exact: true }).click()
  await p
    .getByRole('dialog', { name: /Primera conexión/ })
    .getByRole('button', { name: 'Confiar y conectar' })
    .click()
  await expect(p.locator('section:not([hidden]) .xterm-rows')).toContainText('$')
}

async function fillLocalTunnel(p: Page, bindPort: string) {
  const form = dialog(p)
  await form.getByLabel('Puerto de escucha').fill(bindPort)
  await form.getByLabel('Host de destino').fill('127.0.0.1')
  await form.getByLabel('Puerto de destino').fill('2222')
}

/** First bytes a TCP client reads from 127.0.0.1:port. */
function firstBytes(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = tcpConnect(port, '127.0.0.1')
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('sin datos'))
    }, 8000)
    socket.once('data', (d) => {
      clearTimeout(timer)
      socket.destroy()
      resolve(d.toString())
    })
    socket.once('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
  })
}

const canConnect = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = tcpConnect(port, '127.0.0.1')
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })

test.beforeAll(async () => {
  test.setTimeout(120_000)
  home = mkdtempSync(join(tmpdir(), 'alma-e2e-tunnels-'))
  server = await startTestSshServer()
  // The image ships with port forwarding off; connections made from now on may forward.
  await server.allowTcpForwarding()
  app = await electron.launch(launchOptions(launchEnv()))
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  server?.stop()
  rmSync(home, { recursive: true, force: true })
})

let tunnelPort = 0

test('criterion 4: creates a local forward and traffic goes through it', async () => {
  await connectSsh(page)
  await sidebar(page)
    .getByRole('button', { name: /^Túneles/ })
    .click()
  await expect(sidebar(page).getByText('Sin túneles')).toBeVisible()
  await sidebar(page).getByRole('button', { name: 'Nuevo túnel' }).click()
  await fillLocalTunnel(page, '0')
  await dialog(page).getByRole('button', { name: 'Crear' }).click()

  const row = sidebar(page).getByRole('listitem')
  await expect(row).toContainText(/127\.0\.0\.1:\d+ → 127\.0\.0\.1:2222/)
  await expect(row).toContainText('Activo')
  const text = (await row.textContent()) ?? ''
  tunnelPort = Number(/127\.0\.0\.1:(\d+) →/.exec(text)?.[1])
  expect(tunnelPort).toBeGreaterThan(0)

  // From the server, 127.0.0.1:2222 is its own sshd: the banner proves the traffic went through.
  expect(await firstBytes(tunnelPort)).toMatch(/^SSH-/)
  await expect(page.getByText('1 túnel', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Túneles, 1 activo' })).toBeVisible()
})

test('a port already in use is reported with the next step', async () => {
  const busy: Server = createServer()
  await new Promise<void>((resolve) => busy.listen(0, '127.0.0.1', resolve))
  const address = busy.address()
  const port = typeof address === 'object' && address ? address.port : 0
  try {
    await sidebar(page).getByRole('button', { name: 'Nuevo túnel' }).click()
    await fillLocalTunnel(page, String(port))
    await dialog(page).getByRole('button', { name: 'Crear' }).click()
    await expect(dialog(page).getByRole('alert')).toContainText('Puerto local en uso')
    await expect(dialog(page).getByRole('alert')).toContainText('Elegir otro puerto')
    await expect(dialog(page).getByLabel('Puerto de escucha')).toBeFocused()
    await dialog(page).getByRole('button', { name: 'Cancelar' }).click()
  } finally {
    busy.close()
  }
})

test('listening beyond 127.0.0.1 needs an explicit acknowledgement', async () => {
  await sidebar(page).getByRole('button', { name: 'Nuevo túnel' }).click()
  await fillLocalTunnel(page, '0')
  await dialog(page).getByLabel('Dirección de escucha').fill('0.0.0.0')
  await expect(dialog(page).getByText(/otros equipos de tu red/)).toBeVisible()
  await expect(dialog(page).getByRole('button', { name: 'Crear' })).toBeDisabled()
  await dialog(page)
    .getByRole('checkbox', { name: /Entiendo que otros equipos podrán conectarse/ })
    .check()
  await expect(dialog(page).getByRole('button', { name: 'Crear' })).toBeEnabled()
  await dialog(page).getByRole('button', { name: 'Cancelar' }).click()
})

test('closing the window with an active tunnel asks first', async () => {
  await app.evaluate(({ dialog: electronDialog }) => {
    Reflect.set(globalThis, '__asked', [])
    electronDialog.showMessageBox = (async (...args: unknown[]) => {
      const options = args.at(-1) as { message?: string }
      const asked = Reflect.get(globalThis, '__asked') as string[]
      asked.push(options.message ?? '')
      return { response: 0, checkboxChecked: false }
    }) as typeof electronDialog.showMessageBox
  })
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close()
  })
  await expect
    .poll(() => app.evaluate(() => Reflect.get(globalThis, '__asked') as string[]))
    .toEqual(['Hay 1 túnel activo'])
  // "Cancelar" keeps the window and the tunnel.
  expect(app.windows()).toHaveLength(1)
  expect(await canConnect(tunnelPort)).toBe(true)
})

test('closing the tab with an active tunnel asks first and Cancelar keeps everything', async () => {
  await page.getByRole('tab', { selected: true }).focus()
  await page.keyboard.press('Delete')
  const confirm = page.getByRole('dialog', { name: 'Cerrar la pestaña' })
  await expect(confirm).toContainText('Se cerrará 1 túnel activo')
  await confirm.getByRole('button', { name: 'Cancelar' }).click()
  await expect(confirm).toHaveCount(0)
  await expect(page.getByRole('tab')).toHaveCount(1)
  expect(await canConnect(tunnelPort)).toBe(true)
})

test('closing the tunnel frees its port', async () => {
  await sidebar(page)
    .getByRole('button', { name: /^Cerrar túnel 127\.0\.0\.1:\d+ → 127\.0\.0\.1:2222/ })
    .click()
  await expect(sidebar(page).getByRole('listitem')).toContainText('Cerrado')
  await expect.poll(() => canConnect(tunnelPort)).toBe(false)
  await expect(page.getByText('1 túnel', { exact: true })).toHaveCount(0)
})

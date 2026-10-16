import { mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import axe from 'axe-core'
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

test.describe.configure({ mode: 'serial' })

let home: string
let app: ElectronApplication
let page: Page
let server: TestSshServer | null = null

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

test.beforeAll(async () => {
  test.setTimeout(120_000)
  home = mkdtempSync(join(tmpdir(), 'alma-e2e-a11y-'))
  if (dockerAvailable()) server = await startTestSshServer()
  app = await electron.launch(launchOptions(launchEnv()))
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  server?.stop()
  rmSync(home, { recursive: true, force: true })
})

/**
 * Serious and critical WCAG 2.x A/AA violations of what is on screen (the terminal canvas
 * aside). axe-core runs inside the page: @axe-core/playwright opens a second page, which
 * Electron does not support.
 */
async function violations(p: Page, label: string): Promise<string[]> {
  // evaluate() is not subject to the page CSP, which would block an inline script tag.
  await p.evaluate(axe.source)
  const results = await p.evaluate(
    (tags) =>
      (
        window as unknown as {
          axe: { run(context: object, options: object): Promise<{ violations: AxeViolation[] }> }
        }
      ).axe.run({ exclude: [['.xterm']] }, { runOnly: { type: 'tag', values: tags } }),
    ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
  )
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${label}: ${v.id} (${v.impact}) ${v.help} → ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(' '))
          .join(' | ')}`,
    )
}

interface AxeViolation {
  id: string
  impact?: string | null
  help: string
  nodes: { target: unknown[] }[]
}

async function setTheme(p: Page, theme: 'dark' | 'light') {
  const current = await p.evaluate(() => document.documentElement.dataset['theme'])
  if (current === theme) return
  await p
    .getByRole('button', {
      name: theme === 'light' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro',
    })
    .click()
  await expect.poll(() => p.evaluate(() => document.documentElement.dataset['theme'])).toBe(theme)
}

for (const theme of ['dark', 'light'] as const) {
  test(`${theme}: the empty workspace and the sidebar sections have no serious violations`, async () => {
    await setTheme(page, theme)
    const found = [...(await violations(page, `${theme} vacío`))]
    for (const name of [/^Túneles/, /^Transferencias/, /^Sesiones/]) {
      await page.getByRole('button', { name }).click()
      found.push(...(await violations(page, `${theme} sección ${String(name)}`)))
    }
    expect(found).toEqual([])
  })

  test(`${theme}: dialogs and the palette have no serious violations and give the focus back`, async () => {
    await setTheme(page, theme)
    const found: string[] = []

    const nueva = page.getByRole('button', { name: 'Nueva sesión SSH' }).first()
    await nueva.click()
    await expect(page.getByRole('dialog', { name: 'Nueva sesión SSH' })).toBeVisible()
    found.push(...(await violations(page, `${theme} nueva sesión`)))
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // Focus trap in, focus back out: the button that opened the dialog has it again.
    await expect(nueva).toBeFocused()

    await page.keyboard.press('Control+k')
    await expect(page.getByRole('dialog')).toBeVisible()
    found.push(...(await violations(page, `${theme} paleta`)))
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.getByRole('button', { name: /^Túneles/ }).click()
    await page.getByRole('button', { name: 'Nuevo túnel' }).click()
    await expect(page.getByRole('dialog', { name: 'Nuevo túnel' })).toBeVisible()
    found.push(...(await violations(page, `${theme} nuevo túnel sin sesión`)))
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /^Sesiones/ }).click()
    expect(found).toEqual([])
  })

  test(`${theme}: a terminal tab, split panes and MultiExec have no serious violations`, async () => {
    await setTheme(page, theme)
    if ((await page.getByRole('tab').count()) === 0)
      await page.getByRole('button', { name: 'Abrir terminal local' }).first().click()
    await expect(page.locator('section:not([hidden]) .xterm-rows')).toBeVisible()
    const found = [...(await violations(page, `${theme} terminal`))]
    await page.getByRole('radio', { name: '2 columnas' }).click()
    found.push(...(await violations(page, `${theme} 2 columnas`)))
    await page.keyboard.press('Control+Shift+M')
    await expect(page.getByRole('region', { name: 'MultiExec' })).toBeVisible()
    found.push(...(await violations(page, `${theme} multiexec`)))
    await page.getByRole('button', { name: 'Ocultar MultiExec' }).click()
    await page.getByRole('radio', { name: '1 panel' }).click()
    expect(found).toEqual([])
  })
}

test('an ssh tab with the sftp panel and the tunnel form has no serious violations in either theme', async () => {
  test.skip(server === null, 'Docker no disponible')
  test.setTimeout(120_000)
  if (!server) return
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
  await expect(page.getByRole('region', { name: 'Archivos remotos' })).toBeVisible()
  await expect(page.getByRole('grid')).toBeVisible()
  const found: string[] = []
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    found.push(...(await violations(page, `${theme} sftp`)))
    await page.getByRole('button', { name: /^Túneles/ }).click()
    await page.getByRole('button', { name: 'Nuevo túnel' }).click()
    await expect(page.getByRole('dialog', { name: 'Nuevo túnel' })).toBeVisible()
    found.push(...(await violations(page, `${theme} nuevo túnel`)))
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /^Sesiones/ }).click()
  }
  expect(found).toEqual([])
})

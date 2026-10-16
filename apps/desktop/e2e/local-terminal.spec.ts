import { launchOptions } from './launch'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'

function launchEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  return { ...env, ALMA_DISABLE_WEBGL: '1', SHELL: '/bin/bash' }
}

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  app = await electron.launch(launchOptions(launchEnv()))
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterEach(async () => {
  await app.close()
})

const activeRows = (p: Page) => p.locator('section:not([hidden]) .xterm-rows')

async function openTerminal(p: Page) {
  await p.getByRole('button', { name: 'Abrir terminal local' }).first().click()
  await expect(activeRows(p)).toBeVisible()
  await p.locator('section:not([hidden]) .xterm').click()
}

async function run(p: Page, command: string) {
  await p.keyboard.type(command)
  await p.keyboard.press('Enter')
}

test('runs a command in a local terminal', async () => {
  await openTerminal(page)
  await run(page, 'echo alma-$((40+2))')
  await expect(activeRows(page)).toContainText('alma-42')
})

test('keeps the session across a renderer reload', async () => {
  await openTerminal(page)
  await run(page, 'echo antes-de-$((1+1))-recargar')
  await expect(activeRows(page)).toContainText('antes-de-2-recargar')
  await page.reload()
  await expect(activeRows(page)).toContainText('antes-de-2-recargar')
  await page.locator('section:not([hidden]) .xterm').click()
  await run(page, 'echo despues-$((2+3))')
  await expect(activeRows(page)).toContainText('despues-5')
})

test('shows the closed state when the shell exits and reopens', async () => {
  await openTerminal(page)
  await run(page, 'exit')
  await expect(page.getByRole('heading', { name: 'La sesión terminó' })).toBeVisible()
  await page.getByRole('button', { name: 'Reabrir' }).click()
  await expect(activeRows(page)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'La sesión terminó' })).toHaveCount(0)
})

test('leaves Ctrl+K to the shell and opens the palette with Ctrl+Shift+K', async () => {
  await openTerminal(page)
  await page.locator('section:not([hidden]) .xterm').click()
  // readline: Ctrl+A to the start, Ctrl+K kills to the end of the line.
  await page.keyboard.type('echo basura')
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+k')
  await run(page, 'echo limpio-$((3+4))')
  await expect(activeRows(page)).toContainText('limpio-7')
  // Without the kill, the new command is typed in front of the old text: "limpio-7echo basura".
  await expect(activeRows(page)).not.toContainText('limpio-7echo')
  await expect(page.getByRole('dialog', { name: 'Paleta de comandos' })).toHaveCount(0)
  await page.keyboard.press('Control+Shift+K')
  await expect(page.getByRole('dialog', { name: 'Paleta de comandos' })).toBeVisible()
})

test('drags a tab into another pane without losing its shell', async () => {
  await openTerminal(page)
  await page.getByRole('button', { name: 'Nueva terminal local' }).click()
  await page.getByRole('radio', { name: '2 columnas' }).click()
  const second = page.getByRole('region', { name: 'Terminal local 2' })
  const first = page.getByRole('region', { name: 'Terminal local 1' })
  await expect(second).toBeVisible()
  await expect(first).toBeVisible()
  await second.locator('.xterm').click()
  await run(page, 'export ALMA_MARK=movida')
  // Both visible: local 2 in front of the left pane, local 1 spread to the right one.
  await page.getByRole('tab', { name: /local 2/ }).dragTo(first)
  await expect(page.getByRole('region', { name: 'Panel izquierda, vacío' })).toBeVisible()
  await second.locator('.xterm').click()
  await run(page, 'echo $ALMA_MARK')
  await expect(second.locator('.xterm-rows')).toContainText('movida')
})

test('moves a tab with the pane menu and back to one pane', async () => {
  await openTerminal(page)
  await page.getByRole('button', { name: 'Nueva terminal local' }).click()
  await page.getByRole('radio', { name: '2 filas' }).click()
  await page.getByRole('button', { name: 'Acciones del panel local 1' }).click()
  await page.getByRole('menuitem', { name: 'Mover al panel arriba' }).click()
  await expect(page.getByRole('region', { name: 'Panel abajo, vacío' })).toBeVisible()
  await page.getByRole('radio', { name: '1 panel' }).click()
  await expect(page.locator('section:not([hidden]) .xterm')).toHaveCount(1)
})

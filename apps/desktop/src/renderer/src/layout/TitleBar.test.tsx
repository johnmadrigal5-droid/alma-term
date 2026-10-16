import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TitleBar } from './TitleBar'

const base = { kind: 'local' as const, generation: 0, step: null, error: null, request: null }
const tabs = [
  { ...base, sessionId: 'a', title: 'local 1', status: 'ready' as const, exitCode: null },
  { ...base, sessionId: 'b', title: 'local 2', status: 'closed' as const, exitCode: 0 },
]

const layout = {
  preset: 'single' as const,
  onPreset: vi.fn(),
  multiExecOpen: false,
  onMultiExec: vi.fn(),
  theme: 'dark' as const,
  onToggleTheme: vi.fn(),
}

function renderTitleBar(over: Partial<Parameters<typeof TitleBar>[0]> = {}) {
  const props = {
    tabs,
    activeId: 'a',
    platform: 'linux',
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onNew: vi.fn(),
    onPalette: vi.fn(),
    ...layout,
    onPreset: vi.fn(),
    onMultiExec: vi.fn(),
    ...over,
  }
  render(<TitleBar {...props} />)
  return props
}

describe('TitleBar', () => {
  it('switches the pane preset', async () => {
    const p = renderTitleBar()
    const group = screen.getByRole('radiogroup', { name: 'Distribución de paneles' })
    expect(within(group).getByRole('radio', { name: '1 panel' })).toBeChecked()
    await userEvent.click(within(group).getByRole('radio', { name: '2×2' }))
    expect(p.onPreset).toHaveBeenCalledWith('grid')
  })

  it('moves between presets with the arrow keys', async () => {
    const p = renderTitleBar()
    screen.getByRole('radio', { name: '1 panel' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(p.onPreset).toHaveBeenCalledWith('columns')
    await userEvent.keyboard('{ArrowLeft}')
    expect(p.onPreset).toHaveBeenLastCalledWith('grid')
  })

  it('lets tabs be dragged with their session id', () => {
    renderTitleBar()
    const setData = vi.fn()
    fireEvent.dragStart(screen.getByRole('tab', { name: /local 1/ }), {
      dataTransfer: { setData, effectAllowed: '' },
    })
    expect(setData).toHaveBeenCalledWith('application/x-alma-tab', 'a')
  })

  it('toggles MultiExec', async () => {
    const p = renderTitleBar()
    const button = screen.getByRole('button', { name: 'MultiExec' })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(button)
    expect(p.onMultiExec).toHaveBeenCalledOnce()
  })

  it('marks the active tab and exposes status as text', () => {
    render(
      <TitleBar
        tabs={tabs}
        activeId="b"
        platform="linux"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
        onPalette={vi.fn()}
        {...layout}
      />,
    )
    expect(screen.getByRole('tab', { name: /local 2/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /local 1/ })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: /local 2/ })).toHaveTextContent('terminada')
  })

  it('selects, closes and creates tabs', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const onNew = vi.fn()
    render(
      <TitleBar
        tabs={tabs}
        activeId="a"
        platform="linux"
        onSelect={onSelect}
        onClose={onClose}
        onNew={onNew}
        onPalette={vi.fn()}
        {...layout}
      />,
    )
    await userEvent.click(screen.getByRole('tab', { name: /local 2/ }))
    expect(onSelect).toHaveBeenCalledWith('b')
    screen.getByRole('tab', { name: /local 1/ }).focus()
    await userEvent.keyboard('{Delete}')
    expect(onClose).toHaveBeenCalledWith('a')
    await userEvent.click(screen.getByRole('button', { name: 'Nueva terminal local' }))
    expect(onNew).toHaveBeenCalledOnce()
  })

  it('opens the palette from the search field and shows the shortcut', async () => {
    const onPalette = vi.fn()
    render(
      <TitleBar
        tabs={tabs}
        activeId="a"
        platform="linux"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
        onPalette={onPalette}
        {...layout}
      />,
    )
    const field = screen.getByRole('button', { name: /Conectar, buscar o ejecutar…/ })
    expect(field).toHaveTextContent('Ctrl K')
    await userEvent.click(field)
    expect(onPalette).toHaveBeenCalledOnce()
  })

  it('puts the theme button in the title bar', async () => {
    const p = renderTitleBar({ onToggleTheme: vi.fn() })
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar a tema claro' }))
    expect(p.onToggleTheme).toHaveBeenCalledOnce()
  })

  it('A11y: has no empty tablist when there are no tabs, and keeps the new-terminal button', () => {
    renderTitleBar({ tabs: [] })
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByRole('button', { name: 'Nueva terminal local' })).toBeVisible()
  })

  it('A11y: keeps the new-terminal button outside the tablist', () => {
    renderTitleBar()
    const list = screen.getByRole('tablist', { name: 'Sesiones abiertas' })
    expect(within(list).queryByRole('button', { name: 'Nueva terminal local' })).toBeNull()
  })

  it('A11y: closes a tab with the pointer through its decorative x, without selecting it', async () => {
    const p = renderTitleBar({ activeId: 'b' })
    const tab = screen.getByRole('tab', { name: /local 1/ })
    const close = tab.querySelector('[data-close]')
    expect(close).not.toBeNull()
    expect(close).toHaveAttribute('aria-hidden', 'true')
    await userEvent.click(close as Element)
    expect(p.onClose).toHaveBeenCalledWith('a')
    expect(p.onSelect).not.toHaveBeenCalled()
  })

  it('A11y: only tabs live inside the tablist (no buttons owned by it)', () => {
    renderTitleBar()
    const list = screen.getByRole('tablist', { name: 'Sesiones abiertas' })
    expect(within(list).queryAllByRole('button')).toEqual([])
    expect(within(list).getAllByRole('tab')).toHaveLength(2)
  })
})

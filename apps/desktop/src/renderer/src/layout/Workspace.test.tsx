import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Tab } from '../state/sessions-store'
import { Workspace, type PanesView } from './Workspace'

const tab = (over: Partial<Tab> = {}): Tab => ({
  sessionId: 'a',
  title: 'local 1',
  kind: 'local',
  status: 'ready',
  exitCode: null,
  generation: 0,
  step: null,
  error: null,
  request: null,
  ...over,
})

function renderWorkspace(props: Partial<Parameters<typeof Workspace>[0]> = {}) {
  const handlers = {
    onOpenLocal: vi.fn(),
    onReopen: vi.fn(),
    onCloseTab: vi.fn(),
    onRetry: vi.fn(),
    onEdit: vi.fn(),
  }
  render(
    <Workspace
      tabs={[]}
      activeId={null}
      openError={null}
      platform="linux"
      renderTerminal={(t) => <div tabIndex={-1}>terminal {t.sessionId}</div>}
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

const panes = (over: Partial<PanesView> = {}): PanesView => ({
  preset: 'columns',
  split: { x: 0.5, y: 0.5 },
  paneOf: { a: 0, b: 1 },
  front: ['a', 'b'],
  receivers: new Set(),
  onSplit: vi.fn(),
  onMove: vi.fn(),
  onFocusPane: vi.fn(),
  onActivate: vi.fn(),
  ...over,
})
const two = [tab(), tab({ sessionId: 'b', title: 'local 2' })]

describe('Workspace', () => {
  it('shows the front tab of every pane', () => {
    renderWorkspace({ tabs: two, activeId: 'a', panes: panes() })
    expect(screen.getByText('terminal a')).toBeVisible()
    expect(screen.getByText('terminal b')).toBeVisible()
  })

  it('offers an empty pane a local terminal and the drop hint', async () => {
    const p = panes({ paneOf: { a: 0, b: 0 }, front: ['a', null] })
    const h = renderWorkspace({ tabs: two, activeId: 'a', panes: p })
    const empty = screen.getByRole('region', { name: 'Panel derecha, vacío' })
    expect(empty).toHaveTextContent('Arrastra una pestaña aquí')
    await userEvent.click(within(empty).getByRole('button', { name: 'Abrir terminal local aquí' }))
    expect(p.onFocusPane).toHaveBeenCalledWith(1)
    expect(h.onOpenLocal).toHaveBeenCalledOnce()
  })

  it('moves a tab with the pane menu', async () => {
    const p = panes()
    renderWorkspace({ tabs: two, activeId: 'a', panes: p })
    await userEvent.click(screen.getByRole('button', { name: 'Acciones del panel local 1' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Mover al panel derecha' }))
    expect(p.onMove).toHaveBeenCalledWith('a', 1)
  })

  it('moves a tab dropped from the title bar', () => {
    const p = panes()
    renderWorkspace({ tabs: two, activeId: 'a', panes: p })
    const data = { types: ['application/x-alma-tab'], getData: () => 'a' }
    const target = screen.getByRole('region', { name: 'Terminal local 2' })
    fireEvent.dragOver(target, { dataTransfer: data })
    fireEvent.drop(target, { dataTransfer: data })
    expect(p.onMove).toHaveBeenCalledWith('a', 1)
  })

  it('resizes the columns with the keyboard', async () => {
    const p = panes()
    renderWorkspace({ tabs: two, activeId: 'a', panes: p })
    const separator = screen.getByRole('separator', { name: 'Ancho de los paneles' })
    expect(separator).toHaveAttribute('aria-valuenow', '50')
    separator.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(p.onSplit).toHaveBeenCalledWith('x', 0.55)
  })

  it('marks MultiExec receivers', () => {
    renderWorkspace({ tabs: two, activeId: 'a', panes: panes({ receivers: new Set(['b']) }) })
    const pane = screen.getByRole('region', { name: 'Terminal local 2' })
    expect(within(pane).getByText('Recibe MultiExec')).toBeVisible()
    expect(pane).toHaveClass('ring-2')
  })

  it('activates the tab of a pane that gets focus', () => {
    const p = panes()
    renderWorkspace({ tabs: two, activeId: 'a', panes: p })
    // React's onFocusCapture listens to focusin, which a real focus() fires.
    act(() => screen.getByText('terminal b').focus())
    expect(p.onActivate).toHaveBeenCalledWith('b')
  })

  it('leaves the active tab alone when a pane header control takes focus', () => {
    // Activating would focus that terminal and close the menu that just opened.
    const p = panes()
    renderWorkspace({ tabs: two, activeId: 'a', panes: p })
    act(() => screen.getByRole('button', { name: 'Acciones del panel local 2' }).focus())
    expect(p.onActivate).not.toHaveBeenCalled()
  })

  it('shows the connecting state inside its pane only', () => {
    const tabs = [tab(), tab({ sessionId: 'b', title: 'srv', kind: 'ssh', status: 'connecting' })]
    renderWorkspace({ tabs, activeId: 'a', panes: panes() })
    expect(
      within(screen.getByRole('region', { name: 'Terminal srv' })).getByRole('status'),
    ).toBeVisible()
    expect(screen.getByText('terminal a')).toBeVisible()
  })

  it('shows the empty state with a call to action', async () => {
    const h = renderWorkspace()
    expect(screen.getByRole('heading', { name: 'Abre una terminal para empezar' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Abrir terminal local' }))
    expect(h.onOpenLocal).toHaveBeenCalledOnce()
  })

  it('shows open errors with a retry action', async () => {
    const h = renderWorkspace({ openError: 'sin shell' })
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo abrir la terminal: sin shell')
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(h.onOpenLocal).toHaveBeenCalledOnce()
  })

  it('renders only the active terminal visibly', () => {
    renderWorkspace({ tabs: [tab(), tab({ sessionId: 'b', title: 'local 2' })], activeId: 'b' })
    expect(screen.getByText('terminal b')).toBeVisible()
    expect(screen.getByText('terminal a')).not.toBeVisible()
  })

  it('shows the closed state with exit code and actions', async () => {
    const h = renderWorkspace({ tabs: [tab({ status: 'closed', exitCode: 0 })], activeId: 'a' })
    expect(screen.getByRole('heading', { name: 'La sesión terminó' })).toBeVisible()
    expect(screen.getByText('Código de salida 0')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Reabrir' }))
    expect(h.onReopen).toHaveBeenCalledWith('a')
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar pestaña' }))
    expect(h.onCloseTab).toHaveBeenCalledWith('a')
  })

  it('says the connection dropped and offers to reconnect', () => {
    renderWorkspace({ tabs: [tab({ status: 'lost', lostBy: 'connection' })], activeId: 'a' })
    expect(screen.getByRole('alert')).toHaveTextContent('Conexión perdida')
    expect(screen.getByRole('alert')).toHaveTextContent('El contenido se conserva')
    expect(screen.getByRole('button', { name: 'Reconectar' })).toBeVisible()
  })

  it('shows the host lost state as an alert', () => {
    renderWorkspace({ tabs: [tab({ status: 'lost', lostBy: 'host' })], activeId: 'a' })
    expect(screen.getByRole('alert')).toHaveTextContent('Sesión perdida')
    expect(screen.getByRole('button', { name: 'Abrir de nuevo' })).toBeVisible()
  })

  it('shows connection steps instead of the terminal while connecting', () => {
    renderWorkspace({
      tabs: [tab({ kind: 'ssh', title: 'alma@srv', status: 'connecting', step: 'hostkey' })],
      activeId: 'a',
    })
    expect(screen.getByRole('status')).toHaveTextContent('Conectando a alma@srv')
    expect(screen.queryByText('terminal a')).toBeNull()
  })

  it('shows a typed ssh error with retry, edit and technical details', async () => {
    const h = renderWorkspace({
      tabs: [
        tab({
          kind: 'ssh',
          status: 'error',
          error: { code: 'AUTH_FAILED', message: 'All configured authentication methods failed' },
        }),
      ],
      activeId: 'a',
    })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('No se pudo autenticar')
    expect(screen.getByText('All configured authentication methods failed')).not.toBeVisible()
    await userEvent.click(screen.getByText('Detalles técnicos'))
    expect(screen.getByText('All configured authentication methods failed')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(h.onRetry).toHaveBeenCalledWith('a')
    await userEvent.click(screen.getByRole('button', { name: 'Editar sesión' }))
    expect(h.onEdit).toHaveBeenCalledWith('a')
  })

  describe('side panel', () => {
    const ssh = tab({ sessionId: 's', title: 'alma@srv', kind: 'ssh' })
    const side = { renderSide: (t: Tab) => <div>sftp {t.sessionId}</div>, onSideWidth: vi.fn() }

    it('shows the side panel next to a ready ssh tab', () => {
      renderWorkspace({ tabs: [ssh], activeId: 's', side: { ...side, visible: true, width: 320 } })
      expect(screen.getByText('sftp s')).toBeVisible()
      expect(screen.getByRole('separator', { name: 'Ancho del panel SFTP' })).toHaveAttribute(
        'aria-valuenow',
        '320',
      )
    })

    it('has no side panel for a local tab or when hidden', () => {
      renderWorkspace({
        tabs: [tab()],
        activeId: 'a',
        side: { ...side, visible: true, width: 320 },
      })
      expect(screen.queryByText(/sftp/)).toBeNull()
    })

    it('hides the panel when it is turned off', () => {
      renderWorkspace({ tabs: [ssh], activeId: 's', side: { ...side, visible: false, width: 320 } })
      expect(screen.queryByText('sftp s')).toBeNull()
    })

    it('puts the panel below the terminal when the area is narrower than 880 px', () => {
      const observers: ResizeObserverCallback[] = []
      const Original = globalThis.ResizeObserver
      globalThis.ResizeObserver = class {
        constructor(callback: ResizeObserverCallback) {
          observers.push(callback)
        }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      }
      try {
        const props = {
          activeId: 's',
          openError: null,
          platform: 'linux',
          renderTerminal: () => <div>terminal</div>,
          side: { ...side, visible: true, width: 320 },
          onOpenLocal: vi.fn(),
          onReopen: vi.fn(),
          onCloseTab: vi.fn(),
          onRetry: vi.fn(),
          onEdit: vi.fn(),
        }
        // The first tab arrives after mount, as in the app.
        const { rerender } = render(<Workspace {...props} tabs={[]} />)
        rerender(<Workspace {...props} tabs={[ssh]} />)
        const entry = { contentRect: { width: 600 } } as ResizeObserverEntry
        act(() => {
          for (const cb of observers) cb([entry], {} as ResizeObserver)
        })
        expect(screen.queryByRole('separator')).toBeNull()
        expect(screen.getByText('sftp s').parentElement).toHaveStyle({ height: '240px' })
      } finally {
        globalThis.ResizeObserver = Original
      }
    })

    it('widens the panel with the arrow keys on the separator', async () => {
      const onSideWidth = vi.fn()
      renderWorkspace({
        tabs: [ssh],
        activeId: 's',
        side: { ...side, onSideWidth, visible: true, width: 320 },
      })
      screen.getByRole('separator').focus()
      await userEvent.keyboard('{ArrowLeft}')
      expect(onSideWidth).toHaveBeenCalledWith(336)
    })
  })
})

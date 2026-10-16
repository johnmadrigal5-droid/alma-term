import { TunnelSpec } from '@alma/protocol'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TunnelsPanel, type TunnelsPanelProps } from './TunnelsPanel'
import type { TunnelView } from './tunnels-store'

const spec = TunnelSpec.parse({ type: 'L', bindPort: 8080, targetHost: 'db', targetPort: 5432 })
const view = (over: Partial<TunnelView> = {}): TunnelView => ({
  tunnelId: 't1',
  sessionId: 's1',
  spec,
  state: 'open',
  boundPort: 8080,
  connections: 0,
  error: null,
  savedTunnelId: null,
  ...over,
})

function setup(views: TunnelView[], over: Partial<TunnelsPanelProps> = {}) {
  const props: TunnelsPanelProps = {
    views,
    sessionTitle: () => 'alma@srv',
    onNew: vi.fn(),
    onClose: vi.fn(),
    onRetry: vi.fn(),
    onClearClosed: vi.fn(),
    onForget: vi.fn(),
    savedIdle: [],
    onOpenSaved: vi.fn(),
    onForgetSaved: vi.fn(),
    ...over,
  }
  render(<TunnelsPanel {...props} />)
  return props
}

describe('TunnelsPanel', () => {
  it('shows the empty state with a way to create one', async () => {
    const p = setup([])
    expect(screen.getByText('Sin túneles')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Nuevo túnel' }))
    expect(p.onNew).toHaveBeenCalledOnce()
  })

  it('lists an open tunnel with its route, session and connections', () => {
    setup([view({ connections: 2 })])
    const row = screen.getByRole('listitem')
    expect(within(row).getByText('Local')).toBeVisible()
    expect(within(row).getByText('127.0.0.1:8080 → db:5432')).toBeVisible()
    expect(within(row).getByText(/alma@srv/)).toBeVisible()
    expect(within(row).getByText(/2 conexiones/)).toBeVisible()
  })

  it('closes a tunnel from its row', async () => {
    const p = setup([view()])
    await userEvent.click(
      screen.getByRole('button', { name: 'Cerrar túnel 127.0.0.1:8080 → db:5432' }),
    )
    expect(p.onClose).toHaveBeenCalledWith('t1')
  })

  it('shows an opening tunnel as busy and cannot be closed yet', () => {
    setup([view({ state: 'opening', boundPort: 0 })])
    expect(screen.getByRole('listitem')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Abriendo…')).toBeVisible()
    expect(screen.getByRole('button', { name: /Cerrar túnel/ })).toBeDisabled()
  })

  it('shows a failed tunnel with its message and the next step', async () => {
    const p = setup([
      view({
        state: 'error',
        error: { code: 'TUNNEL_BIND_IN_USE', message: 'El puerto 8080 ya está en uso' },
      }),
    ])
    expect(screen.getByText('Puerto local en uso')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Elegir otro puerto' }))
    expect(p.onRetry).toHaveBeenCalledWith(expect.objectContaining({ tunnelId: 't1' }))
  })

  it('offers to clear closed tunnels', async () => {
    const p = setup([view({ state: 'closed' })])
    expect(screen.getByText('Cerrado')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar cerrados' }))
    expect(p.onClearClosed).toHaveBeenCalledOnce()
  })

  it('labels a dynamic tunnel as a SOCKS5 proxy', () => {
    setup([
      view({
        spec: TunnelSpec.parse({ type: 'D', bindPort: 1080 }),
        boundPort: 1080,
      }),
    ])
    expect(screen.getByText('Dinámico')).toBeVisible()
    expect(screen.getByText('127.0.0.1:1080 · SOCKS5')).toBeVisible()
  })

  it('marks a saved tunnel and lets the user forget it', async () => {
    const p = setup([view({ savedTunnelId: 'saved-1' })])
    expect(screen.getByText('Guardado')).toBeVisible()
    await userEvent.click(
      screen.getByRole('button', { name: 'Olvidar túnel 127.0.0.1:8080 → db:5432' }),
    )
    expect(p.onForget).toHaveBeenCalledWith('t1')
  })

  it('shows no forget button for a tunnel that is not saved', () => {
    setup([view()])
    expect(screen.queryByText('Guardado')).toBeNull()
    expect(screen.queryByRole('button', { name: /Olvidar túnel/ })).toBeNull()
  })

  it('I3: lists the saved tunnels that are not running, to open or forget them', async () => {
    const saved = { id: 'saved-1', savedId: 'bm', spec, autoStart: false }
    const p = setup([], { savedIdle: [{ tunnel: saved, sessionId: 's1', title: 'Prod' }] })
    expect(screen.queryByText('Sin túneles')).toBeNull()
    expect(screen.getByText('Guardados')).toBeVisible()
    expect(screen.getByText('127.0.0.1:8080 → db:5432')).toBeVisible()
    await userEvent.click(
      screen.getByRole('button', { name: 'Abrir túnel guardado 127.0.0.1:8080 → db:5432' }),
    )
    expect(p.onOpenSaved).toHaveBeenCalledWith('s1', saved)
    await userEvent.click(
      screen.getByRole('button', { name: 'Olvidar túnel guardado 127.0.0.1:8080 → db:5432' }),
    )
    expect(p.onForgetSaved).toHaveBeenCalledWith(saved)
  })
})

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { folder, session } from '../sessions/fixtures'
import { buildRows } from '../sessions/tree-model'
import { Sidebar, type SidebarProps } from './Sidebar'

function setup(over: Partial<SidebarProps> = {}) {
  const props: SidebarProps = {
    status: 'ready',
    error: null,
    rows: [],
    empty: true,
    query: '',
    onQuery: vi.fn(),
    onRetry: vi.fn(),
    onNewSsh: vi.fn(),
    onNewFolder: vi.fn(),
    onImport: vi.fn(),
    onOpenLocal: vi.fn(),
    onConnect: vi.fn(),
    onToggle: vi.fn(),
    onAction: vi.fn(),
    section: 'sessions',
    activeTransfers: 0,
    activeTunnels: 0,
    onSection: vi.fn(),
    transfers: <p>lista de transferencias</p>,
    tunnels: <p>lista de túneles</p>,
    ...over,
  }
  render(<Sidebar {...props} />)
  return props
}

describe('Sidebar', () => {
  it('shows a busy skeleton while loading', () => {
    setup({ status: 'loading' })
    expect(screen.getByLabelText('Cargando sesiones')).toHaveAttribute('aria-busy', 'true')
  })

  it('offers Reintentar on error', async () => {
    const p = setup({ status: 'error', error: 'db rota' })
    expect(screen.getByText('db rota')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(p.onRetry).toHaveBeenCalledOnce()
  })

  it('shows the empty state with the three actions', () => {
    setup()
    expect(screen.getByText('Aún no tienes sesiones')).toBeVisible()
    for (const name of ['Nueva sesión SSH', 'Importar ~/.ssh/config', 'Abrir terminal local'])
      expect(screen.getByRole('button', { name })).toBeVisible()
  })

  it('renders the tree and filters through the search box', async () => {
    const f = folder('Clientes')
    const rows = buildRows(
      { folders: [f], sessions: [session('Web', f.id)], canRemember: true },
      new Set([f.id]),
      '',
      new Map(),
    )
    const p = setup({ rows, empty: false })
    expect(screen.getByRole('treeitem', { name: /Web/ })).toBeVisible()
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar sesiones' }), 'w')
    expect(p.onQuery).toHaveBeenCalledWith('w')
  })

  it('says when the search has no results', () => {
    setup({ rows: [], empty: false, query: 'zzz' })
    expect(screen.getByText('Ninguna sesión coincide con «zzz»')).toBeVisible()
  })

  it('names the transfers section with its active count and switches to it', async () => {
    const p = setup({ activeTransfers: 2 })
    await userEvent.click(screen.getByRole('button', { name: 'Transferencias, 2 activas' }))
    expect(p.onSection).toHaveBeenCalledWith('transfers')
  })

  it('shows the transfers list in the transfers section', () => {
    setup({ section: 'transfers' })
    expect(screen.getByText('lista de transferencias')).toBeVisible()
    expect(screen.queryByText('Aún no tienes sesiones')).toBeNull()
  })

  it('lists the sections as sessions, tunnels, transfers', () => {
    setup()
    const names = within(screen.getByRole('navigation', { name: 'Secciones' }))
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(names).toEqual(['Sesiones', 'Túneles', 'Transferencias'])
  })

  it('names the tunnels section with its active count and switches to it', async () => {
    const p = setup({ activeTunnels: 2 })
    await userEvent.click(screen.getByRole('button', { name: 'Túneles, 2 activos' }))
    expect(p.onSection).toHaveBeenCalledWith('tunnels')
  })

  it('says 1 activo for a single tunnel and shows no count for none', () => {
    const { unmount } = render(<></>)
    unmount()
    setup({ activeTunnels: 1 })
    expect(screen.getByRole('button', { name: 'Túneles, 1 activo' })).toBeVisible()
  })

  it('shows the tunnels list in the tunnels section', () => {
    setup({ section: 'tunnels' })
    expect(screen.getByText('lista de túneles')).toBeVisible()
    expect(screen.queryByText('Aún no tienes sesiones')).toBeNull()
  })
})

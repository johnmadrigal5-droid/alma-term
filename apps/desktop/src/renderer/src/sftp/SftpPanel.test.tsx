import type { RemoteEntry } from '@alma/protocol'
import { createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SftpPanel, type SftpPanelProps } from './SftpPanel'
import type { PanelState } from './sftp-store'

const entry = (name: string, over: Partial<RemoteEntry> = {}): RemoteEntry => ({
  name,
  kind: 'file',
  size: 1536,
  mtimeMs: 0,
  mode: 0o644,
  ...over,
})
const ready = (entries: RemoteEntry[], over: Partial<PanelState> = {}): PanelState => ({
  path: '/home/alma',
  entries,
  status: 'ready',
  error: null,
  rowErrors: {},
  loaded: true,
  mode: 'sftp',
  ...over,
})

function renderPanel(panel: PanelState | undefined, over: Partial<SftpPanelProps> = {}) {
  const props: SftpPanelProps = {
    panel,
    onRetry: vi.fn(),
    onCd: vi.fn(),
    onUp: vi.fn(),
    onGoto: vi.fn(),
    onRefresh: vi.fn(),
    onMkdir: vi.fn(async () => null),
    onRename: vi.fn(),
    onRemove: vi.fn(),
    onChmod: vi.fn(),
    onDownload: vi.fn(),
    onPickUpload: vi.fn(),
    onUploadPaths: vi.fn(),
    onHide: vi.fn(),
    getPathForFile: (file) => `/l/${file.name}`,
    ...over,
  }
  render(<SftpPanel {...props} />)
  return props
}

describe('SftpPanel', () => {
  it('shows skeleton rows while loading', () => {
    renderPanel({ ...ready([]), status: 'loading' })
    expect(screen.getByRole('region', { name: 'Archivos remotos' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
  })

  it('lists entries with readable size', () => {
    renderPanel(ready([entry('docs', { kind: 'dir' }), entry('a.txt')]))
    const grid = screen.getByRole('grid', { name: 'Archivos de /home/alma' })
    expect(within(grid).getAllByRole('row')).toHaveLength(2)
    expect(within(grid).getByText('1.5 KB')).toBeVisible()
  })

  it('invites to drop files into an empty folder', () => {
    renderPanel(ready([]))
    expect(screen.getByText('Carpeta vacía, arrastra archivos aquí')).toBeVisible()
  })

  it('shows a listing error with a retry button', async () => {
    const props = renderPanel({ ...ready([]), status: 'error', error: 'Permiso denegado' })
    expect(screen.getByRole('alert')).toHaveTextContent('Permiso denegado')
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(props.onRetry).toHaveBeenCalled()
  })

  it('enters a folder on double click and on Enter, and goes up with Backspace', async () => {
    const props = renderPanel(ready([entry('docs', { kind: 'dir' })]))
    const row = screen.getByRole('row', { name: /docs/ })
    await userEvent.dblClick(row)
    expect(props.onCd).toHaveBeenCalledWith('docs')
    row.focus()
    await userEvent.keyboard('{Enter}')
    expect(props.onCd).toHaveBeenCalledTimes(2)
    await userEvent.keyboard('{Backspace}')
    expect(props.onUp).toHaveBeenCalled()
  })

  it('shows names with spaces, accents and control characters literally', () => {
    renderPanel(ready([entry('mi café #1\n.txt')]))
    expect(screen.getByRole('row', { name: /mi café #1␊\.txt/ })).toBeVisible()
  })

  it('renders fewer than 100 rows for 5000 entries', () => {
    const many = Array.from({ length: 5000 }, (_, i) => entry(`f${i}`))
    renderPanel(ready(many))
    expect(screen.getAllByRole('row').length).toBeLessThan(100)
    expect(screen.getByRole('grid')).toHaveAttribute('aria-rowcount', '5000')
  })

  it('uploads dropped files with their local path', () => {
    const props = renderPanel(ready([]))
    const file = new File(['x'], 'nota.txt')
    fireEvent.drop(screen.getByRole('region', { name: 'Archivos remotos' }), {
      dataTransfer: {
        files: [file],
        items: [{ webkitGetAsEntry: () => ({ isDirectory: false }) }],
      },
    })
    expect(props.onUploadPaths).toHaveBeenCalledWith(['/l/nota.txt'])
  })

  it('M4: does not upload files dropped while the folder loads', () => {
    const props = renderPanel(ready([], { status: 'loading' }))
    fireEvent.drop(screen.getByRole('region', { name: 'Archivos remotos' }), {
      dataTransfer: {
        files: [new File(['x'], 'a.txt')],
        items: [{ webkitGetAsEntry: () => ({ isDirectory: false }) }],
      },
    })
    expect(props.onUploadPaths).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('Espera a que cargue la carpeta')
  })

  it('M4: keeps the drop highlight while the pointer crosses child elements', () => {
    renderPanel(ready([]))
    const region = screen.getByRole('region', { name: 'Archivos remotos' })
    fireEvent.dragOver(region, { dataTransfer: { types: ['Files'] } })
    // jsdom has no DragEvent, so relatedTarget is set by hand.
    const leave = createEvent.dragLeave(region)
    Object.defineProperty(leave, 'relatedTarget', {
      value: within(region).getByRole('heading', { name: 'SFTP' }),
    })
    fireEvent(region, leave)
    expect(region).toHaveClass('ring-2')
  })

  it('explains that folders cannot be transferred yet', () => {
    const props = renderPanel(ready([]))
    fireEvent.drop(screen.getByRole('region', { name: 'Archivos remotos' }), {
      dataTransfer: {
        files: [new File([], 'carpeta')],
        items: [{ webkitGetAsEntry: () => ({ isDirectory: true }) }],
      },
    })
    expect(props.onUploadPaths).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Las carpetas aún no se pueden transferir; arrastra los archivos',
    )
  })

  it('keeps menu keys inside the menu instead of the row', async () => {
    const props = renderPanel(ready([entry('docs', { kind: 'dir' })]))
    await userEvent.click(screen.getByRole('button', { name: 'Acciones de docs' }))
    await screen.findByRole('menuitem', { name: 'Abrir' })
    await userEvent.keyboard('{ArrowDown}{ArrowUp}{Enter}')
    expect(props.onCd).toHaveBeenCalledTimes(1)
    expect(props.onUp).not.toHaveBeenCalled()
  })

  it('asks before deleting', async () => {
    const props = renderPanel(ready([entry('a.txt')]))
    await userEvent.click(screen.getByRole('button', { name: 'Acciones de a.txt' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Eliminar' }))
    const confirm = screen.getByRole('dialog', { name: 'Eliminar «a.txt»' })
    expect(props.onRemove).not.toHaveBeenCalled()
    await userEvent.click(within(confirm).getByRole('button', { name: 'Eliminar' }))
    expect(props.onRemove).toHaveBeenCalledWith(expect.objectContaining({ name: 'a.txt' }))
  })

  it('shows the error of a failed action on its row', () => {
    renderPanel(ready([entry('a.txt')], { rowErrors: { 'a.txt': 'Permiso denegado' } }))
    expect(screen.getByRole('row', { name: /a\.txt/ })).toHaveTextContent('Permiso denegado')
  })

  it('navigates with the breadcrumb', async () => {
    const props = renderPanel(ready([]))
    await userEvent.click(screen.getByRole('button', { name: 'home' }))
    expect(props.onGoto).toHaveBeenCalledWith('/home')
  })

  it('validates new folder names', async () => {
    const props = renderPanel(ready([]))
    await userEvent.click(screen.getByRole('button', { name: 'Nueva carpeta' }))
    const dialog = screen.getByRole('dialog', { name: 'Nueva carpeta' })
    await userEvent.type(within(dialog).getByLabelText('Nombre'), 'a/b')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('«/»')
    expect(props.onMkdir).not.toHaveBeenCalled()
  })

  it('changes permissions with octal input', async () => {
    const props = renderPanel(ready([entry('a.sh')]))
    await userEvent.click(screen.getByRole('button', { name: 'Acciones de a.sh' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Permisos' }))
    const dialog = screen.getByRole('dialog', { name: 'Permisos de «a.sh»' })
    const input = within(dialog).getByLabelText('Permisos (octal)')
    await userEvent.clear(input)
    await userEvent.type(input, '755')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aplicar' }))
    expect(props.onChmod).toHaveBeenCalledWith(expect.objectContaining({ name: 'a.sh' }), 0o755)
  })

  it('A11y: gives every breadcrumb a pointer target of at least 24 px (WCAG 2.5.8)', () => {
    renderPanel(ready([]))
    const crumbs = within(screen.getByRole('navigation', { name: 'Ruta' })).getAllByRole('button')
    expect(crumbs.length).toBeGreaterThan(1)
    // jsdom has no layout: the minimum size is pinned through its utility classes.
    for (const crumb of crumbs) {
      expect(crumb).toHaveClass('min-h-6')
      expect(crumb).toHaveClass('min-w-6')
    }
  })

  it('says it is in scp mode with limited functions, as a status', () => {
    renderPanel(ready([entry('a')], { mode: 'scp' }))
    expect(screen.getByRole('status')).toHaveTextContent('Modo SCP, funciones limitadas')
  })

  it('shows no scp notice with sftp', () => {
    renderPanel(ready([entry('a')]))
    expect(screen.queryByText(/Modo SCP/)).toBeNull()
  })

  it('shows a dash where the server gave no size or date', () => {
    renderPanel(ready([entry('nota.txt', { size: 0, mtimeMs: 0 })], { mode: 'scp' }))
    const row = screen.getByRole('row', { name: /^nota\.txt,/ })
    expect(within(row).getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })
})

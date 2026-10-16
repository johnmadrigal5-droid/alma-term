import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SessionTree } from './SessionTree'
import type { TreeRow } from './tree-model'

const rows: TreeRow[] = [
  { kind: 'folder', id: 'f1', depth: 0, name: 'Clientes', parentId: null, expanded: false },
  { kind: 'session', id: 's1', depth: 0, name: 'Casa', parentId: null, detail: 'alma@casa' },
  { kind: 'session', id: 's2', depth: 0, name: 'Prod', parentId: null, detail: 'root@prod' },
]

function setup() {
  const handlers = { onConnect: vi.fn(), onToggle: vi.fn(), onAction: vi.fn() }
  render(<SessionTree rows={rows} {...handlers} />)
  return handlers
}

describe('SessionTree', () => {
  it('renders a tree with one item per row', () => {
    setup()
    expect(screen.getByRole('tree', { name: 'Sesiones guardadas' })).toBeVisible()
    expect(screen.getAllByRole('treeitem')).toHaveLength(3)
  })

  it('moves focus with the arrow keys', async () => {
    setup()
    const [first, second] = screen.getAllByRole('treeitem')
    first?.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(second).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(first).toHaveFocus()
  })

  it('connects with Enter and double click', async () => {
    const h = setup()
    const casa = screen.getByRole('treeitem', { name: /Casa/ })
    casa.focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.dblClick(screen.getByRole('treeitem', { name: /Prod/ }))
    expect(h.onConnect.mock.calls).toEqual([['s1'], ['s2']])
  })

  it('opens a closed folder with ArrowRight', async () => {
    const h = setup()
    screen.getByRole('treeitem', { name: /Clientes/ }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(h.onToggle).toHaveBeenCalledWith('f1')
  })

  it('asks for confirmation on Delete and removes after confirming', async () => {
    const h = setup()
    screen.getByRole('treeitem', { name: /Casa/ }).focus()
    await userEvent.keyboard('{Delete}')
    expect(screen.getByRole('dialog', { name: 'Eliminar «Casa»' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar' }))
    expect(h.onAction).toHaveBeenCalledWith('remove', rows[1])
  })

  it('explains that sessions move to the root when a folder is deleted', async () => {
    setup()
    screen.getByRole('treeitem', { name: /Clientes/ }).focus()
    await userEvent.keyboard('{Delete}')
    expect(
      screen.getByText(
        'Se eliminarán la carpeta y sus subcarpetas. Las sesiones que contiene pasan a la raíz.',
      ),
    ).toBeVisible()
  })
})

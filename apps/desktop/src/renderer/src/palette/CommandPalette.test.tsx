import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CommandPalette } from './CommandPalette'
import type { PaletteGroup } from './palette-items'

const groups: PaletteGroup[] = [
  {
    heading: 'Sesiones guardadas',
    items: [
      {
        id: 'connect:a',
        label: 'Conectar · Prod',
        detail: 'root@prod',
        command: { type: 'connect', savedId: 'a' },
      },
      {
        id: 'connect:b',
        label: 'Conectar · Casa',
        detail: 'alma@casa',
        command: { type: 'connect', savedId: 'b' },
      },
    ],
  },
]

describe('CommandPalette', () => {
  it('filters by text and runs the selected command with Enter', async () => {
    const onRun = vi.fn()
    render(<CommandPalette groups={groups} onRun={onRun} onClose={vi.fn()} />)
    await userEvent.type(screen.getByRole('combobox', { name: 'Paleta de comandos' }), 'prod')
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      expect.stringContaining('Prod'),
    ])
    await userEvent.keyboard('{Enter}')
    expect(onRun).toHaveBeenCalledWith({ type: 'connect', savedId: 'a' })
  })

  it('shows Sin resultados when nothing matches', async () => {
    render(<CommandPalette groups={groups} onRun={vi.fn()} onClose={vi.fn()} />)
    await userEvent.type(screen.getByRole('combobox'), 'zzzz')
    expect(screen.getByText('Sin resultados')).toBeVisible()
  })

  it('closes with Escape', async () => {
    const onClose = vi.fn()
    render(<CommandPalette groups={groups} onRun={vi.fn()} onClose={onClose} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })
})

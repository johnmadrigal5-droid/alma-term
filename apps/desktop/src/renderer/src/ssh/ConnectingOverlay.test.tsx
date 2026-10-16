import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConnectingOverlay } from './ConnectingOverlay'

describe('ConnectingOverlay', () => {
  it('marks the active step and the completed ones', () => {
    render(<ConnectingOverlay title="alma@srv" step="auth" />)
    expect(screen.getByRole('status')).toHaveTextContent('Conectando a alma@srv')
    const items = screen.getAllByRole('listitem')
    expect(items.map((i) => i.textContent)).toEqual([
      'TCP',
      'Clave de host',
      'Autenticación',
      'Shell',
    ])
    expect(items[2]).toHaveAttribute('aria-current', 'step')
    expect(items[0]).toHaveAttribute('data-state', 'done')
    expect(items[3]).toHaveAttribute('data-state', 'pending')
  })

  it('starts at TCP before any step event', () => {
    render(<ConnectingOverlay title="alma@srv" step={null} />)
    expect(screen.getAllByRole('listitem')[0]).toHaveAttribute('aria-current', 'step')
  })
})

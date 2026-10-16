import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ThemeButton } from './ThemeButton'

describe('ThemeButton', () => {
  it('offers the light theme while dark and the dark one while light', () => {
    const { rerender } = render(<ThemeButton theme="dark" onToggle={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Cambiar a tema claro' })).toBeVisible()
    rerender(<ThemeButton theme="light" onToggle={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Cambiar a tema oscuro' })).toBeVisible()
  })

  it('toggles on click', async () => {
    const onToggle = vi.fn()
    render(<ThemeButton theme="dark" onToggle={onToggle} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar a tema claro' }))
    expect(onToggle).toHaveBeenCalledOnce()
  })
})

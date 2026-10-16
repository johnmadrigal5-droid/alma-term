import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StatusBar } from './StatusBar'

describe('StatusBar', () => {
  it('offers to show the SFTP panel once it is hidden', () => {
    const onToggle = vi.fn()
    render(<StatusBar readyCount={1} sftp={{ visible: false, onToggle }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar SFTP' }))
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('has no SFTP button without an SSH tab', () => {
    render(<StatusBar readyCount={1} />)
    expect(screen.queryByRole('button', { name: /SFTP/ })).toBeNull()
  })

  it('pluralises the active session count', () => {
    const { rerender } = render(<StatusBar readyCount={1} />)
    expect(screen.getByText('1 sesión activa')).toBeVisible()
    rerender(<StatusBar readyCount={3} />)
    expect(screen.getByText('3 sesiones activas')).toBeVisible()
  })

  it('shows the transfers in flight', () => {
    const { rerender } = render(<StatusBar readyCount={1} transferCount={0} />)
    expect(screen.queryByText(/transferencia/)).toBeNull()
    rerender(<StatusBar readyCount={1} transferCount={2} />)
    expect(screen.getByText('2 transferencias')).toBeVisible()
  })

  it('shows the tunnels that are open', () => {
    const { rerender } = render(<StatusBar readyCount={1} tunnelCount={0} />)
    expect(screen.queryByText(/túnel/)).toBeNull()
    rerender(<StatusBar readyCount={1} tunnelCount={1} />)
    expect(screen.getByText('1 túnel')).toBeVisible()
    rerender(<StatusBar readyCount={1} tunnelCount={3} />)
    expect(screen.getByText('3 túneles')).toBeVisible()
  })
})

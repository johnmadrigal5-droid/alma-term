import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Tab } from '../state/sessions-store'
import { MultiExecBar } from './MultiExecBar'

const tab = (id: string, status: Tab['status'] = 'ready'): Tab => ({
  sessionId: id,
  title: `srv ${id}`,
  kind: 'ssh',
  status,
  exitCode: null,
  generation: 0,
  step: null,
  error: null,
  request: null,
})

type BarProps = Parameters<typeof MultiExecBar>[0]

function renderBarProps(over: Partial<BarProps> = {}): BarProps {
  return {
    tabs: [tab('a'), tab('b'), tab('c', 'closed')],
    targets: [] as string[],
    broadcast: false,
    history: [] as string[],
    focusRequest: 0,
    platform: 'linux',
    onToggleTarget: vi.fn(),
    onSetTargets: vi.fn(),
    onToggleBroadcast: vi.fn(),
    onRun: vi.fn(() => ({ sent: 2, skipped: 0 })),
    onClose: vi.fn(),
    ...over,
  }
}

function renderBar(over: Partial<BarProps> = {}) {
  const props = renderBarProps(over)
  render(<MultiExecBar {...props} />)
  return props
}

describe('MultiExecBar', () => {
  it('shows the empty state without ready sessions', () => {
    renderBar({ tabs: [tab('c', 'closed')] })
    expect(screen.getByText('Abre sesiones para usar MultiExec')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Ejecutar en 0' })).toBeDisabled()
  })

  it('offers a chip per ready session and selects all', async () => {
    const p = renderBar()
    expect(screen.getAllByRole('button', { pressed: false }).map((b) => b.textContent)).toEqual([
      'srv a',
      'srv b',
    ])
    await userEvent.click(screen.getByRole('button', { name: 'Todas' }))
    expect(p.onSetTargets).toHaveBeenCalledWith(['a', 'b'])
  })

  it('counts only ready targets', () => {
    renderBar({ targets: ['a', 'c'] })
    expect(screen.getByRole('button', { name: 'Ejecutar en 1' })).toBeVisible()
  })

  it('runs the command with Enter and reports the result', async () => {
    const p = renderBar({ targets: ['a', 'b'] })
    await userEvent.type(screen.getByLabelText('Comando para MultiExec'), 'uptime{Enter}')
    expect(p.onRun).toHaveBeenCalledWith('uptime')
    expect(screen.getByRole('status')).toHaveTextContent('Enviado a 2 sesiones')
    expect(screen.getByLabelText('Comando para MultiExec')).toHaveValue('')
  })

  it('reports targets that could not receive', async () => {
    renderBar({ targets: ['a', 'b'], onRun: vi.fn(() => ({ sent: 1, skipped: 1 })) })
    await userEvent.type(screen.getByLabelText('Comando para MultiExec'), 'ls{Enter}')
    expect(screen.getByRole('status')).toHaveTextContent('Enviado a 1 de 2; 1 sin conexión')
  })

  it('walks the history with the arrow keys', async () => {
    renderBar({ targets: ['a'], history: ['df -h', 'uptime'] })
    const field = screen.getByLabelText('Comando para MultiExec')
    await userEvent.type(field, '{ArrowUp}{ArrowUp}')
    expect(field).toHaveValue('uptime')
    await userEvent.type(field, '{ArrowDown}{ArrowDown}')
    expect(field).toHaveValue('')
  })

  it('switches keystroke broadcast', async () => {
    const p = renderBar({ targets: ['a'] })
    const toggle = screen.getByRole('switch', { name: 'Broadcast de teclas' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(toggle)
    expect(p.onToggleBroadcast).toHaveBeenCalledOnce()
  })

  it('focuses the field when asked', () => {
    const { rerender } = render(<MultiExecBar {...renderBarProps()} focusRequest={0} />)
    rerender(<MultiExecBar {...renderBarProps()} focusRequest={1} />)
    expect(screen.getAllByLabelText('Comando para MultiExec').at(-1)).toHaveFocus()
  })

  it('M4: says why Enter does nothing when no session is selected', async () => {
    const p = renderBar({ targets: [] })
    await userEvent.type(screen.getByLabelText('Comando para MultiExec'), 'ls{Enter}')
    expect(p.onRun).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('Selecciona al menos una sesión')
    expect(screen.getByLabelText('Comando para MultiExec')).toHaveValue('ls')
  })

  it('M4: clears the "Enviado" notice after a few seconds', () => {
    vi.useFakeTimers()
    try {
      renderBar({ targets: ['a', 'b'] })
      const field = screen.getByLabelText('Comando para MultiExec')
      fireEvent.change(field, { target: { value: 'ls' } })
      fireEvent.keyDown(field, { key: 'Enter' })
      expect(screen.getByRole('status')).toHaveTextContent('Enviado a 2 sesiones')
      act(() => {
        vi.advanceTimersByTime(4000)
      })
      expect(screen.queryByRole('status')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('M4: does not run on the Enter that confirms an IME composition', () => {
    const p = renderBar({ targets: ['a'] })
    const field = screen.getByLabelText('Comando para MultiExec')
    fireEvent.change(field, { target: { value: 'にほん' } })
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true })
    expect(p.onRun).not.toHaveBeenCalled()
  })

  it('M4: keeps leading spaces (HISTCONTROL=ignorespace) and drops trailing ones', async () => {
    const p = renderBar({ targets: ['a'] })
    await userEvent.type(screen.getByLabelText('Comando para MultiExec'), '  secreto  {Enter}')
    expect(p.onRun).toHaveBeenCalledWith('  secreto')
  })

  it('M4: tells apart sessions that share a title', () => {
    renderBar({ tabs: [tab('a'), { ...tab('b'), title: 'srv a' }, tab('c')] })
    expect(screen.getByRole('button', { name: 'srv a (1)' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'srv a (2)' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'srv c' })).toBeVisible()
  })

  it('M8: gets the unsent draft back after browsing the history', async () => {
    renderBar({ targets: ['a'], history: ['uptime'] })
    const field = screen.getByLabelText('Comando para MultiExec')
    await userEvent.type(field, 'df -h')
    await userEvent.keyboard('{ArrowUp}')
    expect(field).toHaveValue('uptime')
    await userEvent.keyboard('{ArrowDown}')
    expect(field).toHaveValue('df -h')
  })
})

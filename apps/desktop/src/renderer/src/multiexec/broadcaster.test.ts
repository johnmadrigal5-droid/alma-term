// @vitest-environment node
import { describe, expect, it, vi, type Mock } from 'vitest'
import { TerminalRegistry, type TerminalHandle } from '../terminal/terminal-registry'
import { sendCommand, startBroadcast, type BroadcastState } from './broadcaster'

function setup(state: Partial<BroadcastState> = {}) {
  const registry = new TerminalRegistry()
  const handles: Record<string, TerminalHandle & { write: Mock<(text: string) => void> }> = {}
  for (const id of ['a', 'b', 'c']) {
    const handle = {
      modes: () => ({ applicationCursorKeysMode: id === 'c', bracketedPasteMode: false }),
      write: vi.fn<(text: string) => void>(),
    }
    handles[id] = handle
    registry.register(id, handle)
  }
  const current: BroadcastState = {
    broadcast: true,
    targets: ['a', 'b', 'c'],
    activeId: 'a',
    ready: new Set(['a', 'b', 'c']),
    ...state,
  }
  const stop = startBroadcast(registry, () => current)
  return { registry, handles, stop }
}

describe('startBroadcast', () => {
  it('forwards the active input to every other target in its own mode', () => {
    const { registry, handles } = setup()
    registry.emitInput('a', { kind: 'keys', data: '\x1b[A' })
    expect(handles.b?.write).toHaveBeenCalledWith('\x1b[A')
    expect(handles.c?.write).toHaveBeenCalledWith('\x1bOA')
  })

  it('never writes the input back to the active session', () => {
    const { registry, handles } = setup()
    registry.emitInput('a', { kind: 'keys', data: 'x' })
    expect(handles.a?.write).not.toHaveBeenCalled()
  })

  it('ignores input of sessions that are not active', () => {
    const { registry, handles } = setup()
    registry.emitInput('b', { kind: 'keys', data: 'x' })
    expect(handles.c?.write).not.toHaveBeenCalled()
  })

  it('does nothing with broadcast off', () => {
    const { registry, handles } = setup({ broadcast: false })
    registry.emitInput('a', { kind: 'keys', data: 'x' })
    expect(handles.b?.write).not.toHaveBeenCalled()
  })

  it('skips targets that are not ready', () => {
    const { registry, handles } = setup({ ready: new Set(['a', 'c']) })
    registry.emitInput('a', { kind: 'keys', data: 'x' })
    expect(handles.b?.write).not.toHaveBeenCalled()
    expect(handles.c?.write).toHaveBeenCalledWith('x')
  })

  it('stops forwarding once stopped', () => {
    const { registry, handles, stop } = setup()
    stop()
    registry.emitInput('a', { kind: 'keys', data: 'x' })
    expect(handles.b?.write).not.toHaveBeenCalled()
  })
})

describe('sendCommand', () => {
  it('types the command and Enter once in each ready target, the active one included', () => {
    const { registry, handles } = setup()
    const result = sendCommand(registry, 'uptime', ['a', 'b', 'b', 'x'], new Set(['a', 'b']))
    expect(handles.a?.write).toHaveBeenCalledExactlyOnceWith('uptime\r')
    expect(handles.b?.write).toHaveBeenCalledExactlyOnceWith('uptime\r')
    expect(result).toEqual({ sent: 2, skipped: 1 })
  })
})

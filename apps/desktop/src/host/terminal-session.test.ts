import { describe, expect, it, vi } from 'vitest'
import { FakePort } from './test/fake-port'
import { FakePty } from './test/fake-pty'
import { FakeScheduler } from './test/fake-scheduler'
import { TerminalSession } from './terminal-session'

function setup() {
  const pty = new FakePty()
  const scheduler = new FakeScheduler()
  const onStatus = vi.fn()
  const onDetached = vi.fn()
  const warn = vi.fn()
  const session = new TerminalSession({ id: 's1', pty, onStatus, onDetached, scheduler, warn })
  const port = new FakePort()
  session.attach(port, false)
  return { pty, scheduler, onStatus, onDetached, warn, session, port }
}

const dataMessages = (port: FakePort) =>
  port.sent.filter(
    (m): m is { type: 'data'; seq: number; bytes: Uint8Array } =>
      typeof m === 'object' && m !== null && 'type' in m && m.type === 'data',
  )

describe('TerminalSession', () => {
  it('forwards pty output as numbered data messages', () => {
    const { pty, scheduler, port } = setup()
    pty.emitData('hola')
    scheduler.advance(20)
    pty.emitData('mundo')
    const msgs = dataMessages(port)
    expect(msgs.map((m) => m.seq)).toEqual([0, 1])
    expect(new TextDecoder().decode(msgs[0]?.bytes)).toBe('hola')
  })

  it('writes renderer input to the pty', () => {
    const { pty, port } = setup()
    port.deliver({ type: 'input', bytes: new Uint8Array([108, 115, 13]) })
    expect(pty.written).toEqual([new Uint8Array([108, 115, 13])])
  })

  it('ignores invalid renderer messages', () => {
    const { pty, port, warn } = setup()
    port.deliver({ type: 'input', bytes: 'ls' })
    expect(pty.written).toEqual([])
    expect(warn).toHaveBeenCalledOnce()
  })

  it('pauses the pty without acks and resumes after acks', () => {
    const { pty, scheduler, port } = setup()
    const big = new Uint8Array(600_000).fill(0x61)
    pty.emitData(big)
    scheduler.advance(20)
    pty.emitData(big)
    expect(pty.pauses).toBe(1)
    port.deliver({ type: 'ack', bytes: 1_000_000 })
    expect(pty.resumes).toBe(1)
  })

  it('reports exit to the port and the owner, then ignores resize', () => {
    const { pty, port, onStatus, session } = setup()
    pty.emitExit(0)
    expect(port.sent).toContainEqual({ type: 'exit', code: 0 })
    expect(onStatus).toHaveBeenCalledWith('closed', 0)
    session.resize(100, 30)
    expect(pty.resized).toEqual([])
  })

  it('survives a pty that throws on resize and write (dead fd)', () => {
    const { pty, port, session, warn } = setup()
    pty.resize = () => {
      throw new Error('EBADF')
    }
    pty.write = () => {
      throw new Error('EBADF')
    }
    expect(() => session.resize(100, 30)).not.toThrow()
    expect(() => port.deliver({ type: 'input', bytes: new Uint8Array([97]) })).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('escalates close() to SIGKILL when the shell ignores SIGHUP', () => {
    const { pty, scheduler, session } = setup()
    session.close()
    expect(pty.signals).toEqual([undefined])
    scheduler.advance(3000)
    expect(pty.signals).toEqual([undefined, 'SIGKILL'])
  })

  it('does not escalate when the shell exits after SIGHUP', () => {
    const { pty, scheduler, session } = setup()
    session.close()
    pty.emitExit(129)
    scheduler.advance(3000)
    expect(pty.signals).toEqual([undefined])
  })

  it('replays recent output after detach and reattach', () => {
    const { pty, scheduler, port, onDetached, session } = setup()
    pty.emitData('antes ')
    port.close()
    expect(onDetached).toHaveBeenCalledOnce()
    scheduler.advance(20)
    pty.emitData('durante')
    const next = new FakePort()
    session.attach(next, true)
    const replay = dataMessages(next)[0]
    expect(new TextDecoder().decode(replay?.bytes)).toBe('antes durante')
  })

  describe('session log', () => {
    function withLog() {
      const pty = new FakePty()
      const scheduler = new FakeScheduler()
      const log = { write: vi.fn(), close: vi.fn() }
      const warn = vi.fn()
      const session = new TerminalSession({
        id: 's1',
        pty,
        scheduler,
        warn,
        log,
        onStatus: vi.fn(),
        onDetached: vi.fn(),
      })
      return { pty, scheduler, log, warn, session }
    }

    it('logs the output even when no tab is attached, and closes the log on exit', () => {
      const { pty, scheduler, log } = withLog()
      pty.emitData('hola')
      scheduler.advance(20)
      expect(new TextDecoder().decode(log.write.mock.calls[0]?.[0] as Uint8Array)).toBe('hola')
      pty.emitExit(0)
      expect(log.close).toHaveBeenCalledOnce()
    })

    it('keeps the session alive when the log throws', () => {
      const { pty, scheduler, log, warn } = withLog()
      log.write.mockImplementation(() => {
        throw new Error('disco lleno')
      })
      pty.emitData('hola')
      scheduler.advance(20)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('disco lleno'))
    })
  })
})

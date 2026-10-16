import type { ControlRequest, HostEvent } from '@alma/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HostRequestError, HostSupervisor, type HostChild } from './host-supervisor'
import { RestartPolicy } from './restart-policy'

class FakeChild implements HostChild<string> {
  readonly posted: [unknown, string[]][] = []
  killed = false
  private messageListener: ((m: unknown) => void) | null = null
  private exitListener: ((code: number) => void) | null = null
  postMessage(message: unknown, transfer: string[]): void {
    this.posted.push([message, transfer])
  }
  onMessage(listener: (m: unknown) => void): void {
    this.messageListener = listener
  }
  onExit(listener: (code: number) => void): void {
    this.exitListener = listener
  }
  kill(): void {
    this.killed = true
  }
  emitMessage(m: unknown): void {
    this.messageListener?.(m)
  }
  emitExit(code: number): void {
    this.exitListener?.(code)
  }
}

const SID = '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d'
const RID = '6f1c3c2e-8f6a-4b8e-9d3f-2a1b0c9d8e7f'
const closeReq: ControlRequest = { type: 'session.close', requestId: RID, sessionId: SID }

function setup() {
  const children: FakeChild[] = []
  const events: HostEvent[] = []
  const lost = vi.fn()
  const gaveUp = vi.fn()
  const supervisor = new HostSupervisor<string>({
    fork: () => {
      const c = new FakeChild()
      children.push(c)
      return c
    },
    policy: new RestartPolicy(),
    onEvent: (e) => events.push(e),
    onHostLost: lost,
    onGaveUp: gaveUp,
  })
  supervisor.start()
  return { supervisor, children, events, lost, gaveUp }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('HostSupervisor', () => {
  it('resolves a request with the matching response and passes ports', async () => {
    const { supervisor, children } = setup()
    const p = supervisor.request(closeReq, ['port-a'])
    expect(children[0]?.posted[0]).toEqual([closeReq, ['port-a']])
    children[0]?.emitMessage({
      type: 'response',
      requestId: RID,
      ok: true,
      data: { sessionId: SID },
    })
    await expect(p).resolves.toEqual({ sessionId: SID })
  })

  it('rejects with the host error code', async () => {
    const { supervisor, children } = setup()
    const p = supervisor.request(closeReq)
    children[0]?.emitMessage({
      type: 'response',
      requestId: RID,
      ok: false,
      error: { code: 'SESSION_NOT_FOUND', message: 'no' },
    })
    await expect(p).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' })
  })

  it('rejects with TIMEOUT after 30 s without response', async () => {
    const { supervisor } = setup()
    const p = supervisor.request(closeReq)
    vi.advanceTimersByTime(30_000)
    await expect(p).rejects.toBeInstanceOf(HostRequestError)
    await expect(p).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('forwards status events', () => {
    const { children, events } = setup()
    children[0]?.emitMessage({ type: 'event.status', sessionId: SID, state: 'closed', exitCode: 0 })
    expect(events).toEqual([{ type: 'event.status', sessionId: SID, state: 'closed', exitCode: 0 }])
  })

  it('fails pending requests immediately and restarts when the host exits', async () => {
    const { supervisor, children, lost } = setup()
    const p = supervisor.request(closeReq)
    children[0]?.emitExit(1)
    await expect(p).rejects.toMatchObject({ code: 'HOST_UNAVAILABLE' })
    expect(lost).toHaveBeenCalledOnce()
    expect(children).toHaveLength(2)
    expect(supervisor.isAvailable).toBe(true)
  })

  it('gives up after the 4th crash within 60 s', async () => {
    const { supervisor, children, gaveUp } = setup()
    for (let i = 0; i < 4; i++) children[i]?.emitExit(1)
    expect(gaveUp).toHaveBeenCalledOnce()
    expect(children).toHaveLength(4)
    await expect(supervisor.request(closeReq)).rejects.toMatchObject({ code: 'HOST_UNAVAILABLE' })
  })

  it('does not restart after stop()', () => {
    const { supervisor, children } = setup()
    supervisor.stop()
    children[0]?.emitExit(0)
    expect(children[0]?.killed).toBe(true)
    expect(children).toHaveLength(1)
  })

  it('never times out a request sent with timeoutMs null', async () => {
    const { supervisor, children } = setup()
    let settled = false
    const done = () => {
      settled = true
    }
    void supervisor.request(closeReq, [], { timeoutMs: null }).then(done, done)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(settled).toBe(false)
    children[0]?.emitMessage({ type: 'response', requestId: RID, ok: true, data: null })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(true)
  })
})

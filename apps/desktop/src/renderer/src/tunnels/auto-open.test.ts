// @vitest-environment node
import { TunnelSpec, type AlmaApi, type SavedTunnel } from '@alma/protocol'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { autoOpen, resetAutoOpen } from './auto-open'

const spec = TunnelSpec.parse({ type: 'L', bindPort: 8080, targetHost: 'db', targetPort: 1 })
const saved = (n: number, autoStart: boolean): SavedTunnel => ({
  id: `0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c0${n}`,
  savedId: '7d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11',
  spec,
  autoStart,
})

function setup(
  list: SavedTunnel[],
  openResult:
    { ok: true } | { ok: false; error: { code: 'TUNNEL_BIND_IN_USE'; message: string } } = {
    ok: true,
  },
) {
  const api = {
    list: vi.fn(async () => ({ ok: true as const, data: list })),
  } as unknown as AlmaApi['tunnels']['saved']
  const open = vi.fn(async () => openResult)
  return { api, open }
}

describe('autoOpen', () => {
  beforeEach(resetAutoOpen)

  it('opens only the tunnels marked to start with the session', async () => {
    const { api, open } = setup([saved(1, true), saved(2, false), saved(3, true)])
    const result = await autoOpen({ api, open }, 'sid1', 'saved-id')
    expect(open).toHaveBeenCalledTimes(2)
    expect(open).toHaveBeenCalledWith('sid1', spec, saved(1, true).id)
    expect(result).toEqual({ opened: 2, failed: [] })
  })

  it('keeps opening the rest when one open throws', async () => {
    const { api } = setup([saved(1, true), saved(2, true), saved(3, true)])
    const open = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error('ipc down'))
      .mockResolvedValueOnce({ ok: true })
    const result = await autoOpen({ api, open }, 'sid1', 'saved-id')
    expect(open).toHaveBeenCalledTimes(3)
    expect(result.opened).toBe(2)
    expect(result.failed).toHaveLength(1)
  })

  it('reports the ones that fail and still opens the rest', async () => {
    const { api, open } = setup([saved(1, true), saved(2, true)])
    open.mockResolvedValueOnce({
      ok: false,
      error: { code: 'TUNNEL_BIND_IN_USE', message: 'en uso' },
    } as never)
    const result = await autoOpen({ api, open }, 'sid2', 'saved-id')
    expect(result.opened).toBe(1)
    expect(result.failed).toEqual([{ code: 'TUNNEL_BIND_IN_USE', message: 'en uso' }])
  })

  it('opens each saved tunnel once per session however often it is asked', async () => {
    const { api, open } = setup([saved(1, true)])
    await autoOpen({ api, open }, 'sid3', 'saved-id')
    await autoOpen({ api, open }, 'sid3', 'saved-id')
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('I3: a failed listing is not remembered: the next call tries again', async () => {
    const api = {
      list: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, error: { code: 'IO_FAILED', message: 'x' } })
        .mockResolvedValue({ ok: true, data: [saved(1, true)] }),
    } as unknown as AlmaApi['tunnels']['saved']
    const open = vi.fn(async () => ({ ok: true as const }))
    const first = await autoOpen({ api, open }, 'sid4', 'saved-id')
    expect(first.failed).toHaveLength(1)
    const second = await autoOpen({ api, open }, 'sid4', 'saved-id')
    expect(second.opened).toBe(1)
  })

  it('I3: two calls at once open each tunnel once', async () => {
    const { api, open } = setup([saved(1, true)])
    await Promise.all([
      autoOpen({ api, open }, 'sid5', 'saved-id'),
      autoOpen({ api, open }, 'sid5', 'saved-id'),
    ])
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('I3: hands the saved list to the caller so the panel can show the idle ones', async () => {
    const { api, open } = setup([saved(1, true), saved(2, false)])
    const onListed = vi.fn()
    await autoOpen({ api, open, onListed }, 'sid6', 'saved-id')
    expect(onListed).toHaveBeenCalledWith('saved-id', [saved(1, true), saved(2, false)])
  })
})

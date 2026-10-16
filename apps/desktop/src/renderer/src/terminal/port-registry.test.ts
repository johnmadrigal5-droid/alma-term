// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { PortRegistry } from './port-registry'

const port = (name: string) => ({ name, close: () => {} })

describe('PortRegistry', () => {
  it('resolves take() when the port arrives later', async () => {
    const r = new PortRegistry<ReturnType<typeof port>>()
    const p = r.take('a')
    r.deliver('a', port('port-a'))
    await expect(p).resolves.toMatchObject({ name: 'port-a' })
  })
  it('returns a port delivered before take()', async () => {
    const r = new PortRegistry<ReturnType<typeof port>>()
    r.deliver('a', port('port-a'))
    await expect(r.take('a')).resolves.toMatchObject({ name: 'port-a' })
  })
  it('hands out each port once; a reattach delivers a new one', async () => {
    const r = new PortRegistry<ReturnType<typeof port>>()
    r.deliver('a', port('first'))
    await r.take('a')
    const next = r.take('a')
    r.deliver('a', port('second'))
    await expect(next).resolves.toMatchObject({ name: 'second' })
  })

  it('closes a port that arrives after its tab was dropped', () => {
    const registry = new PortRegistry<{ close(): void }>()
    const port = { close: vi.fn() }
    registry.drop('s1')
    registry.deliver('s1', port)
    expect(port.close).toHaveBeenCalledOnce()
  })

  it('closes a stored port when its tab is dropped', () => {
    const registry = new PortRegistry<{ close(): void }>()
    const port = { close: vi.fn() }
    registry.deliver('s1', port)
    registry.drop('s1')
    expect(port.close).toHaveBeenCalledOnce()
  })
})

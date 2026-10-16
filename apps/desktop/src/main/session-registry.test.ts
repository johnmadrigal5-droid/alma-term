import { describe, expect, it } from 'vitest'
import { SessionRegistry } from './session-registry'

const a = {
  sessionId: '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d',
  kind: 'local' as const,
  title: 'local',
  savedId: null,
}
const b = {
  sessionId: '1b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d',
  kind: 'local' as const,
  title: 'local',
  savedId: null,
}

describe('SessionRegistry', () => {
  it('adds, lists and removes sessions', () => {
    const r = new SessionRegistry()
    r.add(a)
    r.add(b)
    r.remove(a.sessionId)
    expect(r.list()).toEqual([b])
  })
  it('clear returns the removed ids', () => {
    const r = new SessionRegistry()
    r.add(a)
    r.add(b)
    expect(r.clear()).toEqual([a.sessionId, b.sessionId])
    expect(r.list()).toEqual([])
  })
})

describe('SessionRegistry pending opens', () => {
  it('returns each pending session once from takePending', () => {
    const r = new SessionRegistry()
    r.addPending('p1', null)
    r.addPending('p2', null)
    r.resolvePending('p2')
    expect(r.takePending()).toEqual(['p1'])
    expect(r.takePending()).toEqual([])
  })

  it('finds a live session by id', () => {
    const r = new SessionRegistry()
    r.add(a)
    expect(r.get(a.sessionId)).toEqual(a)
    expect(r.get('missing')).toBeUndefined()
  })
  it('remembers the bookmark of a pending open until it resolves', () => {
    const r = new SessionRegistry()
    r.addPending(a.sessionId, 'saved-1')
    r.addPending(b.sessionId, null)
    expect(r.pendingSavedId(a.sessionId)).toBe('saved-1')
    expect(r.pendingSavedId(b.sessionId)).toBeNull()
    r.resolvePending(a.sessionId)
    expect(r.pendingSavedId(a.sessionId)).toBeNull()
  })
})

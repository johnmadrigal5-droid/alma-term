import type { LiveSession } from '@alma/protocol'

// Main owns the list of live sessions so a reloaded renderer can reattach, and the list of
// opens still in flight so a reload mid-connect can cancel them instead of leaking them.
export class SessionRegistry {
  private readonly sessions = new Map<string, LiveSession>()
  private readonly pending = new Map<string, string | null>()

  add(session: LiveSession): void {
    this.sessions.set(session.sessionId, session)
  }

  get(sessionId: string): LiveSession | undefined {
    return this.sessions.get(sessionId)
  }

  remove(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  list(): LiveSession[] {
    return [...this.sessions.values()]
  }

  clear(): string[] {
    const ids = [...this.sessions.keys()]
    this.sessions.clear()
    return ids
  }

  addPending(sessionId: string, savedId: string | null): void {
    this.pending.set(sessionId, savedId)
  }

  pendingSavedId(sessionId: string): string | null {
    return this.pending.get(sessionId) ?? null
  }

  resolvePending(sessionId: string): void {
    this.pending.delete(sessionId)
  }

  takePending(): string[] {
    const ids = [...this.pending.keys()]
    this.pending.clear()
    return ids
  }
}

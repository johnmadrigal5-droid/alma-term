import type { TerminalRegistry } from '../terminal/terminal-registry'
import { encodeFor } from './translate'

export interface BroadcastState {
  broadcast: boolean
  targets: readonly string[]
  activeId: string | null
  /** Sessions whose tab is ready; closed, lost or failed ones never receive. */
  ready: ReadonlySet<string>
}

type Terminals = Pick<TerminalRegistry, 'get' | 'onInput'>

/**
 * Forwards what is typed in the active session to the other targets. The active session
 * already got its keys through its own port, so it is never written here.
 */
export function startBroadcast(terminals: Terminals, read: () => BroadcastState): () => void {
  return terminals.onInput((sessionId, chunk) => {
    const state = read()
    if (!state.broadcast || sessionId !== state.activeId) return
    for (const id of new Set(state.targets)) {
      if (id === sessionId || !state.ready.has(id)) continue
      const target = terminals.get(id)
      target?.write(encodeFor(chunk, target.modes()))
    }
  })
}

/** Types `command` and Enter in each ready target; counts who got it. */
export function sendCommand(
  terminals: Pick<TerminalRegistry, 'get'>,
  command: string,
  targets: readonly string[],
  ready: ReadonlySet<string>,
): { sent: number; skipped: number } {
  let sent = 0
  let skipped = 0
  for (const id of new Set(targets)) {
    const target = ready.has(id) ? terminals.get(id) : undefined
    if (!target) {
      skipped += 1
      continue
    }
    target.write(`${command}\r`)
    sent += 1
  }
  return { sent, skipped }
}

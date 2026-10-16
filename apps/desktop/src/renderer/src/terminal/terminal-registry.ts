import type { InputChunk, TermModes } from '../multiexec/translate'

export interface TerminalHandle {
  modes(): TermModes
  /** Sends text to the session as if typed there. */
  write(text: string): void
}

export type InputListener = (sessionId: string, chunk: InputChunk) => void

/** The live terminals by session, so MultiExec can read their modes and type into them. */
export class TerminalRegistry {
  private readonly handles = new Map<string, TerminalHandle>()
  private readonly listeners = new Set<InputListener>()

  register(sessionId: string, handle: TerminalHandle): () => void {
    this.handles.set(sessionId, handle)
    return () => {
      if (this.handles.get(sessionId) === handle) this.handles.delete(sessionId)
    }
  }

  get(sessionId: string): TerminalHandle | undefined {
    return this.handles.get(sessionId)
  }

  onInput(listener: InputListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emitInput(sessionId: string, chunk: InputChunk): void {
    for (const listener of this.listeners) listener(sessionId, chunk)
  }
}

export const terminals = new TerminalRegistry()

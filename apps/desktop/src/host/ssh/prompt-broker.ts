import { randomUUID } from 'node:crypto'
import type { HostEvent, Prompt, PromptAnswer } from '@alma/protocol'

export class PromptCancelledError extends Error {
  constructor() {
    super('La solicitud se canceló')
    this.name = 'PromptCancelledError'
  }
}

interface Pending {
  sessionId: string
  resolve: (answer: PromptAnswer) => void
  reject: (error: PromptCancelledError) => void
}

// Interactive questions (host key, password, 2FA) waiting for the user's answer.
export class PromptBroker {
  private readonly pending = new Map<string, Pending>()

  constructor(
    private readonly send: (event: HostEvent) => void,
    private readonly newId: () => string = randomUUID,
  ) {}

  ask(sessionId: string, prompt: Prompt): Promise<PromptAnswer> {
    const promptId = this.newId()
    return new Promise((resolve, reject) => {
      this.pending.set(promptId, { sessionId, resolve, reject })
      this.send({ type: 'event.prompt', sessionId, promptId, prompt })
    })
  }

  answer(promptId: string, answer: PromptAnswer): boolean {
    const entry = this.pending.get(promptId)
    if (!entry) return false
    this.close(promptId, entry)
    if (answer.type === 'cancel') entry.reject(new PromptCancelledError())
    else entry.resolve(answer)
    return true
  }

  cancelSession(sessionId: string): void {
    for (const [promptId, entry] of this.pending) {
      if (entry.sessionId !== sessionId) continue
      this.close(promptId, entry)
      entry.reject(new PromptCancelledError())
    }
  }

  private close(promptId: string, entry: Pending): void {
    this.pending.delete(promptId)
    this.send({ type: 'event.prompt-closed', sessionId: entry.sessionId, promptId })
  }
}

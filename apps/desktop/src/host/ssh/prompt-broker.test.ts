import type { HostEvent } from '@alma/protocol'
import { describe, expect, it } from 'vitest'
import { PromptBroker, PromptCancelledError } from './prompt-broker'

const SID = '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d'
const PID = '1f1c3c2e-8f6a-4b8e-9d3f-2a1b0c9d8e7f'
const prompt = {
  kind: 'auth' as const,
  title: 't',
  instructions: '',
  fields: [{ label: 'P', echo: false }],
}

function setup() {
  const sent: HostEvent[] = []
  const broker = new PromptBroker(
    (e) => sent.push(e),
    () => PID,
  )
  return { sent, broker }
}

describe('PromptBroker', () => {
  it('emits the prompt and resolves with the answer, then closes it', async () => {
    const { sent, broker } = setup()
    const p = broker.ask(SID, prompt)
    expect(sent[0]).toEqual({ type: 'event.prompt', sessionId: SID, promptId: PID, prompt })
    expect(broker.answer(PID, { type: 'auth', responses: ['x'] })).toBe(true)
    await expect(p).resolves.toEqual({ type: 'auth', responses: ['x'] })
    expect(sent[1]).toEqual({ type: 'event.prompt-closed', sessionId: SID, promptId: PID })
  })
  it('rejects with PromptCancelledError on a cancel answer', async () => {
    const { broker } = setup()
    const p = broker.ask(SID, prompt)
    broker.answer(PID, { type: 'cancel' })
    await expect(p).rejects.toBeInstanceOf(PromptCancelledError)
  })
  it('returns false for unknown prompt ids', () => {
    expect(setup().broker.answer(PID, { type: 'cancel' })).toBe(false)
  })
  it('cancels every pending prompt of a session', async () => {
    const { sent, broker } = setup()
    const p = broker.ask(SID, prompt)
    broker.cancelSession(SID)
    await expect(p).rejects.toBeInstanceOf(PromptCancelledError)
    expect(sent.at(-1)).toEqual({ type: 'event.prompt-closed', sessionId: SID, promptId: PID })
  })
})

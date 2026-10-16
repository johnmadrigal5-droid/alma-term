import { describe, expect, it } from 'vitest'
import { ControlRequest } from './control'
import { ErrorCode } from './errors'
import { HostToMain } from './events'

const ids = {
  requestId: '6f1c3c2e-8f6a-4b8e-9d3f-2a1b0c9d8e7f',
  sessionId: '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d',
}
const promptId = '1f1c3c2e-8f6a-4b8e-9d3f-2a1b0c9d8e7f'
const target = { host: 'srv.example', port: 22, username: 'alma' }

describe('ssh.open', () => {
  it('accepts a valid request', () => {
    const r = ControlRequest.safeParse({
      type: 'ssh.open',
      ...ids,
      cols: 80,
      rows: 24,
      target,
      auth: { type: 'password', password: 'x' },
      trusted: [],
    })
    expect(r.success).toBe(true)
  })
  it.each([0, 70000])('rejects port %i', (port) => {
    const r = ControlRequest.safeParse({
      type: 'ssh.open',
      ...ids,
      cols: 80,
      rows: 24,
      target: { ...target, port },
      auth: { type: 'agent' },
      trusted: [],
    })
    expect(r.success).toBe(false)
  })
  it('rejects an empty host', () => {
    const r = ControlRequest.safeParse({
      type: 'ssh.open',
      ...ids,
      cols: 80,
      rows: 24,
      target: { ...target, host: '' },
      auth: { type: 'key', privateKeyPath: '/k' },
      trusted: [],
    })
    expect(r.success).toBe(false)
  })
})

describe('prompt.answer', () => {
  it('accepts cancel, hostkey and auth answers', () => {
    for (const answer of [
      { type: 'cancel' },
      { type: 'hostkey', accept: true },
      { type: 'auth', responses: ['123456'] },
    ]) {
      expect(
        ControlRequest.safeParse({
          type: 'prompt.answer',
          requestId: ids.requestId,
          promptId,
          answer,
        }).success,
      ).toBe(true)
    }
  })
})

describe('ssh events', () => {
  const entry = {
    host: 'srv.example',
    port: 22,
    keyType: 'ssh-ed25519',
    fingerprint: 'SHA256:abc',
    publicKey: 'AAAA',
  }
  it.each([
    { type: 'event.step', sessionId: ids.sessionId, step: 'hostkey' },
    {
      type: 'event.prompt',
      sessionId: ids.sessionId,
      promptId,
      prompt: {
        kind: 'hostkey',
        status: 'changed',
        host: 'srv.example',
        port: 22,
        keyType: 'ssh-ed25519',
        fingerprint: 'SHA256:new',
        knownFingerprint: 'SHA256:old',
      },
    },
    {
      type: 'event.prompt',
      sessionId: ids.sessionId,
      promptId,
      prompt: {
        kind: 'auth',
        title: 'Contraseña',
        instructions: '',
        fields: [{ label: 'Password:', echo: false }],
      },
    },
    { type: 'event.prompt-closed', sessionId: ids.sessionId, promptId },
    { type: 'event.hostkey-trusted', sessionId: ids.sessionId, entry },
  ])('accepts $type', (event) => {
    expect(HostToMain.safeParse(event).success).toBe(true)
  })
  it('accepts the new error codes', () => {
    for (const code of [
      'ECONNREFUSED',
      'EHOSTUNREACH',
      'ETIMEDOUT',
      'AUTH_FAILED',
      'HOSTKEY_REJECTED',
      'PROMPT_CANCELLED',
    ]) {
      expect(ErrorCode.safeParse(code).success).toBe(true)
    }
  })
})

import { describe, expect, it } from 'vitest'
import { OpenSavedArgs } from './api'
import { HostToMain, StatusEvent } from './events'
import { SaveSessionInput } from './saved'
import { PromptAnswer } from './ssh'

const sessionId = '7d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11'
const input = {
  folderId: null,
  name: 'prod',
  host: 'example.com',
  port: 22,
  username: 'alma',
  auth: 'password',
  keyPath: null,
}

describe('saved sessions protocol', () => {
  it('rejects an empty name and one longer than 80 characters', () => {
    expect(SaveSessionInput.safeParse({ ...input, name: '  ' }).success).toBe(false)
    expect(SaveSessionInput.safeParse({ ...input, name: 'x'.repeat(81) }).success).toBe(false)
    expect(SaveSessionInput.safeParse({ ...input, name: 'x'.repeat(80) }).success).toBe(true)
  })

  it('accepts a null secret value to forget the stored one', () => {
    expect(
      SaveSessionInput.safeParse({ ...input, secret: { kind: 'password', value: null } }).success,
    ).toBe(true)
  })

  it('ties keyPath to the key auth method', () => {
    expect(SaveSessionInput.safeParse({ ...input, auth: 'key', keyPath: null }).success).toBe(false)
    expect(SaveSessionInput.safeParse({ ...input, keyPath: '/home/a/.ssh/id' }).success).toBe(false)
    expect(
      SaveSessionInput.safeParse({ ...input, auth: 'key', keyPath: '/home/a/.ssh/id' }).success,
    ).toBe(true)
  })

  it('requires a uuid for openSaved', () => {
    expect(OpenSavedArgs.safeParse({ sessionId, savedId: 'x', cols: 80, rows: 24 }).success).toBe(
      false,
    )
    expect(
      OpenSavedArgs.safeParse({ sessionId, savedId: sessionId, cols: 80, rows: 24 }).success,
    ).toBe(true)
  })

  it('accepts the credential event from the host', () => {
    expect(
      HostToMain.safeParse({ type: 'event.credential', sessionId, kind: 'password', secret: 'pw' })
        .success,
    ).toBe(true)
  })

  it('accepts the lost session state', () => {
    expect(
      StatusEvent.safeParse({ type: 'event.status', sessionId, state: 'lost', exitCode: null })
        .success,
    ).toBe(true)
  })

  it('carries the remember flag in an auth answer', () => {
    expect(PromptAnswer.parse({ type: 'auth', responses: ['pw'], remember: true })).toEqual({
      type: 'auth',
      responses: ['pw'],
      remember: true,
    })
  })
})

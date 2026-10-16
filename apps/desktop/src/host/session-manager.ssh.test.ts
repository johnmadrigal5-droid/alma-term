import { EventEmitter } from 'node:events'
import type { HostToMain, KnownHostEntry } from '@alma/protocol'
import { describe, expect, it, vi } from 'vitest'
import { FakePort } from './test/fake-port'
import { FakeScheduler } from './test/fake-scheduler'
import { SessionManager } from './session-manager'
import type { ChannelLike } from './ssh/channel-pty'
import type { SshConnection, SshConnectOptions, SshConnector } from './ssh/connector-types'

const SID = '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d'
const rid = (n: number) => `6f1c3c2e-8f6a-4b8e-9d3f-2a1b0c9d8e${String(n).padStart(2, '0')}`
const KEY = 'AAAAC3NzaC1lZDI1NTE5AAAAIJiGiuoA8zoanDABZkLqhD8Ybmq/A9fKjDH33M1OSry0'
const FP = 'SHA256:GlTO0lQ5F7b2JYx83c+cZhdAMSOusuN3u9ivvULipU8'
const target = { host: 'srv', port: 22, username: 'alma' }

class FakeChannel extends EventEmitter implements ChannelLike {
  readonly stderr = new EventEmitter()
  write(): boolean {
    return true
  }
  setWindow(): void {}
  close(): void {
    this.emit('close')
  }
  pause(): void {}
  resume(): void {}
}

type Script = (o: SshConnectOptions) => Promise<SshConnection>

function setup(script: Script, opts: { knownHostsFile?: string; warn?: (m: string) => void } = {}) {
  const sent: HostToMain[] = []
  const scheduler = new FakeScheduler()
  const connector: SshConnector = { connect: (o) => script(o) }
  let n = 0
  const manager = new SessionManager({
    ptyFactory: () => {
      throw new Error('no local')
    },
    shell: () => ({ shell: '/bin/sh', args: [] }),
    env: () => ({}),
    cwd: () => '/',
    send: (m) => sent.push(m),
    scheduler,
    warn: opts.warn ?? vi.fn(),
    sshConnector: connector,
    readKnownHostsFile: () => opts.knownHostsFile ?? '',
    newPromptId: () => `2f1c3c2e-8f6a-4b8e-9d3f-2a1b0c9d8e${String(n++).padStart(2, '0')}`,
  })
  return { manager, sent, scheduler }
}

function open(
  manager: SessionManager,
  trusted: KnownHostEntry[] = [],
  port = new FakePort(),
  rememberable = false,
) {
  manager.handle(
    {
      type: 'ssh.open',
      requestId: rid(1),
      sessionId: SID,
      cols: 80,
      rows: 24,
      target,
      auth: { type: 'password', password: 'p' },
      trusted,
      rememberable,
    },
    [port],
  )
  return port
}

const noSftp = () => Promise.reject(new Error('no sftp'))
const flush = () => new Promise((r) => setTimeout(r, 0))
const keyBlob = Buffer.from(KEY, 'base64')
const responses = (sent: HostToMain[]) => sent.filter((m) => m.type === 'response')
const promptsOf = (sent: HostToMain[]) => sent.filter((m) => m.type === 'event.prompt')

async function happy(o: SshConnectOptions) {
  o.hooks.step('tcp')
  o.hooks.step('hostkey')
  if (!(await o.hooks.verifyHostKey('ssh-ed25519', keyBlob))) throw new Error('Host denied')
  o.hooks.step('auth')
  o.hooks.step('shell')
  return { channel: new FakeChannel(), end: vi.fn(), openSftp: noSftp, remembered: null }
}

describe('SessionManager ssh.open', () => {
  it('reports steps, trusts a known key silently and answers ok', async () => {
    const { manager, sent } = setup(happy)
    open(manager, [
      { host: 'srv', port: 22, keyType: 'ssh-ed25519', fingerprint: FP, publicKey: KEY },
    ])
    await flush()
    expect(
      sent.filter((m) => m.type === 'event.step').map((m) => m.type === 'event.step' && m.step),
    ).toEqual(['tcp', 'hostkey', 'auth', 'shell'])
    expect(promptsOf(sent)).toEqual([])
    expect(responses(sent)).toEqual([
      { type: 'response', requestId: rid(1), ok: true, data: { sessionId: SID } },
    ])
  })

  it('asks for a new key and records it when accepted', async () => {
    const { manager, sent } = setup(happy)
    open(manager)
    await flush()
    const prompt = promptsOf(sent)[0]
    expect(prompt).toMatchObject({ prompt: { kind: 'hostkey', status: 'new', fingerprint: FP } })
    if (prompt?.type !== 'event.prompt') throw new Error('no prompt')
    manager.handle(
      {
        type: 'prompt.answer',
        requestId: rid(2),
        promptId: prompt.promptId,
        answer: { type: 'hostkey', accept: true },
      },
      [],
    )
    await flush()
    expect(sent).toContainEqual({
      type: 'event.hostkey-trusted',
      sessionId: SID,
      entry: { host: 'srv', port: 22, keyType: 'ssh-ed25519', fingerprint: FP, publicKey: KEY },
    })
    expect(responses(sent).at(-1)).toMatchObject({ requestId: rid(1), ok: true })
  })

  it('fails with HOSTKEY_REJECTED and closes the port when the key is declined', async () => {
    const { manager, sent } = setup(happy)
    const port = open(manager, [], new FakePort())
    await flush()
    const prompt = promptsOf(sent)[0]
    if (prompt?.type !== 'event.prompt') throw new Error('no prompt')
    manager.handle(
      {
        type: 'prompt.answer',
        requestId: rid(2),
        promptId: prompt.promptId,
        answer: { type: 'hostkey', accept: false },
      },
      [],
    )
    await flush()
    expect(responses(sent).find((r) => r.requestId === rid(1))).toMatchObject({
      ok: false,
      error: { code: 'HOSTKEY_REJECTED' },
    })
    expect(port.closed).toBe(true)
    expect(manager.size).toBe(0)
  })

  it('reports a changed key with both fingerprints', async () => {
    const other = 'AAAAC3NzaC1lZDI1NTE5AAAAIPd6RFHJS9RwY1R0tekQisQTozxfDfQpzRRqIHigsMkc'
    const { manager, sent } = setup(happy, { knownHostsFile: `srv ssh-ed25519 ${other}` })
    open(manager)
    await flush()
    expect(promptsOf(sent)[0]).toMatchObject({
      prompt: {
        status: 'changed',
        fingerprint: FP,
        knownFingerprint: 'SHA256:xqjg91mCqRhJ6dNLUGBSJz/3ECCOKwcsS+twNF+2yv8',
      },
    })
  })

  it('does not time out while a prompt is open', async () => {
    const { manager, sent, scheduler } = setup(happy)
    open(manager)
    await flush()
    scheduler.advance(60_000)
    expect(responses(sent)).toEqual([])
  })

  it('times out with ETIMEDOUT when the connection stalls', async () => {
    const { manager, sent, scheduler } = setup(() => new Promise(() => {}))
    open(manager)
    scheduler.advance(20_000)
    await flush()
    expect(responses(sent)[0]).toMatchObject({ ok: false, error: { code: 'ETIMEDOUT' } })
  })

  it('cancels a pending prompt when the session is closed', async () => {
    const { manager, sent } = setup(happy)
    open(manager)
    await flush()
    manager.handle({ type: 'session.close', requestId: rid(3), sessionId: SID }, [])
    await flush()
    expect(sent.some((m) => m.type === 'event.prompt-closed')).toBe(true)
    expect(responses(sent).find((r) => r.requestId === rid(1))).toMatchObject({
      ok: false,
      error: { code: 'PROMPT_CANCELLED' },
    })
    expect(responses(sent).find((r) => r.requestId === rid(3))).toMatchObject({ ok: true })
  })

  it('maps connector errors to typed codes', async () => {
    const { manager, sent } = setup(async () => {
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    })
    open(manager)
    await flush()
    expect(responses(sent)[0]).toMatchObject({ ok: false, error: { code: 'ECONNREFUSED' } })
  })

  it('passes keyboard-interactive answers through askAuth', async () => {
    const seen: string[][] = []
    const { manager, sent } = setup(async (o) => {
      seen.push(
        (
          await o.hooks.askAuth({
            kind: 'auth',
            title: '2FA',
            instructions: '',
            fields: [{ label: 'Code', echo: true }],
          })
        ).responses,
      )
      return { channel: new FakeChannel(), end: vi.fn(), openSftp: noSftp, remembered: null }
    })
    open(manager)
    await flush()
    const prompt = promptsOf(sent)[0]
    if (prompt?.type !== 'event.prompt') throw new Error('no prompt')
    manager.handle(
      {
        type: 'prompt.answer',
        requestId: rid(2),
        promptId: prompt.promptId,
        answer: { type: 'auth', responses: ['123456'] },
      },
      [],
    )
    await flush()
    expect(seen).toEqual([['123456']])
  })

  it('reports closed and forgets the session when the remote shell ends', async () => {
    const channel = new FakeChannel()
    const end = vi.fn()
    const { manager, sent } = setup(async () => ({
      channel,
      end,
      openSftp: noSftp,
      remembered: null,
    }))
    open(manager)
    await flush()
    channel.emit('exit', 0)
    channel.emit('close')
    expect(sent.at(-1)).toEqual({
      type: 'event.status',
      sessionId: SID,
      state: 'closed',
      exitCode: 0,
    })
    // Deferred until the session's transfers released their partial files.
    await flush()
    expect(end).toHaveBeenCalled()
    expect(manager.size).toBe(0)
  })

  it('rejects answers to unknown prompts', () => {
    const { manager, sent } = setup(happy)
    manager.handle(
      {
        type: 'prompt.answer',
        requestId: rid(9),
        promptId: '3f1c3c2e-8f6a-4b8e-9d3f-2a1b0c9d8e7f',
        answer: { type: 'cancel' },
      },
      [],
    )
    expect(sent[0]).toMatchObject({ ok: false, error: { code: 'INVALID_MESSAGE' } })
  })

  it('answers the open request when the shell channel cannot be adopted', async () => {
    const { manager, sent } = setup(async (o) => {
      await happy(o)
      const broken = new FakeChannel()
      broken.on = () => {
        throw new Error('channel gone')
      }
      return { channel: broken, end: vi.fn(), openSftp: noSftp, remembered: null }
    })
    open(manager, [{ ...target, keyType: 'ssh-ed25519', fingerprint: FP, publicKey: KEY }])
    await flush()
    await flush()
    expect(responses(sent)).toEqual([expect.objectContaining({ requestId: rid(1), ok: false })])
  })

  it('passes rememberable through to the connector', async () => {
    const seen: boolean[] = []
    const { manager } = setup(async (o) => {
      seen.push(o.rememberable)
      return happy(o)
    })
    open(manager, [], new FakePort(), true)
    await flush()
    expect(seen).toEqual([true])
  })

  it('sends the remembered secret to main after the open succeeds', async () => {
    const { manager, sent } = setup(async (o) => ({
      ...(await happy(o)),
      remembered: { kind: 'password' as const, secret: 'pw' },
    }))
    open(manager, [
      { host: 'srv', port: 22, keyType: 'ssh-ed25519', fingerprint: FP, publicKey: KEY },
    ])
    await flush()
    const types = sent.map((m) => m.type)
    expect(sent).toContainEqual({
      type: 'event.credential',
      sessionId: SID,
      kind: 'password',
      secret: 'pw',
    })
    expect(types.indexOf('event.credential')).toBeGreaterThan(types.indexOf('response'))
  })

  it('never sends a credential when authentication fails', async () => {
    const { manager, sent } = setup(async () => {
      throw new Error('All configured authentication methods failed')
    })
    open(manager)
    await flush()
    expect(sent.some((m) => m.type === 'event.credential')).toBe(false)
    expect(responses(sent)[0]).toMatchObject({ ok: false, error: { code: 'AUTH_FAILED' } })
  })

  it('passes the known key types of the host to the connector', async () => {
    const seen: (string[] | undefined)[] = []
    const { manager } = setup(
      async (o) => {
        seen.push(o.preferredHostKeys)
        return happy(o)
      },
      { knownHostsFile: `srv ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ==\n` },
    )
    open(manager, [
      { host: 'srv', port: 22, keyType: 'ssh-ed25519', fingerprint: FP, publicKey: KEY },
    ])
    await flush()
    expect(seen).toEqual([['ssh-ed25519', 'ssh-rsa']])
  })

  it('logs unsupported known_hosts markers once per connection', async () => {
    const warn = vi.fn()
    const { manager } = setup(happy, {
      knownHostsFile: `@revoked srv ssh-ed25519 ${KEY}\nsrv ssh-ed25519 ${KEY}\n`,
      warn,
    })
    open(manager)
    await flush()
    const markers = warn.mock.calls.filter(([m]) => String(m).includes('known_hosts'))
    expect(markers).toHaveLength(1)
  })

  it('reports lost when the connection drops after the shell opened', async () => {
    const channel = new FakeChannel()
    let drop: () => void = () => {}
    const { manager, sent } = setup(async (o) => ({
      ...(await happy(o)),
      channel,
      onLost: (listener: () => void) => {
        drop = listener
      },
    }))
    open(manager, [
      { host: 'srv', port: 22, keyType: 'ssh-ed25519', fingerprint: FP, publicKey: KEY },
    ])
    await flush()
    drop()
    channel.emit('close')
    await flush()
    expect(sent).toContainEqual({
      type: 'event.status',
      sessionId: SID,
      state: 'lost',
      exitCode: null,
    })
    expect(sent.some((m) => m.type === 'event.status' && m.state === 'closed')).toBe(false)
  })

  it('forgets a lost session so a reloaded renderer cannot reattach it', async () => {
    const channel = new FakeChannel()
    let drop: () => void = () => {}
    const { manager, sent } = setup(async (o) => ({
      ...(await happy(o)),
      channel,
      onLost: (listener: () => void) => {
        drop = listener
      },
    }))
    open(manager, [
      { host: 'srv', port: 22, keyType: 'ssh-ed25519', fingerprint: FP, publicKey: KEY },
    ])
    await flush()
    drop()
    channel.emit('close')
    await flush()
    manager.handle({ type: 'session.reattach', requestId: rid(9), sessionId: SID }, [
      new FakePort(),
    ])
    expect(responses(sent).at(-1)).toMatchObject({
      ok: false,
      error: { code: 'SESSION_NOT_FOUND' },
    })
  })
})

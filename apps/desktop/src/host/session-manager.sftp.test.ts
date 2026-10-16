import { EventEmitter } from 'node:events'
import type { HostToMain, TransferEvent } from '@alma/protocol'
import { describe, expect, it, vi } from 'vitest'
import { SessionManager } from './session-manager'
import type { ChannelLike } from './ssh/channel-pty'
import type { SshConnection } from './ssh/connector-types'
import { FakePort } from './test/fake-port'
import { FakePty } from './test/fake-pty'
import { FakeScheduler } from './test/fake-scheduler'
import { FakeSftp } from './test/fake-sftp'
import { MemoryFs } from './test/memory-fs'

const SID = '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d'
const LOCAL = '1b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d'
const TID = '2b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d'
const rid = (n: number) => `6f1c3c2e-8f6a-4b8e-9d3f-2a1b0c9d8e${String(n).padStart(2, '0')}`

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

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r))
}

function setup(openSftp?: () => Promise<FakeSftp>) {
  const sent: HostToMain[] = []
  const fake = new FakeSftp()
  const local = new MemoryFs()
  const ends: { partialLeft: boolean }[] = []
  const lostListeners: (() => void)[] = []
  const connection: SshConnection = {
    channel: new FakeChannel(),
    end: vi.fn(() => {
      ends.push({ partialLeft: [...fake.nodes.keys()].some((p) => p.endsWith('/big')) })
    }),
    openSftp: openSftp ?? (async () => fake),
    remembered: null,
    onLost: (listener) => lostListeners.push(listener),
  }
  const loseConnection = () => lostListeners.forEach((l) => l())
  const manager = new SessionManager({
    ptyFactory: () => new FakePty(),
    shell: () => ({ shell: '/bin/sh', args: [] }),
    env: () => ({}),
    cwd: () => '/',
    send: (m) => sent.push(m),
    scheduler: new FakeScheduler(),
    warn: vi.fn(),
    sshConnector: { connect: async () => connection },
    readKnownHostsFile: () => '',
    localFs: local,
  })
  manager.handle(
    {
      type: 'ssh.open',
      requestId: rid(1),
      sessionId: SID,
      cols: 80,
      rows: 24,
      target: { host: 'srv', port: 22, username: 'alma' },
      auth: { type: 'agent' },
      trusted: [],
      rememberable: false,
    },
    [new FakePort()],
  )
  const response = (n: number) => sent.find((m) => m.type === 'response' && m.requestId === rid(n))
  const transfers = () => sent.filter((m): m is TransferEvent => m.type === 'event.transfer')
  return { manager, sent, fake, local, response, transfers, ends, loseConnection }
}

describe('SessionManager sftp', () => {
  it('fails running transfers as soon as the connection is lost', async () => {
    const { manager, local, transfers, loseConnection } = setup()
    await settle()
    local.controlled('/l/a.txt', 3)
    manager.handle(
      {
        type: 'transfer.start',
        requestId: rid(2),
        transferId: TID,
        sessionId: SID,
        direction: 'upload',
        localPath: '/l/a.txt',
        remotePath: '/home/alma/a.txt',
        overwrite: false,
      },
      [],
    )
    await settle()
    expect(transfers().at(-1)?.state).toBe('running')
    loseConnection()
    await settle()
    expect(transfers().at(-1)).toMatchObject({ state: 'error', error: { code: 'CONNECTION_LOST' } })
  })

  it('lists a folder of the ssh session sorted', async () => {
    const { manager, fake, response } = setup()
    await settle()
    fake.file('/home/alma/b', 'x')
    fake.mkdirp('/home/alma/a')
    manager.handle({ type: 'sftp.list', requestId: rid(2), sessionId: SID, path: '/home/alma' }, [])
    await settle()
    expect(response(2)).toMatchObject({
      ok: true,
      data: [
        { name: 'a', kind: 'dir' },
        { name: 'b', kind: 'file' },
      ],
    })
  })

  it('answers the home folder', async () => {
    const { manager, response } = setup()
    await settle()
    manager.handle({ type: 'sftp.home', requestId: rid(2), sessionId: SID }, [])
    await settle()
    expect(response(2)).toMatchObject({ ok: true, data: '/home/alma' })
  })

  it('reports ENOTEMPTY when removing a folder with content', async () => {
    const { manager, fake, response } = setup()
    await settle()
    fake.file('/home/alma/d/f', 'x')
    manager.handle(
      { type: 'sftp.rm', requestId: rid(2), sessionId: SID, path: '/home/alma/d', kind: 'dir' },
      [],
    )
    await settle()
    expect(response(2)).toMatchObject({ ok: false, error: { code: 'ENOTEMPTY' } })
  })

  it('answers SESSION_NOT_FOUND for a local session', async () => {
    const { manager, response } = setup()
    manager.handle(
      { type: 'local.open', requestId: rid(2), sessionId: LOCAL, cols: 80, rows: 24 },
      [new FakePort()],
    )
    manager.handle({ type: 'sftp.list', requestId: rid(3), sessionId: LOCAL, path: '/' }, [])
    await settle()
    expect(response(3)).toMatchObject({ ok: false, error: { code: 'SESSION_NOT_FOUND' } })
  })

  it('runs a transfer through queued, running and done', async () => {
    const { manager, local, fake, response, transfers } = setup()
    await settle()
    local.files.set('/l/a.txt', Buffer.from('abc'))
    manager.handle(
      {
        type: 'transfer.start',
        requestId: rid(2),
        transferId: TID,
        sessionId: SID,
        direction: 'upload',
        localPath: '/l/a.txt',
        remotePath: '/home/alma/a.txt',
        overwrite: false,
      },
      [],
    )
    await settle()
    expect(response(2)).toMatchObject({ ok: true, data: { transferId: TID } })
    expect(transfers().map((e) => e.state)).toEqual(['queued', 'running', 'done'])
    expect(fake.read('/home/alma/a.txt')?.toString()).toBe('abc')
  })

  it('cancels a running upload when the session closes and removes the partial file', async () => {
    const { manager, local, fake, transfers, ends } = setup()
    await settle()
    const source = local.controlled('/l/big', 1000)
    manager.handle(
      {
        type: 'transfer.start',
        requestId: rid(2),
        transferId: TID,
        sessionId: SID,
        direction: 'upload',
        localPath: '/l/big',
        remotePath: '/home/alma/big',
        overwrite: false,
      },
      [],
    )
    await settle()
    source.write(Buffer.alloc(100))
    await settle()
    manager.handle({ type: 'session.close', requestId: rid(3), sessionId: SID }, [])
    await settle()
    expect(transfers().at(-1)?.state).toBe('cancelled')
    expect(fake.nodes.has('/home/alma/big')).toBe(false)
    expect(fake.ended).toBe(true)
    // The SSH connection ends only after the partial file was removed over it.
    expect(ends).toEqual([{ partialLeft: false }])
  })

  it('keeps the shell alive when the server has no sftp subsystem', async () => {
    const { manager, response } = setup(() =>
      Promise.reject(new Error('Unable to start subsystem: sftp')),
    )
    await settle()
    manager.handle({ type: 'sftp.home', requestId: rid(2), sessionId: SID }, [])
    await settle()
    expect(response(2)).toMatchObject({ ok: false, error: { code: 'SFTP_UNAVAILABLE' } })
    manager.handle(
      { type: 'session.resize', requestId: rid(3), sessionId: SID, cols: 100, rows: 30 },
      [],
    )
    expect(response(3)).toMatchObject({ ok: true })
  })
})

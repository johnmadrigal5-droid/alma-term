import type { TransferEvent } from '@alma/protocol'
import { describe, expect, it } from 'vitest'
import { FakeScheduler } from '../test/fake-scheduler'
import { FakeSftp, sftpError } from '../test/fake-sftp'
import { MemoryFs } from '../test/memory-fs'
import { CLEANUP_TIMEOUT_MS, TransferQueue, type TransferJob } from './transfer-queue'

const S1 = '7d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11'
const S2 = '8d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11'
const id = (n: number) => `0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c${String(n).padStart(2, '0')}`

function setup() {
  const fake = new FakeSftp()
  const local = new MemoryFs()
  const scheduler = new FakeScheduler()
  const events: TransferEvent[] = []
  const queue = new TransferQueue({ local, scheduler, send: (e) => events.push(e) })
  const job = (n: number, over: Partial<TransferJob> = {}): TransferJob => ({
    transferId: id(n),
    sessionId: S1,
    direction: 'upload',
    localPath: `/local/f${n}`,
    remotePath: `/home/alma/f${n}`,
    overwrite: false,
    sftp: async () => fake,
    ...over,
  })
  const states = (n: number) => events.filter((e) => e.transferId === id(n)).map((e) => e.state)
  const last = (n: number) => events.filter((e) => e.transferId === id(n)).at(-1)
  return { fake, local, scheduler, events, queue, job, states, last }
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r))
}

describe('TransferQueue', () => {
  it('M1: stops waiting for a cleanup that never finishes and forgets it', async () => {
    const { fake, local, queue, job, scheduler } = setup()
    local.controlled('/local/f1', 10)
    fake.hangOnClose = true
    queue.add(job(1))
    await settle()
    let released = false
    void queue.cancelSession(S1).then(() => {
      released = true
    })
    await settle()
    expect(released).toBe(false)
    scheduler.advance(CLEANUP_TIMEOUT_MS)
    await settle()
    expect(released).toBe(true)
  })

  it('M2: reports a bare server failure when opening an upload exclusively as EEXIST', async () => {
    const { fake, local, queue, job, last } = setup()
    local.files.set('/local/f1', Buffer.from('nuevo'))
    fake.mkdirp('/home/alma')
    fake.beforeOpen = (path) => fake.file(path, 'ajeno')
    queue.add(job(1))
    await settle()
    expect(last(1)).toMatchObject({ state: 'error', error: { code: 'EEXIST' } })
  })

  it('M2: reports a local file that appeared before a download as EEXIST', async () => {
    const { fake, local, queue, job, last } = setup()
    fake.file('/home/alma/f1', 'remoto')
    // Appears after the existence check and before the exclusive open.
    local.beforeCreate = (path) => local.files.set(path, Buffer.from('ajeno'))
    queue.add(job(1, { direction: 'download', localPath: '/local/f1' }))
    await settle()
    expect(last(1)).toMatchObject({ state: 'error', error: { code: 'EEXIST' } })
    expect(local.files.get('/local/f1')?.toString()).toBe('ajeno')
  })

  it('fails every transfer of a session at once when its connection is lost', async () => {
    const { local, queue, job, last } = setup()
    local.files.set('/local/f1', Buffer.alloc(10))
    local.files.set('/local/f2', Buffer.alloc(10))
    queue.add(job(1))
    queue.add(job(2, { sessionId: S2 }))
    queue.failSession(S1, { code: 'CONNECTION_LOST', message: 'Se perdió la conexión' })
    await settle()
    expect(last(1)).toMatchObject({ state: 'error', error: { code: 'CONNECTION_LOST' } })
    expect(last(2)?.state).toBe('done')
  })

  it('opens the destination exclusively when it must not overwrite', async () => {
    const { fake, local, queue, job, last } = setup()
    local.files.set('/local/f1', Buffer.from('nuevo'))
    fake.mkdirp('/home/alma')
    // Appears between the existence check and the open.
    fake.beforeOpen = (path) => fake.file(path, 'ajeno')
    queue.add(job(1))
    await settle()
    expect(last(1)?.state).toBe('error')
    expect(fake.read('/home/alma/f1')?.toString()).toBe('ajeno')
  })

  it('downloads with an exclusive local open when it must not overwrite', async () => {
    const { fake, local, queue, job } = setup()
    fake.file('/home/alma/f1', 'remoto')
    queue.add(job(1, { direction: 'download', localPath: '/local/f1' }))
    await settle()
    expect(local.flags.get('/local/f1')).toBe('wx')
  })

  it('uploads a file and reports queued, running and done', async () => {
    const { fake, local, queue, job, states, last } = setup()
    local.files.set('/local/f1', Buffer.from('hola mundo'))
    queue.add(job(1))
    await settle()
    expect(states(1)).toEqual(['queued', 'running', 'done'])
    expect(last(1)).toMatchObject({ name: 'f1', bytes: 10, total: 10, direction: 'upload' })
    expect(fake.read('/home/alma/f1')?.toString()).toBe('hola mundo')
  })

  it('completes an upload over ssh2 write streams that only emit close', async () => {
    const { fake, local, queue, job, states } = setup()
    fake.ssh2Streams = true
    local.files.set('/local/f1', Buffer.alloc(300_000, 1))
    queue.add(job(1))
    await new Promise((r) => setTimeout(r, 20))
    await settle()
    expect(states(1).at(-1)).toBe('done')
    expect(fake.read('/home/alma/f1')?.length).toBe(300_000)
  })

  it('downloads a file to the local disk', async () => {
    const { fake, local, queue, job, states } = setup()
    fake.file('/home/alma/r', Buffer.alloc(200_000, 7))
    queue.add(job(1, { direction: 'download', localPath: '/local/r', remotePath: '/home/alma/r' }))
    await settle()
    expect(states(1).at(-1)).toBe('done')
    expect(local.files.get('/local/r')?.equals(Buffer.alloc(200_000, 7))).toBe(true)
  })

  it('runs two transfers at a time and starts the third when one ends', async () => {
    const { local, queue, job, states } = setup()
    const sources = [1, 2, 3].map((n) => local.controlled(`/local/f${n}`, 1))
    for (const n of [1, 2, 3]) queue.add(job(n))
    await settle()
    expect([states(1).at(-1), states(2).at(-1), states(3).at(-1)]).toEqual([
      'running',
      'running',
      'queued',
    ])
    sources[0]?.end(Buffer.from('x'))
    await settle()
    expect(states(1).at(-1)).toBe('done')
    expect(states(3).at(-1)).toBe('running')
  })

  it('reports progress at most every 200 ms plus the final event', async () => {
    const { local, scheduler, queue, job, states } = setup()
    const source = local.controlled('/local/f1', 100 * 1024)
    queue.add(job(1))
    await settle()
    for (let i = 0; i < 100; i++) {
      if (i % 2 === 0) scheduler.advance(1)
      source.write(Buffer.alloc(1024))
      await settle()
    }
    expect(states(1).filter((s) => s === 'running')).toHaveLength(1)
    scheduler.advance(250)
    source.end(Buffer.alloc(0))
    await settle()
    expect(states(1)).toEqual(['queued', 'running', 'done'])
  })

  it('emits a progress event once 200 ms passed since the last one', async () => {
    const { local, scheduler, queue, job, events } = setup()
    const source = local.controlled('/local/f1', 2048)
    queue.add(job(1))
    await settle()
    scheduler.advance(250)
    source.write(Buffer.alloc(1024))
    await settle()
    expect(events.at(-1)).toMatchObject({ state: 'running', bytes: 1024, total: 2048 })
  })

  it('stops moving bytes while paused and continues on resume', async () => {
    const { fake, local, queue, job, states } = setup()
    const source = local.controlled('/local/f1', 6)
    queue.add(job(1))
    await settle()
    source.write(Buffer.from('abc'))
    await settle()
    queue.pause(id(1))
    source.write(Buffer.from('def'))
    await settle()
    expect(fake.read('/home/alma/f1')?.toString()).toBe('abc')
    expect(states(1).at(-1)).toBe('paused')
    queue.resume(id(1))
    source.end()
    await settle()
    expect(fake.read('/home/alma/f1')?.toString()).toBe('abcdef')
    expect(states(1).at(-1)).toBe('done')
  })

  it('starts once when paused and resumed while its checks are still running', async () => {
    const { fake, local, queue, job, states } = setup()
    local.files.set('/local/f1', Buffer.from('una vez'))
    queue.add(job(1))
    queue.pause(id(1))
    queue.resume(id(1))
    await settle()
    expect(fake.writes).toHaveLength(1)
    expect(fake.read('/home/alma/f1')?.toString()).toBe('una vez')
    expect(states(1).at(-1)).toBe('done')
  })

  it('cancels a running transfer, closes both streams and removes the partial file', async () => {
    const { fake, local, queue, job, states } = setup()
    const source = local.controlled('/local/f1', 10)
    queue.add(job(1))
    await settle()
    source.write(Buffer.from('abc'))
    await settle()
    queue.cancel(id(1))
    await settle()
    expect(states(1).at(-1)).toBe('cancelled')
    expect(source.destroyed).toBe(true)
    expect(fake.writes[0]?.destroyed).toBe(true)
    expect(fake.nodes.has('/home/alma/f1')).toBe(false)
  })

  it('cancels only the transfers of the closed session', async () => {
    const { local, queue, job, states } = setup()
    local.controlled('/local/f1', 1)
    local.controlled('/local/f2', 1)
    queue.add(job(1))
    queue.add(job(2, { sessionId: S2 }))
    await settle()
    queue.cancelSession(S1)
    await settle()
    expect(states(1).at(-1)).toBe('cancelled')
    expect(states(2).at(-1)).toBe('running')
  })

  it('fails one transfer with ENOSPC while the other one finishes', async () => {
    const { fake, local, queue, job, last, states } = setup()
    fake.writeFault = { afterBytes: 4, error: sftpError(4, 'No space left on device') }
    local.files.set('/local/f1', Buffer.from('demasiado'))
    local.files.set('/local/f2', Buffer.from('ok'))
    queue.add(job(1))
    queue.add(job(2))
    await settle()
    expect(last(1)).toMatchObject({ state: 'error', error: { code: 'ENOSPC' } })
    expect(fake.nodes.has('/home/alma/f1')).toBe(false)
    expect(states(2).at(-1)).toBe('done')
  })

  it('fails with TRANSFER_STALLED after 60 s without bytes', async () => {
    const { local, scheduler, queue, job, last } = setup()
    local.controlled('/local/f1', 10)
    queue.add(job(1))
    await settle()
    scheduler.advance(60_000)
    await settle()
    expect(last(1)).toMatchObject({ state: 'error', error: { code: 'TRANSFER_STALLED' } })
  })

  it('refuses to replace an existing file without overwrite and opens no stream', async () => {
    const { fake, local, queue, job, last } = setup()
    local.files.set('/local/f1', Buffer.from('nuevo'))
    fake.file('/home/alma/f1', 'viejo')
    queue.add(job(1))
    await settle()
    expect(last(1)).toMatchObject({ state: 'error', error: { code: 'EEXIST' } })
    expect(local.readStreams).toHaveLength(0)
    expect(fake.read('/home/alma/f1')?.toString()).toBe('viejo')
  })

  it('replaces an existing file with overwrite', async () => {
    const { fake, local, queue, job, last } = setup()
    local.files.set('/local/f1', Buffer.from('nuevo'))
    fake.file('/home/alma/f1', 'viejo')
    queue.add(job(1, { overwrite: true }))
    await settle()
    expect(last(1)?.state).toBe('done')
    expect(fake.read('/home/alma/f1')?.toString()).toBe('nuevo')
  })

  it('keeps a read-only file whose overwrite failed to open', async () => {
    const { fake, local, queue, job, last } = setup()
    local.files.set('/local/f1', Buffer.from('nuevo'))
    fake.file('/home/alma/f1', 'viejo')
    fake.readOnly.add('/home/alma/f1')
    queue.add(job(1, { overwrite: true }))
    await settle()
    expect(last(1)).toMatchObject({ state: 'error', error: { code: 'EACCES' } })
    expect(fake.read('/home/alma/f1')?.toString()).toBe('viejo')
  })

  it('fails with ENOENT when the local source is missing', async () => {
    const { queue, job, last } = setup()
    queue.add(job(1))
    await settle()
    expect(last(1)).toMatchObject({ state: 'error', error: { code: 'ENOENT' } })
  })
})

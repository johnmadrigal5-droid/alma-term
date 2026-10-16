import type { ConnectStep, SshAuth } from '@alma/protocol'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SshConnection, SshHooks } from './connector-types'
import { fingerprintSha256, parseKnownHosts } from './known-hosts'
import { ssh2Connector } from './ssh2-connector'
import { mapSshError } from './ssh-errors'
import {
  dockerAvailable,
  freePort,
  SSH_TEST_PASSWORD,
  SSH_TEST_USER,
  startTestSshServer,
  type TestSshServer,
} from './test/ssh-server'

const hasDocker = dockerAvailable()
if (!hasDocker) console.warn('[ssh2-connector] Docker no disponible: tests SSH omitidos')

function hooks(seen: {
  steps: ConnectStep[]
  keys: { keyType: string; blob: Uint8Array }[]
}): SshHooks {
  return {
    step: (s) => seen.steps.push(s),
    verifyHostKey: async (keyType, blob) => {
      seen.keys.push({ keyType, blob })
      return true
    },
    askAuth: async () => ({ responses: [], remember: false }),
  }
}

function run(connection: SshConnection, command: string, expected: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = ''
    const timer = setTimeout(() => reject(new Error(`sin "${expected}" en: ${out}`)), 10_000)
    connection.channel.on('data', (d: Buffer) => {
      out += d.toString()
      if (out.includes(expected)) {
        clearTimeout(timer)
        resolve(out)
      }
    })
    connection.channel.write(Buffer.from(`${command}\n`))
  })
}

describe.skipIf(!hasDocker)('ssh2Connector (native, Docker)', () => {
  let server: TestSshServer

  beforeAll(async () => {
    server = await startTestSshServer()
  }, 120_000)
  afterAll(() => server?.stop())

  const open = (
    auth: SshAuth,
    seen = { steps: [] as ConnectStep[], keys: [] as { keyType: string; blob: Uint8Array }[] },
  ) =>
    ssh2Connector.connect({
      target: { host: server.host, port: server.port, username: SSH_TEST_USER },
      auth,
      cols: 80,
      rows: 24,
      hooks: hooks(seen),
      rememberable: false,
      signal: new AbortController().signal,
    })

  it('opens a shell with the right password', async () => {
    const seen = { steps: [] as ConnectStep[], keys: [] as { keyType: string; blob: Uint8Array }[] }
    const connection = await open({ type: 'password', password: SSH_TEST_PASSWORD }, seen)
    try {
      await run(connection, 'echo alma-$((40+2))', 'alma-42')
      expect(seen.steps).toEqual(['tcp', 'hostkey', 'auth', 'shell'])
    } finally {
      connection.end()
    }
  })

  it('fails with AUTH_FAILED on a wrong password', async () => {
    const error = await open({ type: 'password', password: 'nope' }).catch((e: unknown) => e)
    expect(mapSshError(error).code).toBe('AUTH_FAILED')
  })

  it('authenticates with an unencrypted private key', async () => {
    const connection = await open({ type: 'key', privateKeyPath: server.privateKeyPath })
    try {
      await run(connection, 'echo alma-$((40+2))', 'alma-42')
    } finally {
      connection.end()
    }
  })

  it('fails with ECONNREFUSED on a closed port', async () => {
    const port = await freePort()
    const error = await ssh2Connector
      .connect({
        target: { host: '127.0.0.1', port, username: SSH_TEST_USER },
        auth: { type: 'password', password: 'x' },
        cols: 80,
        rows: 24,
        hooks: hooks({ steps: [], keys: [] }),
        rememberable: false,
        signal: new AbortController().signal,
      })
      .catch((e: unknown) => e)
    expect(mapSshError(error).code).toBe('ECONNREFUSED')
  })

  it('hands the real host key to verifyHostKey', async () => {
    const seen = { steps: [] as ConnectStep[], keys: [] as { keyType: string; blob: Uint8Array }[] }
    const connection = await open({ type: 'password', password: SSH_TEST_PASSWORD }, seen)
    connection.end()
    const scanned = parseKnownHosts(server.keyscan()).entries
    expect(scanned.length).toBeGreaterThan(0)
    const [key] = seen.keys
    const match = scanned.find((e) => e.keyType === key?.keyType)
    if (!key || !match) throw new Error(`keyscan sin la clave ${key?.keyType ?? '(ninguna)'}`)
    expect(fingerprintSha256(key.blob)).toBe(fingerprintSha256(match.keyBlob))
  })
})

describe.skipIf(!hasDocker)('ssh2Connector milestone 2 follow-ups (native, Docker)', () => {
  let server: TestSshServer
  let home: string
  let previousHome: string | undefined

  beforeAll(async () => {
    server = await startTestSshServer()
    home = mkdtempSync(join(tmpdir(), 'alma-home-'))
    mkdirSync(join(home, '.ssh'))
    copyFileSync(server.privateKeyPath, join(home, '.ssh', 'id_test'))
    previousHome = process.env['HOME']
    process.env['HOME'] = home
  }, 120_000)
  afterAll(() => {
    if (previousHome === undefined) delete process.env['HOME']
    else process.env['HOME'] = previousHome
    rmSync(home, { recursive: true, force: true })
    server?.stop()
  })

  it('reads a private key given as a ~ path', async () => {
    const connection = await ssh2Connector.connect({
      target: { host: server.host, port: server.port, username: SSH_TEST_USER },
      auth: { type: 'key', privateKeyPath: '~/.ssh/id_test' },
      cols: 80,
      rows: 24,
      hooks: hooks({ steps: [], keys: [] }),
      rememberable: false,
      signal: new AbortController().signal,
    })
    try {
      await run(connection, 'echo alma-$((40+2))', 'alma-42')
    } finally {
      connection.end()
    }
  })

  it('cancels promptly against a peer that accepts TCP and never speaks', async () => {
    const silent = createServer(() => {})
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve))
    const address = silent.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const abort = new AbortController()
    try {
      const pending = ssh2Connector.connect({
        target: { host: '127.0.0.1', port, username: SSH_TEST_USER },
        auth: { type: 'password', password: 'x' },
        cols: 80,
        rows: 24,
        hooks: hooks({ steps: [], keys: [] }),
        rememberable: false,
        signal: abort.signal,
      })
      setTimeout(() => abort.abort(), 200)
      const started = Date.now()
      await expect(pending).rejects.toThrow('Conexión cancelada')
      expect(Date.now() - started).toBeLessThan(1000)
    } finally {
      silent.close()
    }
  })
})

import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AuthPrompt, ConnectStep, SshAuth } from '@alma/protocol'
import type { ClientChannel, ConnectConfig, Prompt } from 'ssh2'
import { describe, expect, it, vi } from 'vitest'
import { FakeSftp } from '../test/fake-sftp'
import type { SshHooks } from './connector-types'
import { createSsh2Connector, type ClientLike } from './ssh2-connector'

class FakeClient extends EventEmitter implements ClientLike {
  ended = false
  destroyed = false
  config: ConnectConfig | undefined
  connect(config?: ConnectConfig): this {
    this.config = config
    return this
  }
  end(): this {
    this.ended = true
    return this
  }
  destroy(): this {
    this.destroyed = true
    return this
  }
  sftpResult: Error | FakeSftp = new Error('Unable to start subsystem: sftp')
  sftpCalls = 0
  sftp(callback: (error: Error | undefined, sftp: FakeSftp) => void): this {
    this.sftpCalls += 1
    const result = this.sftpResult
    if (result instanceof Error) callback(result, new FakeSftp())
    else callback(undefined, result)
    return this
  }
  shell(
    window?: unknown,
    callback?: (error: Error | undefined, stream: ClientChannel) => void,
  ): this {
    this.onShell(window, callback)
    return this
  }
  protected onShell: (
    window: unknown,
    callback: ((error: Error | undefined, stream: ClientChannel) => void) | undefined,
  ) => void = () => {}
}

function connect(client: FakeClient, signal = new AbortController().signal) {
  const steps: ConnectStep[] = []
  const promise = createSsh2Connector(() => client).connect({
    target: { host: 'srv', port: 22, username: 'alma' },
    auth: { type: 'agent' },
    cols: 80,
    rows: 24,
    rememberable: false,
    signal,
    hooks: {
      step: (s) => steps.push(s),
      verifyHostKey: async () => true,
      askAuth: async () => ({ responses: [], remember: false }),
    },
  })
  return { promise, steps }
}

describe('ssh2 connector lifecycle', () => {
  it('destroys the socket when aborted mid-connect', async () => {
    const client = new FakeClient()
    const abort = new AbortController()
    const { promise } = connect(client, abort.signal)
    abort.abort()
    await expect(promise).rejects.toThrow()
    expect(client.destroyed).toBe(true)
  })

  it('rejects when the server closes the connection before ready', async () => {
    const client = new FakeClient()
    const { promise } = connect(client)
    client.emit('close')
    await expect(promise).rejects.toThrow(/cerró la conexión/)
  })
})

class AuthClient extends FakeClient {
  readonly stream = Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
    close: () => {},
  })
  protected override onShell = (
    _: unknown,
    callback: ((error: Error | undefined, stream: ClientChannel) => void) | undefined,
  ) => {
    callback?.(undefined, this.stream as unknown as ClientChannel)
  }
  /** Runs one authHandler round and returns what the connector offered. */
  offer(methods: string[]): Promise<unknown> {
    const handler = this.config?.authHandler
    if (typeof handler !== 'function') throw new Error('no authHandler')
    return new Promise((resolve) => {
      ;(handler as (m: string[], p: boolean, next: (a: unknown) => void) => void)(
        methods,
        false,
        resolve,
      )
    })
  }
}

function connectWith(
  client: AuthClient,
  auth: SshAuth,
  askAuth: SshHooks['askAuth'],
  rememberable = true,
) {
  return createSsh2Connector(() => client).connect({
    target: { host: 'srv', port: 22, username: 'alma' },
    auth,
    cols: 80,
    rows: 24,
    rememberable,
    signal: new AbortController().signal,
    hooks: { step: () => {}, verifyHostKey: async () => true, askAuth },
  })
}

describe('ssh2 connector remember', () => {
  it('marks the password prompt as rememberable for a saved session', async () => {
    const client = new AuthClient()
    const prompts: AuthPrompt[] = []
    void connectWith(client, { type: 'password' }, async (p) => {
      prompts.push(p)
      return { responses: ['pw'], remember: false }
    })
    await client.offer(['password'])
    expect(prompts[0]?.remember).toBe('password')
  })

  it('does not offer remember when the session is not rememberable', async () => {
    const client = new AuthClient()
    const prompts: AuthPrompt[] = []
    void connectWith(
      client,
      { type: 'password' },
      async (p) => {
        prompts.push(p)
        return { responses: ['pw'], remember: false }
      },
      false,
    )
    await client.offer(['password'])
    expect(prompts[0]?.remember).toBeUndefined()
  })

  it('returns the remembered password once the shell is open', async () => {
    const client = new AuthClient()
    const connection = connectWith(client, { type: 'password' }, async () => ({
      responses: ['pw'],
      remember: true,
    }))
    expect(await client.offer(['password'])).toMatchObject({ type: 'password', password: 'pw' })
    client.emit('ready')
    expect((await connection).remembered).toEqual({ kind: 'password', secret: 'pw' })
  })

  it('opens an SFTP channel over the same client on demand', async () => {
    const client = new AuthClient()
    const sftp = new FakeSftp()
    client.sftpResult = sftp
    const connection = connectWith(client, { type: 'agent' }, async () => ({
      responses: [],
      remember: false,
    }))
    client.emit('ready')
    const open = await connection
    expect(client.sftpCalls).toBe(0)
    expect(await open.openSftp()).toBe(sftp)
  })

  it('rejects openSftp when the server has no SFTP subsystem', async () => {
    const client = new AuthClient()
    const connection = connectWith(client, { type: 'agent' }, async () => ({
      responses: [],
      remember: false,
    }))
    client.emit('ready')
    await expect((await connection).openSftp()).rejects.toThrow(/subsystem/)
  })

  it('returns nothing to remember when the user did not ask', async () => {
    const client = new AuthClient()
    const connection = connectWith(client, { type: 'password' }, async () => ({
      responses: ['pw'],
      remember: false,
    }))
    await client.offer(['password'])
    client.emit('ready')
    expect((await connection).remembered).toBeNull()
  })

  it('never marks generic keyboard-interactive prompts as rememberable', async () => {
    const client = new AuthClient()
    const prompts: AuthPrompt[] = []
    void connectWith(client, { type: 'agent' }, async (p) => {
      prompts.push(p)
      return { responses: ['123456'], remember: true }
    })
    const step = (await client.offer(['keyboard-interactive'])) as {
      prompt: (n: string, i: string, l: string, p: Prompt[], f: (r: string[]) => void) => void
    }
    await new Promise<void>((resolve) =>
      step.prompt('2FA', '', '', [{ prompt: 'Code: ', echo: true }], () => resolve()),
    )
    expect(prompts[0]?.remember).toBeUndefined()
  })

  it('uses the stored passphrase without prompting', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'alma-key-'))
    try {
      const keyPath = join(dir, 'id')
      execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', 'frase', '-f', keyPath])
      const client = new AuthClient()
      const prompts: AuthPrompt[] = []
      void connectWith(
        client,
        { type: 'key', privateKeyPath: keyPath, passphrase: 'frase' },
        async (p) => {
          prompts.push(p)
          return { responses: [], remember: false }
        },
      )
      expect(await client.offer(['publickey'])).toMatchObject({
        type: 'publickey',
        passphrase: 'frase',
      })
      expect(prompts).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('asks for the passphrase as rememberable when none is stored', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'alma-key-'))
    try {
      const keyPath = join(dir, 'id')
      execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', 'frase', '-f', keyPath])
      const client = new AuthClient()
      const connection = connectWith(
        client,
        { type: 'key', privateKeyPath: keyPath },
        async (p) => {
          expect(p.remember).toBe('passphrase')
          return { responses: ['frase'], remember: true }
        },
      )
      await client.offer(['publickey'])
      client.emit('ready')
      expect((await connection).remembered).toEqual({ kind: 'passphrase', secret: 'frase' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function encryptedKey(dir: string): string {
  const keyPath = join(dir, 'id')
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', 'frase', '-f', keyPath])
  return keyPath
}

describe('ssh2 connector milestone 2 follow-ups', () => {
  it('asks again after a wrong passphrase and connects with the right one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'alma-key-'))
    try {
      const keyPath = encryptedKey(dir)
      const client = new AuthClient()
      const answers = ['mal', 'peor', 'frase']
      const prompts: AuthPrompt[] = []
      void connectWith(client, { type: 'key', privateKeyPath: keyPath }, async (p) => {
        prompts.push(p)
        return { responses: [answers.shift() ?? ''], remember: false }
      })
      expect(await client.offer(['publickey'])).toMatchObject({ passphrase: 'frase' })
      expect(prompts).toHaveLength(3)
      expect(prompts[1]?.instructions).toContain('Frase incorrecta')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails with a clear message after three wrong passphrases', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'alma-key-'))
    try {
      const keyPath = encryptedKey(dir)
      const client = new AuthClient()
      const connection = connectWith(
        client,
        { type: 'key', privateKeyPath: keyPath },
        async () => ({
          responses: ['mal'],
          remember: false,
        }),
      )
      void client.offer(['publickey'])
      await expect(connection).rejects.toThrow('No se pudo descifrar la clave privada')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a file that is not a private key without asking for a passphrase', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'alma-key-'))
    try {
      const keyPath = join(dir, 'notes.txt')
      writeFileSync(keyPath, 'hola, esto no es una clave\n')
      const client = new AuthClient()
      const prompts: AuthPrompt[] = []
      const connection = connectWith(
        client,
        { type: 'key', privateKeyPath: keyPath },
        async (p) => {
          prompts.push(p)
          return { responses: [''], remember: false }
        },
      )
      void client.offer(['publickey'])
      await expect(connection).rejects.toThrow('El archivo no es una clave privada válida')
      expect(prompts).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('prefers the host key types already known for the host', () => {
    const client = new AuthClient()
    void createSsh2Connector(() => client).connect({
      target: { host: 'srv', port: 22, username: 'alma' },
      auth: { type: 'agent' },
      cols: 80,
      rows: 24,
      rememberable: false,
      preferredHostKeys: ['ssh-rsa'],
      signal: new AbortController().signal,
      hooks: {
        step: () => {},
        verifyHostKey: async () => true,
        askAuth: async () => ({ responses: [], remember: false }),
      },
    })
    const order = client.config?.algorithms?.serverHostKey
    // An ssh-rsa key in known_hosts is negotiated through the rsa-sha2-* signature algorithms.
    expect(Array.isArray(order) && order.slice(0, 3)).toEqual([
      'rsa-sha2-512',
      'rsa-sha2-256',
      'ssh-rsa',
    ])
    expect(Array.isArray(order) && order.includes('ssh-ed25519')).toBe(true)
  })

  it('tears the connection down before declining a rejected host key', async () => {
    const client = new AuthClient()
    const connection = createSsh2Connector(() => client).connect({
      target: { host: 'srv', port: 22, username: 'alma' },
      auth: { type: 'agent' },
      cols: 80,
      rows: 24,
      rememberable: false,
      signal: new AbortController().signal,
      hooks: {
        step: () => {},
        verifyHostKey: async () => {
          throw new Error('rechazada')
        },
        askAuth: async () => ({ responses: [], remember: false }),
      },
    })
    const verifier = client.config?.hostVerifier as (
      key: Buffer,
      verify: (ok: boolean) => void,
    ) => void
    const destroyedAtVerify = await new Promise<boolean>((resolve) =>
      verifier(Buffer.from('AAAA', 'base64'), () => resolve(client.destroyed)),
    )
    await expect(connection).rejects.toThrow('rechazada')
    expect(destroyedAtVerify).toBe(true)
  })

  it('reports the connection as lost when the client errors after ready', async () => {
    const client = new AuthClient()
    const connection = connectWith(client, { type: 'password', password: 'pw' }, async () => ({
      responses: [],
      remember: false,
    }))
    client.emit('ready')
    const lost = vi.fn()
    ;(await connection).onLost?.(lost)
    client.emit('error', new Error('Keepalive timeout'))
    expect(lost).toHaveBeenCalledOnce()
  })
})

describe('ssh2 connector keyboard-interactive with a stored password', () => {
  type KbdStep = {
    prompt: (n: string, i: string, l: string, p: Prompt[], f: (r: string[]) => void) => void
  }
  const round = (step: KbdStep): Promise<string[]> =>
    new Promise((resolve) =>
      step.prompt('', '', '', [{ prompt: 'Password: ', echo: false }], resolve),
    )

  it('answers PAM once with the password when the server only offers keyboard-interactive', async () => {
    const client = new AuthClient()
    const prompts: AuthPrompt[] = []
    void connectWith(client, { type: 'password', password: 'pw' }, async (p) => {
      prompts.push(p)
      return { responses: ['otra'], remember: false }
    })
    const step = (await client.offer(['keyboard-interactive'])) as KbdStep
    expect(await round(step)).toEqual(['pw'])
    expect(await round(step)).toEqual(['otra'])
    expect(prompts).toHaveLength(1)
  })

  it('asks the user instead of repeating a password the server already rejected', async () => {
    const client = new AuthClient()
    const prompts: AuthPrompt[] = []
    void connectWith(client, { type: 'password', password: 'mal' }, async (p) => {
      prompts.push(p)
      return { responses: ['buena'], remember: false }
    })
    expect(await client.offer(['password', 'keyboard-interactive'])).toMatchObject({
      type: 'password',
      password: 'mal',
    })
    const step = (await client.offer(['keyboard-interactive'])) as KbdStep
    expect(await round(step)).toEqual(['buena'])
    expect(prompts).toHaveLength(1)
  })
})

describe('ssh2 connector remember after a rejected password', () => {
  it('forgets a remembered password that the server rejected', async () => {
    const client = new AuthClient()
    const answers = [
      { responses: ['mal'], remember: true },
      { responses: ['buena'], remember: false },
    ]
    const connection = connectWith(client, { type: 'password' }, async () => {
      const next = answers.shift()
      if (!next) throw new Error('unexpected prompt')
      return next
    })
    expect(await client.offer(['password', 'keyboard-interactive'])).toMatchObject({
      password: 'mal',
    })
    // The server rejected "mal": ssh2 asks the handler again with the methods left.
    const step = (await client.offer(['keyboard-interactive'])) as {
      prompt: (n: string, i: string, l: string, p: Prompt[], f: (r: string[]) => void) => void
    }
    await new Promise<string[]>((resolve) =>
      step.prompt('', '', '', [{ prompt: 'Password: ', echo: false }], resolve),
    )
    client.emit('ready')
    expect((await connection).remembered).toBeNull()
  })
})

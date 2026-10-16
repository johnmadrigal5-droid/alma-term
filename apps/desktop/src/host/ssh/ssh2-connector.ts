import { readFile } from 'node:fs/promises'
import type { AuthPrompt, SshAuth } from '@alma/protocol'
// ssh2 is CommonJS: Node's ESM loader only exposes its default export reliably.
import ssh2, {
  type AnyAuthMethod,
  type AuthenticationType,
  type AuthHandlerMiddleware,
  type ClientChannel,
  type ConnectConfig,
  type KeyboardInteractiveCallback,
  type Prompt,
} from 'ssh2'
import { homedir } from 'node:os'
import type { ChannelLike } from './channel-pty'
import type {
  RememberedSecret,
  SshConnection,
  SshConnectOptions,
  SshConnector,
  SshHooks,
} from './connector-types'

import { expandHome } from './expand-path'
import type { SftpLike } from '../sftp/sftp-types'

const { Client, utils } = ssh2

// ssh2 1.17's default host key algorithm order (lib/protocol/constants.js).
const DEFAULT_HOST_KEY_ALGORITHMS = [
  'ssh-ed25519',
  'ecdsa-sha2-nistp256',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521',
  'rsa-sha2-512',
  'rsa-sha2-256',
  'ssh-rsa',
]
const MAX_PASSPHRASE_ATTEMPTS = 3

// Known key types go first, as OpenSSH does, so a server with several keys keeps presenting
// the one the user trusted. An ssh-rsa key is negotiated through the rsa-sha2-* algorithms.
export function hostKeyAlgorithms(known: readonly string[]): string[] {
  const preferred = known.flatMap((t) =>
    t === 'ssh-rsa' ? ['rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa'] : [t],
  )
  return [...new Set([...preferred, ...DEFAULT_HOST_KEY_ALGORITHMS])]
}

type AuthStep = AnyAuthMethod
// ssh2 accepts `false` to end authentication; @types/ssh2 omits it.
type NextAuth = (auth: AuthStep | false) => void

// The SSH wire format starts the host key blob with its type as a length-prefixed string.
export function hostKeyType(blob: Uint8Array): string {
  const buffer = Buffer.from(blob)
  if (buffer.length < 4) return 'unknown'
  const length = buffer.readUInt32BE(0)
  return buffer.subarray(4, 4 + length).toString('ascii')
}

export function agentSocket(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string | undefined {
  return (
    env['SSH_AUTH_SOCK'] ?? (platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined)
  )
}

function passwordPrompt(username: string, host: string, rememberable: boolean): AuthPrompt {
  return {
    kind: 'auth',
    title: `Contraseña de ${username}@${host}`,
    instructions: '',
    fields: [{ label: 'Contraseña', echo: false }],
    ...(rememberable ? { remember: 'password' as const } : {}),
  }
}

function passphrasePrompt(path: string, rememberable: boolean, retry: boolean): AuthPrompt {
  return {
    kind: 'auth',
    title: 'Clave privada cifrada',
    instructions: retry ? `Frase incorrecta, inténtalo de nuevo. ${path}` : path,
    fields: [{ label: 'Frase de contraseña', echo: false }],
    ...(rememberable ? { remember: 'passphrase' as const } : {}),
  }
}

function keyboardPrompt(name: string, instructions: string, prompts: Prompt[]): AuthPrompt {
  return {
    kind: 'auth',
    title: name || 'Autenticación del servidor',
    instructions,
    fields: prompts.map((p) => ({ label: p.prompt.trim(), echo: p.echo ?? false })),
  }
}

// Builds the ordered list of auth attempts for the chosen method; each entry resolves lazily
// so prompts (password, passphrase) only appear when the server actually reaches that step.
interface AuthContext {
  username: string
  host: string
  hooks: SshHooks
  rememberable: boolean
  abort: (error: unknown) => void
  /** Records a secret typed with "Recordar"; the connection reports it once the shell opens. */
  remember: (secret: RememberedSecret) => void
  forget: () => void
}

function authPlan(
  auth: SshAuth,
  { username, host, hooks, rememberable, abort, remember, forget }: AuthContext,
): { method: AuthenticationType; build: () => Promise<AuthStep> }[] {
  const ask = async (prompt: AuthPrompt, kind: RememberedSecret['kind']) => {
    const answer = await hooks.askAuth(prompt)
    const secret = answer.responses[0] ?? ''
    if (answer.remember && secret) remember({ kind, secret })
    return secret
  }
  // PAM usually asks a single hidden "Password:" over keyboard-interactive; answer it once
  // with the given password, as OpenSSH does, unless the password method already got it
  // rejected: repeating a wrong saved password only burns a server attempt.
  let reusablePassword = auth.type === 'password' ? auth.password : undefined
  const keyboard = {
    method: 'keyboard-interactive' as const,
    build: async (): Promise<AuthStep> => ({
      type: 'keyboard-interactive',
      username,
      prompt: (
        name: string,
        instructions: string,
        _lang: string,
        prompts: Prompt[],
        finish: KeyboardInteractiveCallback,
      ) => {
        if (prompts.length === 0) return finish([])
        const [only] = prompts
        if (reusablePassword !== undefined && prompts.length === 1 && only && !only.echo) {
          const password = reusablePassword
          reusablePassword = undefined
          return finish([password])
        }
        // A cancelled prompt ends the connection instead of counting as a failed attempt.
        hooks
          .askAuth(keyboardPrompt(name, instructions, prompts))
          .then((answer) => finish(answer.responses), abort)
      },
    }),
  }
  switch (auth.type) {
    case 'password':
      return [
        {
          method: 'password',
          build: async () => {
            reusablePassword = undefined
            return {
              type: 'password',
              username,
              password:
                auth.password ??
                (await ask(passwordPrompt(username, host, rememberable), 'password')),
            }
          },
        },
        keyboard,
      ]
    case 'key':
      return [
        {
          method: 'publickey',
          build: async () => {
            const path = expandHome(auth.privateKeyPath, homedir())
            const key = await readFile(path)
            const plain = utils.parseKey(key)
            if (!(plain instanceof Error)) return { type: 'publickey', username, key }
            // Only an encrypted key deserves a passphrase prompt; anything else is the wrong file.
            if (!/encrypt|passphrase/i.test(plain.message))
              throw new Error('El archivo no es una clave privada válida')
            if (
              auth.passphrase !== undefined &&
              !(utils.parseKey(key, auth.passphrase) instanceof Error)
            )
              return { type: 'publickey', username, key, passphrase: auth.passphrase }
            for (let attempt = 0; attempt < MAX_PASSPHRASE_ATTEMPTS; attempt += 1) {
              const prompt = passphrasePrompt(path, rememberable, attempt > 0)
              const passphrase = await ask(prompt, 'passphrase')
              if (!(utils.parseKey(key, passphrase) instanceof Error))
                return { type: 'publickey', username, key, passphrase }
              forget()
            }
            throw new Error('No se pudo descifrar la clave privada')
          },
        },
        keyboard,
      ]
    case 'agent': {
      const agent = agentSocket(process.platform, process.env)
      return [
        {
          method: 'agent',
          build: async () => {
            if (!agent) throw new Error('No hay agente SSH disponible (SSH_AUTH_SOCK)')
            return { type: 'agent', username, agent }
          },
        },
        keyboard,
      ]
    }
  }
}

function asChannel(stream: ClientChannel): ChannelLike {
  return stream as unknown as ChannelLike
}

/** The slice of ssh2's Client the connector drives; injectable for tests. */
export interface ClientLike {
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'ready' | 'close', listener: () => void): unknown
  connect(config: ConnectConfig): unknown
  end(): unknown
  destroy(): unknown
  shell(
    window: { term: string; cols: number; rows: number },
    callback: (error: Error | undefined, stream: ClientChannel) => void,
  ): unknown
  sftp(callback: (error: Error | undefined, sftp: SftpLike) => void): unknown
  exec?(
    command: string,
    callback: (error: Error | undefined, channel: ClientChannel) => void,
  ): unknown
  // Forwarding is optional so test doubles that only drive the shell need not implement it.
  forwardOut?(
    srcIP: string,
    srcPort: number,
    dstIP: string,
    dstPort: number,
    callback: (error: Error | undefined, channel: ClientChannel) => void,
  ): unknown
  forwardIn?(
    bindAddr: string,
    bindPort: number,
    callback: (error: Error | undefined, port: number) => void,
  ): unknown
  unforwardIn?(bindAddr: string, bindPort: number, callback: (error?: Error) => void): unknown
  on(
    event: 'tcp connection',
    listener: (
      info: { destIP: string; destPort: number; srcIP: string; srcPort: number },
      accept: () => ClientChannel,
      reject: () => void,
    ) => void,
  ): unknown
}

export function createSsh2Connector(
  newClient: () => ClientLike = () => new Client() as unknown as ClientLike,
): SshConnector {
  return { connect: (options) => connectWith(newClient(), options) }
}

export const ssh2Connector: SshConnector = createSsh2Connector()

function connectWith(
  client: ClientLike,
  {
    target,
    auth,
    cols,
    rows,
    hooks,
    signal,
    rememberable,
    preferredHostKeys = [],
  }: SshConnectOptions,
): Promise<SshConnection> {
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      // destroy, not end: end() leaves a socket that is still connecting alive until the OS gives up.
      client.destroy()
      reject(error)
    }
    const onAbort = () => fail(new Error('Conexión cancelada'))
    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })

    let remembered: RememberedSecret | null = null
    const plan = authPlan(auth, {
      username: target.username,
      host: target.host,
      hooks,
      rememberable,
      abort: fail,
      remember: (secret) => {
        remembered = secret
      },
      forget: () => {
        remembered = null
      },
    })
    let next = 0
    let authStarted = false
    const authHandler: AuthHandlerMiddleware = (methodsLeft, _partial, nextAuth) => {
      const callback = nextAuth as NextAuth
      if (!authStarted) {
        authStarted = true
        hooks.step('auth')
      } else {
        // ssh2 calls the handler again only after the previous method was rejected:
        // whatever secret that method used must not be remembered.
        remembered = null
      }
      for (let entry = plan[next]; entry; entry = plan[next]) {
        next += 1
        const allowed =
          !methodsLeft ||
          methodsLeft.includes(entry.method) ||
          (entry.method === 'agent' && methodsLeft.includes('publickey'))
        if (!allowed) continue
        entry.build().then(callback, fail)
        return
      }
      callback(false)
    }

    const config: ConnectConfig = {
      host: target.host,
      port: target.port,
      username: target.username,
      // The session manager owns the deadline (PhaseTimer pauses during prompts).
      readyTimeout: 0,
      keepaliveInterval: 15_000,
      // 3 missed keepalives = disconnected (spec §6).
      keepaliveCountMax: 3,
      algorithms: {
        serverHostKey: hostKeyAlgorithms(preferredHostKeys) as ssh2.ServerHostKeyAlgorithm[],
      },
      tryKeyboard: true,
      authHandler,
      // Returning undefined selects ssh2's callback form, so the check may await a prompt.
      hostVerifier: (key: Buffer, verify: (ok: boolean) => void) => {
        hooks.step('hostkey')
        hooks.verifyHostKey(hostKeyType(key), new Uint8Array(key)).then(verify, (error) => {
          // Settle first so the rejection, not ssh2's generic handshake error, reaches the user.
          fail(error)
          verify(false)
        })
        return undefined
      },
    }

    const lostListeners = new Set<() => void>()
    let ready = false
    client.on('error', (error) => {
      if (ready) for (const l of lostListeners) l()
      else fail(error)
    })
    // A server may drop the socket after key exchange without DISCONNECT; ssh2 then only emits close.
    client.on('close', () =>
      fail(new Error('El servidor cerró la conexión antes de abrir la sesión')),
    )
    client.on('ready', () => {
      if (settled) return
      hooks.step('shell')
      client.shell({ term: 'xterm-256color', cols, rows }, (error, stream) => {
        if (error) return fail(error)
        if (settled) {
          stream.close()
          return
        }
        settled = true
        ready = true
        signal.removeEventListener('abort', onAbort)
        resolve({
          channel: asChannel(stream),
          end: () => client.end(),
          // Same authenticated connection as the shell: no second login.
          openSftp: () =>
            new Promise<SftpLike>((resolveSftp, rejectSftp) => {
              client.sftp((error, sftp) => (error ? rejectSftp(error) : resolveSftp(sftp)))
            }),
          remembered,
          onLost: (listener) => lostListeners.add(listener),
          exec: (command) =>
            new Promise((resolveExec, rejectExec) => {
              if (!client.exec) return rejectExec(new Error('Sin soporte de exec'))
              client.exec(command, (error, stream) => {
                if (error) return rejectExec(error)
                // Without an error listener a channel failure would reach the host process.
                stream.on('error', () => undefined)
                stream.stderr.on('error', () => undefined)
                const exit = new Promise<number | null>((resolveExit) => {
                  stream.once('close', (code: number | null | undefined) =>
                    resolveExit(code ?? null),
                  )
                })
                resolveExec({
                  io: stream,
                  stderr: stream.stderr,
                  exit,
                  close: () => stream.close(),
                })
              })
            }),
          forwardOut: (srcHost, srcPort, dstHost, dstPort) =>
            new Promise((resolveOut, rejectOut) => {
              if (!client.forwardOut) return rejectOut(new Error('Sin soporte de túneles'))
              client.forwardOut(srcHost, srcPort, dstHost, dstPort, (error, channel) =>
                error ? rejectOut(error) : resolveOut(channel),
              )
            }),
          forwardIn: (bindHost, bindPort) =>
            new Promise((resolveIn, rejectIn) => {
              if (!client.forwardIn) return rejectIn(new Error('Sin soporte de túneles'))
              // ssh2 reports the port the server chose when 0 was requested.
              client.forwardIn(bindHost, bindPort, (error, port) =>
                error ? rejectIn(error) : resolveIn(port || bindPort),
              )
            }),
          unforwardIn: (bindHost, bindPort) =>
            new Promise((resolveUn) => {
              if (!client.unforwardIn) return resolveUn()
              client.unforwardIn(bindHost, bindPort, () => resolveUn())
            }),
          onTcpConnection: (listener) => {
            client.on('tcp connection', (info, accept, reject) =>
              listener(
                {
                  destHost: info.destIP,
                  destPort: info.destPort,
                  srcHost: info.srcIP,
                  srcPort: info.srcPort,
                },
                () => accept(),
                () => reject(),
              ),
            )
          },
        })
      })
    })
    hooks.step('tcp')
    client.connect(config)
  })
}

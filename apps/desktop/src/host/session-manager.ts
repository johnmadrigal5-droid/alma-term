import {
  ControlRequest,
  TIMEOUTS,
  type HostToMain,
  type KnownHostEntry,
  type ProtocolError,
} from '@alma/protocol'
import { realScheduler, type Scheduler } from './flow/scheduler'
import { ScpService } from './scp/scp-service'
import { AutoFiles } from './sftp/auto-files'
import type { RemoteFiles } from './sftp/remote-files'
import { mapSftpError, SftpFailure } from './sftp/sftp-errors'
import { SftpService } from './sftp/sftp-service'
import { nodeFs, TransferQueue, type LocalFs } from './sftp/transfer-queue'
import { channelAsPty, type ChannelPty } from './ssh/channel-pty'
import type { SshConnection, SshConnector } from './ssh/connector-types'
import { fingerprintSha256, knownKeyTypes, parseKnownHosts, verifyHostKey } from './ssh/known-hosts'
import { PhaseTimer } from './ssh/phase-timer'
import { PromptBroker, PromptCancelledError } from './ssh/prompt-broker'
import { mapSshError } from './ssh/ssh-errors'
import { realTunnelNet } from './tunnels/real-net'
import { TunnelFailure, TunnelManager, type TunnelNet } from './tunnels/tunnel-manager'
import { TerminalSession } from './terminal-session'
import type { PortLike } from './ports'
import type { PtyFactory, PtyLike } from './pty-types'

export interface ManagerDeps {
  ptyFactory: PtyFactory
  shell: () => { shell: string; args: string[] }
  env: () => Record<string, string>
  cwd: () => string
  send: (message: HostToMain) => void
  scheduler?: Scheduler
  warn?: (message: string) => void
  sshConnector?: SshConnector
  readKnownHostsFile?: () => string
  newPromptId?: () => string
  localFs?: LocalFs
  tunnelNet?: TunnelNet
}

interface Connecting {
  abort: AbortController
  cancelled: boolean
  settled: boolean
  fail: (error: ProtocolError) => void
}

interface Entry {
  session: TerminalSession
  graceTimer: unknown
  /** SSH sessions only: one lazy SFTP channel on the same connection. */
  sftp: RemoteFiles | null
  /** SSH sessions only: the connection tunnels are opened over. */
  connection: SshConnection | null
}

const TRANSFER_CLEANUP_MS = 5_000

type Request<T extends ControlRequest['type']> = Extract<ControlRequest, { type: T }>

function readRequestId(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null || !('requestId' in raw)) return null
  return typeof raw.requestId === 'string' ? raw.requestId : null
}

export class SessionManager {
  private readonly entries = new Map<string, Entry>()
  private readonly connecting = new Map<string, Connecting>()
  private readonly scheduler: Scheduler
  private readonly prompts: PromptBroker
  private readonly transfers: TransferQueue
  private readonly tunnels: TunnelManager

  constructor(private readonly deps: ManagerDeps) {
    this.scheduler = deps.scheduler ?? realScheduler
    this.prompts = new PromptBroker((event) => deps.send(event), deps.newPromptId)
    this.transfers = new TransferQueue({
      local: deps.localFs ?? nodeFs,
      scheduler: this.scheduler,
      send: (event) => deps.send(event),
    })
    this.tunnels = new TunnelManager({
      net: deps.tunnelNet ?? realTunnelNet,
      scheduler: this.scheduler,
      send: (event) => deps.send(event),
    })
  }

  get size(): number {
    return this.entries.size
  }

  handle(raw: unknown, ports: readonly PortLike[]): void {
    const parsed = ControlRequest.safeParse(raw)
    if (!parsed.success) {
      this.deps.warn?.(`mensaje de control inválido: ${parsed.error.message}`)
      for (const port of ports) port.close()
      const requestId = readRequestId(raw)
      if (requestId)
        this.fail(requestId, { code: 'INVALID_MESSAGE', message: 'Mensaje de control inválido' })
      return
    }
    const message = parsed.data
    switch (message.type) {
      case 'local.open':
        this.openLocal(message, ports[0])
        return
      case 'session.resize':
        this.withSession(message.requestId, message.sessionId, (entry) => {
          entry.session.resize(message.cols, message.rows)
          this.ok(message.requestId, null)
        })
        return
      case 'ssh.open':
        this.openSsh(message, ports[0])
        return
      case 'prompt.answer':
        if (this.prompts.answer(message.promptId, message.answer)) this.ok(message.requestId, null)
        else
          this.fail(message.requestId, {
            code: 'INVALID_MESSAGE',
            message: 'La solicitud ya no está pendiente',
          })
        return
      case 'session.close':
        if (this.cancelConnecting(message.sessionId)) {
          this.ok(message.requestId, null)
          return
        }
        this.withSession(message.requestId, message.sessionId, (entry) => {
          entry.session.close()
          this.ok(message.requestId, null)
        })
        return
      case 'session.reattach':
        this.reattach(message, ports[0])
        return
      case 'sftp.home':
        return this.withSftp(message, (sftp) => sftp.home())
      case 'sftp.list':
        return this.withSftp(message, (sftp) => sftp.list(message.path))
      case 'sftp.stat':
        return this.withSftp(message, (sftp) => sftp.stat(message.path))
      case 'sftp.mkdir':
        return this.withSftp(message, (sftp) => sftp.mkdir(message.path))
      case 'sftp.rename':
        return this.withSftp(message, (sftp) => sftp.rename(message.from, message.to))
      case 'sftp.rm':
        return this.withSftp(message, (sftp) => sftp.remove(message.path, message.kind))
      case 'sftp.chmod':
        return this.withSftp(message, (sftp) => sftp.chmod(message.path, message.mode))
      case 'transfer.start':
        return this.startTransfer(message)
      case 'transfer.pause':
        this.transfers.pause(message.transferId)
        return this.ok(message.requestId, null)
      case 'transfer.resume':
        this.transfers.resume(message.transferId)
        return this.ok(message.requestId, null)
      case 'transfer.cancel':
        this.transfers.cancel(message.transferId)
        return this.ok(message.requestId, null)
      case 'tunnel.open':
        return this.openTunnel(message)
      case 'tunnel.close':
        this.tunnels.close(message.tunnelId)
        return this.ok(message.requestId, null)
    }
  }

  private sftpOf(requestId: string, sessionId: string): RemoteFiles | null {
    const sftp = this.entries.get(sessionId)?.sftp
    if (sftp) return sftp
    this.fail(requestId, { code: 'SESSION_NOT_FOUND', message: 'La sesión no tiene SFTP' })
    return null
  }

  private withSftp(
    message: { requestId: string; sessionId: string },
    run: (sftp: RemoteFiles) => Promise<unknown>,
  ): void {
    const sftp = this.sftpOf(message.requestId, message.sessionId)
    if (!sftp) return
    run(sftp).then(
      (data) => this.ok(message.requestId, data ?? null),
      (error: unknown) =>
        this.fail(
          message.requestId,
          error instanceof SftpFailure ? error.toProtocol() : mapSftpError(error),
        ),
    )
  }

  private startTransfer(message: Request<'transfer.start'>): void {
    const sftp = this.sftpOf(message.requestId, message.sessionId)
    if (!sftp) return
    if (this.transfers.has(message.transferId))
      return this.fail(message.requestId, {
        code: 'INVALID_MESSAGE',
        message: 'La transferencia ya existe',
      })
    const { transferId, sessionId, direction, localPath, remotePath, overwrite } = message
    this.transfers.add({
      transferId,
      sessionId,
      direction,
      localPath,
      remotePath,
      overwrite,
      sftp: () => sftp.stream(),
    })
    this.ok(message.requestId, { transferId })
  }

  private openTunnel(message: Request<'tunnel.open'>): void {
    const { requestId, sessionId, tunnelId, spec } = message
    const connection = this.entries.get(sessionId)?.connection
    if (!connection)
      return this.fail(requestId, { code: 'SESSION_NOT_FOUND', message: 'La sesión no es SSH' })
    const { forwardOut, forwardIn, unforwardIn, onTcpConnection } = connection
    if (!forwardOut || !forwardIn || !unforwardIn || !onTcpConnection)
      return this.fail(requestId, {
        code: 'TUNNEL_FAILED',
        message: 'Esta conexión no admite túneles',
      })
    this.tunnels
      .open(sessionId, tunnelId, spec, {
        forwardOut: forwardOut.bind(connection),
        forwardIn: forwardIn.bind(connection),
        unforwardIn: unforwardIn.bind(connection),
        onTcpConnection: onTcpConnection.bind(connection),
      })
      .then(
        (boundPort) => this.ok(requestId, { tunnelId, boundPort }),
        (error: unknown) =>
          this.fail(
            requestId,
            error instanceof TunnelFailure
              ? error.error
              : { code: 'TUNNEL_FAILED', message: 'No se pudo abrir el túnel' },
          ),
      )
  }

  dispose(): void {
    this.tunnels.dispose()
    this.transfers.dispose()
    for (const id of [...this.connecting.keys()]) this.cancelConnecting(id)
    for (const entry of this.entries.values()) {
      this.scheduler.clearTimeout(entry.graceTimer)
      entry.session.close()
    }
    this.entries.clear()
  }

  private openLocal(message: Request<'local.open'>, port: PortLike | undefined): void {
    const { requestId, sessionId } = message
    if (!port)
      return this.fail(requestId, { code: 'INVALID_MESSAGE', message: 'Falta el puerto de datos' })
    if (this.entries.has(sessionId)) {
      port.close()
      return this.fail(requestId, { code: 'INVALID_MESSAGE', message: 'La sesión ya existe' })
    }
    const defaults = this.deps.shell()
    let pty: PtyLike
    try {
      pty = this.deps.ptyFactory({
        shell: message.shell ?? defaults.shell,
        args: message.shell ? [] : defaults.args,
        cols: message.cols,
        rows: message.rows,
        cwd: message.cwd ?? this.deps.cwd(),
        env: this.deps.env(),
      })
    } catch (error) {
      port.close()
      const text = error instanceof Error ? error.message : 'No se pudo iniciar la shell'
      return this.fail(requestId, { code: 'SPAWN_FAILED', message: text })
    }
    this.startSession(requestId, sessionId, pty, port, null)
  }

  private startSession(
    requestId: string,
    sessionId: string,
    pty: PtyLike,
    port: PortLike,
    sftp: RemoteFiles | null,
    connection: SshConnection | null = null,
  ): void {
    const entry: Entry = {
      graceTimer: null,
      sftp,
      connection,
      session: new TerminalSession({
        id: sessionId,
        pty,
        scheduler: this.scheduler,
        warn: this.deps.warn,
        onStatus: (state, exitCode) => {
          if (state === 'closed' || state === 'lost') this.forget(sessionId)
          this.deps.send({ type: 'event.status', sessionId, state, exitCode })
        },
        onDetached: () => this.startGrace(sessionId),
      }),
    }
    this.entries.set(sessionId, entry)
    entry.session.attach(port, false)
    this.deps.send({ type: 'event.status', sessionId, state: 'ready', exitCode: null })
    this.ok(requestId, { sessionId })
  }

  private openSsh(message: Request<'ssh.open'>, port: PortLike | undefined): void {
    const { requestId, sessionId, target } = message
    const connector = this.deps.sshConnector
    if (!port)
      return this.fail(requestId, { code: 'INVALID_MESSAGE', message: 'Falta el puerto de datos' })
    if (!connector || this.entries.has(sessionId) || this.connecting.has(sessionId)) {
      port.close()
      return this.fail(requestId, {
        code: 'INVALID_MESSAGE',
        message: 'No se puede abrir la sesión',
      })
    }
    const state: Connecting = {
      abort: new AbortController(),
      cancelled: false,
      settled: false,
      fail: (error) => settleFailure(error),
    }
    this.connecting.set(sessionId, state)
    let outcome: ProtocolError | null = null
    // Ends the open request exactly once, whatever finishes first.
    const settleFailure = (error: ProtocolError) => {
      if (state.settled) return
      state.settled = true
      timer.stop()
      this.connecting.delete(sessionId)
      this.prompts.cancelSession(sessionId)
      state.abort.abort()
      port.close()
      this.fail(requestId, error)
    }
    const timer = new PhaseTimer(
      TIMEOUTS.connectHandshakeMs,
      () => settleFailure({ code: 'ETIMEDOUT', message: 'La conexión tardó demasiado' }),
      this.scheduler,
    )
    const ask = async <T>(fn: () => Promise<T>): Promise<T> => {
      timer.pause()
      try {
        return await fn()
      } finally {
        timer.resume()
      }
    }
    const trustedFor = (keyType: string, keyBlob: Uint8Array): KnownHostEntry => ({
      host: target.host,
      port: target.port,
      keyType,
      fingerprint: fingerprintSha256(keyBlob),
      publicKey: Buffer.from(keyBlob).toString('base64'),
    })

    // Read once per connection: the same view drives the algorithm order and the key check.
    const knownFile = parseKnownHosts(this.deps.readKnownHostsFile?.() ?? '')
    if (knownFile.warnings.length > 0)
      this.deps.warn?.(`known_hosts: ${knownFile.warnings.join('; ')}`)
    const file = knownFile.entries

    timer.start()
    connector
      .connect({
        target,
        auth: message.auth,
        cols: message.cols,
        rows: message.rows,
        rememberable: message.rememberable,
        preferredHostKeys: knownKeyTypes(target.host, target.port, message.trusted, file),
        signal: state.abort.signal,
        hooks: {
          step: (step) => this.deps.send({ type: 'event.step', sessionId, step }),
          verifyHostKey: async (keyType, keyBlob) => {
            const check = verifyHostKey(
              { app: message.trusted, file },
              target.host,
              target.port,
              keyType,
              keyBlob,
            )
            if (check.status === 'trusted') return true
            const answer = await ask(() =>
              this.prompts.ask(sessionId, {
                kind: 'hostkey',
                status: check.status === 'changed' ? 'changed' : 'new',
                host: target.host,
                port: target.port,
                keyType,
                fingerprint: fingerprintSha256(keyBlob),
                ...(check.status === 'changed' ? { knownFingerprint: check.knownFingerprint } : {}),
              }),
            )
            if (answer.type === 'hostkey' && answer.accept) {
              this.deps.send({
                type: 'event.hostkey-trusted',
                sessionId,
                entry: trustedFor(keyType, keyBlob),
              })
              return true
            }
            outcome = { code: 'HOSTKEY_REJECTED', message: 'No se confió en la clave del servidor' }
            return false
          },
          askAuth: async (prompt) => {
            const answer = await ask(() => this.prompts.ask(sessionId, prompt))
            return answer.type === 'auth'
              ? { responses: answer.responses, remember: answer.remember === true }
              : { responses: [], remember: false }
          },
        },
      })
      .then((connection) => {
        if (state.settled || state.cancelled || outcome) {
          connection.end()
          settleFailure(outcome ?? { code: 'PROMPT_CANCELLED', message: 'Conexión cancelada' })
          return
        }
        let pty: ChannelPty
        try {
          // Partial uploads are removed over this connection: end it once they are gone.
          pty = channelAsPty(connection.channel, () => {
            void this.releaseTransfers(sessionId).then(() => connection.end())
          })
          connection.onLost?.(() => {
            pty.markLost()
            this.tunnels.closeSession(sessionId)
            this.transfers.failSession(sessionId, {
              code: 'CONNECTION_LOST',
              message: 'Se perdió la conexión con el servidor',
            })
          })
        } catch (error) {
          // Settle before marking the request done, or the renderer would wait forever.
          connection.end()
          settleFailure(mapSshError(error))
          return
        }
        state.settled = true
        timer.stop()
        this.connecting.delete(sessionId)
        this.startSession(
          requestId,
          sessionId,
          pty,
          port,
          new AutoFiles(
            new SftpService(() => connection.openSftp()),
            connection.exec
              ? new ScpService(
                  (command) => connection.exec?.(command) ?? Promise.reject(new Error('Sin exec')),
                )
              : null,
            (mode) => this.deps.send({ type: 'event.sftp-mode', sessionId, mode }),
          ),
          connection,
        )
        // Only after authentication succeeded and the open was answered: main stores it encrypted.
        if (connection.remembered)
          this.deps.send({ type: 'event.credential', sessionId, ...connection.remembered })
      })
      .catch((error: unknown) => {
        if (state.cancelled || error instanceof PromptCancelledError)
          settleFailure({ code: 'PROMPT_CANCELLED', message: 'Conexión cancelada' })
        else settleFailure(outcome ?? mapSshError(error))
      })
  }

  private cancelConnecting(sessionId: string): boolean {
    const state = this.connecting.get(sessionId)
    if (!state) return false
    state.cancelled = true
    state.fail({ code: 'PROMPT_CANCELLED', message: 'Conexión cancelada' })
    return true
  }

  private reattach(message: Request<'session.reattach'>, port: PortLike | undefined): void {
    if (!port)
      return this.fail(message.requestId, {
        code: 'INVALID_MESSAGE',
        message: 'Falta el puerto de datos',
      })
    const entry = this.entries.get(message.sessionId)
    if (!entry) {
      port.close()
      return this.fail(message.requestId, {
        code: 'SESSION_NOT_FOUND',
        message: 'La sesión ya no existe',
      })
    }
    this.scheduler.clearTimeout(entry.graceTimer)
    entry.graceTimer = null
    entry.session.attach(port, true)
    this.ok(message.requestId, { sessionId: message.sessionId })
  }

  private startGrace(sessionId: string): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return
    entry.graceTimer = this.scheduler.setTimeout(() => {
      this.deps.warn?.(
        `sesión ${sessionId} sin renderer tras ${TIMEOUTS.reattachGraceMs} ms; se cierra`,
      )
      entry.session.close()
    }, TIMEOUTS.reattachGraceMs)
  }

  private forget(sessionId: string): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return
    this.scheduler.clearTimeout(entry.graceTimer)
    this.entries.delete(sessionId)
    // Closing or losing the tab cancels its transfers and tunnels before the channel goes away.
    this.tunnels.closeSession(sessionId)
    void this.releaseTransfers(sessionId).then(() => entry.sftp?.dispose())
  }

  /** Cancels the session's transfers; waits for their cleanup, at most 5 s. */
  private releaseTransfers(sessionId: string): Promise<void> {
    return new Promise((resolve) => {
      const timer = this.scheduler.setTimeout(resolve, TRANSFER_CLEANUP_MS)
      void this.transfers.cancelSession(sessionId).then(() => {
        this.scheduler.clearTimeout(timer)
        resolve()
      })
    })
  }

  private withSession(requestId: string, sessionId: string, fn: (entry: Entry) => void): void {
    const entry = this.entries.get(sessionId)
    if (!entry)
      return this.fail(requestId, { code: 'SESSION_NOT_FOUND', message: 'La sesión no existe' })
    fn(entry)
  }

  private ok(requestId: string, data: unknown): void {
    this.deps.send({ type: 'response', requestId, ok: true, data })
  }

  private fail(requestId: string, error: ProtocolError): void {
    this.deps.send({ type: 'response', requestId, ok: false, error })
  }
}

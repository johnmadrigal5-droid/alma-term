import { DataFromRenderer, FLOW, type SessionState } from '@alma/protocol'
import { Coalescer } from './flow/coalescer'
import { CreditGate } from './flow/credits'
import { ByteRing } from './flow/ring-buffer'
import { realScheduler, type Scheduler } from './flow/scheduler'
import type { PortLike } from './ports'
import type { PtyLike } from './pty-types'
import type { SessionLogWriter } from './session-log'

const KILL_ESCALATION_MS = 3000

export interface TerminalSessionOptions {
  id: string
  pty: PtyLike
  onStatus: (state: SessionState, exitCode: number | null) => void
  onDetached: () => void
  scheduler?: Scheduler
  warn?: (message: string) => void
  /** Receives everything the terminal printed, whether or not a tab is attached. */
  log?: SessionLogWriter
}

export class TerminalSession {
  readonly id: string
  private port: PortLike | null = null
  private seq = 0
  private exitCode: number | null | undefined = undefined
  private readonly ring = new ByteRing(FLOW.replayBytes)
  private readonly gate: CreditGate
  private readonly coalescer: Coalescer
  private readonly disposers: (() => void)[] = []
  private readonly scheduler: Scheduler
  private killTimer: unknown = null

  constructor(private readonly options: TerminalSessionOptions) {
    this.id = options.id
    this.scheduler = options.scheduler ?? realScheduler
    const { pty } = options
    this.gate = new CreditGate(
      FLOW.highWaterBytes,
      FLOW.lowWaterBytes,
      () => this.safe('pause', () => pty.pause()),
      () => this.safe('resume', () => pty.resume()),
    )
    this.coalescer = new Coalescer((bytes) => this.emitData(bytes), FLOW.coalesceMs, this.scheduler)
    const data = pty.onData((chunk) => this.coalescer.push(chunk))
    const exit = pty.onExit(({ exitCode, lost }) => this.handleExit(exitCode, lost === true))
    this.disposers.push(
      () => data.dispose(),
      () => exit.dispose(),
    )
  }

  attach(port: PortLike, replay: boolean): void {
    const previous = this.port
    this.port = port
    previous?.close()
    this.gate.reset()
    port.onMessage((message) => this.handleRendererMessage(message))
    port.onClose(() => {
      if (this.port !== port) return
      this.port = null
      this.gate.reset()
      this.options.onDetached()
    })
    if (replay) {
      const snapshot = this.ring.snapshot()
      if (snapshot.length > 0) this.post(port, snapshot)
    }
    if (this.exitCode !== undefined) port.postMessage({ type: 'exit', code: this.exitCode })
  }

  resize(cols: number, rows: number): void {
    if (this.exitCode === undefined) this.safe('resize', () => this.options.pty.resize(cols, rows))
  }

  // SIGHUP first; shells that ignore it (trap '' HUP) get SIGKILL after 3 s.
  close(): void {
    if (this.exitCode !== undefined || this.killTimer !== null) return
    this.safe('kill', () => this.options.pty.kill())
    this.killTimer = this.scheduler.setTimeout(() => {
      if (this.exitCode === undefined) this.safe('kill', () => this.options.pty.kill('SIGKILL'))
    }, KILL_ESCALATION_MS)
  }

  // A dead pty fd makes node-pty throw (EBADF) until its exit event arrives;
  // one session must never take the whole host down.
  private safe(action: string, fn: () => void): void {
    try {
      fn()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      this.options.warn?.(`${action} falló en ${this.id}: ${reason}`)
    }
  }

  private emitData(bytes: Uint8Array): void {
    this.safe('log', () => this.options.log?.write(bytes))
    this.ring.append(bytes)
    if (this.port) this.post(this.port, bytes)
  }

  private post(port: PortLike, bytes: Uint8Array): void {
    port.postMessage({ type: 'data', seq: this.seq++, bytes })
    this.gate.sent(bytes.length)
  }

  private handleRendererMessage(raw: unknown): void {
    const parsed = DataFromRenderer.safeParse(raw)
    if (!parsed.success) {
      this.options.warn?.(`mensaje de datos inválido en ${this.id}`)
      return
    }
    const message = parsed.data
    if (message.type === 'ack') {
      this.gate.acked(message.bytes)
      return
    }
    if (this.exitCode === undefined) this.safe('write', () => this.options.pty.write(message.bytes))
  }

  private handleExit(exitCode: number, lost: boolean): void {
    this.scheduler.clearTimeout(this.killTimer)
    this.coalescer.dispose()
    this.safe('log', () => this.options.log?.close())
    this.exitCode = exitCode
    // A dropped connection is not an exit: the tab keeps its content and offers to reconnect,
    // so the data port gets no exit message that would mark it as cleanly closed.
    if (!lost) this.port?.postMessage({ type: 'exit', code: exitCode })
    for (const dispose of this.disposers) dispose()
    if (lost) this.options.onStatus('lost', null)
    else this.options.onStatus('closed', exitCode)
  }
}

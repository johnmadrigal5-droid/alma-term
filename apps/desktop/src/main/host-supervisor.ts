import {
  HostToMain,
  TIMEOUTS,
  type ControlRequest,
  type ErrorCode,
  type HostEvent,
} from '@alma/protocol'
import type { RestartPolicy } from './restart-policy'

export class HostRequestError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'HostRequestError'
  }
}

export interface HostChild<P> {
  postMessage(message: unknown, transfer: P[]): void
  onMessage(listener: (message: unknown) => void): void
  onExit(listener: (code: number) => void): void
  kill(): void
}

export interface SupervisorDeps<P> {
  fork: () => HostChild<P>
  policy: RestartPolicy
  onEvent: (event: HostEvent) => void
  onHostLost: () => void
  onGaveUp: () => void
  timeoutMs?: number
  warn?: (message: string) => void
}

interface Pending {
  resolve: (data: unknown) => void
  reject: (error: HostRequestError) => void
  timer: ReturnType<typeof setTimeout> | undefined
}

export interface RequestOptions {
  /** `null` waits indefinitely (the host enforces its own deadline, e.g. ssh.open). */
  timeoutMs?: number | null
}

export class HostSupervisor<P> {
  private child: HostChild<P> | null = null
  private readonly pending = new Map<string, Pending>()
  private stopping = false
  private gaveUp = false

  constructor(private readonly deps: SupervisorDeps<P>) {}

  get isAvailable(): boolean {
    return this.child !== null
  }

  start(): void {
    if (this.stopping || this.gaveUp) return
    const child = this.deps.fork()
    this.child = child
    child.onMessage((message) => {
      if (this.child === child) this.handleMessage(message)
    })
    child.onExit((code) => {
      if (this.child === child) this.handleExit(code)
    })
  }

  request(
    message: ControlRequest,
    transfer: P[] = [],
    options: RequestOptions = {},
  ): Promise<unknown> {
    const child = this.child
    if (!child) {
      return Promise.reject(
        new HostRequestError('HOST_UNAVAILABLE', 'El proceso de sesiones no está disponible'),
      )
    }
    return new Promise((resolve, reject) => {
      const timeoutMs =
        options.timeoutMs === undefined
          ? (this.deps.timeoutMs ?? TIMEOUTS.controlMs)
          : options.timeoutMs
      const timer =
        timeoutMs === null
          ? undefined
          : setTimeout(() => {
              this.pending.delete(message.requestId)
              reject(new HostRequestError('TIMEOUT', `Sin respuesta a ${message.type}`))
            }, timeoutMs)
      this.pending.set(message.requestId, { resolve, reject, timer })
      child.postMessage(message, transfer)
    })
  }

  stop(): void {
    this.stopping = true
    this.rejectAll('HOST_UNAVAILABLE', 'La aplicación se está cerrando')
    const child = this.child
    this.child = null
    child?.kill()
  }

  private handleMessage(raw: unknown): void {
    const parsed = HostToMain.safeParse(raw)
    if (!parsed.success) {
      this.deps.warn?.('mensaje inválido del session host')
      return
    }
    const message = parsed.data
    if (message.type !== 'response') {
      this.deps.onEvent(message)
      return
    }
    const entry = this.pending.get(message.requestId)
    if (!entry) return
    this.pending.delete(message.requestId)
    clearTimeout(entry.timer)
    if (message.ok) entry.resolve(message.data)
    else entry.reject(new HostRequestError(message.error.code, message.error.message))
  }

  private handleExit(code: number): void {
    this.child = null
    this.deps.warn?.(`el session host terminó con código ${code}`)
    this.rejectAll('HOST_UNAVAILABLE', 'El proceso de sesiones se reinició')
    this.deps.onHostLost()
    if (this.deps.policy.recordCrash() === 'restart') {
      this.start()
    } else {
      this.gaveUp = true
      this.deps.onGaveUp()
    }
  }

  private rejectAll(code: ErrorCode, message: string): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(new HostRequestError(code, message))
      this.pending.delete(id)
    }
  }
}

import type {
  AlmaApi,
  ProtocolError,
  TransferEvent,
  TransferStartArgs,
  TransferState,
} from '@alma/protocol'
import { create } from 'zustand'

export interface TransferView {
  transferId: string
  sessionId: string
  direction: TransferEvent['direction']
  name: string
  state: TransferState
  bytes: number
  total: number
  /** Bytes per second between the last two progress events; 0 when unknown. */
  speed: number
  error: ProtocolError | null
}

const ACTIVE: readonly TransferState[] = ['queued', 'running', 'paused']
const FINISHED: readonly TransferState[] = ['done', 'cancelled']

interface Sample {
  at: number
  bytes: number
}

interface TransfersState {
  items: Record<string, TransferView>
  views(): TransferView[]
  activeCount(): number
  apply(event: TransferEvent): void
  /** Keeps the start arguments so Reintentar can launch the same transfer again. */
  remember(args: TransferStartArgs & { transferId: string }): void
  /** Lists a transfer the host refused to start, so it can be seen and retried. */
  reject(args: TransferStartArgs & { transferId: string }, name: string, error: ProtocolError): void
  dismiss(transferId: string): void
  pause(transferId: string): Promise<void>
  resume(transferId: string): Promise<void>
  cancel(transferId: string): Promise<void>
  retry(transferId: string): Promise<void>
  clearDone(): void
}

interface Options {
  now?: () => number
  newId?: () => string
}

export const isActive = (view: TransferView) => ACTIVE.includes(view.state)

export function createTransfers(api: AlmaApi['transfers'], options: Options = {}) {
  const now = options.now ?? (() => performance.now())
  const newId = options.newId ?? (() => crypto.randomUUID())
  const started = new Map<string, TransferStartArgs & { transferId: string }>()
  const samples = new Map<string, Sample>()
  const without = (items: Record<string, TransferView>, id: string) =>
    Object.fromEntries(Object.entries(items).filter(([key]) => key !== id))

  return create<TransfersState>()((set, get) => ({
    items: {},
    views: () => Object.values(get().items).reverse(),
    activeCount: () => Object.values(get().items).filter(isActive).length,

    apply: (event) => {
      const previous = get().items[event.transferId]
      const sample = samples.get(event.transferId)
      const at = now()
      const elapsed = sample ? (at - sample.at) / 1000 : 0
      const speed =
        sample && elapsed > 0 && event.bytes >= sample.bytes
          ? Math.round((event.bytes - sample.bytes) / elapsed)
          : (previous?.speed ?? 0)
      samples.set(event.transferId, { at, bytes: event.bytes })
      set({
        items: {
          ...get().items,
          [event.transferId]: {
            transferId: event.transferId,
            sessionId: event.sessionId,
            direction: event.direction,
            name: event.name,
            state: event.state,
            bytes: event.bytes,
            total: event.total,
            speed: event.state === 'running' ? speed : 0,
            error: event.error ?? null,
          },
        },
      })
    },

    remember: (args) => {
      started.set(args.transferId, args)
    },

    reject: (args, name, error) => {
      started.set(args.transferId, args)
      set({
        items: {
          ...get().items,
          [args.transferId]: {
            transferId: args.transferId,
            sessionId: args.sessionId,
            direction: args.direction,
            name,
            state: 'error',
            bytes: 0,
            total: 0,
            speed: 0,
            error,
          },
        },
      })
    },

    dismiss: (transferId) => {
      samples.delete(transferId)
      set({ items: without(get().items, transferId) })
    },

    pause: async (transferId) => {
      await api.pause({ transferId })
    },
    resume: async (transferId) => {
      await api.resume({ transferId })
    },
    cancel: async (transferId) => {
      await api.cancel({ transferId })
    },

    retry: async (transferId) => {
      const args = started.get(transferId)
      const view = get().items[transferId]
      if (!args || !view) return
      // A transfer that failed halfway removed its partial file; one that never started
      // (EEXIST) keeps the user's original choice.
      const next = { ...args, transferId: newId(), overwrite: args.overwrite || view.bytes > 0 }
      get().dismiss(transferId)
      started.delete(transferId)
      started.set(next.transferId, next)
      const result = await api.start(next)
      if (!result.ok) get().reject(next, view.name, result.error)
    },

    clearDone: () =>
      set({
        items: Object.fromEntries(
          Object.entries(get().items).filter(([, v]) => !FINISHED.includes(v.state)),
        ),
      }),
  }))
}

export type TransfersStore = ReturnType<typeof createTransfers>

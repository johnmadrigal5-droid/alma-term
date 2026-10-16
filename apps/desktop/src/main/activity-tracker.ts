import type { HostEvent } from '@alma/protocol'

export interface ActivityCounts {
  transfers: number
  tunnels: number
}

const ACTIVE_TRANSFER = new Set(['queued', 'running', 'paused'])

/**
 * What is still going on, from the events main already forwards: transfers and tunnels that
 * closing the app would cut off. A session that closes or is lost takes its own along.
 */
export class ActivityTracker {
  private readonly transfers = new Map<string, string>()
  private readonly tunnels = new Map<string, string>()

  apply(event: HostEvent): void {
    switch (event.type) {
      case 'event.transfer':
        if (ACTIVE_TRANSFER.has(event.state)) this.transfers.set(event.transferId, event.sessionId)
        else this.transfers.delete(event.transferId)
        return
      case 'event.tunnel':
        if (event.state === 'open') this.tunnels.set(event.tunnelId, event.sessionId)
        else this.tunnels.delete(event.tunnelId)
        return
      case 'event.status':
        if (event.state === 'ready') return
        for (const map of [this.transfers, this.tunnels])
          for (const [id, sessionId] of map) if (sessionId === event.sessionId) map.delete(id)
        return
      default:
        return
    }
  }

  counts(): ActivityCounts {
    return { transfers: this.transfers.size, tunnels: this.tunnels.size }
  }

  clear(): void {
    this.transfers.clear()
    this.tunnels.clear()
  }
}

export interface CloseWarning {
  message: string
  detail: string
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The question to ask before closing, or null when nothing would be lost. */
export function closeWarning({ transfers, tunnels }: ActivityCounts): CloseWarning | null {
  if (transfers === 0 && tunnels === 0) return null
  const detail = 'Si cierras la aplicación se cancelarán.'
  if (tunnels === 0)
    return {
      message: `Hay ${count(transfers, 'transferencia activa', 'transferencias activas')}`,
      detail,
    }
  if (transfers === 0)
    return { message: `Hay ${count(tunnels, 'túnel activo', 'túneles activos')}`, detail }
  return {
    message: `Hay ${count(transfers, 'transferencia', 'transferencias')} y ${count(tunnels, 'túnel', 'túneles')} activos`,
    detail,
  }
}

interface GuardDeps {
  counts(): ActivityCounts
  /** Resolves true when the user chose to close anyway. */
  ask(warning: CloseWarning): Promise<boolean>
}

/** Holds a window close while transfers or tunnels are active, until the user confirms. */
export function createCloseGuard({ counts, ask }: GuardDeps) {
  let confirmed = false
  let asking = false
  return {
    onClose(event: { preventDefault(): void }, closeAgain: () => void): void {
      if (confirmed) return
      const warning = closeWarning(counts())
      if (!warning) return
      event.preventDefault()
      if (asking) return
      asking = true
      void ask(warning).then((close) => {
        asking = false
        if (!close) return
        confirmed = true
        closeAgain()
      })
    },
  }
}

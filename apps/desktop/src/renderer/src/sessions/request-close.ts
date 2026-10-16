export interface CloseCounts {
  tunnels: number
  transfers: number
}

export interface CloseWarning {
  title: string
  description: string
}

/** What closing a tab would stop, or null when it has nothing running. */
export function closeWarning({ tunnels, transfers }: CloseCounts): CloseWarning | null {
  if (tunnels === 0 && transfers === 0) return null
  const parts: string[] = []
  if (tunnels > 0)
    parts.push(
      tunnels === 1 ? 'Se cerrará 1 túnel activo' : `Se cerrarán ${tunnels} túneles activos`,
    )
  if (transfers > 0) {
    const text =
      transfers === 1 ? '1 transferencia en curso' : `${transfers} transferencias en curso`
    const verb = `cancelará${transfers === 1 ? '' : 'n'}`
    parts.push(tunnels > 0 ? `se ${verb} ${text}` : `Se ${verb} ${text}`)
  }
  return { title: 'Cerrar la pestaña', description: `${parts.join(' y ')} de esta pestaña.` }
}

interface Deps {
  /** Running tunnels and transfers of one tab. */
  counts(sessionId: string): CloseCounts
  close(sessionId: string): void
  confirm(sessionId: string, warning: CloseWarning): void
}

/**
 * One way in for every route that closes a tab (the x, Delete on a tab, Ctrl+Shift+W, the
 * connecting overlay): a tab with something running asks first, like the window does.
 */
export function createRequestClose({ counts, close, confirm }: Deps) {
  return (sessionId: string): void => {
    const warning = closeWarning(counts(sessionId))
    if (warning) confirm(sessionId, warning)
    else close(sessionId)
  }
}

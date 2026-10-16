export type ShortcutAction =
  | { type: 'newLocal' }
  | { type: 'nextTab' }
  | { type: 'prevTab' }
  | { type: 'selectTab'; index: number }
  | { type: 'palette' }
  | { type: 'toggleSftp' }
  | { type: 'multiExec' }
  | { type: 'splitPanes' }
  | { type: 'closeTab' }

export interface KeyLike {
  key: string
  type: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

export interface ShortcutContext {
  /** Focus is inside a terminal, where Ctrl+K belongs to the shell (readline kill-line). */
  inTerminal: boolean
}

export function matchShortcut(
  event: KeyLike,
  platform: string,
  context: ShortcutContext = { inTerminal: false },
): ShortcutAction | null {
  if (event.type !== 'keydown' || event.altKey) return null
  const mod = platform === 'darwin' ? event.metaKey : event.ctrlKey
  if (mod && event.key.toLowerCase() === 'k') {
    // ⌘K never reaches a shell on macOS; elsewhere Ctrl+K does, so the terminal keeps it
    // and Ctrl+Shift+K opens the palette from anywhere.
    if (platform === 'darwin' || event.shiftKey || !context.inTerminal) return { type: 'palette' }
    return null
  }
  if (mod && event.shiftKey && event.key.toLowerCase() === 't') return { type: 'newLocal' }
  if (mod && event.shiftKey && event.key.toLowerCase() === 'f') return { type: 'toggleSftp' }
  if (mod && event.shiftKey && event.key.toLowerCase() === 'm') return { type: 'multiExec' }
  if (mod && event.shiftKey && event.key.toLowerCase() === 'd') return { type: 'splitPanes' }
  // Ctrl+W is readline's delete-word, so the terminal keeps it and closing takes the Shift.
  if (mod && event.shiftKey && event.key.toLowerCase() === 'w') return { type: 'closeTab' }
  if (event.ctrlKey && event.key === 'Tab')
    return event.shiftKey ? { type: 'prevTab' } : { type: 'nextTab' }
  if (mod && !event.shiftKey && /^[1-9]$/.test(event.key))
    return { type: 'selectTab', index: Number(event.key) - 1 }
  return null
}

/** xterm's key filter: true lets the key reach the shell; app shortcuts stay with the app. */
export function passesToTerminal(event: KeyLike, platform: string): boolean {
  return matchShortcut(event, platform, { inTerminal: true }) === null
}

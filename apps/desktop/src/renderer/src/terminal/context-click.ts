import type { PasteTracker } from './paste-tracker'

export interface ClipboardLike {
  readText(): Promise<string>
  writeText(text: string): Promise<void>
}

export interface SelectableTerminal {
  hasSelection(): boolean
  getSelection(): string
  clearSelection(): void
  paste(text: string): void
}

/**
 * Right click as in PuTTY: with a selection it copies it, without one it pastes the clipboard.
 * Clipboard failures (permission, empty) leave the terminal untouched.
 */
export function bindContextClick(
  el: HTMLElement,
  term: SelectableTerminal,
  paste: Pick<PasteTracker, 'around'>,
  clipboard: ClipboardLike,
): () => void {
  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    if (term.hasSelection()) {
      const text = term.getSelection()
      term.clearSelection()
      void clipboard.writeText(text).catch(() => undefined)
      return
    }
    void clipboard
      .readText()
      .then((text) => {
        if (text !== '') paste.around(() => term.paste(text))
      })
      .catch(() => undefined)
  }
  el.addEventListener('contextmenu', onContextMenu)
  return () => el.removeEventListener('contextmenu', onContextMenu)
}

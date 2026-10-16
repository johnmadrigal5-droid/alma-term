/**
 * True while xterm handles a paste. xterm fires onData for the pasted text synchronously inside
 * the textarea's paste event; this capture listener on an ancestor runs first.
 */
export interface PasteTracker {
  active(): boolean
  /** Runs a paste started by the app (not by a paste event) so it counts as one. */
  around(run: () => void): void
  dispose(): void
}

export function trackPaste(el: HTMLElement): PasteTracker {
  let pasting = false
  const onPaste = () => {
    pasting = true
    queueMicrotask(() => {
      pasting = false
    })
  }
  el.addEventListener('paste', onPaste, true)
  return {
    active: () => pasting,
    around: (run) => {
      pasting = true
      try {
        run()
      } finally {
        pasting = false
      }
    },
    dispose: () => el.removeEventListener('paste', onPaste, true),
  }
}

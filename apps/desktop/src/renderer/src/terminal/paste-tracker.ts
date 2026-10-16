/**
 * True while xterm handles a paste. xterm fires onData for the pasted text synchronously inside
 * the textarea's paste event; this capture listener on an ancestor runs first.
 */
export function trackPaste(el: HTMLElement): { active(): boolean; dispose(): void } {
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
    dispose: () => el.removeEventListener('paste', onPaste, true),
  }
}

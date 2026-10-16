/**
 * Whether a terminal that becomes active (or reconnects) may take the keyboard focus. Fields
 * marked `data-keeps-focus` keep it: typing in the MultiExec composer must not end up in a shell.
 */
export function mayTakeFocus(active: Element | null): boolean {
  return active?.closest('[data-keeps-focus]') == null
}

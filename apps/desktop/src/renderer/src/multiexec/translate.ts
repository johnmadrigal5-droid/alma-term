export interface TermModes {
  applicationCursorKeysMode: boolean
  bracketedPasteMode: boolean
}

export type InputChunk = { kind: 'keys'; data: string } | { kind: 'paste'; text: string }

export const PASTE_START = '\x1b[200~'
export const PASTE_END = '\x1b[201~'

/** What the active terminal sent, as MultiExec needs it: keys, or the bare pasted text. */
export function fromXterm(data: string, pasting: boolean): InputChunk {
  if (!pasting) return { kind: 'keys', data }
  const wrapped = data.startsWith(PASTE_START) && data.endsWith(PASTE_END)
  return {
    kind: 'paste',
    text: wrapped ? data.slice(PASTE_START.length, data.length - PASTE_END.length) : data,
  }
}
// Unmodified arrows and Home/End, in normal (CSI) or application (SS3) form.
// eslint-disable-next-line no-control-regex
const CURSOR = /\x1b[[O]([ABCDHF])/g
// Mouse reports (X10, SGR) and focus in/out: answers of the source terminal, not keys.
// eslint-disable-next-line no-control-regex
const REPORTS = /\x1b\[M[\s\S]{3}|\x1b\[<\d+;\d+;\d+[Mm]|\x1b\[[IO]/g

/** Re-encodes what the active terminal sent for a target terminal in its own modes. */
export function encodeFor(chunk: InputChunk, target: TermModes): string {
  if (chunk.kind === 'paste') {
    // A marker inside the text would end the paste early and run the rest as typed keys.
    // Strip until stable: removing a nested marker can assemble a new one.
    let text = chunk.text
    for (let before = ''; before !== text;) {
      before = text
      text = text.replaceAll(PASTE_START, '').replaceAll(PASTE_END, '')
    }
    return target.bracketedPasteMode ? PASTE_START + text + PASTE_END : text
  }
  const intro = target.applicationCursorKeysMode ? '\x1bO' : '\x1b['
  return chunk.data.replace(REPORTS, '').replace(CURSOR, (_, key: string) => intro + key)
}

// Bytes at the end of `bytes` that start a UTF-8 sequence not yet completed.
export function incompleteUtf8TailLength(bytes: Uint8Array): number {
  const len = bytes.length
  if (len === 0) return 0
  let cont = 0
  while (cont < 3 && cont < len && ((bytes[len - 1 - cont] ?? 0) & 0xc0) === 0x80) cont++
  const leadIndex = len - 1 - cont
  if (leadIndex < 0) return 0
  const lead = bytes[leadIndex] ?? 0
  if (lead < 0xc0) return 0
  const needed = lead < 0xe0 ? 1 : lead < 0xf0 ? 2 : 3
  return cont < needed ? cont + 1 : 0
}

export const TIMEOUTS = {
  connectHandshakeMs: 20_000,
  sftpListMs: 60_000,
  sftpOpMs: 30_000,
  controlMs: 30_000,
  transferStallMs: 60_000,
  reattachGraceMs: 30_000,
} as const

export const TUNNEL = {
  maxConnections: 256,
  socksHandshakeMs: 10_000,
} as const

export const TRANSFER = {
  parallel: 2,
  chunkBytes: 65_536,
  progressMs: 200,
} as const

export const FLOW = {
  coalesceMs: 12,
  highWaterBytes: 1_048_576,
  lowWaterBytes: 262_144,
  replayBytes: 524_288,
} as const

export const SIZE_LIMITS = {
  minCols: 2,
  maxCols: 1000,
  minRows: 1,
  maxRows: 500,
  defaultCols: 80,
  defaultRows: 24,
} as const

function fit(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

export function clampSize(cols: number, rows: number): { cols: number; rows: number } {
  return {
    cols: fit(cols, SIZE_LIMITS.minCols, SIZE_LIMITS.maxCols, SIZE_LIMITS.defaultCols),
    rows: fit(rows, SIZE_LIMITS.minRows, SIZE_LIMITS.maxRows, SIZE_LIMITS.defaultRows),
  }
}

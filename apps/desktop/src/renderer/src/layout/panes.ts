export type LayoutPreset = 'single' | 'columns' | 'rows' | 'grid'

export const PRESETS: readonly { preset: LayoutPreset; label: string }[] = [
  { preset: 'single', label: '1 panel' },
  { preset: 'columns', label: '2 columnas' },
  { preset: 'rows', label: '2 filas' },
  { preset: 'grid', label: '2×2' },
]

/** The preset after `preset`, for the split shortcut (2×2 wraps back to one pane). */
export function nextPreset(preset: LayoutPreset): LayoutPreset {
  const index = PRESETS.findIndex((p) => p.preset === preset)
  return PRESETS[(index + 1) % PRESETS.length]?.preset ?? 'single'
}

export const PANE_COUNT: Record<LayoutPreset, number> = { single: 1, columns: 2, rows: 2, grid: 4 }
export const SPLIT = { min: 0.2, max: 0.8, step: 0.05 } as const
export interface Split {
  x: number
  y: number
}
/** Drag payload of a title bar tab dropped on a pane. */
export const TAB_MIME = 'application/x-alma-tab'

const NAMES: Record<LayoutPreset, readonly string[]> = {
  single: ['principal'],
  columns: ['izquierda', 'derecha'],
  rows: ['arriba', 'abajo'],
  grid: [
    'arriba a la izquierda',
    'arriba a la derecha',
    'abajo a la izquierda',
    'abajo a la derecha',
  ],
}

export const clampSplit = (ratio: number) =>
  Math.round(Math.min(SPLIT.max, Math.max(SPLIT.min, ratio)) * 100) / 100

const splitsX = (p: LayoutPreset) => p === 'columns' || p === 'grid'
const splitsY = (p: LayoutPreset) => p === 'rows' || p === 'grid'

/** Panes sit in tracks 1 and 3; track 2 is the 4 px separator. */
export function gridTemplate(preset: LayoutPreset, split: Split) {
  const two = (r: number) => `minmax(0, ${r}fr) 4px minmax(0, ${Math.round((1 - r) * 100) / 100}fr)`
  const one = 'minmax(0, 1fr)'
  return {
    columns: splitsX(preset) ? two(split.x) : one,
    rows: splitsY(preset) ? two(split.y) : one,
  }
}

export function paneArea(preset: LayoutPreset, pane: number): string {
  const second = (yes: boolean) => (yes ? 3 : 1)
  if (preset === 'columns') return `1 / ${second(pane === 1)}`
  if (preset === 'rows') return `${second(pane === 1)} / 1`
  if (preset === 'grid') return `${second(pane >= 2)} / ${second(pane % 2 === 1)}`
  return '1 / 1'
}

export const paneName = (preset: LayoutPreset, pane: number) => NAMES[preset][pane] ?? ''

export const effectivePane = (home: number | undefined, preset: LayoutPreset) =>
  Math.min(home ?? 0, PANE_COUNT[preset] - 1)

export interface Arrangement {
  /** Pane each tab shows in under the current preset. */
  paneOf: Record<string, number>
  /** Tab in front of each pane, or null for an empty pane. */
  front: (string | null)[]
}

export function arrange(
  tabIds: readonly string[],
  home: Readonly<Record<string, number>>,
  recent: readonly string[],
  preset: LayoutPreset,
): Arrangement {
  const paneOf = Object.fromEntries(tabIds.map((id) => [id, effectivePane(home[id], preset)]))
  const front = Array.from({ length: PANE_COUNT[preset] }, (_, pane) => {
    const inPane = tabIds.filter((id) => paneOf[id] === pane)
    return recent.find((id) => inPane.includes(id)) ?? inPane[0] ?? null
  })
  return { paneOf, front }
}

/** Tabs hidden behind others fill the panes a bigger preset leaves empty, in tab order. */
export function spread(
  tabIds: readonly string[],
  home: Readonly<Record<string, number>>,
  recent: readonly string[],
  preset: LayoutPreset,
): Record<string, number> {
  const next = { ...home }
  const { front } = arrange(tabIds, next, recent, preset)
  const hidden = tabIds.filter((id) => !front.includes(id))
  front.forEach((id, pane) => {
    if (id !== null) return
    const moved = hidden.shift()
    if (moved !== undefined) next[moved] = pane
  })
  return next
}

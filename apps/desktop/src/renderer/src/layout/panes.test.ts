import { describe, expect, it } from 'vitest'
import {
  arrange,
  nextPreset,
  clampSplit,
  effectivePane,
  gridTemplate,
  paneArea,
  paneName,
  spread,
} from './panes'

describe('panes', () => {
  it('builds grid tracks with a 4 px separator track', () => {
    expect(gridTemplate('single', { x: 0.5, y: 0.5 })).toEqual({
      columns: 'minmax(0, 1fr)',
      rows: 'minmax(0, 1fr)',
    })
    expect(gridTemplate('grid', { x: 0.3, y: 0.6 })).toEqual({
      columns: 'minmax(0, 0.3fr) 4px minmax(0, 0.7fr)',
      rows: 'minmax(0, 0.6fr) 4px minmax(0, 0.4fr)',
    })
  })

  it('places panes in tracks 1 and 3', () => {
    expect(paneArea('columns', 1)).toBe('1 / 3')
    expect(paneArea('rows', 1)).toBe('3 / 1')
    expect([0, 1, 2, 3].map((i) => paneArea('grid', i))).toEqual([
      '1 / 1',
      '1 / 3',
      '3 / 1',
      '3 / 3',
    ])
  })

  it('names panes by position', () => {
    expect(paneName('columns', 0)).toBe('izquierda')
    expect(paneName('grid', 3)).toBe('abajo a la derecha')
  })

  it('clamps split ratios between 20 % and 80 %', () => {
    expect(clampSplit(0.05)).toBe(0.2)
    expect(clampSplit(0.95)).toBe(0.8)
  })

  it('shows a remembered pane in the last pane when the preset has fewer', () => {
    expect(effectivePane(3, 'columns')).toBe(1)
    expect(effectivePane(undefined, 'grid')).toBe(0)
  })

  it('fronts the most recently active tab of each pane', () => {
    const result = arrange(['a', 'b', 'c'], { a: 0, b: 0, c: 1 }, ['b', 'c', 'a'], 'columns')
    expect(result.front).toEqual(['b', 'c'])
    expect(result.paneOf).toEqual({ a: 0, b: 0, c: 1 })
  })

  it('an empty pane after its last tab closes', () => {
    expect(arrange(['a'], { a: 0, b: 1 }, ['a'], 'columns').front).toEqual(['a', null])
  })

  it('fills empty panes with hidden tabs, in tab order, when the preset grows', () => {
    const home = spread(['a', 'b', 'c', 'd'], { a: 0, b: 0, c: 0, d: 0 }, ['d'], 'grid')
    expect(arrange(['a', 'b', 'c', 'd'], home, ['d'], 'grid').front).toEqual(['d', 'a', 'b', 'c'])
  })

  it('keeps remembered panes when they are already visible', () => {
    expect(spread(['a', 'b'], { a: 0, b: 1 }, [], 'columns')).toEqual({ a: 0, b: 1 })
  })

  it('cycles presets for the split shortcut', () => {
    expect(nextPreset('single')).toBe('columns')
    expect(nextPreset('grid')).toBe('single')
  })
})

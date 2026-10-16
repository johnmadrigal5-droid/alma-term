import { describe, expect, it } from 'vitest'
import { arrange } from '../layout/panes'
import { createPanesStore } from './panes-store'
import { createSessionsStore } from './sessions-store'

function setup() {
  const sessions = createSessionsStore()
  const panes = createPanesStore(sessions)
  const add = (id: string) => sessions.getState().addTab({ sessionId: id, title: 'local' })
  const view = () => {
    const p = panes.getState()
    const ids = sessions.getState().tabs.map((t) => t.sessionId)
    return arrange(ids, p.home, p.recent, p.preset)
  }
  return { sessions, panes, add, view }
}

describe('panes store', () => {
  it('opens new tabs in the pane that had focus', () => {
    const { panes, add, view } = setup()
    add('a')
    add('b')
    panes.getState().setPreset('columns')
    expect(view().front).toEqual(['b', 'a'])
    panes.getState().focusPane(1)
    add('c')
    expect(view().paneOf['c']).toBe(1)
  })

  it('opens the next tab in an empty pane the user picked', () => {
    const { panes, add, view } = setup()
    add('a')
    panes.getState().setPreset('grid')
    panes.getState().focusPane(3)
    add('b')
    expect(view().front).toEqual(['a', null, null, 'b'])
  })

  it('moves a tab to another pane and activates it', () => {
    const { sessions, panes, add, view } = setup()
    add('a')
    add('b')
    panes.getState().setPreset('columns')
    // Spread put b in front of pane 0 and a in pane 1.
    panes.getState().moveTab('a', 0)
    expect(view().front).toEqual(['a', null])
    expect(sessions.getState().activeId).toBe('a')
  })

  it('ignores a move to a pane the preset does not have', () => {
    const { panes, add } = setup()
    add('a')
    panes.getState().moveTab('a', 3)
    expect(panes.getState().home['a']).toBe(0)
  })

  it('remembers each tab pane across presets', () => {
    const { panes, add, view } = setup()
    for (const id of ['a', 'b', 'c', 'd']) add(id)
    panes.getState().setPreset('grid')
    panes.getState().setPreset('single')
    panes.getState().setPreset('grid')
    expect(new Set(view().front)).toEqual(new Set(['a', 'b', 'c', 'd']))
  })

  it('forgets closed tabs', () => {
    const { sessions, panes, add } = setup()
    add('a')
    add('b')
    sessions.getState().removeTab('a')
    expect(Object.keys(panes.getState().home)).toEqual(['b'])
    expect(panes.getState().recent).toEqual(['b'])
  })

  it('clamps the split', () => {
    const { panes } = setup()
    panes.getState().setSplit('x', 0.99)
    expect(panes.getState().split).toEqual({ x: 0.8, y: 0.5 })
  })

  it('I2: closing the active tab keeps focus in its pane', () => {
    const { sessions, panes, add, view } = setup()
    for (const id of ['a', 'b', 'c', 'd']) add(id)
    panes.getState().setPreset('grid')
    // d in pane 0, a b c in 1 2 3; put b next to c in pane 3 and focus c.
    panes.getState().moveTab('b', 3)
    panes.getState().moveTab('c', 3)
    sessions.getState().removeTab('c')
    expect(sessions.getState().activeId).toBe('b')
    expect(view().front[3]).toBe('b')
  })

  it('I1: a tab retried from an emptied pane reopens in that pane', () => {
    const { sessions, panes, add, view } = setup()
    for (const id of ['a', 'b', 'c', 'd']) add(id)
    panes.getState().setPreset('grid')
    sessions.getState().setActive('c')
    const pane = view().paneOf['c']
    sessions.getState().removeTab('c')
    add('c2')
    expect(view().paneOf['c2']).toBe(pane)
  })

  it('keeps the neighbour rule in one pane', () => {
    const { sessions, add } = setup()
    for (const id of ['a', 'b', 'c']) add(id)
    // Most recent is a, the neighbour is c: within one pane the neighbour wins, as in browsers.
    sessions.getState().setActive('a')
    sessions.getState().setActive('b')
    sessions.getState().removeTab('b')
    expect(sessions.getState().activeId).toBe('c')
  })

  it('M5: forgets the picked empty pane when opening the terminal there fails', () => {
    const { sessions, panes, add, view } = setup()
    add('a')
    panes.getState().setPreset('grid')
    panes.getState().focusPane(3)
    expect(panes.getState().target).toBe(3)
    sessions.getState().setOpenError('no se pudo abrir la shell')
    expect(panes.getState().target).toBeNull()
    add('b')
    expect(view().paneOf['b']).toBe(view().paneOf['a'])
  })

  it('M5: forgets the picked empty pane once the user goes to another tab', () => {
    const { sessions, panes, add } = setup()
    add('a')
    add('b')
    panes.getState().setPreset('grid')
    panes.getState().focusPane(3)
    sessions.getState().setActive('a')
    expect(panes.getState().target).toBeNull()
  })

  it('M5: keeps the picked pane while the user only changes the active tab by closing', () => {
    const { sessions, panes, add } = setup()
    add('a')
    add('b')
    // Columns: b stays in front on the left, a is spread to the right one.
    panes.getState().setPreset('columns')
    sessions.getState().removeTab('b')
    expect(panes.getState().target).toBe(0)
  })
})

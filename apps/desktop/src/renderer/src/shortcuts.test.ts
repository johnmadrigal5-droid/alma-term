import { describe, expect, it } from 'vitest'
import { matchShortcut, passesToTerminal, type KeyLike } from './shortcuts'

const key = (
  k: string,
  mods: Partial<{ ctrl: boolean; shift: boolean; alt: boolean; meta: boolean }> = {},
) => ({
  key: k,
  type: 'keydown',
  ctrlKey: mods.ctrl ?? false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
  metaKey: mods.meta ?? false,
})

describe('matchShortcut', () => {
  it('maps Ctrl+Shift+T to a new local terminal on linux', () => {
    expect(matchShortcut(key('T', { ctrl: true, shift: true }), 'linux')).toEqual({
      type: 'newLocal',
    })
  })
  it('uses Cmd on macOS', () => {
    expect(matchShortcut(key('t', { meta: true, shift: true }), 'darwin')).toEqual({
      type: 'newLocal',
    })
    expect(matchShortcut(key('t', { ctrl: true, shift: true }), 'darwin')).toBeNull()
  })
  it('maps Ctrl+Tab and Ctrl+Shift+Tab', () => {
    expect(matchShortcut(key('Tab', { ctrl: true }), 'linux')).toEqual({ type: 'nextTab' })
    expect(matchShortcut(key('Tab', { ctrl: true, shift: true }), 'linux')).toEqual({
      type: 'prevTab',
    })
  })
  it('maps Ctrl+1..9 to tab indexes', () => {
    expect(matchShortcut(key('3', { ctrl: true }), 'linux')).toEqual({
      type: 'selectTab',
      index: 2,
    })
  })
  it('lets plain typing and keyup events through', () => {
    expect(matchShortcut(key('t'), 'linux')).toBeNull()
    expect(
      matchShortcut({ ...key('T', { ctrl: true, shift: true }), type: 'keyup' }, 'linux'),
    ).toBeNull()
    expect(matchShortcut(key('c', { ctrl: true }), 'linux')).toBeNull()
  })

  it('opens the palette with Ctrl+K outside the terminal on Linux', () => {
    expect(matchShortcut(key('k', { ctrl: true }), 'linux', { inTerminal: false })).toEqual({
      type: 'palette',
    })
  })
  it('leaves Ctrl+K to the shell inside the terminal on Linux and Windows', () => {
    expect(matchShortcut(key('k', { ctrl: true }), 'linux', { inTerminal: true })).toBeNull()
    expect(matchShortcut(key('k', { ctrl: true }), 'win32', { inTerminal: true })).toBeNull()
  })
  it('opens the palette with Ctrl+Shift+K anywhere', () => {
    expect(
      matchShortcut(key('K', { ctrl: true, shift: true }), 'linux', { inTerminal: true }),
    ).toEqual({ type: 'palette' })
  })
  it('opens the palette with Cmd+K on macOS even inside the terminal', () => {
    expect(matchShortcut(key('k', { meta: true }), 'darwin', { inTerminal: true })).toEqual({
      type: 'palette',
    })
  })
})

describe('sftp panel shortcut', () => {
  it('toggles the panel with Ctrl+Shift+F inside and outside the terminal', () => {
    for (const inTerminal of [true, false])
      expect(matchShortcut(key('F', { ctrl: true, shift: true }), 'linux', { inTerminal })).toEqual(
        {
          type: 'toggleSftp',
        },
      )
    expect(matchShortcut(key('f', { meta: true, shift: true }), 'darwin')).toEqual({
      type: 'toggleSftp',
    })
    expect(matchShortcut(key('f', { ctrl: true }), 'linux')).toBeNull()
  })
})

describe('passesToTerminal', () => {
  it('lets Ctrl+K reach the shell on Linux and Windows', () => {
    expect(passesToTerminal(key('k', { ctrl: true }), 'linux')).toBe(true)
    expect(passesToTerminal(key('k', { ctrl: true }), 'win32')).toBe(true)
  })
  it('keeps app shortcuts away from the shell', () => {
    expect(passesToTerminal(key('K', { ctrl: true, shift: true }), 'linux')).toBe(false)
    expect(passesToTerminal(key('Tab', { ctrl: true }), 'linux')).toBe(false)
    expect(passesToTerminal(key('k', { meta: true }), 'darwin')).toBe(false)
  })
})

describe('multiexec shortcut', () => {
  it('app shortcuts never reach the broadcast', () => {
    const key = (k: string, over: Partial<KeyLike> = {}): KeyLike => ({
      key: k,
      type: 'keydown',
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
      ...over,
    })
    expect(passesToTerminal(key('m'), 'linux')).toBe(false)
    expect(passesToTerminal(key('Tab', { shiftKey: false }), 'linux')).toBe(false)
    expect(passesToTerminal(key('k'), 'linux')).toBe(false)
  })

  it('Ctrl+Shift+M opens MultiExec, also from the terminal', () => {
    const e = {
      key: 'M',
      type: 'keydown',
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    }
    expect(matchShortcut(e, 'linux', { inTerminal: true })).toEqual({ type: 'multiExec' })
    expect(matchShortcut({ ...e, ctrlKey: false, metaKey: true }, 'darwin')).toEqual({
      type: 'multiExec',
    })
  })
})

describe('split shortcut', () => {
  it('Ctrl+Shift+D splits the work area, also from the terminal', () => {
    const e = {
      key: 'D',
      type: 'keydown',
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    }
    expect(matchShortcut(e, 'linux', { inTerminal: true })).toEqual({ type: 'splitPanes' })
    expect(passesToTerminal(e, 'linux')).toBe(false)
  })
})

describe('close tab shortcut', () => {
  it('Ctrl+Shift+W closes the active tab, also from the terminal where Ctrl+W is readline', () => {
    const e = {
      key: 'W',
      type: 'keydown',
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    }
    expect(matchShortcut(e, 'linux', { inTerminal: true })).toEqual({ type: 'closeTab' })
    expect(passesToTerminal(e, 'linux')).toBe(false)
    expect(matchShortcut({ ...e, shiftKey: false }, 'linux', { inTerminal: true })).toBeNull()
  })
})

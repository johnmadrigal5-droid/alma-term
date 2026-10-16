import { describe, expect, it } from 'vitest'
import { buildPtyEnv, defaultShell } from './defaults'

describe('defaultShell', () => {
  it('uses $SHELL as a login shell on unix', () => {
    expect(defaultShell('linux', { SHELL: '/usr/bin/zsh' })).toEqual({
      shell: '/usr/bin/zsh',
      args: ['-l'],
    })
  })
  it('falls back to /bin/bash without $SHELL', () => {
    expect(defaultShell('darwin', {})).toEqual({ shell: '/bin/bash', args: ['-l'] })
  })
  it('uses PowerShell on Windows', () => {
    expect(defaultShell('win32', {})).toEqual({ shell: 'powershell.exe', args: ['-NoLogo'] })
  })
})

describe('buildPtyEnv', () => {
  it('drops undefined values and electron-only variables, sets TERM', () => {
    const env = buildPtyEnv({ PATH: '/bin', EMPTY: undefined, ELECTRON_RUN_AS_NODE: '1' })
    expect(env).toEqual({ PATH: '/bin', TERM: 'xterm-256color', COLORTERM: 'truecolor' })
  })
})

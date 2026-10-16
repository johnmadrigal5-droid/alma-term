// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { askOverwrite, useUi } from './ui-store'

describe('ui store', () => {
  it('toggles the sftp panel and clamps its width', () => {
    expect(useUi.getState().sftpVisible).toBe(true)
    useUi.getState().toggleSftp()
    expect(useUi.getState().sftpVisible).toBe(false)
    useUi.getState().setSideWidth(9999)
    expect(useUi.getState().sideWidth).toBe(560)
  })

  it('resolves an overwrite question with the user answer and closes it', async () => {
    const answer = askOverwrite('a.txt', true)
    expect(useUi.getState().overwritePrompt).toMatchObject({ name: 'a.txt', many: true })
    useUi.getState().answerOverwrite({ replace: true, all: false })
    await expect(answer).resolves.toEqual({ replace: true, all: false })
    expect(useUi.getState().overwritePrompt).toBeNull()
  })

  it('opens and closes the new-tunnel form, optionally refilled', () => {
    useUi.getState().setTunnelDialog({ initial: { bindPort: '8080' } })
    expect(useUi.getState().tunnelDialog).toEqual({ initial: { bindPort: '8080' } })
    useUi.getState().setTunnelDialog(null)
    expect(useUi.getState().tunnelDialog).toBeNull()
  })

  it('switches to the tunnels section', () => {
    useUi.getState().setSidebarSection('tunnels')
    expect(useUi.getState().sidebarSection).toBe('tunnels')
    useUi.getState().setSidebarSection('sessions')
  })

  it('I4: holds the tab whose close waits for confirmation', () => {
    const warning = { title: 'Cerrar la pestaña', description: 'x' }
    useUi.getState().setCloseConfirm({ sessionId: 's1', warning })
    expect(useUi.getState().closeConfirm).toEqual({ sessionId: 's1', warning })
    useUi.getState().setCloseConfirm(null)
    expect(useUi.getState().closeConfirm).toBeNull()
  })
})

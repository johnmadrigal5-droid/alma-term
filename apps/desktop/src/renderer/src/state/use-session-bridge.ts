import { useEffect } from 'react'
import { useSftp } from '../sftp/sftp-store'
import { useTransfers } from '../transfers/use-transfers'
import { useTunnels } from '../tunnels/use-tunnels'
import { useSessions } from './sessions-store'

// Reattaches sessions that survived a renderer reload and mirrors host events.
export function useSessionBridge(): void {
  useEffect(() => {
    let cancelled = false
    void window.api.session.reattachAll().then((result) => {
      if (cancelled || !result.ok) return
      for (const live of result.data)
        useSessions
          .getState()
          .addTab({ sessionId: live.sessionId, title: live.title, kind: live.kind })
    })
    const store = () => useSessions.getState()
    const offs = [
      window.api.onStatus((event) => {
        if (event.state === 'closed') store().setStatus(event.sessionId, 'closed', event.exitCode)
        // The connection dropped: keep the tab and its content, offer to reconnect.
        if (event.state === 'lost') store().markLost([event.sessionId], 'connection')
      }),
      window.api.onHostLost(({ sessionIds }) => {
        store().markLost(sessionIds, 'host')
        // The tunnels lived in the host that died.
        useTunnels.getState().closeSessions(sessionIds)
      }),
      window.api.onStep(({ sessionId, step }) => store().setStep(sessionId, step)),
      window.api.onPrompt(({ sessionId, promptId, prompt }) =>
        store().addPrompt({ sessionId, promptId, prompt }),
      ),
      window.api.onPromptClosed(({ promptId }) => store().removePrompt(promptId)),
      window.api.onTransfer((event) => useTransfers.getState().apply(event)),
      window.api.onSftpMode((event) => useSftp.getState().setMode(event.sessionId, event.mode)),
      window.api.onTunnel((event) => useTunnels.getState().apply(event)),
    ]
    return () => {
      cancelled = true
      for (const off of offs) off()
    }
  }, [])
}

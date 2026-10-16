import { useEffect } from 'react'
import { useUi } from '../state/ui-store'
import { SftpPanel } from './SftpPanel'
import type { SftpActions } from './sftp-actions'
import { useSftp } from './sftp-store'

interface Props {
  sessionId: string
  actions: SftpActions
}

/** Binds the panel of one SSH session to the store; opens the home folder the first time. */
export function SftpSide({ sessionId, actions }: Props) {
  const panel = useSftp((s) => s.panels[sessionId])
  useEffect(() => {
    void actions.open(sessionId)
  }, [actions, sessionId])
  return (
    <SftpPanel
      panel={panel}
      onRetry={() => void actions.retry(sessionId)}
      onCd={(name) => void actions.cd(sessionId, name)}
      onUp={() => void actions.up(sessionId)}
      onGoto={(path) => void actions.goto(sessionId, path)}
      onRefresh={() => void actions.refresh(sessionId)}
      onMkdir={(name) => actions.mkdir(sessionId, name)}
      onRename={(entry, name) => void actions.rename(sessionId, entry, name)}
      onRemove={(entry) => void actions.remove(sessionId, entry)}
      onChmod={(entry, mode) => void actions.chmod(sessionId, entry, mode)}
      onDownload={(entries) => void actions.download(sessionId, entries)}
      onPickUpload={() => void actions.pickAndUpload(sessionId)}
      onUploadPaths={(paths) => void actions.upload(sessionId, paths)}
      onHide={() => useUi.getState().toggleSftp()}
      getPathForFile={(file) => window.api.getPathForFile(file)}
    />
  )
}

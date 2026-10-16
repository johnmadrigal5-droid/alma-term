import { useMemo } from 'react'
import { Sidebar } from '../layout/Sidebar'
import type { SavedActions } from '../state/saved-actions'
import { useSaved } from '../state/saved-store'
import { useSessions, type TabStatus } from '../state/sessions-store'
import { openImport, useUi } from '../state/ui-store'
import { TransfersPanel } from '../transfers/TransfersPanel'
import { TunnelsPanel } from '../tunnels/TunnelsPanel'
import type { TunnelActions } from '../tunnels/tunnels-actions'
import { isActiveTunnel } from '../tunnels/tunnels-store'
import { useTunnels } from '../tunnels/use-tunnels'
import { isActive } from '../transfers/transfers-store'
import { useTransfers } from '../transfers/use-transfers'
import { FolderNameDialog } from './FolderNameDialog'
import { ImportDialog } from './ImportDialog'
import type { TreeAction } from './SessionTree'
import { buildRows, type TreeRow } from './tree-model'

interface Props {
  saved: SavedActions
  tunnelActions: TunnelActions
  onOpenLocal(): void
}

// Owns the sidebar's dialogs (folder name, import) and maps tree actions to saved actions.
export function SessionsSidebar({ saved, tunnelActions, onOpenLocal }: Props) {
  const { status, tree, error, query, expanded, setQuery, toggle } = useSaved()
  const tabs = useSessions((s) => s.tabs)
  const openConnectDialog = useSessions((s) => s.openConnectDialog)
  const { folderDialog, setFolderDialog, importPreview, setImportPreview } = useUi()
  const section = useUi((s) => s.sidebarSection)
  const transferItems = useTransfers((s) => s.items)
  const transferViews = useMemo(() => Object.values(transferItems).reverse(), [transferItems])
  const transfers = useTransfers.getState()
  const tunnelItems = useTunnels((s) => s.items)
  const savedTunnels = useTunnels((s) => s.saved)
  const tunnelViews = useMemo(() => Object.values(tunnelItems).reverse(), [tunnelItems])
  // Saved tunnels of the open sessions that have no running row.
  const savedIdle = useMemo(
    () =>
      tabs.flatMap((tab) => {
        const savedId = tab.request?.savedId
        if (tab.kind !== 'ssh' || tab.status !== 'ready' || !savedId) return []
        return (savedTunnels[savedId] ?? [])
          .filter(
            (t) =>
              !tunnelViews.some(
                (v) =>
                  v.sessionId === tab.sessionId && v.savedTunnelId === t.id && v.state !== 'closed',
              ),
          )
          .map((tunnel) => ({ tunnel, sessionId: tab.sessionId, title: tab.title }))
      }),
    [tabs, savedTunnels, tunnelViews],
  )

  const live = useMemo(() => {
    const map = new Map<string, TabStatus>()
    for (const t of tabs) if (t.request?.savedId) map.set(t.request.savedId, t.status)
    return map
  }, [tabs])
  const rows = useMemo(
    () => (tree ? buildRows(tree, expanded, query, live) : []),
    [tree, expanded, query, live],
  )
  const findSession = (id: string) => tree?.sessions.find((s) => s.id === id)

  const onAction = (action: TreeAction, row: TreeRow) => {
    const session = row.kind === 'session' ? findSession(row.id) : undefined
    switch (action) {
      case 'edit':
        if (session) openConnectDialog({ saved: session })
        return
      case 'duplicate':
        if (session) void saved.duplicate(session)
        return
      case 'remove':
        void (row.kind === 'folder' ? saved.removeFolder(row.id) : saved.remove(row.id))
        return
      case 'newSessionHere':
        openConnectDialog({ folderId: row.id })
        return
      case 'newFolderHere':
        setFolderDialog({ mode: 'create', parentId: row.id })
        return
      case 'rename':
        setFolderDialog({ mode: 'rename', row })
        return
    }
  }

  return (
    <>
      <Sidebar
        status={status}
        error={error}
        rows={rows}
        empty={(tree?.sessions.length ?? 0) === 0 && (tree?.folders.length ?? 0) === 0}
        query={query}
        onQuery={setQuery}
        onRetry={() => void saved.reload()}
        onNewSsh={() => openConnectDialog()}
        onNewFolder={() => setFolderDialog({ mode: 'create', parentId: null })}
        onImport={() => void openImport(window.api.saved)}
        onOpenLocal={onOpenLocal}
        onConnect={(id) => {
          const session = findSession(id)
          if (session) void saved.connect(session)
        }}
        onToggle={toggle}
        onAction={onAction}
        section={section}
        activeTransfers={transferViews.filter(isActive).length}
        activeTunnels={tunnelViews.filter(isActiveTunnel).length}
        onSection={(next) => useUi.getState().setSidebarSection(next)}
        tunnels={
          <TunnelsPanel
            views={tunnelViews}
            sessionTitle={(id) => tabs.find((t) => t.sessionId === id)?.title ?? 'Sesión cerrada'}
            onNew={() => useUi.getState().setTunnelDialog({ initial: null })}
            onClose={(id) => void tunnelActions.close(id)}
            onRetry={(view) => {
              useTunnels.getState().remove(view.tunnelId)
              useUi.getState().setTunnelDialog({
                initial: {
                  sessionId: view.sessionId,
                  type: view.spec.type,
                  bindHost: view.spec.bindHost,
                  bindPort: String(view.spec.bindPort),
                  ...(view.spec.targetHost !== undefined && view.spec.targetPort !== undefined
                    ? { targetHost: view.spec.targetHost, targetPort: String(view.spec.targetPort) }
                    : {}),
                },
              })
            }}
            onClearClosed={() => useTunnels.getState().clearClosed()}
            onForget={(id) => void tunnelActions.forget(id)}
            savedIdle={savedIdle}
            onOpenSaved={(sessionId, tunnel) => void tunnelActions.openSaved(sessionId, tunnel)}
            onForgetSaved={(tunnel) => void tunnelActions.forgetSaved(tunnel)}
          />
        }
        transfers={
          <TransfersPanel
            views={transferViews}
            onPause={(id) => void transfers.pause(id)}
            onResume={(id) => void transfers.resume(id)}
            onCancel={(id) => void transfers.cancel(id)}
            onRetry={(id) => void transfers.retry(id)}
            onClearDone={transfers.clearDone}
          />
        }
      />
      {folderDialog && (
        <FolderNameDialog
          title={folderDialog.mode === 'create' ? 'Nueva carpeta' : 'Renombrar carpeta'}
          initial={folderDialog.mode === 'rename' ? folderDialog.row.name : ''}
          onCancel={() => setFolderDialog(null)}
          onSubmit={(name) => {
            const dialog = folderDialog
            setFolderDialog(null)
            if (dialog.mode === 'rename') void saved.renameFolder(dialog.row.id, name)
            else
              void saved.createFolder(name, dialog.parentId).then(() => {
                if (dialog.parentId) useSaved.getState().expand(dialog.parentId)
              })
          }}
        />
      )}
      {importPreview !== undefined && (
        <ImportDialog
          preview={importPreview}
          onCancel={() => setImportPreview(undefined)}
          onImport={(aliases) =>
            void (async () => {
              setImportPreview(undefined)
              const result = await window.api.saved.applyImport({ aliases })
              await saved.reload()
              const folder = useSaved
                .getState()
                .tree?.folders.find((f) => f.name === 'Importadas de ~/.ssh/config')
              if (result.ok && folder) useSaved.getState().expand(folder.id)
            })()
          }
        />
      )}
    </>
  )
}

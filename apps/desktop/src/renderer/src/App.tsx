import { useCallback, useEffect, useMemo, useState } from 'react'
import { StatusBar } from './layout/StatusBar'
import { TitleBar } from './layout/TitleBar'
import { arrange } from './layout/panes'
import { sendCommand, startBroadcast } from './multiexec/broadcaster'
import { useMultiExec } from './multiexec/multiexec-store'
import { MultiExecBar } from './multiexec/MultiExecBar'
import { Workspace } from './layout/Workspace'
import { AuthPromptDialog } from './ssh/AuthPromptDialog'
import { ConnectDialog } from './ssh/ConnectDialog'
import { HostKeyDialog } from './ssh/HostKeyDialog'
import { ConfirmDialog } from './sessions/ConfirmDialog'
import { createRequestClose } from './sessions/request-close'
import { SessionsSidebar } from './sessions/SessionsSidebar'
import { createSavedActions } from './state/saved-actions'
import { useSaved } from './state/saved-store'
import { usePanes } from './state/panes-store'
import { createSessionActions } from './state/session-actions'
import { useSessions } from './state/sessions-store'
import { useSessionBridge } from './state/use-session-bridge'
import { portRegistry } from './terminal/port-registry-instance'
import { terminals } from './terminal/terminal-registry'
import { TerminalView } from './terminal/TerminalView'
import { CommandPalette } from './palette/CommandPalette'
import { paletteItems, type PaletteCommand } from './palette/palette-items'
import { ConfirmOverwrite } from './sftp/ConfirmOverwrite'
import { createSftpActions } from './sftp/sftp-actions'
import { useSftp } from './sftp/sftp-store'
import { SftpSide } from './sftp/SftpSide'
import { askOverwrite, openImport, useUi } from './state/ui-store'
import { isActive } from './transfers/transfers-store'
import { autoOpen } from './tunnels/auto-open'
import { TunnelDialog } from './tunnels/TunnelDialog'
import { createTunnelActions } from './tunnels/tunnels-actions'
import { isActiveTunnel } from './tunnels/tunnels-store'
import { useTunnels } from './tunnels/use-tunnels'
import { useTransfers } from './transfers/use-transfers'
import { useTheme } from './theme/use-theme'
import { useGlobalShortcuts } from './use-global-shortcuts'

const NO_RECEIVERS: ReadonlySet<string> = new Set()

export function App() {
  const tabs = useSessions((s) => s.tabs)
  const activeId = useSessions((s) => s.activeId)
  const openError = useSessions((s) => s.openError)
  const setActive = useSessions((s) => s.setActive)
  const setStatus = useSessions((s) => s.setStatus)
  const prompt = useSessions((s) => s.prompts[0])
  const connectDialog = useSessions((s) => s.connectDialog)
  const closeConnectDialog = useSessions((s) => s.closeConnectDialog)
  const actions = useMemo(
    () =>
      createSessionActions(window.api.session, useSessions, undefined, (id) =>
        portRegistry.drop(id),
      ),
    [],
  )
  const savedActions = useMemo(
    () => createSavedActions(window.api.saved, useSaved, actions),
    [actions],
  )
  const sftpActions = useMemo(
    () =>
      createSftpActions({
        api: window.api,
        store: useSftp,
        platform: window.api.platform,
        askOverwrite,
        dismissTransfer: (id) => useTransfers.getState().dismiss(id),
        onStarted: (args) => useTransfers.getState().remember(args),
        onStartFailed: (args, name, error) => useTransfers.getState().reject(args, name, error),
      }),
    [],
  )
  const tunnelActions = useMemo(
    () => createTunnelActions({ api: window.api.tunnels, store: useTunnels }),
    [],
  )
  const tunnelDialog = useUi((s) => s.tunnelDialog)
  // Saved tunnels marked "abrir al conectar" start with their session, once per connection.
  useEffect(() => {
    for (const tab of tabs) {
      const savedId = tab.request?.savedId
      if (tab.kind !== 'ssh' || tab.status !== 'ready' || !savedId) continue
      void autoOpen(
        {
          api: window.api.tunnels.saved,
          onListed: (id, list) => useTunnels.getState().setSaved(id, list),
          open: (sessionId, spec, savedTunnelId) =>
            tunnelActions.open(sessionId, spec, { savedTunnelId }),
        },
        tab.sessionId,
        savedId,
        tab.generation,
      )
    }
  }, [tabs, tunnelActions])
  const theme = useTheme((s) => s.theme)
  const sftpVisible = useUi((s) => s.sftpVisible)
  const sideWidth = useUi((s) => s.sideWidth)
  const overwritePrompt = useUi((s) => s.overwritePrompt)
  const tree = useSaved((s) => s.tree)
  const [saveError, setSaveError] = useState<string | null>(null)
  const platform = window.api.platform
  const preset = usePanes((s) => s.preset)
  const split = usePanes((s) => s.split)
  const home = usePanes((s) => s.home)
  const recent = usePanes((s) => s.recent)
  const arrangement = useMemo(
    () =>
      arrange(
        tabs.map((t) => t.sessionId),
        home,
        recent,
        preset,
      ),
    [tabs, home, recent, preset],
  )
  const multiExec = useMultiExec()
  const ready = useMemo(
    () => new Set(tabs.filter((t) => t.status === 'ready').map((t) => t.sessionId)),
    [tabs],
  )
  // The active session types for itself; only the other targets show the ring.
  const receivers = useMemo(
    () =>
      multiExec.broadcast
        ? new Set(multiExec.targets.filter((id) => id !== activeId && ready.has(id)))
        : NO_RECEIVERS,
    [multiExec.broadcast, multiExec.targets, activeId, ready],
  )
  useEffect(
    () =>
      startBroadcast(terminals, () => {
        const m = useMultiExec.getState()
        const s = useSessions.getState()
        return {
          broadcast: m.open && m.broadcast,
          targets: m.targets,
          activeId: s.activeId,
          ready: new Set(s.tabs.filter((t) => t.status === 'ready').map((t) => t.sessionId)),
        }
      }),
    [],
  )
  // Targets of closed tabs are forgotten.
  useEffect(() => {
    useMultiExec.getState().prune(new Set(tabs.map((t) => t.sessionId)))
  }, [tabs])

  useEffect(() => {
    void savedActions.reload()
  }, [savedActions])

  useSessionBridge()
  useEffect(
    () => window.api.onTransfer((event) => void sftpActions.onTransfer(event)),
    [sftpActions],
  )
  // Forget the browser state of tabs that are gone.
  useEffect(() => {
    const live = new Set(tabs.map((t) => t.sessionId))
    for (const id of Object.keys(useSftp.getState().panels))
      if (!live.has(id)) useSftp.getState().drop(id)
  }, [tabs])
  const paletteOpen = useUi((s) => s.paletteOpen)
  const setPaletteOpen = useUi((s) => s.setPaletteOpen)
  const openPalette = useCallback(() => setPaletteOpen(true), [setPaletteOpen])
  // Every way of closing a tab goes through here: one with a tunnel or a transfer running asks.
  const requestClose = useMemo(
    () =>
      createRequestClose({
        counts: (sessionId) => ({
          tunnels: Object.values(useTunnels.getState().items).filter(
            (v) => v.sessionId === sessionId && isActiveTunnel(v),
          ).length,
          transfers: Object.values(useTransfers.getState().items).filter(
            (v) => v.sessionId === sessionId && isActive(v),
          ).length,
        }),
        close: (sessionId) => void actions.closeTab(sessionId),
        confirm: (sessionId, warning) => useUi.getState().setCloseConfirm({ sessionId, warning }),
      }),
    [actions],
  )
  const closeConfirm = useUi((s) => s.closeConfirm)
  const closeActiveTab = useCallback(() => {
    const id = useSessions.getState().activeId
    if (id) requestClose(id)
  }, [requestClose])
  useGlobalShortcuts(actions.openLocal, openPalette, closeActiveTab)

  const runCommand = (command: PaletteCommand) => {
    switch (command.type) {
      case 'connect': {
        const session = tree?.sessions.find((s) => s.id === command.savedId)
        if (session) void savedActions.connect(session)
        return
      }
      case 'tab':
        return setActive(command.sessionId)
      case 'newSsh':
        return useSessions.getState().openConnectDialog()
      case 'openLocal':
        return void actions.openLocal()
      case 'toggleTheme':
        return useTheme.getState().toggle()
      case 'newTunnel':
        return useUi.getState().setTunnelDialog({ initial: null })
      case 'import':
        return void openImport(window.api.saved)
      case 'newFolder':
        return useUi.getState().setFolderDialog({ mode: 'create', parentId: null })
      case 'export':
        return void window.api.saved.exportJson()
      case 'openLogDir':
        return void window.api.settings.openLogDir()
      case 'chooseLogDir':
        return void window.api.settings.chooseLogDir()
    }
  }

  const readyCount = tabs.filter((t) => t.status === 'ready').length
  const transferCount = useTransfers((s) => Object.values(s.items).filter(isActive).length)
  const tunnelCount = useTunnels((s) => s.activeCount())

  return (
    <div className="flex h-full flex-col bg-canvas text-text">
      <TitleBar
        tabs={tabs}
        activeId={activeId}
        platform={platform}
        onSelect={setActive}
        onClose={requestClose}
        onNew={() => void actions.openLocal()}
        onPalette={openPalette}
        preset={preset}
        onPreset={(p) => usePanes.getState().setPreset(p)}
        multiExecOpen={multiExec.open}
        onMultiExec={() => (multiExec.open ? multiExec.setOpen(false) : multiExec.focusField())}
        theme={theme}
        onToggleTheme={() => useTheme.getState().toggle()}
      />
      <div className="flex min-h-0 flex-1">
        <SessionsSidebar
          saved={savedActions}
          tunnelActions={tunnelActions}
          onOpenLocal={() => void actions.openLocal()}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Workspace
            tabs={tabs}
            activeId={activeId}
            openError={openError}
            platform={platform}
            onOpenLocal={() => void actions.openLocal()}
            onReopen={(id) => void actions.reopen(id)}
            onCloseTab={requestClose}
            onRetry={(id) => void actions.retry(id)}
            onEdit={(id) => actions.edit(id)}
            panes={{
              preset,
              split,
              ...arrangement,
              receivers,
              onSplit: (axis, ratio) => usePanes.getState().setSplit(axis, ratio),
              onMove: (id, pane) => usePanes.getState().moveTab(id, pane),
              onFocusPane: (pane) => usePanes.getState().focusPane(pane),
              onActivate: (id) => {
                if (useSessions.getState().activeId !== id) setActive(id)
              },
            }}
            side={{
              visible: sftpVisible,
              width: sideWidth,
              onSideWidth: (width) => useUi.getState().setSideWidth(width),
              renderSide: (tab) => (
                <SftpSide key={tab.sessionId} sessionId={tab.sessionId} actions={sftpActions} />
              ),
            }}
            renderTerminal={(tab, active) => (
              <TerminalView
                sessionId={tab.sessionId}
                generation={tab.generation}
                active={active}
                onExit={(code) => setStatus(tab.sessionId, 'closed', code)}
              />
            )}
          />
          {multiExec.open && (
            <MultiExecBar
              tabs={tabs}
              targets={multiExec.targets}
              broadcast={multiExec.broadcast}
              history={multiExec.history}
              focusRequest={multiExec.focusRequest}
              platform={platform}
              onToggleTarget={multiExec.toggleTarget}
              onSetTargets={multiExec.setTargets}
              onToggleBroadcast={multiExec.toggleBroadcast}
              onRun={(command) => {
                multiExec.remember(command)
                return sendCommand(terminals, command, multiExec.targets, ready)
              }}
              onClose={() => multiExec.setOpen(false)}
            />
          )}
        </div>
      </div>
      <StatusBar
        readyCount={readyCount}
        transferCount={transferCount}
        tunnelCount={tunnelCount}
        sftp={
          tabs.find((t) => t.sessionId === activeId)?.kind === 'ssh'
            ? { visible: sftpVisible, onToggle: () => useUi.getState().toggleSftp() }
            : undefined
        }
      />
      {connectDialog && (
        <ConnectDialog
          initial={connectDialog.initial}
          saved={
            connectDialog.saved ??
            tree?.sessions.find((s) => s.id === connectDialog.initial?.savedId) ??
            null
          }
          folders={tree?.folders ?? []}
          canRemember={tree?.canRemember ?? false}
          folderId={connectDialog.folderId}
          error={saveError}
          onSubmit={(request) => void actions.submitConnect(request)}
          onSave={(input, options) =>
            void (async () => {
              setSaveError(null)
              const replaceId = connectDialog.replaceId
              const result = await savedActions.save(input, options)
              if (!result.ok) return setSaveError(result.error.message)
              closeConnectDialog()
              if (replaceId) await actions.closeTab(replaceId)
            })()
          }
          onCancel={() => {
            setSaveError(null)
            closeConnectDialog()
          }}
          pickPrivateKey={() => window.api.pickPrivateKey()}
        />
      )}
      {prompt?.prompt.kind === 'hostkey' && (
        <HostKeyDialog
          key={prompt.promptId}
          prompt={prompt.prompt}
          onAnswer={(accept) =>
            void actions.answerPrompt(prompt.promptId, { type: 'hostkey', accept })
          }
        />
      )}
      {prompt?.prompt.kind === 'auth' && (
        <AuthPromptDialog
          key={prompt.promptId}
          prompt={prompt.prompt}
          onSubmit={(responses, remember) =>
            void actions.answerPrompt(prompt.promptId, { type: 'auth', responses, remember })
          }
          onCancel={() => void actions.answerPrompt(prompt.promptId, { type: 'cancel' })}
        />
      )}
      {closeConfirm && (
        <ConfirmDialog
          title={closeConfirm.warning.title}
          description={closeConfirm.warning.description}
          confirmLabel="Cerrar pestaña"
          onConfirm={() => {
            useUi.getState().setCloseConfirm(null)
            void actions.closeTab(closeConfirm.sessionId)
          }}
          onCancel={() => useUi.getState().setCloseConfirm(null)}
        />
      )}
      {tunnelDialog && (
        <TunnelDialog
          sessions={tabs
            .filter((t) => t.kind === 'ssh' && t.status === 'ready')
            .map((t) => ({
              sessionId: t.sessionId,
              title: t.title,
              savedId: t.request?.savedId ?? null,
            }))}
          {...(tunnelDialog.initial ? { initial: tunnelDialog.initial } : {})}
          onSubmit={(sessionId, spec, keep) =>
            tunnelActions.open(sessionId, spec, keep ? { keep } : {})
          }
          onClose={() => useUi.getState().setTunnelDialog(null)}
        />
      )}
      {overwritePrompt && (
        <ConfirmOverwrite
          key={overwritePrompt.name}
          name={overwritePrompt.name}
          many={overwritePrompt.many}
          onAnswer={(answer) => useUi.getState().answerOverwrite(answer)}
        />
      )}
      {paletteOpen && (
        <CommandPalette
          groups={paletteItems({ tree, tabs })}
          onRun={runCommand}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  )
}

import type { AlmaApi, ApiResult, LiveSession, PromptAnswer, SshAuth } from '@alma/protocol'
import { useSessions, type SessionsStore, type SshRequest } from './sessions-store'

const INITIAL_SIZE = { cols: 120, rows: 32 }

// Typed passwords are not kept (no credential store until milestone 3): a retry asks again.
function withoutSecrets(auth: SshAuth): SshAuth {
  return auth.type === 'password' ? { type: 'password' } : auth
}

export function createSessionActions(
  api: AlmaApi['session'],
  store: SessionsStore = useSessions,
  newSessionId: () => string = () => crypto.randomUUID(),
  dropPort: (sessionId: string) => void = () => {},
) {
  const findTab = (sessionId: string) =>
    store.getState().tabs.find((t) => t.sessionId === sessionId)

  async function openLocal(): Promise<void> {
    store.getState().setOpenError(null)
    const result = await api.openLocal(INITIAL_SIZE)
    if (result.ok)
      store.getState().addTab({ sessionId: result.data.sessionId, title: result.data.title })
    else store.getState().setOpenError(result.error.message)
  }

  async function settle(sessionId: string, result: ApiResult<LiveSession>): Promise<void> {
    // The tab may have been closed while connecting; the host already cancelled it.
    if (findTab(sessionId)?.status !== 'connecting') return
    if (result.ok) store.getState().setStatus(sessionId, 'ready')
    else store.getState().setError(sessionId, result.error)
  }

  async function openSsh(request: SshRequest, title?: string): Promise<void> {
    const sessionId = newSessionId()
    const { target, auth } = request
    store.getState().addSshTab({
      sessionId,
      title: title ?? `${target.username}@${target.host}`,
      request: { target, auth: withoutSecrets(auth), savedId: request.savedId ?? null },
    })
    await settle(sessionId, await api.openSsh({ sessionId, target, auth, ...INITIAL_SIZE }))
  }

  /** Opens a bookmark by id: main reads and decrypts its secrets, the renderer never sees them. */
  async function openSaved({ title, request }: { title: string; request: SshRequest }) {
    const savedId = request.savedId
    if (!savedId) return openSsh(request, title)
    const sessionId = newSessionId()
    store.getState().addSshTab({
      sessionId,
      title,
      request: { target: request.target, auth: withoutSecrets(request.auth), savedId },
    })
    await settle(sessionId, await api.openSaved({ sessionId, savedId, ...INITIAL_SIZE }))
  }

  async function closeTab(sessionId: string): Promise<void> {
    const tab = findTab(sessionId)
    store.getState().removeTab(sessionId)
    dropPort(sessionId)
    if (tab?.status === 'ready' || tab?.status === 'connecting') await api.close({ sessionId })
  }

  async function retry(sessionId: string): Promise<void> {
    const tab = findTab(sessionId)
    store.getState().removeTab(sessionId)
    dropPort(sessionId)
    if (!tab?.request) return
    if (tab.request.savedId) await openSaved({ title: tab.title, request: tab.request })
    else await openSsh(tab.request)
  }

  async function reopen(sessionId: string): Promise<void> {
    if (findTab(sessionId)?.kind === 'ssh') return retry(sessionId)
    store.getState().removeTab(sessionId)
    await openLocal()
  }

  function edit(sessionId: string): void {
    const request = findTab(sessionId)?.request ?? null
    store.getState().openConnectDialog({ initial: request, replaceId: sessionId })
  }

  async function submitConnect(request: SshRequest): Promise<void> {
    const replaceId = store.getState().connectDialog?.replaceId
    store.getState().closeConnectDialog()
    if (replaceId) await closeTab(replaceId)
    await openSsh(request)
  }

  async function answerPrompt(promptId: string, answer: PromptAnswer): Promise<void> {
    store.getState().removePrompt(promptId)
    await api.answerPrompt({ promptId, answer })
  }

  return {
    openLocal,
    openSsh,
    openSaved,
    closeTab,
    retry,
    reopen,
    edit,
    submitConnect,
    answerPrompt,
  }
}

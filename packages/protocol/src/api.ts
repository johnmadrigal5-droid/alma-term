import { z } from 'zod'
import type { ProtocolError } from './errors'
import type {
  PromptClosedEvent,
  PromptEvent,
  SftpModeEvent,
  StatusEvent,
  StepEvent,
} from './events'
import { SessionId } from './ids'
import type { Folder, SavedSession, SessionTree } from './saved'
import { SaveSessionInput } from './saved'
import type {
  LocalExistsArgs,
  RemoteEntry,
  SftpChmodArgs,
  SftpPathArgs,
  SftpRemoveArgs,
  SftpRenameArgs,
  SftpSessionArgs,
  TransferEvent,
  TransferIdArgs,
  TransferStartArgs,
} from './sftp'
import { PromptAnswer, SshAuth, SshTarget } from './ssh'
import type {
  SavedTunnel,
  SavedTunnelListArgs,
  SavedTunnelRemoveArgs,
  SavedTunnelRequest,
} from './saved-tunnel'
import type { ThemeName } from './settings'
import type { TunnelCloseArgs, TunnelEvent, TunnelOpenInput } from './tunnel'

export const OpenLocalArgs = z.object({ cols: z.number(), rows: z.number() })
export type OpenLocalArgs = z.infer<typeof OpenLocalArgs>

export const ResizeArgs = z.object({ sessionId: SessionId, cols: z.number(), rows: z.number() })
export type ResizeArgs = z.infer<typeof ResizeArgs>

export const CloseArgs = z.object({ sessionId: SessionId })
export type CloseArgs = z.infer<typeof CloseArgs>

export const LiveSession = z.object({
  sessionId: SessionId,
  kind: z.enum(['local', 'ssh']),
  title: z.string(),
  savedId: z.uuid().nullable().default(null),
})
export type LiveSession = z.infer<typeof LiveSession>

// The renderer picks the sessionId so steps and prompts that arrive while connecting
// can be routed to the tab before the open request resolves.
export const OpenSshArgs = z.object({
  sessionId: SessionId,
  target: SshTarget,
  auth: SshAuth,
  cols: z.number(),
  rows: z.number(),
})
export type OpenSshArgs = z.infer<typeof OpenSshArgs>

export const OpenSavedArgs = z.object({
  sessionId: SessionId,
  savedId: z.uuid(),
  cols: z.number(),
  rows: z.number(),
})
export type OpenSavedArgs = z.infer<typeof OpenSavedArgs>

export const IdArgs = z.object({ id: z.uuid() })
export type IdArgs = z.infer<typeof IdArgs>

export const CreateFolderArgs = z.object({
  name: z.string().trim().min(1).max(80),
  parentId: z.uuid().nullable(),
})
export type CreateFolderArgs = z.infer<typeof CreateFolderArgs>

export const RenameFolderArgs = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(80) })
export type RenameFolderArgs = z.infer<typeof RenameFolderArgs>

export const ApplyImportArgs = z.object({ aliases: z.array(z.string().min(1)).min(1) })
export type ApplyImportArgs = z.infer<typeof ApplyImportArgs>

export { SaveSessionInput }

export const ImportCandidate = z.object({
  alias: z.string(),
  target: SshTarget,
  keyPath: z.string().nullable(),
  warnings: z.array(z.string()),
  duplicate: z.boolean(),
})
export type ImportCandidate = z.infer<typeof ImportCandidate>

export const ImportPreview = z.object({
  file: z.string(),
  candidates: z.array(ImportCandidate),
  warnings: z.array(z.string()),
})
export type ImportPreview = z.infer<typeof ImportPreview>

export const AnswerPromptArgs = z.object({ promptId: z.uuid(), answer: PromptAnswer })
export type AnswerPromptArgs = z.infer<typeof AnswerPromptArgs>

export const HostLostPush = z.object({ sessionIds: z.array(SessionId) })
export type HostLostPush = z.infer<typeof HostLostPush>

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ProtocolError }

export interface AlmaApi {
  platform: string
  flags: { disableWebgl: boolean }
  session: {
    openLocal(args: OpenLocalArgs): Promise<ApiResult<LiveSession>>
    openSsh(args: OpenSshArgs): Promise<ApiResult<LiveSession>>
    answerPrompt(args: AnswerPromptArgs): Promise<ApiResult<null>>
    resize(args: ResizeArgs): Promise<ApiResult<null>>
    close(args: CloseArgs): Promise<ApiResult<null>>
    openSaved(args: OpenSavedArgs): Promise<ApiResult<LiveSession>>
    reattachAll(): Promise<ApiResult<LiveSession[]>>
  }
  saved: {
    tree(): Promise<ApiResult<SessionTree>>
    save(input: SaveSessionInput): Promise<ApiResult<SavedSession>>
    remove(args: IdArgs): Promise<ApiResult<null>>
    createFolder(args: CreateFolderArgs): Promise<ApiResult<Folder>>
    renameFolder(args: RenameFolderArgs): Promise<ApiResult<null>>
    removeFolder(args: IdArgs): Promise<ApiResult<null>>
    previewImport(): Promise<ApiResult<ImportPreview>>
    applyImport(args: ApplyImportArgs): Promise<ApiResult<{ created: number }>>
    exportJson(): Promise<ApiResult<{ file: string } | null>>
  }
  sftp: {
    home(args: SftpSessionArgs): Promise<ApiResult<string>>
    list(args: SftpPathArgs): Promise<ApiResult<RemoteEntry[]>>
    stat(args: SftpPathArgs): Promise<ApiResult<RemoteEntry | null>>
    mkdir(args: SftpPathArgs): Promise<ApiResult<null>>
    rename(args: SftpRenameArgs): Promise<ApiResult<null>>
    remove(args: SftpRemoveArgs): Promise<ApiResult<null>>
    chmod(args: SftpChmodArgs): Promise<ApiResult<null>>
  }
  transfers: {
    start(args: TransferStartArgs): Promise<ApiResult<{ transferId: string }>>
    pause(args: TransferIdArgs): Promise<ApiResult<null>>
    resume(args: TransferIdArgs): Promise<ApiResult<null>>
    cancel(args: TransferIdArgs): Promise<ApiResult<null>>
    /** Whether a local path exists, to ask before a download overwrites it. */
    localExists(args: LocalExistsArgs): Promise<ApiResult<boolean>>
  }
  onTransfer(listener: (event: TransferEvent) => void): () => void
  onSftpMode(listener: (event: SftpModeEvent) => void): () => void
  tunnels: {
    open(args: TunnelOpenInput): Promise<ApiResult<{ tunnelId: string }>>
    close(args: TunnelCloseArgs): Promise<ApiResult<null>>
    /** Tunnels kept with a saved session. */
    saved: {
      list(args: SavedTunnelListArgs): Promise<ApiResult<SavedTunnel[]>>
      save(args: SavedTunnelRequest): Promise<ApiResult<SavedTunnel>>
      remove(args: SavedTunnelRemoveArgs): Promise<ApiResult<null>>
    }
  }
  onTunnel(listener: (event: TunnelEvent) => void): () => void
  /** The theme the window was opened with (read synchronously: no flash on start). */
  initialTheme: ThemeName
  settings: {
    setTheme(theme: ThemeName): Promise<ApiResult<null>>
    /** Asks for the folder of the session logs; null when the dialog is cancelled. */
    chooseLogDir(): Promise<ApiResult<{ dir: string } | null>>
    openLogDir(): Promise<ApiResult<null>>
  }
  /** Native pickers; empty or null when cancelled. */
  pickUploadFiles(): Promise<string[]>
  pickDownloadFolder(): Promise<string | null>
  /** Absolute path of a file dropped from the OS (Electron webUtils); '' for non-files. */
  getPathForFile(file: File): string
  onStatus(listener: (event: StatusEvent) => void): () => void
  onHostLost(listener: (push: HostLostPush) => void): () => void
  onStep(listener: (event: StepEvent) => void): () => void
  onPrompt(listener: (event: PromptEvent) => void): () => void
  onPromptClosed(listener: (event: PromptClosedEvent) => void): () => void
  pickPrivateKey(): Promise<string | null>
}

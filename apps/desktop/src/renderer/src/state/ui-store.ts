import type { ImportPreview } from '@alma/protocol'
import { create } from 'zustand'
import { clampSideWidth, SIDE_WIDTH } from '../layout/side-layout'
import type { TreeRow } from '../sessions/tree-model'
import type { OverwriteAnswer } from '../sftp/sftp-actions'
import type { CloseWarning } from '../sessions/request-close'
import type { TunnelFormValues } from '../tunnels/TunnelDialog'

export type FolderDialog =
  { mode: 'create'; parentId: string | null } | { mode: 'rename'; row: TreeRow }

interface UiState {
  paletteOpen: boolean
  folderDialog: FolderDialog | null
  /** undefined: closed; null: reading ~/.ssh/config. */
  importPreview: ImportPreview | null | undefined
  sftpVisible: boolean
  sidebarSection: 'sessions' | 'tunnels' | 'transfers'
  setSidebarSection(section: 'sessions' | 'tunnels' | 'transfers'): void
  /** The new-tunnel form: null when closed; `initial` refills it after a failure. */
  tunnelDialog: { initial: TunnelFormValues | null } | null
  setTunnelDialog(dialog: { initial: TunnelFormValues | null } | null): void
  /** A tab whose close waits for the user (it has tunnels or transfers running). */
  closeConfirm: { sessionId: string; warning: CloseWarning } | null
  setCloseConfirm(confirm: { sessionId: string; warning: CloseWarning } | null): void
  sideWidth: number
  overwritePrompt: { name: string; many: boolean; resolve(answer: OverwriteAnswer): void } | null
  setPaletteOpen(open: boolean): void
  toggleSftp(): void
  setSideWidth(width: number): void
  answerOverwrite(answer: OverwriteAnswer): void
  setFolderDialog(dialog: FolderDialog | null): void
  setImportPreview(preview: ImportPreview | null | undefined): void
}

// Dialogs reachable from both the sidebar and the command palette.
export const useUi = create<UiState>()((set, get) => ({
  paletteOpen: false,
  folderDialog: null,
  importPreview: undefined,
  sftpVisible: true,
  sidebarSection: 'sessions',
  setSidebarSection: (sidebarSection) => set({ sidebarSection }),
  tunnelDialog: null,
  setTunnelDialog: (tunnelDialog) => set({ tunnelDialog }),
  closeConfirm: null,
  setCloseConfirm: (closeConfirm) => set({ closeConfirm }),
  sideWidth: SIDE_WIDTH.initial,
  overwritePrompt: null,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  toggleSftp: () => set({ sftpVisible: !get().sftpVisible }),
  setSideWidth: (width) => set({ sideWidth: clampSideWidth(width) }),
  answerOverwrite: (answer) => {
    get().overwritePrompt?.resolve(answer)
    set({ overwritePrompt: null })
  },
  setFolderDialog: (folderDialog) => set({ folderDialog }),
  setImportPreview: (importPreview) => set({ importPreview }),
}))

export async function openImport(api: Pick<Window['api']['saved'], 'previewImport'>) {
  useUi.getState().setImportPreview(null)
  const result = await api.previewImport()
  useUi
    .getState()
    .setImportPreview(
      result.ok
        ? result.data
        : { file: '~/.ssh/config', candidates: [], warnings: [result.error.message] },
    )
}

/** Shows the overwrite question and resolves with the answer (Omitir when dismissed). */
export function askOverwrite(name: string, many: boolean): Promise<OverwriteAnswer> {
  return new Promise((resolve) => useUi.setState({ overwritePrompt: { name, many, resolve } }))
}

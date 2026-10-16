import type { RemoteEntry } from '@alma/protocol'
import { FolderPlus, PanelRightClose, RefreshCw, Upload } from 'lucide-react'
import { useState, type DragEvent } from 'react'
import { Button } from '../components/ui/button'
import type { MenuItem } from '../components/ui/menu'
import { ConfirmDialog } from '../sessions/ConfirmDialog'
import { FileList, ROW_HEIGHT } from './FileList'
import { displayName } from './format'
import { NameDialog } from './NameDialog'
import { PermissionsDialog } from './PermissionsDialog'
import { crumbs } from './remote'
import type { PanelState } from './sftp-store'

export interface SftpPanelProps {
  panel: PanelState | undefined
  onRetry(): void
  onCd(name: string): void
  onUp(): void
  onGoto(path: string): void
  onRefresh(): void
  /** Resolves null on success, else the message to show in the dialog. */
  onMkdir(name: string): Promise<string | null>
  onRename(entry: RemoteEntry, name: string): void
  onRemove(entry: RemoteEntry): void
  onChmod(entry: RemoteEntry, mode: number): void
  onDownload(entries: RemoteEntry[]): void
  onPickUpload(): void
  onUploadPaths(paths: string[]): void
  onHide(): void
  getPathForFile(file: File): string
}

type Dialog =
  | { kind: 'mkdir' }
  | { kind: 'rename'; entry: RemoteEntry }
  | { kind: 'chmod'; entry: RemoteEntry }
  | { kind: 'remove'; entry: RemoteEntry }

const FOLDER_DROP = 'Las carpetas aún no se pueden transferir; arrastra los archivos'

function Skeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-2 p-2">
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          className="animate-pulse rounded bg-s2"
          style={{ height: ROW_HEIGHT - 8, width: `${90 - ((i * 13) % 40)}%` }}
        />
      ))}
    </div>
  )
}

/** Remote file browser of the active SSH tab, on the same connection as its terminal. */
export function SftpPanel(props: SftpPanelProps) {
  const { panel } = props
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const loading = !panel || panel.status === 'loading'

  const menuFor = (entry: RemoteEntry): MenuItem[] => [
    entry.kind === 'dir'
      ? { label: 'Abrir', onSelect: () => props.onCd(entry.name) }
      : { label: 'Descargar', onSelect: () => props.onDownload([entry]) },
    { label: 'Renombrar', onSelect: () => setDialog({ kind: 'rename', entry }) },
    { label: 'Permisos', onSelect: () => setDialog({ kind: 'chmod', entry }) },
    { label: 'Eliminar', danger: true, onSelect: () => setDialog({ kind: 'remove', entry }) },
  ]

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    if (panel?.status !== 'ready') return setNotice('Espera a que cargue la carpeta')
    const items = [...event.dataTransfer.items]
    const files = [...event.dataTransfer.files]
    const isFolder = (i: number) => items[i]?.webkitGetAsEntry()?.isDirectory === true
    const paths = files
      .filter((_, i) => !isFolder(i))
      .map((f) => props.getPathForFile(f))
      .filter((p) => p !== '')
    setNotice(files.some((_, i) => isFolder(i)) ? FOLDER_DROP : null)
    if (paths.length > 0) props.onUploadPaths(paths)
  }

  return (
    <section
      aria-label="Archivos remotos"
      aria-busy={loading}
      className={`@container flex h-full min-h-0 flex-col rounded-lg bg-s1 ${
        dragging ? 'ring-2 ring-inset ring-accent' : ''
      }`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        // Moving onto a child also fires dragleave on the section; only leaving it counts.
        if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return
        setDragging(false)
      }}
      onDrop={onDrop}
    >
      <header className="flex flex-col gap-1 p-2">
        <div className="flex items-center gap-1">
          <h2 className="m-0 flex-1 text-xs font-semibold uppercase tracking-wide text-muted">
            SFTP
          </h2>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Subir archivos"
            disabled={panel?.status !== 'ready'}
            onClick={props.onPickUpload}
          >
            <Upload size={16} aria-hidden />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Nueva carpeta"
            disabled={panel?.status !== 'ready'}
            onClick={() => setDialog({ kind: 'mkdir' })}
          >
            <FolderPlus size={16} aria-hidden />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Actualizar"
            disabled={loading}
            onClick={props.onRefresh}
          >
            <RefreshCw size={16} aria-hidden />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Ocultar panel" onClick={props.onHide}>
            <PanelRightClose size={16} aria-hidden />
          </Button>
        </div>
        {panel && (
          <nav aria-label="Ruta" className="flex min-w-0 flex-wrap items-center text-xs">
            {crumbs(panel.path).map((c, i) => (
              <span key={c.path} className="flex items-center">
                {i > 1 && <span className="px-1 text-faint">/</span>}
                <button
                  type="button"
                  className="min-h-6 min-w-6 max-w-40 cursor-pointer truncate rounded px-1 text-muted hover:bg-s2 hover:text-text"
                  aria-current={c.path === panel.path ? 'location' : undefined}
                  onClick={() => props.onGoto(c.path)}
                >
                  {c.name}
                </button>
              </span>
            ))}
          </nav>
        )}
      </header>

      {notice && (
        <p role="status" className="m-0 bg-s2 px-2 py-1 text-xs text-warn">
          {notice}
        </p>
      )}

      {panel?.mode === 'scp' && (
        <p role="status" className="m-0 bg-s2 px-2 py-1 text-xs text-warn">
          Modo SCP, funciones limitadas
        </p>
      )}

      {loading && <Skeleton />}
      {panel?.status === 'error' && (
        <div role="alert" className="flex flex-col items-start gap-2 p-4">
          <p className="m-0 text-sm text-err">{panel.error}</p>
          <Button size="sm" onClick={props.onRetry}>
            Reintentar
          </Button>
        </div>
      )}
      {panel?.status === 'ready' && panel.entries.length === 0 && (
        <p className="m-0 flex flex-1 items-center justify-center p-4 text-center text-sm text-muted">
          Carpeta vacía, arrastra archivos aquí
        </p>
      )}
      {panel?.status === 'ready' && panel.entries.length > 0 && (
        <FileList
          path={panel.path}
          entries={panel.entries}
          rowErrors={panel.rowErrors}
          onOpen={(entry) => entry.kind === 'dir' && props.onCd(entry.name)}
          onUp={props.onUp}
          menuFor={menuFor}
        />
      )}

      {dialog?.kind === 'mkdir' && (
        <NameDialog
          title="Nueva carpeta"
          submitLabel="Crear"
          onSubmit={async (name) => {
            const failure = await props.onMkdir(name)
            if (!failure) setDialog(null)
            return failure
          }}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'rename' && (
        <NameDialog
          title={`Renombrar «${displayName(dialog.entry.name)}»`}
          submitLabel="Renombrar"
          initial={dialog.entry.name}
          onSubmit={async (name) => {
            setDialog(null)
            if (name !== dialog.entry.name) props.onRename(dialog.entry, name)
            return null
          }}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'chmod' && (
        <PermissionsDialog
          name={dialog.entry.name}
          mode={dialog.entry.mode}
          onSubmit={(mode) => {
            setDialog(null)
            props.onChmod(dialog.entry, mode)
          }}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'remove' && (
        <ConfirmDialog
          title={`Eliminar «${displayName(dialog.entry.name)}»`}
          description={
            dialog.entry.kind === 'dir'
              ? 'Solo se pueden eliminar carpetas vacías. No se puede deshacer.'
              : 'Se eliminará del servidor. No se puede deshacer.'
          }
          confirmLabel="Eliminar"
          onConfirm={() => {
            setDialog(null)
            props.onRemove(dialog.entry)
          }}
          onCancel={() => setDialog(null)}
        />
      )}
    </section>
  )
}

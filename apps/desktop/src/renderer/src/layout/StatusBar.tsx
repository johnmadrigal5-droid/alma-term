export function StatusBar({
  readyCount,
  transferCount = 0,
  tunnelCount = 0,
  sftp,
}: {
  readyCount: number
  transferCount?: number
  tunnelCount?: number
  /** Shown for an SSH tab: the only visible way back once the panel is hidden. */
  sftp?: { visible: boolean; onToggle(): void }
}) {
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 px-4 text-xs text-faint">
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ok" />
        {readyCount === 1 ? '1 sesión activa' : `${readyCount} sesiones activas`}
      </span>
      {tunnelCount > 0 && <span>{tunnelCount === 1 ? '1 túnel' : `${tunnelCount} túneles`}</span>}
      {transferCount > 0 && (
        <span>{transferCount === 1 ? '1 transferencia' : `${transferCount} transferencias`}</span>
      )}
      {sftp && (
        <button
          type="button"
          aria-pressed={sftp.visible}
          onClick={sftp.onToggle}
          className="ml-auto min-h-6 cursor-pointer rounded px-2 text-xs text-muted hover:bg-s2 hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
        >
          {sftp.visible ? 'Ocultar SFTP' : 'Mostrar SFTP'}
        </button>
      )}
    </footer>
  )
}

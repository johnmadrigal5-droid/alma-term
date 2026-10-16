import type { ImportPreview } from '@alma/protocol'
import { useState } from 'react'
import { Button } from '../components/ui/button'
import { Dialog } from '../components/ui/dialog'

interface Props {
  /** null while ~/.ssh/config is being read. */
  preview: ImportPreview | null
  onImport(aliases: string[]): void
  onCancel(): void
}

export function ImportDialog({ preview, onImport, onCancel }: Props) {
  const [chosen, setChosen] = useState<ReadonlySet<string> | null>(null)
  const selected =
    chosen ?? new Set(preview?.candidates.filter((c) => !c.duplicate).map((c) => c.alias) ?? [])
  const toggle = (alias: string) => {
    const next = new Set(selected)
    if (!next.delete(alias)) next.add(alias)
    setChosen(next)
  }
  const aliases = preview?.candidates.map((c) => c.alias).filter((a) => selected.has(a)) ?? []

  return (
    <Dialog open title="Importar ~/.ssh/config" onDismiss={onCancel}>
      {preview === null ? (
        <p role="status" className="m-0 text-muted">
          Leyendo ~/.ssh/config…
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {preview.warnings.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs text-warn">
              {preview.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {preview.candidates.length === 0 ? (
            <p className="m-0 font-semibold">No hay hosts para importar</p>
          ) : (
            <ul className="m-0 flex max-h-80 list-none flex-col gap-1 overflow-y-auto p-0">
              {preview.candidates.map((c) => (
                <li key={c.alias} className="flex flex-col gap-1 rounded-md bg-s2 px-2 py-1">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.has(c.alias)}
                      onChange={() => toggle(c.alias)}
                      className="accent-accent"
                    />
                    <span className="font-medium">{c.alias}</span>
                    <span className="font-mono text-xs text-muted">
                      {c.target.username}@{c.target.host}
                      {c.target.port !== 22 ? `:${c.target.port}` : ''}
                    </span>
                    {c.duplicate && <span className="ml-auto text-xs text-faint">Ya existe</span>}
                  </label>
                  {c.warnings.map((w) => (
                    <span key={w} className="pl-6 text-xs text-warn">
                      {w}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancelar</Button>
        <Button variant="primary" disabled={aliases.length === 0} onClick={() => onImport(aliases)}>
          {`Importar ${aliases.length}`}
        </Button>
      </div>
    </Dialog>
  )
}

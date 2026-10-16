import { ChevronRight, Folder as FolderIcon, MoreHorizontal, Server } from 'lucide-react'
import { useRef, useState, type KeyboardEvent } from 'react'
import { StatusDot } from '../components/StatusDot'
import { Menu, type MenuItem } from '../components/ui/menu'
import { ConfirmDialog } from './ConfirmDialog'
import type { TreeRow } from './tree-model'

export type TreeAction =
  'edit' | 'duplicate' | 'remove' | 'newSessionHere' | 'newFolderHere' | 'rename'

interface Props {
  rows: readonly TreeRow[]
  onConnect(sessionId: string): void
  onToggle(folderId: string): void
  onAction(action: TreeAction, row: TreeRow): void
}

const FOLDER_REMOVE_NOTE =
  'Se eliminarán la carpeta y sus subcarpetas. Las sesiones que contiene pasan a la raíz.'

export function SessionTree({ rows, onConnect, onToggle, onAction }: Props) {
  const [focusId, setFocusId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<TreeRow | null>(null)
  const items = useRef(new Map<string, HTMLElement>())
  // Roving tabindex: one item is tabbable; default to the first.
  const current = rows.find((r) => r.id === focusId)?.id ?? rows[0]?.id

  const focusRow = (row: TreeRow | undefined) => {
    if (!row) return
    setFocusId(row.id)
    items.current.get(row.id)?.focus()
  }

  const activate = (row: TreeRow) => (row.kind === 'session' ? onConnect(row.id) : onToggle(row.id))

  const onKeyDown = (event: KeyboardEvent, row: TreeRow, index: number) => {
    const handled = () => event.preventDefault()
    switch (event.key) {
      case 'ArrowDown':
        handled()
        return focusRow(rows[index + 1])
      case 'ArrowUp':
        handled()
        return focusRow(rows[index - 1])
      case 'Home':
        handled()
        return focusRow(rows[0])
      case 'End':
        handled()
        return focusRow(rows[rows.length - 1])
      case 'ArrowRight':
        handled()
        if (row.kind === 'folder' && !row.expanded) return onToggle(row.id)
        if (row.kind === 'folder') return focusRow(rows[index + 1])
        return
      case 'ArrowLeft':
        handled()
        if (row.kind === 'folder' && row.expanded) return onToggle(row.id)
        return focusRow(rows.find((r) => r.id === row.parentId))
      case 'Enter':
        handled()
        return activate(row)
      case 'Delete':
        handled()
        return setConfirm(row)
    }
  }

  const menuItems = (row: TreeRow): MenuItem[] =>
    row.kind === 'session'
      ? [
          { label: 'Conectar', onSelect: () => onConnect(row.id) },
          { label: 'Editar', onSelect: () => onAction('edit', row) },
          { label: 'Duplicar', onSelect: () => onAction('duplicate', row) },
          { label: 'Eliminar', onSelect: () => setConfirm(row), danger: true },
        ]
      : [
          { label: 'Nueva sesión aquí', onSelect: () => onAction('newSessionHere', row) },
          { label: 'Nueva carpeta', onSelect: () => onAction('newFolderHere', row) },
          { label: 'Renombrar', onSelect: () => onAction('rename', row) },
          { label: 'Eliminar', onSelect: () => setConfirm(row), danger: true },
        ]

  return (
    <>
      <ul role="tree" aria-label="Sesiones guardadas" className="m-0 flex list-none flex-col p-0">
        {rows.map((row, index) => (
          <li
            key={row.id}
            ref={(el) => {
              if (el) items.current.set(row.id, el)
              else items.current.delete(row.id)
            }}
            role="treeitem"
            aria-level={row.depth + 1}
            aria-expanded={row.kind === 'folder' ? row.expanded === true : undefined}
            aria-selected={row.id === current}
            tabIndex={row.id === current ? 0 : -1}
            onFocus={() => setFocusId(row.id)}
            onKeyDown={(event) => onKeyDown(event, row, index)}
            onClick={() => row.kind === 'folder' && onToggle(row.id)}
            onDoubleClick={() => row.kind === 'session' && onConnect(row.id)}
            style={{ paddingLeft: 8 + row.depth * 16 }}
            className="group flex h-7 cursor-pointer items-center gap-2 rounded-md pr-1 text-text outline-none hover:bg-s1 focus-visible:ring-2 focus-visible:ring-accent aria-selected:bg-s2"
          >
            {row.kind === 'folder' ? (
              <>
                <ChevronRight
                  size={12}
                  aria-hidden="true"
                  className={`shrink-0 text-faint transition-transform duration-150 motion-reduce:transition-none ${row.expanded ? 'rotate-90' : ''}`}
                />
                <FolderIcon size={14} aria-hidden="true" className="shrink-0 text-muted" />
              </>
            ) : (
              <>
                <Server size={14} aria-hidden="true" className="ml-5 shrink-0 text-muted" />
                {row.status && <StatusDot status={row.status} />}
              </>
            )}
            <span className="min-w-0 flex-1 truncate">
              {row.name}
              {row.detail && <span className="sr-only">, {row.detail}</span>}
            </span>
            <Menu
              label={`Acciones de ${row.name}`}
              trigger={<MoreHorizontal size={14} aria-hidden="true" />}
              items={menuItems(row)}
            />
          </li>
        ))}
      </ul>
      {confirm && (
        <ConfirmDialog
          title={`Eliminar «${confirm.name}»`}
          description={
            confirm.kind === 'folder'
              ? FOLDER_REMOVE_NOTE
              : 'Se borrará la sesión guardada y su contraseña. Las pestañas abiertas siguen funcionando.'
          }
          confirmLabel="Eliminar"
          onConfirm={() => {
            onAction('remove', confirm)
            setConfirm(null)
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  )
}

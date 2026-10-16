import type { RemoteEntry } from '@alma/protocol'
import { File, Folder, Link2, MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Menu, type MenuItem } from '../components/ui/menu'
import { displayName, formatDate, formatSize, isUnknownMeta } from './format'

export const ROW_HEIGHT = 28
const OVERSCAN = 10
// jsdom and the first paint report no height; assume a typical panel until measured.
const FALLBACK_HEIGHT = 600

interface Props {
  path: string
  entries: readonly RemoteEntry[]
  rowErrors: Readonly<Record<string, string>>
  onOpen(entry: RemoteEntry): void
  onUp(): void
  menuFor(entry: RemoteEntry): MenuItem[]
}

const KIND_LABEL: Record<RemoteEntry['kind'], string> = {
  dir: 'carpeta',
  file: 'archivo',
  link: 'enlace',
  other: 'especial',
}

function KindIcon({ kind }: { kind: RemoteEntry['kind'] }) {
  if (kind === 'dir') return <Folder size={16} className="shrink-0 text-accent" aria-hidden />
  if (kind === 'link') return <Link2 size={16} className="shrink-0 text-muted" aria-hidden />
  return <File size={16} className="shrink-0 text-muted" aria-hidden />
}

/** Fixed-height rows; only the visible ones (plus a margin) are in the DOM. */
export function FileList({ path, entries, rowErrors, onOpen, onUp, menuFor }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const rows = useRef(new Map<number, HTMLElement>())
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(FALLBACK_HEIGHT)
  const [focus, setFocus] = useState(0)

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () => setHeight(el.clientHeight || FALLBACK_HEIGHT)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setFocus(0)
    setScrollTop(0)
    if (scroller.current) scroller.current.scrollTop = 0
  }, [path])

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(entries.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN)
  const current = Math.min(focus, Math.max(0, entries.length - 1))

  const moveTo = (index: number) => {
    const next = Math.max(0, Math.min(entries.length - 1, index))
    setFocus(next)
    const el = scroller.current
    if (el) {
      const top = next * ROW_HEIGHT
      if (top < el.scrollTop) el.scrollTop = top
      else if (top + ROW_HEIGHT > el.scrollTop + height) el.scrollTop = top + ROW_HEIGHT - height
      setScrollTop(el.scrollTop)
    }
    requestAnimationFrame(() => rows.current.get(next)?.focus())
  }

  const onKeyDown = (event: KeyboardEvent, index: number, entry: RemoteEntry) => {
    // React bubbles events out of the menu's portal into the row: only the row's own keys count.
    if (event.target !== event.currentTarget) return
    const page = Math.max(1, Math.floor(height / ROW_HEIGHT) - 1)
    const keys: Record<string, () => void> = {
      ArrowDown: () => moveTo(index + 1),
      ArrowUp: () => moveTo(index - 1),
      PageDown: () => moveTo(index + page),
      PageUp: () => moveTo(index - page),
      Home: () => moveTo(0),
      End: () => moveTo(entries.length - 1),
      Enter: () => onOpen(entry),
      Backspace: onUp,
    }
    const run = keys[event.key]
    if (!run) return
    event.preventDefault()
    run()
  }

  // Rows are absolute, so the longest name sets the width and the list scrolls sideways.
  const widest = entries.reduce((max, e) => Math.max(max, displayName(e.name).length), 0)

  return (
    <div
      ref={scroller}
      role="grid"
      aria-label={`Archivos de ${path}`}
      aria-rowcount={entries.length}
      className="min-h-0 flex-1 overflow-auto"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div
        className="relative min-w-full"
        style={{
          height: entries.length * ROW_HEIGHT,
          width: `max(24rem, calc(${widest}ch + 17rem))`,
        }}
      >
        {entries.slice(first, last).map((entry, offset) => {
          const index = first + offset
          const error = rowErrors[entry.name]
          const name = displayName(entry.name)
          return (
            <div
              key={entry.name}
              ref={(el) => {
                if (el) rows.current.set(index, el)
                else rows.current.delete(index)
              }}
              role="row"
              aria-rowindex={index + 1}
              aria-label={`${name}, ${KIND_LABEL[entry.kind]}`}
              tabIndex={index === current ? 0 : -1}
              className="absolute inset-x-0 flex cursor-default items-center gap-2 px-2 text-sm outline-none hover:bg-s2 focus-visible:bg-s2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
              style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
              onFocus={() => setFocus(index)}
              onDoubleClick={() => onOpen(entry)}
              onKeyDown={(e) => onKeyDown(e, index, entry)}
            >
              <span role="gridcell" className="flex min-w-0 flex-1 items-center gap-2">
                <KindIcon kind={entry.kind} />
                <span className="whitespace-pre" title={name}>
                  {name}
                </span>
              </span>
              {error ? (
                <span role="gridcell" className="truncate text-xs text-err" title={error}>
                  {error}
                </span>
              ) : (
                <>
                  <span role="gridcell" className="w-16 shrink-0 text-right text-xs text-muted">
                    {entry.kind === 'dir'
                      ? ''
                      : isUnknownMeta(entry)
                        ? '—'
                        : formatSize(entry.size)}
                  </span>
                  <span role="gridcell" className="w-28 shrink-0 text-right text-xs text-faint">
                    {isUnknownMeta(entry) ? '—' : formatDate(entry.mtimeMs)}
                  </span>
                </>
              )}
              <span role="gridcell" className="shrink-0">
                <Menu
                  label={`Acciones de ${name}`}
                  trigger={<MoreHorizontal size={16} aria-hidden />}
                  items={menuFor(entry)}
                />
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

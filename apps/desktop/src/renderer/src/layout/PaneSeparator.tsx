import { useRef, type KeyboardEvent } from 'react'
import { clampSplit, SPLIT } from './panes'

interface Props {
  axis: 'x' | 'y'
  ratio: number
  onSplit(axis: 'x' | 'y', ratio: number): void
}

/** Splitter between panes: drag, or arrows in 5 % steps (20 % to 80 %). */
export function PaneSeparator({ axis, ratio, onSplit }: Props) {
  const dragging = useRef(false)
  const vertical = axis === 'x'
  const keys: Record<string, number> = vertical
    ? { ArrowLeft: -SPLIT.step, ArrowRight: SPLIT.step }
    : { ArrowUp: -SPLIT.step, ArrowDown: SPLIT.step }
  const onKeyDown = (event: KeyboardEvent) => {
    const delta = keys[event.key]
    if (delta === undefined) return
    event.preventDefault()
    onSplit(axis, clampSplit(ratio + delta))
  }
  return (
    <div
      role="separator"
      aria-label={vertical ? 'Ancho de los paneles' : 'Alto de los paneles'}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={SPLIT.min * 100}
      aria-valuemax={SPLIT.max * 100}
      tabIndex={0}
      style={vertical ? { gridColumn: 2, gridRow: '1 / -1' } : { gridRow: 2, gridColumn: '1 / -1' }}
      className={`z-10 rounded outline-none transition-colors duration-150 hover:bg-s3 focus-visible:bg-accent motion-reduce:transition-none ${
        vertical ? 'cursor-col-resize' : 'cursor-row-resize'
      }`}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        dragging.current = true
      }}
      onPointerMove={(e) => {
        const grid = e.currentTarget.parentElement
        // A release lost to focus loss must not leave plain hovering resizing the panes.
        if (!dragging.current || !grid || e.buttons === 0) return
        const box = grid.getBoundingClientRect()
        const at = vertical
          ? (e.clientX - box.left) / box.width
          : (e.clientY - box.top) / box.height
        onSplit(axis, clampSplit(at))
      }}
      onPointerUp={() => {
        dragging.current = false
      }}
      onPointerCancel={() => {
        dragging.current = false
      }}
      onLostPointerCapture={() => {
        dragging.current = false
      }}
    />
  )
}

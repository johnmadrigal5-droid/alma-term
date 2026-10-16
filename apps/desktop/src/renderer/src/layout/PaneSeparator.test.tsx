import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PaneSeparator } from './PaneSeparator'

function setup() {
  const onSplit = vi.fn()
  render(
    <div data-testid="grid">
      <PaneSeparator axis="x" ratio={0.5} onSplit={onSplit} />
    </div>,
  )
  const grid = screen.getByTestId('grid')
  grid.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500, x: 0, y: 0 }) as DOMRect
  return { onSplit, separator: screen.getByRole('separator') }
}

const move = (el: HTMLElement, clientX: number, buttons: number) => {
  const event = createEvent.pointerMove(el, { clientX, buttons })
  // jsdom may not build a PointerEvent: set what the handler reads.
  Object.defineProperty(event, 'clientX', { value: clientX })
  Object.defineProperty(event, 'buttons', { value: buttons })
  fireEvent(el, event)
}

describe('PaneSeparator pointer drag', () => {
  beforeEach(() => {
    HTMLElement.prototype.setPointerCapture = vi.fn()
  })

  it('resizes while the pointer is held', () => {
    const { onSplit, separator } = setup()
    fireEvent.pointerDown(separator, { pointerId: 1 })
    move(separator, 300, 1)
    expect(onSplit).toHaveBeenLastCalledWith('x', 0.3)
  })

  it('M3: stops when the pointer capture is lost, so hovering never resizes', () => {
    const { onSplit, separator } = setup()
    fireEvent.pointerDown(separator, { pointerId: 1 })
    fireEvent.lostPointerCapture(separator)
    move(separator, 700, 0)
    expect(onSplit).not.toHaveBeenCalled()
  })

  it('M3: stops on pointercancel', () => {
    const { onSplit, separator } = setup()
    fireEvent.pointerDown(separator, { pointerId: 1 })
    fireEvent.pointerCancel(separator)
    move(separator, 700, 1)
    expect(onSplit).not.toHaveBeenCalled()
  })

  it('M3: ignores moves without a pressed button even if the release was lost', () => {
    const { onSplit, separator } = setup()
    fireEvent.pointerDown(separator, { pointerId: 1 })
    move(separator, 700, 0)
    expect(onSplit).not.toHaveBeenCalled()
  })
})

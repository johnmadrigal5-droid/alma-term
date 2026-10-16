import { describe, expect, it, vi } from 'vitest'
import { bindContextClick, type ClipboardLike, type SelectableTerminal } from './context-click'

function setup(selection: string, clipboardText = '') {
  const el = document.createElement('div')
  const term: SelectableTerminal = {
    hasSelection: () => selection !== '',
    getSelection: () => selection,
    clearSelection: vi.fn(),
    paste: vi.fn(),
  }
  const clipboard: ClipboardLike = {
    readText: vi.fn().mockResolvedValue(clipboardText),
    writeText: vi.fn().mockResolvedValue(undefined),
  }
  const around = vi.fn((run: () => void) => run())
  const dispose = bindContextClick(el, term, { around }, clipboard)
  const click = () => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    el.dispatchEvent(event)
    return event
  }
  return { term, clipboard, around, dispose, click }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('bindContextClick', () => {
  it('copies the selection and clears it', async () => {
    const { term, clipboard, click } = setup('ls -la')
    const event = click()
    await flush()
    expect(event.defaultPrevented).toBe(true)
    expect(clipboard.writeText).toHaveBeenCalledWith('ls -la')
    expect(term.clearSelection).toHaveBeenCalled()
    expect(term.paste).not.toHaveBeenCalled()
  })

  it('pastes the clipboard as a paste when nothing is selected', async () => {
    const { term, clipboard, around, click } = setup('', 'echo hi')
    click()
    await flush()
    expect(clipboard.writeText).not.toHaveBeenCalled()
    expect(around).toHaveBeenCalledOnce()
    expect(term.paste).toHaveBeenCalledWith('echo hi')
  })

  it('does nothing with an empty clipboard or a clipboard error', async () => {
    const empty = setup('', '')
    empty.click()
    await flush()
    expect(empty.term.paste).not.toHaveBeenCalled()

    const denied = setup('')
    vi.mocked(denied.clipboard.readText).mockRejectedValue(new Error('denied'))
    denied.click()
    await flush()
    expect(denied.term.paste).not.toHaveBeenCalled()
  })

  it('stops listening once disposed', async () => {
    const { term, dispose, click } = setup('', 'x')
    dispose()
    click()
    await flush()
    expect(term.paste).not.toHaveBeenCalled()
  })
})

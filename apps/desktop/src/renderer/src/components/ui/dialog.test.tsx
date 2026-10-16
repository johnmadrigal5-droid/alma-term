import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { Dialog } from './dialog'

function Host() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>abrir</button>
      {open && (
        <Dialog open title="Diálogo" onDismiss={() => setOpen(false)}>
          <input aria-label="campo" autoFocus />
        </Dialog>
      )}
    </>
  )
}

describe('Dialog', () => {
  it('A11y: puts the focus back on the button that opened it, even with an autofocused field', async () => {
    const user = userEvent.setup()
    render(<Host />)
    await user.click(screen.getByRole('button', { name: 'abrir' }))
    expect(screen.getByLabelText('campo')).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'abrir' })).toHaveFocus()
  })
})

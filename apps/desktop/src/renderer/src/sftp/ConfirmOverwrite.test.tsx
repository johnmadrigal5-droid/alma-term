import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmOverwrite } from './ConfirmOverwrite'

describe('ConfirmOverwrite', () => {
  it('asks to replace one file', async () => {
    const onAnswer = vi.fn()
    render(<ConfirmOverwrite name="a.txt" many={false} onAnswer={onAnswer} />)
    expect(screen.getByRole('dialog')).toHaveTextContent('Ya existe «a.txt». ¿Reemplazarlo?')
    expect(screen.queryByLabelText('Aplicar a todos')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Reemplazar' }))
    expect(onAnswer).toHaveBeenCalledWith({ replace: true, all: false })
  })

  it('offers to apply the answer to every conflict of a batch', async () => {
    const onAnswer = vi.fn()
    render(<ConfirmOverwrite name="a.txt" many onAnswer={onAnswer} />)
    await userEvent.click(screen.getByLabelText('Aplicar a todos'))
    await userEvent.click(screen.getByRole('button', { name: 'Omitir' }))
    expect(onAnswer).toHaveBeenCalledWith({ replace: false, all: true })
  })
})

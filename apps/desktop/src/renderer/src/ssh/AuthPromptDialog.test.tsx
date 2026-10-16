import type { AuthPrompt } from '@alma/protocol'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AuthPromptDialog } from './AuthPromptDialog'

const prompt: AuthPrompt = {
  kind: 'auth',
  title: 'Verificación en dos pasos',
  instructions: 'Introduce el código',
  fields: [
    { label: 'Contraseña', echo: false },
    { label: 'Código', echo: true },
  ],
}

describe('AuthPromptDialog', () => {
  it('renders one field per prompt and hides text when echo is false', () => {
    render(<AuthPromptDialog prompt={prompt} onSubmit={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Verificación en dos pasos' })).toBeVisible()
    expect(screen.getByLabelText('Contraseña')).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText('Código')).toHaveAttribute('type', 'text')
    expect(screen.getByLabelText('Contraseña')).toHaveFocus()
  })

  it('submits all responses with Enter', async () => {
    const onSubmit = vi.fn()
    render(<AuthPromptDialog prompt={prompt} onSubmit={onSubmit} onCancel={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Contraseña'), 'pw')
    await userEvent.type(screen.getByLabelText('Código'), '123456{Enter}')
    expect(onSubmit).toHaveBeenCalledWith(['pw', '123456'], false)
  })

  it('cancels with the cancel button', async () => {
    const onCancel = vi.fn()
    render(<AuthPromptDialog prompt={prompt} onSubmit={vi.fn()} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('does not cancel on a click outside the dialog', async () => {
    const onCancel = vi.fn()
    render(<AuthPromptDialog prompt={prompt} onSubmit={vi.fn()} onCancel={onCancel} />)
    // In a modal the click outside lands on the overlay. Radix attaches its pointerdown
    // listener on the next tick, and user-event cannot click through pointer-events:none.
    await new Promise((resolve) => setTimeout(resolve, 0))
    const overlay = document.querySelector('[data-alma-overlay]')
    if (!overlay) throw new Error('no overlay')
    fireEvent.pointerDown(overlay)
    fireEvent.pointerUp(overlay)
    fireEvent.click(overlay)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('offers Recordar on a rememberable prompt and sends it', async () => {
    const onSubmit = vi.fn()
    render(
      <AuthPromptDialog
        prompt={{ ...prompt, fields: [{ label: 'Contraseña', echo: false }], remember: 'password' }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )
    await userEvent.type(screen.getByLabelText('Contraseña'), 'pw')
    await userEvent.click(screen.getByLabelText('Recordar contraseña'))
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(onSubmit).toHaveBeenCalledWith(['pw'], true)
  })

  it('has no Recordar option on other prompts', () => {
    render(<AuthPromptDialog prompt={prompt} onSubmit={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByLabelText(/Recordar/)).toBeNull()
  })
})

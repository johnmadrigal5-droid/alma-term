import type { HostKeyPrompt } from '@alma/protocol'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { HostKeyDialog } from './HostKeyDialog'

const base: HostKeyPrompt = {
  kind: 'hostkey',
  status: 'new',
  host: 'srv.example',
  port: 22,
  keyType: 'ssh-ed25519',
  fingerprint: 'SHA256:newkey',
}

describe('HostKeyDialog', () => {
  it('asks to trust a new key', async () => {
    const onAnswer = vi.fn()
    render(<HostKeyDialog prompt={base} onAnswer={onAnswer} />)
    expect(screen.getByRole('dialog', { name: /primera conexión/i })).toBeVisible()
    expect(screen.getByText('SHA256:newkey')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Confiar y conectar' }))
    expect(onAnswer).toHaveBeenCalledWith(true)
  })

  it('cancelling a new key rejects it', async () => {
    const onAnswer = vi.fn()
    render(<HostKeyDialog prompt={base} onAnswer={onAnswer} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onAnswer).toHaveBeenCalledWith(false)
  })

  it('warns about a changed key, focuses "No conectar" and shows both fingerprints', async () => {
    const onAnswer = vi.fn()
    render(
      <HostKeyDialog
        prompt={{ ...base, status: 'changed', knownFingerprint: 'SHA256:oldkey' }}
        onAnswer={onAnswer}
      />,
    )
    expect(screen.getByRole('dialog', { name: /la clave del servidor cambió/i })).toBeVisible()
    expect(screen.getByText('SHA256:oldkey')).toBeVisible()
    expect(screen.getByText('SHA256:newkey')).toBeVisible()
    expect(screen.getByRole('button', { name: 'No conectar' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onAnswer).toHaveBeenCalledWith(false)
    await userEvent.click(screen.getByRole('button', { name: 'Reemplazar clave' }))
    expect(onAnswer).toHaveBeenLastCalledWith(true)
  })
})

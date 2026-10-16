import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SavedSession, SaveSessionInput } from '@alma/protocol'
import { describe, expect, it, vi } from 'vitest'
import { ConnectDialog } from './ConnectDialog'

const FOLDER = {
  id: '9d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11',
  name: 'Clientes',
  parentId: null,
  sort: 0,
}
const SAVED: SavedSession = {
  id: '7d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11',
  folderId: null,
  name: 'prod',
  host: 'srv',
  port: 22,
  username: 'alma',
  auth: 'password',
  keyPath: null,
  hasPassword: true,
  hasPassphrase: false,
}

function setup(props: Partial<Parameters<typeof ConnectDialog>[0]> = {}) {
  const handlers = {
    onSubmit: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    pickPrivateKey: vi.fn().mockResolvedValue('/home/u/.ssh/id_ed25519'),
  }
  render(
    <ConnectDialog
      initial={null}
      saved={null}
      folders={[FOLDER]}
      canRemember
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

async function fillBasics() {
  await userEvent.type(screen.getByLabelText('Host'), 'srv.example')
  await userEvent.type(screen.getByLabelText('Usuario'), 'alma')
}

describe('ConnectDialog', () => {
  it('shows every error and focuses the first invalid field when connecting too early', async () => {
    const h = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Conectar' }))
    expect(h.onSubmit).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Host')).toHaveFocus()
    const alerts = screen.getAllByRole('alert').map((a) => a.textContent)
    expect(alerts).toEqual(['Indica el host', 'Indica el usuario'])
  })

  it('marks the required fields', () => {
    setup()
    for (const label of ['Host', 'Puerto', 'Usuario'])
      expect(screen.getByLabelText(label)).toHaveAttribute('aria-required', 'true')
  })

  it('shows field errors next to the field for an empty host and port 0', async () => {
    setup()
    const host = screen.getByLabelText('Host')
    await userEvent.type(host, 'x')
    await userEvent.clear(host)
    expect(host).toHaveAccessibleDescription('Indica el host')
    const port = screen.getByLabelText('Puerto')
    await userEvent.clear(port)
    await userEvent.type(port, '0')
    expect(port).toHaveAccessibleDescription('El puerto va de 1 a 65535')
    expect(port).toHaveAttribute('aria-invalid', 'true')
  })

  it('submits a password connection', async () => {
    const h = setup()
    await userEvent.type(screen.getByLabelText('Host'), 'srv.example')
    await userEvent.clear(screen.getByLabelText('Puerto'))
    await userEvent.type(screen.getByLabelText('Puerto'), '2222')
    await userEvent.type(screen.getByLabelText('Usuario'), 'alma')
    await userEvent.type(screen.getByLabelText('Contraseña (opcional)'), 'pw{Enter}')
    expect(h.onSubmit).toHaveBeenCalledWith({
      target: { host: 'srv.example', port: 2222, username: 'alma' },
      auth: { type: 'password', password: 'pw' },
      savedId: null,
    })
  })

  it('picks a private key file and submits key auth', async () => {
    const h = setup()
    await userEvent.type(screen.getByLabelText('Host'), 'srv')
    await userEvent.type(screen.getByLabelText('Usuario'), 'alma')
    await userEvent.click(screen.getByRole('radio', { name: 'Clave privada' }))
    await userEvent.click(screen.getByRole('button', { name: 'Elegir archivo' }))
    expect(screen.getByLabelText('Archivo de clave')).toHaveValue('/home/u/.ssh/id_ed25519')
    await userEvent.click(screen.getByRole('button', { name: 'Conectar' }))
    expect(h.onSubmit).toHaveBeenCalledWith({
      target: { host: 'srv', port: 22, username: 'alma' },
      auth: { type: 'key', privateKeyPath: '/home/u/.ssh/id_ed25519' },
      savedId: null,
    })
  })

  it('prefills from a previous request when editing', () => {
    setup({
      initial: {
        target: { host: 'srv', port: 2200, username: 'root' },
        auth: { type: 'agent' },
        savedId: null,
      },
    })
    expect(screen.getByLabelText('Host')).toHaveValue('srv')
    expect(screen.getByLabelText('Puerto')).toHaveValue('2200')
    expect(screen.getByRole('radio', { name: 'Agente SSH' })).toBeChecked()
  })

  it('saves and connects with the default name and the chosen folder', async () => {
    const h = setup()
    await fillBasics()
    await userEvent.selectOptions(screen.getByLabelText('Carpeta'), 'Clientes')
    await userEvent.type(screen.getByLabelText('Contraseña (opcional)'), 'pw')
    await userEvent.click(screen.getByLabelText('Recordar contraseña'))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar y conectar' }))
    expect(h.onSave).toHaveBeenCalledWith(
      {
        folderId: FOLDER.id,
        name: 'alma@srv.example',
        host: 'srv.example',
        port: 22,
        username: 'alma',
        auth: 'password',
        keyPath: null,
        secret: { kind: 'password', value: 'pw' },
      },
      { connect: true, password: 'pw' },
    )
  })

  it('disables Recordar with a notice when there is no keyring', () => {
    setup({ canRemember: false })
    expect(screen.getByLabelText('Recordar contraseña')).toBeDisabled()
    expect(screen.getByText(/no tiene un llavero disponible/)).toBeVisible()
  })

  it('keeps the stored password when editing with an empty password field', async () => {
    const h = setup({ saved: SAVED })
    expect(screen.getByLabelText('Contraseña (opcional)')).toHaveAttribute(
      'placeholder',
      'Dejar vacío para mantener la guardada',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    const [input] = h.onSave.mock.calls[0] as [SaveSessionInput]
    expect(input.id).toBe(SAVED.id)
    expect(input.secret).toBeUndefined()
  })

  it('forgets the stored password on request', async () => {
    const h = setup({ saved: SAVED })
    await userEvent.click(screen.getByLabelText('Olvidar contraseña guardada'))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    const [input] = h.onSave.mock.calls[0] as [SaveSessionInput]
    expect(input.secret).toEqual({ kind: 'password', value: null })
  })
})

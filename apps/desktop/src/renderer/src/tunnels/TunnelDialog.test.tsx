import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TunnelDialog, type TunnelDialogProps } from './TunnelDialog'

const sessions = [
  { sessionId: 's1', title: 'alma@srv' },
  { sessionId: 's2', title: 'root@db' },
]

function setup(over: Partial<TunnelDialogProps> = {}) {
  const props: TunnelDialogProps = {
    sessions,
    onSubmit: vi.fn(async () => ({ ok: true as const })),
    onClose: vi.fn(),
    ...over,
  }
  render(<TunnelDialog {...props} />)
  return props
}

const field = (name: string) => screen.getByLabelText(name)
async function fillLocal(user: ReturnType<typeof userEvent.setup>) {
  await user.type(field('Puerto de escucha'), '8080')
  await user.type(field('Host de destino'), 'db')
  await user.type(field('Puerto de destino'), '5432')
}

describe('TunnelDialog', () => {
  it('asks for an open ssh session when there is none', async () => {
    const p = setup({ sessions: [] })
    expect(screen.getByText('Abre una sesión SSH para crear un túnel')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Crear' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(p.onClose).toHaveBeenCalledOnce()
  })

  it('starts on the session field and closes with Escape', async () => {
    const p = setup()
    expect(screen.getByRole('combobox', { name: 'Sesión' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(p.onClose).toHaveBeenCalledOnce()
  })

  it('hides the destination of a dynamic tunnel', async () => {
    setup()
    expect(screen.getByLabelText('Host de destino')).toBeVisible()
    await userEvent.click(screen.getByRole('radio', { name: 'Dinámico' }))
    expect(screen.queryByLabelText('Host de destino')).toBeNull()
    expect(screen.getByText(/proxy SOCKS5/)).toBeVisible()
  })

  it('creates a local forward with the typed values', async () => {
    const user = userEvent.setup()
    const p = setup()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sesión' }), 's2')
    await fillLocal(user)
    await user.click(screen.getByRole('button', { name: 'Crear' }))
    expect(p.onSubmit).toHaveBeenCalledWith(
      's2',
      {
        type: 'L',
        bindHost: '127.0.0.1',
        bindPort: 8080,
        targetHost: 'db',
        targetPort: 5432,
        exposeExternally: false,
      },
      null,
    )
    expect(p.onClose).toHaveBeenCalledOnce()
  })

  it('creates a dynamic tunnel without a destination', async () => {
    const user = userEvent.setup()
    const p = setup()
    await user.click(screen.getByRole('radio', { name: 'Dinámico' }))
    await user.type(field('Puerto de escucha'), '1080')
    await user.click(screen.getByRole('button', { name: 'Crear' }))
    expect(p.onSubmit).toHaveBeenCalledWith(
      's1',
      { type: 'D', bindHost: '127.0.0.1', bindPort: 1080, exposeExternally: false },
      null,
    )
  })

  it('explains each invalid field and does not submit', async () => {
    const user = userEvent.setup()
    const p = setup()
    await user.click(screen.getByRole('button', { name: 'Crear' }))
    expect(screen.getByText('Indica un puerto entre 0 y 65535')).toBeVisible()
    expect(screen.getByText('Indica el host de destino')).toBeVisible()
    expect(screen.getByText('Indica un puerto entre 1 y 65535')).toBeVisible()
    expect(field('Puerto de escucha')).toHaveAttribute('aria-invalid', 'true')
    expect(p.onSubmit).not.toHaveBeenCalled()
  })

  it('requires an explicit acknowledgement to listen beyond 127.0.0.1', async () => {
    const user = userEvent.setup()
    const p = setup()
    await fillLocal(user)
    await user.clear(field('Dirección de escucha'))
    await user.type(field('Dirección de escucha'), '0.0.0.0')
    expect(screen.getByText(/otros equipos de tu red/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Crear' })).toBeDisabled()
    await user.click(
      screen.getByRole('checkbox', { name: /Entiendo que otros equipos podrán conectarse/ }),
    )
    await user.click(screen.getByRole('button', { name: 'Crear' }))
    expect(p.onSubmit).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ bindHost: '0.0.0.0', exposeExternally: true }),
      null,
    )
  })

  it('keeps the dialog open on a refusal and points at the port when it is in use', async () => {
    const user = userEvent.setup()
    const p = setup({
      onSubmit: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'TUNNEL_BIND_IN_USE' as const, message: 'El puerto 8080 ya está en uso' },
      })),
    })
    await fillLocal(user)
    await user.click(screen.getByRole('button', { name: 'Crear' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Puerto local en uso')
    expect(screen.getByRole('alert')).toHaveTextContent('Elegir otro puerto')
    expect(field('Puerto de escucha')).toHaveFocus()
    expect(p.onClose).not.toHaveBeenCalled()
  })

  it('shows the host message for other refusals', async () => {
    const user = userEvent.setup()
    setup({
      onSubmit: vi.fn(async () => ({
        ok: false as const,
        error: {
          code: 'TUNNEL_FAILED' as const,
          message: 'El servidor no permite reenviar puertos',
        },
      })),
    })
    await fillLocal(user)
    await user.click(screen.getByRole('button', { name: 'Crear' }))
    expect(screen.getByRole('alert')).toHaveTextContent('El servidor no permite reenviar puertos')
  })

  it('disables Crear while the tunnel is being opened', async () => {
    const user = userEvent.setup()
    let release: () => void = () => undefined
    setup({
      onSubmit: vi.fn(
        () =>
          new Promise<{ ok: true }>((resolve) => {
            release = () => resolve({ ok: true })
          }),
      ),
    })
    await fillLocal(user)
    await user.click(screen.getByRole('button', { name: 'Crear' }))
    expect(screen.getByRole('button', { name: 'Creando…' })).toBeDisabled()
    release()
  })

  it('starts from the values of a previous attempt', () => {
    setup({
      initial: {
        sessionId: 's2',
        type: 'R',
        bindPort: '9000',
        targetHost: 'localhost',
        targetPort: '3000',
      },
    })
    expect(screen.getByRole('combobox', { name: 'Sesión' })).toHaveValue('s2')
    expect(screen.getByRole('radio', { name: 'Remoto' })).toBeChecked()
    expect(field('Puerto de escucha')).toHaveValue('9000')
    expect(field('Host de destino')).toHaveValue('localhost')
  })

  it('does not warn about exposure while the address is empty (it falls back to 127.0.0.1)', async () => {
    const user = userEvent.setup()
    const p = setup()
    await fillLocal(user)
    await user.clear(field('Dirección de escucha'))
    expect(screen.queryByText(/otros equipos de tu red/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Crear' }))
    expect(p.onSubmit).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ bindHost: '127.0.0.1', exposeExternally: false }),
      null,
    )
  })

  it('offers to keep the tunnel only for sessions that are saved', async () => {
    const user = userEvent.setup()
    setup({
      sessions: [
        { sessionId: 's1', title: 'alma@srv' },
        { sessionId: 's2', title: 'Prod', savedId: 'saved-2' },
      ],
    })
    expect(screen.queryByRole('checkbox', { name: 'Guardar con la sesión' })).toBeNull()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sesión' }), 's2')
    expect(screen.getByRole('checkbox', { name: 'Guardar con la sesión' })).toBeVisible()
  })

  it('sends the keep options with the tunnel', async () => {
    const user = userEvent.setup()
    const p = setup({ sessions: [{ sessionId: 's2', title: 'Prod', savedId: 'saved-2' }] })
    await fillLocal(user)
    await user.click(screen.getByRole('checkbox', { name: 'Guardar con la sesión' }))
    await user.click(screen.getByRole('checkbox', { name: 'Abrir al conectar' }))
    await user.click(screen.getByRole('button', { name: 'Crear' }))
    expect(p.onSubmit).toHaveBeenCalledWith('s2', expect.anything(), {
      savedId: 'saved-2',
      autoStart: true,
    })
  })

  it('sends no keep options when the box is not checked', async () => {
    const user = userEvent.setup()
    const p = setup({ sessions: [{ sessionId: 's2', title: 'Prod', savedId: 'saved-2' }] })
    await fillLocal(user)
    await user.click(screen.getByRole('button', { name: 'Crear' }))
    expect(p.onSubmit).toHaveBeenCalledWith('s2', expect.anything(), null)
  })
})

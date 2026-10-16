import type { ImportPreview } from '@alma/protocol'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ImportDialog } from './ImportDialog'

const target = (host: string) => ({ host, port: 22, username: 'alma' })
const preview: ImportPreview = {
  file: '~/.ssh/config',
  warnings: ['Los bloques Match no se evalúan'],
  candidates: [
    { alias: 'web', target: target('web'), keyPath: null, warnings: [], duplicate: false },
    { alias: 'old', target: target('old'), keyPath: null, warnings: [], duplicate: true },
    {
      alias: 'db',
      target: target('db'),
      keyPath: null,
      warnings: ['ProxyJump no está soportado'],
      duplicate: false,
    },
  ],
}

describe('ImportDialog', () => {
  it('preselects new hosts, marks duplicates and imports the checked ones', async () => {
    const onImport = vi.fn()
    render(<ImportDialog preview={preview} onImport={onImport} onCancel={vi.fn()} />)
    expect(screen.getByRole('checkbox', { name: /old/ })).not.toBeChecked()
    expect(screen.getByText('Ya existe')).toBeVisible()
    expect(screen.getByText('ProxyJump no está soportado')).toBeVisible()
    expect(screen.getByText('Los bloques Match no se evalúan')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Importar 2' }))
    expect(onImport).toHaveBeenCalledWith(['web', 'db'])
  })

  it('shows the empty state with the warning', () => {
    render(
      <ImportDialog
        preview={{
          file: '~/.ssh/config',
          candidates: [],
          warnings: ['No se encontró ~/.ssh/config'],
        }}
        onImport={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText('No hay hosts para importar')).toBeVisible()
    expect(screen.getByText('No se encontró ~/.ssh/config')).toBeVisible()
  })

  it('shows a loading state while the preview is read', () => {
    render(<ImportDialog preview={null} onImport={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('Leyendo ~/.ssh/config')
  })
})

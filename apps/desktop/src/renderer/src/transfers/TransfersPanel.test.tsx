import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TransfersPanel, type TransfersPanelProps } from './TransfersPanel'
import type { TransferView } from './transfers-store'

const view = (over: Partial<TransferView> = {}): TransferView => ({
  transferId: '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c01',
  sessionId: '7d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11',
  direction: 'upload',
  name: 'a.bin',
  state: 'running',
  bytes: 2.5 * 1024 * 1024,
  total: 5 * 1024 * 1024,
  speed: 0,
  error: null,
  ...over,
})

function renderPanel(views: TransferView[]) {
  const props: TransfersPanelProps = {
    views,
    onPause: vi.fn(),
    onResume: vi.fn(),
    onCancel: vi.fn(),
    onRetry: vi.fn(),
    onClearDone: vi.fn(),
  }
  render(<TransfersPanel {...props} />)
  return props
}

describe('TransfersPanel', () => {
  it('shows the empty state', () => {
    renderPanel([])
    expect(screen.getByText('Sin transferencias')).toBeVisible()
  })

  it('shows progress at 50 % with the byte counts', () => {
    renderPanel([view()])
    expect(screen.getByRole('progressbar', { name: 'Progreso de a.bin' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    )
    expect(screen.getByText(/2\.5 MB de 5\.0 MB/)).toBeVisible()
    expect(screen.getByText('Subida')).toBeInTheDocument()
  })

  it('shows the error with a retry button', async () => {
    const props = renderPanel([
      view({ state: 'error', error: { code: 'ENOSPC', message: 'No queda espacio en el disco' } }),
    ])
    expect(screen.getByText('No queda espacio en el disco')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar a.bin' }))
    expect(props.onRetry).toHaveBeenCalledWith(view().transferId)
  })

  it('pauses a running transfer', async () => {
    const props = renderPanel([view()])
    await userEvent.click(screen.getByRole('button', { name: 'Pausar a.bin' }))
    expect(props.onPause).toHaveBeenCalledWith(view().transferId)
  })

  it('offers to clear finished transfers', async () => {
    const props = renderPanel([view({ state: 'done', bytes: 5 * 1024 * 1024 })])
    expect(screen.getByText('Completada')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar completadas' }))
    expect(props.onClearDone).toHaveBeenCalled()
  })
})

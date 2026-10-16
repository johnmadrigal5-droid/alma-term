import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { openDatabase } from './db/open-database'
import { openStorage } from './startup'

const migrations = join(import.meta.dirname, '../../drizzle')

describe('openStorage', () => {
  it('shows the reason and continues with a memory database when the file cannot open', async () => {
    const showError = vi.fn()
    const open = vi.fn(async (file: string, dir: string) => {
      if (file !== ':memory:') throw new Error('disk I/O error')
      return openDatabase(file, dir)
    })
    const db = await openStorage({ file: '/x/alma.db', migrations, open, showError })
    expect(showError).toHaveBeenCalledWith(
      'Alma Term',
      expect.stringContaining('No se pudo abrir la base de datos de sesiones: disk I/O error'),
    )
    expect(open).toHaveBeenLastCalledWith(':memory:', migrations)
    db.close()
  })

  it('opens the file without any dialog when it works', async () => {
    const showError = vi.fn()
    const db = await openStorage({ file: ':memory:', migrations, open: openDatabase, showError })
    expect(showError).not.toHaveBeenCalled()
    db.close()
  })
})

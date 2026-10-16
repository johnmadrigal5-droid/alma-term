import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AlmaDb } from './db/open-database'
import { settings } from './db/schema'
import { SettingsRepo } from './settings-repo'

const migrations = join(import.meta.dirname, '../../drizzle')

describe('SettingsRepo', () => {
  let db: AlmaDb
  let repo: SettingsRepo
  beforeEach(async () => {
    db = await openDatabase(':memory:', migrations)
    repo = new SettingsRepo(db)
  })
  afterEach(() => db.close())

  it('starts on the dark theme', async () => {
    expect(await repo.theme()).toBe('dark')
  })

  it('remembers the theme', async () => {
    await repo.setTheme('light')
    expect(await repo.theme()).toBe('light')
  })

  it('falls back to dark when the stored value is not a theme', async () => {
    await db.insert(settings).values({ key: 'theme', value: '"naranja"' })
    expect(await repo.theme()).toBe('dark')
    await db.update(settings).set({ value: 'no es json' }).where(eq(settings.key, 'theme'))
    expect(await repo.theme()).toBe('dark')
  })

  it('keeps a single row however many times it is set', async () => {
    await repo.setTheme('light')
    await repo.setTheme('dark')
    await repo.setTheme('light')
    expect(await db.select().from(settings)).toHaveLength(1)
    expect(await repo.theme()).toBe('light')
  })
})

import { ThemeName } from '@alma/protocol'
import { eq } from 'drizzle-orm'
import type { AlmaDb } from './db/open-database'
import { settings } from './db/schema'

const THEME = 'theme'

/** Small app settings in the `settings` table; each value is JSON validated by its reader. */
export class SettingsRepo {
  constructor(private readonly db: AlmaDb) {}

  /** The saved theme; dark when nothing is saved or the value is not a theme. */
  async theme(): Promise<ThemeName> {
    const [row] = await this.db.select().from(settings).where(eq(settings.key, THEME))
    if (!row) return 'dark'
    try {
      const parsed = ThemeName.safeParse(JSON.parse(row.value))
      return parsed.success ? parsed.data : 'dark'
    } catch {
      return 'dark'
    }
  }

  async setTheme(theme: ThemeName): Promise<void> {
    const value = JSON.stringify(theme)
    await this.db
      .insert(settings)
      .values({ key: THEME, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
  }
}

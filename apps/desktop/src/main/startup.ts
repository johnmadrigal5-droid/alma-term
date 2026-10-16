import type { AlmaDb } from './db/open-database'

interface StorageDeps {
  file: string
  migrations: string
  open(file: string, migrations: string): Promise<AlmaDb>
  showError(title: string, message: string): void
}

/**
 * A broken or locked database must not keep the app from starting: the terminal still works
 * and sessions live in memory until the next start, which the dialog tells the user.
 */
export async function openStorage(deps: StorageDeps): Promise<AlmaDb> {
  try {
    return await deps.open(deps.file, deps.migrations)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    deps.showError(
      'Alma Term',
      `No se pudo abrir la base de datos de sesiones: ${reason}\n\nLas sesiones que guardes ahora no se conservarán al cerrar la aplicación.`,
    )
    return deps.open(':memory:', deps.migrations)
  }
}

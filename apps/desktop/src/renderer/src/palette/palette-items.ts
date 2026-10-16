import type { SessionTree } from '@alma/protocol'
import type { Tab } from '../state/sessions-store'

export type PaletteCommand =
  | { type: 'connect'; savedId: string }
  | { type: 'tab'; sessionId: string }
  | { type: 'newSsh' }
  | { type: 'openLocal' }
  | { type: 'newTunnel' }
  | { type: 'toggleTheme' }
  | { type: 'import' }
  | { type: 'newFolder' }
  | { type: 'export' }
  | { type: 'chooseLogDir' }
  | { type: 'openLogDir' }

export interface PaletteItem {
  id: string
  label: string
  detail?: string
  command: PaletteCommand
}

export interface PaletteGroup {
  heading: string
  items: PaletteItem[]
}

const ACTIONS: PaletteItem[] = [
  { id: 'action:newSsh', label: 'Nueva sesión SSH', command: { type: 'newSsh' } },
  { id: 'action:openLocal', label: 'Abrir terminal local', command: { type: 'openLocal' } },
  { id: 'action:newTunnel', label: 'Nuevo túnel', command: { type: 'newTunnel' } },
  { id: 'action:toggleTheme', label: 'Cambiar de tema', command: { type: 'toggleTheme' } },
  { id: 'action:import', label: 'Importar ~/.ssh/config', command: { type: 'import' } },
  { id: 'action:newFolder', label: 'Nueva carpeta', command: { type: 'newFolder' } },
  { id: 'action:export', label: 'Exportar sesiones', command: { type: 'export' } },
  { id: 'action:openLogDir', label: 'Abrir carpeta de registros', command: { type: 'openLogDir' } },
  {
    id: 'action:chooseLogDir',
    label: 'Elegir carpeta de registros…',
    command: { type: 'chooseLogDir' },
  },
]

export function paletteItems({
  tree,
  tabs,
}: {
  tree: SessionTree | null
  tabs: readonly Tab[]
}): PaletteGroup[] {
  const groups: PaletteGroup[] = [
    {
      heading: 'Sesiones guardadas',
      items: (tree?.sessions ?? []).map((s) => ({
        id: `connect:${s.id}`,
        label: `Conectar · ${s.name}`,
        detail: `${s.username}@${s.host}`,
        command: { type: 'connect', savedId: s.id },
      })),
    },
    {
      heading: 'Pestañas abiertas',
      items: tabs.map((t) => ({
        id: `tab:${t.sessionId}`,
        label: `Ir a · ${t.title}`,
        command: { type: 'tab', sessionId: t.sessionId },
      })),
    },
    { heading: 'Acciones', items: ACTIONS },
  ]
  return groups.filter((g) => g.items.length > 0)
}

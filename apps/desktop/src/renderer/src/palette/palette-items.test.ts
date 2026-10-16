import { describe, expect, it } from 'vitest'
import { session, treeOf } from '../sessions/fixtures'
import type { Tab } from '../state/sessions-store'
import { paletteItems } from './palette-items'

const tab = (sessionId: string, title: string): Tab => ({
  sessionId,
  title,
  kind: 'local',
  status: 'ready',
  exitCode: null,
  generation: 0,
  step: null,
  error: null,
  request: null,
})

describe('paletteItems', () => {
  it('lists saved sessions, open tabs and actions', () => {
    const prod = session('Prod')
    const groups = paletteItems({ tree: treeOf([], [prod]), tabs: [tab('t1', 'local 1')] })
    expect(groups.map((g) => g.heading)).toEqual([
      'Sesiones guardadas',
      'Pestañas abiertas',
      'Acciones',
    ])
    expect(groups[0]?.items[0]).toMatchObject({
      id: `connect:${prod.id}`,
      label: 'Conectar · Prod',
      detail: 'alma@prod.example',
      command: { type: 'connect', savedId: prod.id },
    })
    expect(groups[1]?.items[0]).toMatchObject({
      label: 'Ir a · local 1',
      command: { type: 'tab', sessionId: 't1' },
    })
    expect(groups[2]?.items.map((i) => i.label)).toEqual([
      'Nueva sesión SSH',
      'Abrir terminal local',
      'Nuevo túnel',
      'Cambiar de tema',
      'Importar ~/.ssh/config',
      'Nueva carpeta',
      'Exportar sesiones',
      'Abrir carpeta de registros',
      'Elegir carpeta de registros…',
    ])
  })

  it('omits empty groups', () => {
    const groups = paletteItems({ tree: null, tabs: [] })
    expect(groups.map((g) => g.heading)).toEqual(['Acciones'])
  })
})

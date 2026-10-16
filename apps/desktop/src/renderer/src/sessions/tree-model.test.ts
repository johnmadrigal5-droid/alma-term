import { describe, expect, it } from 'vitest'
import { folder, session, treeOf } from './fixtures'
import { buildRows } from './tree-model'

const clientes = folder('Clientes')
const acme = folder('ACME', clientes.id)
const web = session('Web', acme.id, { host: 'prod-web.acme.com' })
const db = session('Producción DB', clientes.id)
const loose = session('Casa')
const tree = treeOf([acme, clientes], [loose, web, db])

describe('buildRows', () => {
  it('nests expanded folders with depth, folders before sessions, loose sessions last', () => {
    const rows = buildRows(tree, new Set([clientes.id, acme.id]), '', new Map())
    expect(rows.map((r) => [r.kind, r.name, r.depth])).toEqual([
      ['folder', 'Clientes', 0],
      ['folder', 'ACME', 1],
      ['session', 'Web', 2],
      ['session', 'Producción DB', 1],
      ['session', 'Casa', 0],
    ])
  })

  it('hides the children of a closed folder', () => {
    const rows = buildRows(tree, new Set(), '', new Map())
    expect(rows.map((r) => r.name)).toEqual(['Clientes', 'Casa'])
    expect(rows[0]?.expanded).toBe(false)
  })

  it('finds sessions by host and opens their ancestors', () => {
    const rows = buildRows(tree, new Set(), 'prod-web', new Map())
    expect(rows.map((r) => r.name)).toEqual(['Clientes', 'ACME', 'Web'])
    expect(rows.filter((r) => r.kind === 'folder').every((r) => r.expanded)).toBe(true)
  })

  it('ignores case and accents', () => {
    const rows = buildRows(tree, new Set(), 'produccion', new Map())
    expect(rows.map((r) => r.name)).toEqual(['Clientes', 'Producción DB'])
  })

  it('shows user@host as detail and the live tab status', () => {
    const rows = buildRows(tree, new Set(), '', new Map([[loose.id, 'ready' as const]]))
    expect(rows.find((r) => r.id === loose.id)).toMatchObject({
      detail: 'alma@casa.example',
      status: 'ready',
    })
  })
})

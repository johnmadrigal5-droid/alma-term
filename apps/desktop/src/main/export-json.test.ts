import { describe, expect, it } from 'vitest'
import { exportJson } from './export-json'

describe('exportJson', () => {
  it('writes folders and sessions without any secret or credential flag', () => {
    const json = exportJson({
      canRemember: true,
      folders: [{ id: '7d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11', name: 'f', parentId: null, sort: 0 }],
      sessions: [
        {
          id: '8d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11',
          folderId: null,
          name: 'prod',
          host: 'h',
          port: 22,
          username: 'u',
          auth: 'password',
          keyPath: null,
          hasPassword: true,
          hasPassphrase: false,
        },
      ],
    })
    const parsed: unknown = JSON.parse(json)
    expect(parsed).toMatchObject({
      version: 1,
      folders: [{ name: 'f' }],
      sessions: [{ name: 'prod' }],
    })
    for (const word of [
      'secret',
      '"password":',
      'passphrase',
      'hasPassword',
      'hasPassphrase',
      'canRemember',
    ])
      expect(json).not.toContain(word)
  })
})

import { describe, expect, it } from 'vitest'
import { SessionLogConfig } from './session-log-config'

describe('SessionLogConfig', () => {
  it('uses the default folder until the user chooses another', async () => {
    let chosen: string | null = null
    const config = new SessionLogConfig({ logDir: async () => chosen }, '/docs/Alma Term/logs')
    expect(await config.forSession('root@host')).toEqual({
      dir: '/docs/Alma Term/logs',
      name: 'root@host',
    })
    chosen = '/srv/logs'
    expect(await config.dir()).toBe('/srv/logs')
  })
})

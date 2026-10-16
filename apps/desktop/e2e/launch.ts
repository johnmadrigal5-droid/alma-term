import { fileURLToPath } from 'node:url'

const appDir = fileURLToPath(new URL('..', import.meta.url))

export interface LaunchOptions {
  executablePath?: string
  args: string[]
  env: Record<string, string>
}

// ALMA_E2E_EXECUTABLE points the suite at a packaged binary (release/linux-unpacked/alma-term)
// instead of the dev build. Hosts that block unprivileged user namespaces set ALMA_E2E_NO_SANDBOX=1.
export function launchOptions(env: Record<string, string>): LaunchOptions {
  const executablePath = process.env['ALMA_E2E_EXECUTABLE']
  const args = [
    ...(executablePath ? [] : [appDir]),
    ...(process.env['ALMA_E2E_NO_SANDBOX'] === '1' ? ['--no-sandbox'] : []),
  ]
  // The close warning (active transfers or tunnels) answers by itself unless a spec overrides it.
  const withDefaults = { ALMA_E2E_AUTO_CONFIRM_CLOSE: '1', ...env }
  return executablePath ? { executablePath, args, env: withDefaults } : { args, env: withDefaults }
}

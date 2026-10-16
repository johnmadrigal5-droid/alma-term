export function defaultShell(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): { shell: string; args: string[] } {
  if (platform === 'win32') return { shell: 'powershell.exe', args: ['-NoLogo'] }
  return { shell: env['SHELL'] ?? '/bin/bash', args: ['-l'] }
}

const DROPPED = new Set(['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'])

export function buildPtyEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && !DROPPED.has(key)) out[key] = value
  }
  out['TERM'] = 'xterm-256color'
  out['COLORTERM'] = 'truecolor'
  return out
}

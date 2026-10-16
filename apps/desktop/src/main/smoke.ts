export const SMOKE_TIMEOUT_MS = 30_000

/** ALMA_SMOKE_TEST=1 makes the app prove it starts (window loaded, host answering) and exit. */
export function smokeMode(env: Record<string, string | undefined>): boolean {
  return env['ALMA_SMOKE_TEST'] === '1'
}

interface Deps {
  exit(code: number): void
  log(message: string): void
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

type Step = 'loaded' | 'hostReady'

/** Exits 0 when both steps happened, 1 when one fails or 30 s pass without them. */
export function createSmokeGuard(deps: Deps) {
  const seen = new Set<Step>()
  let finished = false
  const finish = (code: number, message: string) => {
    if (finished) return
    finished = true
    deps.clearTimeout(timer)
    deps.log(message)
    deps.exit(code)
  }
  const timer = deps.setTimeout(
    () => finish(1, `ALMA_SMOKE_FAIL: sin arrancar en ${SMOKE_TIMEOUT_MS / 1000} s`),
    SMOKE_TIMEOUT_MS,
  )
  return {
    mark(step: Step): void {
      seen.add(step)
      if (seen.has('loaded') && seen.has('hostReady')) finish(0, 'ALMA_SMOKE_OK')
    },
    fail(reason: string): void {
      finish(1, `ALMA_SMOKE_FAIL: ${reason}`)
    },
  }
}

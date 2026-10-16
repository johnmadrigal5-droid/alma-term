// Dev adds 'unsafe-inline' scripts (Vite React refresh preamble) and the HMR websocket.
export function buildCsp(isDev: boolean): string {
  return [
    "default-src 'none'",
    isDev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    isDev ? "connect-src 'self' ws://localhost:*" : "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}

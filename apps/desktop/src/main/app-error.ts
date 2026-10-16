import type { ErrorCode } from '@alma/protocol'

/** An error main can hand to the renderer as `{ code, message }` without leaking internals. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

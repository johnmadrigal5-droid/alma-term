import { realScheduler, type Scheduler } from '../flow/scheduler'

// Deadline that only counts active time: paused while the user answers a prompt.
export class PhaseTimer {
  private remaining: number
  private startedAt = 0
  private timer: unknown = null
  private done = false

  constructor(
    budgetMs: number,
    private readonly onExpire: () => void,
    private readonly scheduler: Scheduler = realScheduler,
  ) {
    this.remaining = budgetMs
  }

  start(): void {
    if (this.done || this.timer !== null) return
    this.startedAt = this.scheduler.now()
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null
      this.done = true
      this.onExpire()
    }, this.remaining)
  }

  pause(): void {
    if (this.timer === null) return
    this.scheduler.clearTimeout(this.timer)
    this.timer = null
    this.remaining = Math.max(0, this.remaining - (this.scheduler.now() - this.startedAt))
  }

  resume(): void {
    this.start()
  }

  stop(): void {
    this.done = true
    this.scheduler.clearTimeout(this.timer)
    this.timer = null
  }
}

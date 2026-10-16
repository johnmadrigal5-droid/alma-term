export type CrashDecision = 'restart' | 'give-up'

export class RestartPolicy {
  private crashes: number[] = []

  constructor(
    private readonly maxCrashes = 3,
    private readonly windowMs = 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  recordCrash(): CrashDecision {
    const t = this.now()
    this.crashes = this.crashes.filter((c) => t - c < this.windowMs)
    this.crashes.push(t)
    return this.crashes.length > this.maxCrashes ? 'give-up' : 'restart'
  }
}

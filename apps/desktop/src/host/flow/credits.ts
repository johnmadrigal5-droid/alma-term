// Tracks bytes sent to the renderer but not yet drawn; pauses the source above
// `high` and resumes below `low`.
export class CreditGate {
  private unacked = 0
  private paused = false

  constructor(
    private readonly high: number,
    private readonly low: number,
    private readonly onPause: () => void,
    private readonly onResume: () => void,
  ) {}

  get isPaused(): boolean {
    return this.paused
  }

  get pending(): number {
    return this.unacked
  }

  sent(bytes: number): void {
    this.unacked += bytes
    if (!this.paused && this.unacked > this.high) {
      this.paused = true
      this.onPause()
    }
  }

  acked(bytes: number): void {
    this.unacked = Math.max(0, this.unacked - bytes)
    if (this.paused && this.unacked < this.low) {
      this.paused = false
      this.onResume()
    }
  }

  reset(): void {
    this.unacked = 0
    if (this.paused) {
      this.paused = false
      this.onResume()
    }
  }
}

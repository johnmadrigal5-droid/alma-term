import type { Scheduler } from '../flow/scheduler'

interface Task {
  at: number
  fn: () => void
}

export class FakeScheduler implements Scheduler {
  private time = 0
  private nextId = 1
  private readonly tasks = new Map<number, Task>()

  now(): number {
    return this.time
  }

  setTimeout(fn: () => void, ms: number): number {
    const id = this.nextId++
    this.tasks.set(id, { at: this.time + ms, fn })
    return id
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === 'number') this.tasks.delete(handle)
  }

  advance(ms: number): void {
    const target = this.time + ms
    for (;;) {
      let next: [number, Task] | undefined
      for (const entry of this.tasks) {
        if (entry[1].at <= target && (!next || entry[1].at < next[1].at)) next = entry
      }
      if (!next) break
      this.tasks.delete(next[0])
      this.time = next[1].at
      next[1].fn()
    }
    this.time = target
  }
}

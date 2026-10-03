/** Lightweight stage timer for scan/rank performance audits. */
export class StageTimer {
  private readonly t0 = performance.now();
  private readonly marks = new Map<string, number>();
  private lap = this.t0;

  /** End the current lap and attribute it to `stage`. */
  mark(stage: string): void {
    const now = performance.now();
    this.marks.set(stage, (this.marks.get(stage) ?? 0) + (now - this.lap));
    this.lap = now;
  }

  /** Attribute an explicit duration to `stage` (does not move the lap). */
  add(stage: string, ms: number): void {
    this.marks.set(stage, (this.marks.get(stage) ?? 0) + ms);
  }

  async time<T>(stage: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      this.add(stage, performance.now() - start);
      this.lap = performance.now();
    }
  }

  snapshot(): { totalMs: number; stages: Record<string, number> } {
    const stages: Record<string, number> = {};
    for (const [k, v] of this.marks) stages[k] = Math.round(v);
    return { totalMs: Math.round(performance.now() - this.t0), stages };
  }
}

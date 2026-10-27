export class Metrics {
  private readonly counters = new Map<string, number>();
  readonly startedAt = new Date().toISOString();

  increment(name: string, amount = 1): void { this.counters.set(name, (this.counters.get(name) ?? 0) + amount); }
  snapshot(): Record<string, unknown> { return { startedAt: this.startedAt, uptimeSeconds: Math.floor((Date.now() - Date.parse(this.startedAt)) / 1000), counters: Object.fromEntries(this.counters) }; }
}

/** Owner-local maintenance; expired replay payloads must not survive indefinitely. */
export class IdempotencyRetention {
  private timer: ReturnType<typeof setInterval> | undefined;
  private pending: Promise<void> | undefined;

  constructor(
    private readonly purge: () => Promise<unknown>,
    private readonly onError: () => void,
    private readonly intervalMs = 60_000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sweep(), this.intervalMs);
    this.timer.unref();
    void this.sweep();
  }

  sweep(): Promise<void> {
    if (!this.pending) {
      this.pending = Promise.resolve()
        .then(() => this.purge())
        .then(() => undefined)
        .catch(() => this.onError())
        .finally(() => {
          this.pending = undefined;
        });
    }
    return this.pending;
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.pending;
  }
}

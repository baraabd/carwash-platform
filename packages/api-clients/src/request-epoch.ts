/** A browser session boundary: old reads and command continuations cannot join a new login. */
export interface RequestEpochToken {
  readonly generation: number;
  readonly signal: AbortSignal;
}

export class RequestEpoch {
  private generation = 0;
  private controller = new AbortController();

  capture(): RequestEpochToken {
    return { generation: this.generation, signal: this.controller.signal };
  }

  current(token: RequestEpochToken): boolean {
    return token.generation === this.generation && !token.signal.aborted;
  }

  invalidate(): void {
    this.controller.abort();
    this.generation += 1;
    this.controller = new AbortController();
  }
}

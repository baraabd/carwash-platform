/**
 * Structured lifetime for independent owner workers. An unexpected failure
 * cancels the other loops and waits for their leases/ACKs to settle before the
 * caller disconnects the database. Business work and configuration stay local.
 */
export async function runWorkerGroup(
  signal: AbortSignal,
  tasks: readonly ((signal: AbortSignal) => Promise<void>)[],
): Promise<void> {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  try {
    const results = await Promise.allSettled(
      tasks.map(async (task) => {
        try {
          await task(controller.signal);
        } catch (error: unknown) {
          controller.abort();
          throw error;
        }
      }),
    );
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

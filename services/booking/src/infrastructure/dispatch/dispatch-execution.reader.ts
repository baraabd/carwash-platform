import { dispatchExecutionV1 } from '@carwash/contracts';
import type { OwnerHttpClient } from '../http/owner-http.client';

export class DispatchExecutionReader {
  constructor(private readonly http: OwnerHttpClient) {}
  async read(bookingId: string, correlationId: string): Promise<dispatchExecutionV1.ExecutionV1> {
    const result = await this.http.call({
      method: 'GET',
      path: `/internal/v1/dispatch/bookings/${encodeURIComponent(bookingId)}/execution`,
      correlationId,
    });
    if (result.kind !== 'RESPONSE' || result.status !== 200)
      throw new Error('DISPATCH_EXECUTION_UNAVAILABLE');
    const view = dispatchExecutionV1.parseExecutionV1(result.body);
    if (view.bookingId !== bookingId) throw new Error('DISPATCH_BOOKING_MISMATCH');
    return view;
  }
}

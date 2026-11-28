export interface LeasedEntitlementConsumption {
  readonly bookingId: string;
  readonly reservationId: string;
  readonly correlationId: string;
  readonly attempt: number;
}
export interface EntitlementConsumptionQueue {
  lease(workerId: string, limit: number): Promise<readonly LeasedEntitlementConsumption[]>;
  consumed(workerId: string, item: LeasedEntitlementConsumption): Promise<boolean>;
  retry(workerId: string, item: LeasedEntitlementConsumption, error: string): Promise<boolean>;
}

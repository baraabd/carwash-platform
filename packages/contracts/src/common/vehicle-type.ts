/** Vehicle size classes shared by Vehicle (owner), Catalog eligibility and Pricing surcharges. */
export const VEHICLE_TYPES = ['sedan', 'suv', 'large', 'pickup'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

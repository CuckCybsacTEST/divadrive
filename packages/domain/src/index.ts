export const SERVICE_NAME = "DIVA DRIVE";

export const TRIP_STATUSES = [
  "draft",
  "requested",
  "matched",
  "driver_en_route",
  "driver_arrived",
  "trip_started",
  "trip_completed",
  "cancelled",
  "expired"
] as const;

export type TripStatus = (typeof TRIP_STATUSES)[number];

export const TRIP_EVENT_TYPES = [
  "trip_requested",
  "trip_matched",
  "driver_assigned",
  "driver_arrived",
  "trip_started",
  "trip_completed",
  "trip_cancelled",
  "trip_expired",
  "incident_created"
] as const;

export type TripEventType = (typeof TRIP_EVENT_TYPES)[number];

export interface AuditEvent {
  type: TripEventType;
  tripId: string;
  occurredAt: string;
  actorId?: string;
}


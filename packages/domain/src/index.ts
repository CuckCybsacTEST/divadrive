export const SERVICE_NAME = "DIVA DRIVE";
export const DEFAULT_CITY = "Lima";
export const DEFAULT_COUNTRY = "Peru";

export const USER_ROLES = ["passenger", "driver", "operator", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

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

export interface TripTimelineEvent {
  id: string;
  tripId: string;
  type: TripEventType;
  occurredAt: string;
  actorId?: string;
  actorRole?: UserRole;
  message: string;
}

export type IncidentSeverity = "low" | "medium" | "high";
export type IncidentStatus = "open" | "reviewing" | "resolved";
export type IncidentReporterRole = "passenger" | "driver" | "operator";
export type PromotionKind = "flat" | "percentage";
export type PromotionAudience = "all" | "new_passenger" | "returning_passenger";
export type PromotionApplyMode = "automatic" | "code";

export interface TripIncident {
  id: string;
  tripId: string;
  reporterRole: IncidentReporterRole;
  reporterId: string;
  severity: IncidentSeverity;
  category: string;
  notes: string;
  createdAt: string;
  status: IncidentStatus;
}

export interface SessionUser {
  id: string;
  role: UserRole;
  fullName: string;
  phone: string;
  email: string;
}

export type DriverApprovalStatus = "pending" | "approved" | "rejected";
export type DriverAvailabilityStatus = "offline" | "online";

export interface DriverProfile {
  id: string;
  fullName: string;
  phone: string;
  city: string;
  approvalStatus: DriverApprovalStatus;
  availabilityStatus?: DriverAvailabilityStatus;
  lastKnownLocation?: Coordinates;
  lastLocationAt?: string;
  documentsSubmitted: boolean;
  licenseNumber: string;
  vehicleDescription: string;
  createdAt: string;
}

export interface PassengerProfile {
  id: string;
  fullName: string;
  phone: string;
  city: string;
  createdAt: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: string | null;
  user: SessionUser;
}

export const REALTIME_EVENT_TYPES = [
  "session.ready",
  "ops.snapshot.refresh",
  "ops.events.refresh",
  "ops.directory.refresh",
  "business.refresh",
  "commercial.refresh",
  "trip.queue.refresh",
  "trip.active.refresh",
  "trip.history.refresh",
  "trip.timeline.refresh",
  "notifications.refresh",
  "driver.profile.refresh"
] as const;

export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number];

export interface RealtimeEnvelope {
  id: string;
  type: RealtimeEventType;
  occurredAt: string;
  tripId?: string;
  reason?: string;
  trip?: RideTrip;
  timelineEvent?: TripTimelineEvent;
  notification?: OperationalNotification;
  driverProfile?: DriverProfile;
  passengerProfile?: PassengerProfile;
  pricing?: PricingConfig;
  promotion?: Promotion;
  auditEntry?: BusinessAuditEntry;
}

export interface SignInPayload {
  email: string;
  password: string;
}

export interface SignUpPayload extends SignInPayload {
  fullName: string;
  phone: string;
  role: UserRole;
}

export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface RidePoint extends Coordinates {
  label: string;
  address: string;
}

export interface RouteSegment {
  points: Coordinates[];
}

export interface PlaceSearchResult {
  query: string;
  results: RidePoint[];
}

export interface HomeQuickAction {
  id: string;
  label: string;
  hint: string;
}

export interface HomeBootstrap {
  city: string;
  mapRegion: MapRegion;
  quickActions: HomeQuickAction[];
  suggestedDestinations: RidePoint[];
  activeTripStatus: TripStatus | null;
  notifications?: OperationalNotification[];
}

export interface RideEstimateRequest {
  origin: RidePoint;
  destination: RidePoint;
  promoCode?: string;
}

export interface RideEstimate {
  currency: string;
  distanceKm: number;
  durationMinutes: number;
  estimatedFare: number;
  fareBreakdown: FareBreakdown;
  appliedPromotion: AppliedPromotion | null;
  route: RouteSegment;
}

export interface FareBreakdown {
  subtotal: number;
  serviceFee: number;
  discountAmount: number;
  total: number;
}

export interface PricingConfig {
  currency: string;
  baseFare: number;
  perKmRate: number;
  perMinuteRate: number;
  minimumFare: number;
  serviceFee: number;
  surgeMultiplier: number;
}

export interface Promotion {
  id: string;
  name: string;
  code: string;
  kind: PromotionKind;
  audience: PromotionAudience;
  applyMode: PromotionApplyMode;
  value: number;
  minFare: number;
  description: string;
  isActive: boolean;
  createdAt: string;
}

export interface AppliedPromotion {
  promotionId: string;
  name: string;
  code: string;
  discountAmount: number;
}

export type ActiveTripStatus = Extract<
  TripStatus,
  | "requested"
  | "matched"
  | "driver_en_route"
  | "driver_arrived"
  | "trip_started"
  | "trip_completed"
  | "cancelled"
  | "expired"
>;

export const TRIP_REQUEST_TTL_MS = 90_000;
export const TRIP_RESERVATION_TTL_MS = 20_000;

export const getTripRequestExpiresAt = (requestedAt: string) =>
  new Date(new Date(requestedAt).getTime() + TRIP_REQUEST_TTL_MS).toISOString();

export const isTripRequestExpired = (
  trip: Pick<RideTrip, "requestedAt" | "status">,
  now = Date.now()
) => trip.status === "requested" && new Date(trip.requestedAt).getTime() + TRIP_REQUEST_TTL_MS <= now;

export const isTripReservationActive = (
  trip: Pick<RideTrip, "reservedDriverId" | "reservedUntil">,
  now = Date.now()
) =>
  Boolean(
    trip.reservedDriverId &&
      trip.reservedUntil &&
      new Date(trip.reservedUntil).getTime() > now
  );

export const getTripReservationExpiresAt = (now = Date.now()) =>
  new Date(now + TRIP_RESERVATION_TTL_MS).toISOString();

export interface RideTrip {
  id: string;
  passengerId: string;
  passengerName: string;
  origin: RidePoint;
  destination: RidePoint;
  estimate: RideEstimate;
  status: ActiveTripStatus;
  requestedAt: string;
  driverId?: string;
  driverName?: string;
  driverEtaMinutes?: number;
  currentDriverLocation?: Coordinates;
  cancellationReason?: string;
  cancelledByRole?: IncidentReporterRole;
  cancelledAt?: string;
  requestedPromoCode?: string;
  expiresAt?: string;
  reservedDriverId?: string;
  reservedAt?: string;
  reservedUntil?: string;
}

export interface CreateTripRequest extends RideEstimateRequest {
  passengerId: string;
  passengerName: string;
}

export interface DriverQueueSummary {
  queueSize: number;
  activeTrip: RideTrip | null;
  driverProfile: DriverProfile | null;
  notifications?: OperationalNotification[];
}

export interface OpsDashboardSnapshot {
  queueTrips: RideTrip[];
  activeTrips: RideTrip[];
  completedTrips: RideTrip[];
  cancelledTrips: RideTrip[];
  incidents: TripIncident[];
  totals: {
    requested: number;
    active: number;
    completed: number;
    cancelled: number;
    openIncidents: number;
  };
}

export interface BusinessRulesSnapshot {
  pricing: PricingConfig;
  promotions: Promotion[];
  auditLog: BusinessAuditEntry[];
}

export interface PromoPerformance {
  code: string;
  uses: number;
  totalDiscountAmount: number;
}

export interface CommercialMetricsSnapshot {
  totalRevenue: number;
  totalDiscountAmount: number;
  completedTrips: number;
  cancelledTrips: number;
  averageCompletedFare: number;
  promoPerformance: PromoPerformance[];
}

export interface TripHistorySnapshot {
  trips: RideTrip[];
}

export interface TripTimelineSnapshot {
  events: TripTimelineEvent[];
}

export interface OperationalNotification {
  id: string;
  level: "info" | "success" | "warning";
  message: string;
  createdAt: string;
}

export interface BusinessAuditEntry {
  id: string;
  actorId: string;
  actorRole: Extract<UserRole, "operator" | "admin">;
  action: "pricing_updated" | "promotion_created" | "promotion_updated";
  summary: string;
  occurredAt: string;
}

export interface AdminDirectorySnapshot {
  drivers: DriverProfile[];
  passengers: PassengerProfile[];
}

export interface DriverApprovalUpdate {
  approvalStatus: DriverApprovalStatus;
}

export interface DriverAvailabilityUpdate {
  availabilityStatus: DriverAvailabilityStatus;
  currentLocation?: Coordinates;
}

export interface PricingConfigUpdate {
  currency: string;
  baseFare: number;
  perKmRate: number;
  perMinuteRate: number;
  minimumFare: number;
  serviceFee: number;
  surgeMultiplier: number;
}

export interface PromotionUpsertPayload {
  name: string;
  code: string;
  kind: PromotionKind;
  audience: PromotionAudience;
  applyMode: PromotionApplyMode;
  value: number;
  minFare: number;
  description: string;
  isActive: boolean;
}

export interface IncidentStatusUpdate {
  status: IncidentStatus;
}

export interface CreateIncidentPayload {
  tripId: string;
  severity: IncidentSeverity;
  category: string;
  notes: string;
}

export interface CancelTripPayload {
  reason: string;
}

export interface DriverTripStatusUpdate {
  status: Extract<
    ActiveTripStatus,
    "driver_en_route" | "driver_arrived" | "trip_started" | "trip_completed"
  >;
}

export const DRIVER_STATUS_FLOW: DriverTripStatusUpdate["status"][] = [
  "driver_en_route",
  "driver_arrived",
  "trip_started",
  "trip_completed"
];

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  currency: "PEN",
  baseFare: 5.5,
  perKmRate: 1.8,
  perMinuteRate: 0.22,
  minimumFare: 8.5,
  serviceFee: 1.2,
  surgeMultiplier: 1
};

export const DEFAULT_PROMOTIONS: Promotion[] = [
  {
    id: "promo-welcome",
    name: "Bienvenida DIVA",
    code: "DIVA10",
    kind: "percentage",
    audience: "new_passenger",
    applyMode: "automatic",
    value: 10,
    minFare: 12,
    description: "Descuento inicial para activar primeras solicitudes.",
    isActive: true,
    createdAt: "2026-03-10T00:00:00.000Z"
  },
  {
    id: "promo-safe-night",
    name: "Trayecto seguro",
    code: "SAFE5",
    kind: "flat",
    audience: "all",
    applyMode: "code",
    value: 5,
    minFare: 20,
    description: "Incentivo fijo para recorridos de mayor valor.",
    isActive: false,
    createdAt: "2026-03-10T00:00:00.000Z"
  }
];

export const SUGGESTED_DESTINATIONS: RidePoint[] = [
  {
    label: "Larcomar",
    address: "Malecon de la Reserva 610, Miraflores",
    latitude: -12.1317,
    longitude: -77.0301
  },
  {
    label: "Jockey Plaza",
    address: "Av. Javier Prado Este 4200, Santiago de Surco",
    latitude: -12.0866,
    longitude: -76.9765
  },
  {
    label: "Centro Empresarial",
    address: "Av. Victor Andres Belaunde 147, San Isidro",
    latitude: -12.0974,
    longitude: -77.0357
  }
];

export const DEFAULT_HOME_BOOTSTRAP: HomeBootstrap = {
  city: DEFAULT_CITY,
  mapRegion: {
    latitude: -12.0464,
    longitude: -77.0428,
    latitudeDelta: 0.06,
    longitudeDelta: 0.04
  },
  quickActions: [
    {
      id: "home",
      label: "Casa",
      hint: "Guarda una direccion frecuente"
    },
    {
      id: "work",
      label: "Trabajo",
      hint: "Prepara origen rapido para dias laborales"
    },
    {
      id: "safety",
      label: "Seguridad",
      hint: "Comparte tu viaje y revisa soporte"
    }
  ],
  suggestedDestinations: SUGGESTED_DESTINATIONS,
  activeTripStatus: null
};

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

export interface SessionUser {
  id: string;
  role: UserRole;
  fullName: string;
  phone: string;
}

export interface AuthSession {
  accessToken: string;
  user: SessionUser;
}

export interface SignInPayload {
  phone: string;
  role: Extract<UserRole, "passenger" | "driver">;
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
}

export interface RideEstimateRequest {
  origin: RidePoint;
  destination: RidePoint;
}

export interface RideEstimate {
  currency: string;
  distanceKm: number;
  durationMinutes: number;
  estimatedFare: number;
}

export type ActiveTripStatus = Extract<
  TripStatus,
  | "requested"
  | "matched"
  | "driver_en_route"
  | "driver_arrived"
  | "trip_started"
  | "trip_completed"
>;

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
}

export interface CreateTripRequest extends RideEstimateRequest {
  passengerId: string;
  passengerName: string;
}

export interface DriverQueueSummary {
  queueSize: number;
  activeTrip: RideTrip | null;
}

export interface OpsDashboardSnapshot {
  queueTrips: RideTrip[];
  activeTrips: RideTrip[];
  completedTrips: RideTrip[];
  totals: {
    requested: number;
    active: number;
    completed: number;
  };
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

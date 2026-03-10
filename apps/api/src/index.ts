import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";
import {
  DEFAULT_HOME_BOOTSTRAP,
  SERVICE_NAME,
  type AuthSession,
  type RequestedTrip,
  type RideEstimate,
  type RideEstimateRequest,
  TRIP_EVENT_TYPES,
  TRIP_STATUSES
} from "@diva-drive/domain";

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: true
});

const sessions = new Map<string, AuthSession>();
const tripsByPassengerId = new Map<string, RequestedTrip>();
const signInSchema = z.object({
  phone: z.string().min(9),
  role: z.enum(["passenger", "driver"])
});
const ridePointSchema = z.object({
  label: z.string().min(1),
  address: z.string().min(1),
  latitude: z.number(),
  longitude: z.number()
});
const rideEstimateSchema = z.object({
  origin: ridePointSchema,
  destination: ridePointSchema
});
const createTripSchema = rideEstimateSchema.extend({
  passengerId: z.string().min(1)
});

const requireSession = (authorizationHeader?: string) => {
  const token = authorizationHeader?.replace("Bearer ", "");

  if (!token || !sessions.has(token)) {
    return null;
  }

  return sessions.get(token) ?? null;
};

const toRadians = (value: number) => (value * Math.PI) / 180;

const estimateRide = ({ origin, destination }: RideEstimateRequest): RideEstimate => {
  const earthRadiusKm = 6371;
  const deltaLatitude = toRadians(destination.latitude - origin.latitude);
  const deltaLongitude = toRadians(destination.longitude - origin.longitude);
  const latitudeA = toRadians(origin.latitude);
  const latitudeB = toRadians(destination.latitude);

  const haversine =
    Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2) +
    Math.cos(latitudeA) *
      Math.cos(latitudeB) *
      Math.sin(deltaLongitude / 2) *
      Math.sin(deltaLongitude / 2);

  const distanceKm = Number(
    (earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))).toFixed(1)
  );
  const durationMinutes = Math.max(8, Math.round(distanceKm * 3.2));
  const estimatedFare = Number((5.5 + distanceKm * 1.8).toFixed(2));

  return {
    currency: "PEN",
    distanceKm,
    durationMinutes,
    estimatedFare
  };
};

const buildTrackedTrip = (trip: RequestedTrip): RequestedTrip => {
  const elapsedMs = Date.now() - new Date(trip.requestedAt).getTime();

  if (elapsedMs < 12000) {
    return trip;
  }

  if (elapsedMs < 26000) {
    return {
      ...trip,
      status: "matched",
      driverName: "Rosa M.",
      driverEtaMinutes: 6,
      currentDriverLocation: {
        latitude: trip.origin.latitude + 0.015,
        longitude: trip.origin.longitude - 0.012
      }
    };
  }

  return {
    ...trip,
    status: "driver_en_route",
    driverName: "Rosa M.",
    driverEtaMinutes: 3,
    currentDriverLocation: {
      latitude: trip.origin.latitude + 0.006,
      longitude: trip.origin.longitude - 0.005
    }
  };
};

const getTrackedTripForPassenger = (passengerId: string) => {
  const trip = tripsByPassengerId.get(passengerId);
  return trip ? buildTrackedTrip(trip) : null;
};

const createSession = (payload: z.infer<typeof signInSchema>): AuthSession => {
  const idSuffix = payload.phone.replace(/\D/g, "").slice(-4) || "0000";
  const session: AuthSession = {
    accessToken: `demo-${payload.role}-${idSuffix}`,
    user: {
      id: `${payload.role}-${idSuffix}`,
      role: payload.role,
      fullName:
        payload.role === "driver" ? "Conductora Demo" : "Pasajera Demo",
      phone: payload.phone
    }
  };

  sessions.set(session.accessToken, session);
  return session;
};

app.get("/health", async () => {
  return {
    service: SERVICE_NAME,
    status: "ok"
  };
});

app.get("/meta/trips", async () => {
  return {
    statuses: TRIP_STATUSES,
    events: TRIP_EVENT_TYPES
  };
});

app.post("/auth/sign-in", async (request, reply) => {
  const parsedPayload = signInSchema.safeParse(request.body);

  if (!parsedPayload.success) {
    reply.status(400);
    return {
      error: "invalid_sign_in_payload"
    };
  }

  return createSession(parsedPayload.data);
});

app.get("/auth/session", async (request, reply) => {
  const session = requireSession(request.headers.authorization);

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  return session;
});

app.get("/home/passenger", async (request, reply) => {
  const session = requireSession(request.headers.authorization);

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  return {
    ...DEFAULT_HOME_BOOTSTRAP,
    activeTripStatus: getTrackedTripForPassenger(session.user.id)?.status ?? null
  };
});

app.post("/trips/estimate", async (request, reply) => {
  const session = requireSession(request.headers.authorization);

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  const parsedPayload = rideEstimateSchema.safeParse(request.body);

  if (!parsedPayload.success) {
    reply.status(400);
    return {
      error: "invalid_estimate_payload"
    };
  }

  return estimateRide(parsedPayload.data);
});

app.post("/trips", async (request, reply) => {
  const session = requireSession(request.headers.authorization);

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  const parsedPayload = createTripSchema.safeParse(request.body);

  if (!parsedPayload.success) {
    reply.status(400);
    return {
      error: "invalid_trip_payload"
    };
  }

  if (parsedPayload.data.passengerId !== session.user.id) {
    reply.status(403);
    return {
      error: "passenger_mismatch"
    };
  }

  const estimate = estimateRide(parsedPayload.data);
  const trip: RequestedTrip = {
    id: `trip-${Date.now()}`,
    passengerId: parsedPayload.data.passengerId,
    origin: parsedPayload.data.origin,
    destination: parsedPayload.data.destination,
    estimate,
    status: "requested",
    requestedAt: new Date().toISOString()
  };

  tripsByPassengerId.set(session.user.id, trip);
  reply.status(201);
  return trip;
});

app.get("/trips/active", async (request, reply) => {
  const session = requireSession(request.headers.authorization);

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  return {
    trip: getTrackedTripForPassenger(session.user.id)
  };
});

const start = async () => {
  try {
    await app.listen({
      host: "0.0.0.0",
      port: 4000
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();

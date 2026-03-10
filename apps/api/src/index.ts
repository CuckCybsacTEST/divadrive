import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";
import {
  type CancelTripPayload,
  type CreateIncidentPayload,
  DEFAULT_HOME_BOOTSTRAP,
  DRIVER_STATUS_FLOW,
  type OpsDashboardSnapshot,
  SERVICE_NAME,
  type ActiveTripStatus,
  type AuthSession,
  type DriverTripStatusUpdate,
  type RideEstimate,
  type RideEstimateRequest,
  type RideTrip,
  type TripIncident,
  TRIP_EVENT_TYPES,
  TRIP_STATUSES
} from "@diva-drive/domain";
import { readIncidents, writeIncidents } from "./incident-store.js";
import { readTrips, writeTrips } from "./trip-store.js";

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: true
});

const sessions = new Map<string, AuthSession>();
const tripsById = new Map<string, RideTrip>();
const incidentsById = new Map<string, TripIncident>();

const persistTrips = async () => {
  await writeTrips(Array.from(tripsById.values()));
};

const persistIncidents = async () => {
  await writeIncidents(Array.from(incidentsById.values()));
};

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
  passengerId: z.string().min(1),
  passengerName: z.string().min(1)
});
const incidentSchema = z.object({
  tripId: z.string().min(1),
  severity: z.enum(["low", "medium", "high"]),
  category: z.string().min(2),
  notes: z.string().min(4)
});
const cancelTripSchema = z.object({
  reason: z.string().min(3)
});

const driverStatusSchema = z.object({
  status: z.enum(DRIVER_STATUS_FLOW)
});

const requireSession = (authorizationHeader?: string) => {
  const token = authorizationHeader?.replace("Bearer ", "");

  if (!token || !sessions.has(token)) {
    return null;
  }

  return sessions.get(token) ?? null;
};

const requireRole = (
  session: AuthSession | null,
  role: AuthSession["user"]["role"]
) => {
  if (!session || session.user.role !== role) {
    return null;
  }

  return session;
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

const buildDriverLocation = (
  trip: RideTrip,
  status: ActiveTripStatus
) => {
  switch (status) {
    case "matched":
      return {
        latitude: trip.origin.latitude + 0.015,
        longitude: trip.origin.longitude - 0.012
      };
    case "driver_en_route":
      return {
        latitude: trip.origin.latitude + 0.006,
        longitude: trip.origin.longitude - 0.005
      };
    case "driver_arrived":
      return {
        latitude: trip.origin.latitude,
        longitude: trip.origin.longitude
      };
    case "trip_started":
      return {
        latitude: (trip.origin.latitude + trip.destination.latitude) / 2,
        longitude: (trip.origin.longitude + trip.destination.longitude) / 2
      };
    case "trip_completed":
      return {
        latitude: trip.destination.latitude,
        longitude: trip.destination.longitude
      };
    default:
      return undefined;
  }
};

const buildDriverEta = (status: ActiveTripStatus) => {
  switch (status) {
    case "matched":
      return 6;
    case "driver_en_route":
      return 3;
    case "driver_arrived":
      return 0;
    default:
      return undefined;
  }
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

const getPassengerActiveTrip = (passengerId: string) => {
  const trips = Array.from(tripsById.values()).filter(
    (trip) =>
      trip.passengerId === passengerId &&
      trip.status !== "trip_completed" &&
      trip.status !== "cancelled"
  );

  return trips.at(-1) ?? null;
};

const getDriverActiveTrip = (driverId: string) => {
  return (
    Array.from(tripsById.values()).find(
      (trip) =>
        trip.driverId === driverId &&
        trip.status !== "trip_completed" &&
        trip.status !== "cancelled"
    ) ?? null
  );
};

const getDriverQueue = () => {
  return Array.from(tripsById.values()).filter((trip) => trip.status === "requested");
};

const patchTrip = (tripId: string, patch: Partial<RideTrip>) => {
  const currentTrip = tripsById.get(tripId);

  if (!currentTrip) {
    return null;
  }

  const nextTrip = {
    ...currentTrip,
    ...patch
  };

  tripsById.set(tripId, nextTrip);
  return nextTrip;
};

const getOpsSnapshot = (): OpsDashboardSnapshot => {
  const allTrips = Array.from(tripsById.values()).sort((a, b) =>
    b.requestedAt.localeCompare(a.requestedAt)
  );
  const queueTrips = allTrips.filter((trip) => trip.status === "requested");
  const completedTrips = allTrips.filter((trip) => trip.status === "trip_completed");
  const cancelledTrips = allTrips.filter((trip) => trip.status === "cancelled");
  const activeTrips = allTrips.filter(
    (trip) =>
      trip.status !== "requested" &&
      trip.status !== "trip_completed" &&
      trip.status !== "cancelled"
  );
  const incidents = Array.from(incidentsById.values()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );

  return {
    queueTrips,
    activeTrips,
    completedTrips,
    cancelledTrips,
    incidents,
    totals: {
      requested: queueTrips.length,
      active: activeTrips.length,
      completed: completedTrips.length,
      cancelled: cancelledTrips.length,
      openIncidents: incidents.filter((incident) => incident.status !== "resolved").length
    }
  };
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

app.get("/ops/dashboard", async () => {
  return getOpsSnapshot();
});

app.get("/ops/trips", async () => {
  return {
    trips: Array.from(tripsById.values()).sort((a, b) =>
      b.requestedAt.localeCompare(a.requestedAt)
    )
  };
});

app.get("/ops/incidents", async () => {
  return {
    incidents: Array.from(incidentsById.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    )
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
  const session = requireRole(
    requireSession(request.headers.authorization),
    "passenger"
  );

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  return {
    ...DEFAULT_HOME_BOOTSTRAP,
    activeTripStatus: getPassengerActiveTrip(session.user.id)?.status ?? null
  };
});

app.get("/home/driver", async (request, reply) => {
  const session = requireRole(
    requireSession(request.headers.authorization),
    "driver"
  );

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  return {
    city: DEFAULT_HOME_BOOTSTRAP.city,
    queueSize: getDriverQueue().length,
    activeTrip: getDriverActiveTrip(session.user.id)
  };
});

app.post("/trips/estimate", async (request, reply) => {
  const session = requireRole(
    requireSession(request.headers.authorization),
    "passenger"
  );

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
  const session = requireRole(
    requireSession(request.headers.authorization),
    "passenger"
  );

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
  const trip: RideTrip = {
    id: `trip-${Date.now()}`,
    passengerId: parsedPayload.data.passengerId,
    passengerName: parsedPayload.data.passengerName,
    origin: parsedPayload.data.origin,
    destination: parsedPayload.data.destination,
    estimate,
    status: "requested",
    requestedAt: new Date().toISOString()
  };

  tripsById.set(trip.id, trip);
  await persistTrips();
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
    trip:
      session.user.role === "driver"
        ? getDriverActiveTrip(session.user.id)
        : getPassengerActiveTrip(session.user.id)
  };
});

app.post<{ Body: CreateIncidentPayload }>("/incidents", async (request, reply) => {
  const session = requireSession(request.headers.authorization);

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  const parsedPayload = incidentSchema.safeParse(request.body);

  if (!parsedPayload.success) {
    reply.status(400);
    return {
      error: "invalid_incident_payload"
    };
  }

  const trip = tripsById.get(parsedPayload.data.tripId);

  if (!trip) {
    reply.status(404);
    return {
      error: "trip_not_found"
    };
  }

  const incident: TripIncident = {
    id: `incident-${Date.now()}`,
    tripId: trip.id,
    reporterRole:
      session.user.role === "driver" ? "driver" : "passenger",
    reporterId: session.user.id,
    severity: parsedPayload.data.severity,
    category: parsedPayload.data.category,
    notes: parsedPayload.data.notes,
    createdAt: new Date().toISOString(),
    status: "open"
  };

  incidentsById.set(incident.id, incident);
  await persistIncidents();
  reply.status(201);
  return incident;
});

app.post<{ Params: { tripId: string }; Body: CancelTripPayload }>(
  "/trips/:tripId/cancel",
  async (request, reply) => {
    const session = requireSession(request.headers.authorization);

    if (!session) {
      reply.status(401);
      return {
        error: "invalid_session"
      };
    }

    const parsedPayload = cancelTripSchema.safeParse(request.body);

    if (!parsedPayload.success) {
      reply.status(400);
      return {
        error: "invalid_cancel_payload"
      };
    }

    const trip = tripsById.get(request.params.tripId);

    if (!trip) {
      reply.status(404);
      return {
        error: "trip_not_found"
      };
    }

    const sessionCanCancel =
      session.user.role === "passenger"
        ? trip.passengerId === session.user.id
        : trip.driverId === session.user.id;

    if (!sessionCanCancel) {
      reply.status(403);
      return {
        error: "trip_cancel_not_allowed"
      };
    }

    const cancelledTrip = patchTrip(trip.id, {
      status: "cancelled",
      cancellationReason: parsedPayload.data.reason,
      cancelledByRole:
        session.user.role === "driver" ? "driver" : "passenger",
      cancelledAt: new Date().toISOString(),
      driverEtaMinutes: undefined,
      currentDriverLocation: undefined
    });

    await persistTrips();
    return cancelledTrip;
  }
);

app.get("/driver/trips/queue", async (request, reply) => {
  const session = requireRole(
    requireSession(request.headers.authorization),
    "driver"
  );

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  return {
    trips: getDriverQueue()
  };
});

app.post<{ Params: { tripId: string } }>(
  "/driver/trips/:tripId/accept",
  async (request, reply) => {
    const session = requireRole(
      requireSession(request.headers.authorization),
      "driver"
    );

    if (!session) {
      reply.status(401);
      return {
        error: "invalid_session"
      };
    }

    if (getDriverActiveTrip(session.user.id)) {
      reply.status(409);
      return {
        error: "driver_already_has_active_trip"
      };
    }

    const trip = tripsById.get(request.params.tripId);

    if (!trip || trip.status !== "requested") {
      reply.status(404);
      return {
        error: "trip_not_available"
      };
    }

    const acceptedTrip = patchTrip(trip.id, {
      status: "matched",
      driverId: session.user.id,
      driverName: session.user.fullName,
      driverEtaMinutes: buildDriverEta("matched"),
      currentDriverLocation: buildDriverLocation(trip, "matched")
    });
    await persistTrips();
    return acceptedTrip;
  }
);

app.post<{ Params: { tripId: string }; Body: DriverTripStatusUpdate }>(
  "/driver/trips/:tripId/status",
  async (request, reply) => {
    const session = requireRole(
      requireSession(request.headers.authorization),
      "driver"
    );

    if (!session) {
      reply.status(401);
      return {
        error: "invalid_session"
      };
    }

    const trip = tripsById.get(request.params.tripId);

    if (!trip || trip.driverId !== session.user.id) {
      reply.status(404);
      return {
        error: "trip_not_found_for_driver"
      };
    }

    const parsedPayload = driverStatusSchema.safeParse(request.body);

    if (!parsedPayload.success) {
      reply.status(400);
      return {
        error: "invalid_status_payload"
      };
    }

    const currentIndex = DRIVER_STATUS_FLOW.indexOf(
      trip.status as DriverTripStatusUpdate["status"]
    );
    const nextIndex = DRIVER_STATUS_FLOW.indexOf(parsedPayload.data.status);

    if (trip.status === "matched" && parsedPayload.data.status !== "driver_en_route") {
      reply.status(409);
      return {
        error: "invalid_status_transition"
      };
    }

    if (trip.status !== "matched" && nextIndex !== currentIndex + 1) {
      reply.status(409);
      return {
        error: "invalid_status_transition"
      };
    }

    const nextStatus = parsedPayload.data.status;

    const updatedTrip = patchTrip(trip.id, {
      status: nextStatus,
      driverEtaMinutes: buildDriverEta(nextStatus),
      currentDriverLocation: buildDriverLocation(trip, nextStatus)
    });
    await persistTrips();
    return updatedTrip;
  }
);

const start = async () => {
  try {
    const persistedTrips = await readTrips();
    for (const trip of persistedTrips) {
      tripsById.set(trip.id, trip);
    }
    const persistedIncidents = await readIncidents();
    for (const incident of persistedIncidents) {
      incidentsById.set(incident.id, incident);
    }
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

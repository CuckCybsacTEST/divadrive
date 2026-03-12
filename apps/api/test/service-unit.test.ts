import assert from "node:assert/strict";
import test from "node:test";
import type {
  AuthSession,
  BusinessAuditEntry,
  DriverProfile,
  OperationalZone,
  PricingConfig,
  Promotion,
  RealtimeEnvelope,
  RidePoint,
  RideTrip,
  TripIncident,
  TripTimelineEvent
} from "@diva-drive/domain";
import { createBusinessService } from "../src/services/business-service.js";
import { createOpsService } from "../src/services/ops-service.js";
import { createRealtimeService } from "../src/services/realtime-service.js";
import { createTripService } from "../src/services/trip-service.js";
import {
  createBusinessRepositoryDouble,
  createDirectoryRepositoryDouble,
  createTripRepositoryDouble
} from "./helpers/repository-doubles.js";

const origin: RidePoint = {
  label: "Larcomar",
  address: "Malecon de la Reserva 610, Miraflores",
  latitude: -12.1317,
  longitude: -77.0301
};

const destination: RidePoint = {
  label: "Jockey Plaza",
  address: "Av. Javier Prado Este 4200, Santiago de Surco",
  latitude: -12.0866,
  longitude: -76.9765
};

const basePricing: PricingConfig = {
  currency: "PEN",
  baseFare: 8,
  perKmRate: 2.5,
  perMinuteRate: 0.4,
  minimumFare: 12,
  serviceFee: 1.5,
  surgeMultiplier: 1,
  driverPayoutRate: 0.82
};

const defaultOperationalZone: OperationalZone = {
  id: "lima-central",
  name: "Lima Metropolitana",
  center: {
    latitude: -12.0464,
    longitude: -77.0428
  },
  radiusKm: 18,
  isActive: true
};

const passengerSession: AuthSession = {
  accessToken: "token-passenger",
  refreshToken: "refresh-passenger",
  expiresAt: null,
  user: {
    id: "passenger-1",
    role: "passenger",
    fullName: "Pasajera Demo",
    phone: "999111222",
    email: "passenger@test.dev"
  }
};

const driverSession: AuthSession = {
  accessToken: "token-driver",
  refreshToken: "refresh-driver",
  expiresAt: null,
  user: {
    id: "driver-1",
    role: "driver",
    fullName: "Conductora Demo",
    phone: "999333444",
    email: "driver@test.dev"
  }
};

const driverProfile: DriverProfile = {
  id: "driver-1",
  fullName: "Conductora Demo",
  phone: "999333444",
  city: "Lima",
  approvalStatus: "approved",
  documentsSubmitted: true,
  licenseNumber: "LIC-1001",
  vehicleDescription: "Sedan blanco",
  createdAt: "2026-03-11T10:00:00.000Z"
};

const buildTrip = (
  patch: Partial<RideTrip> = {},
  requestedAt = "2026-03-11T10:00:00.000Z"
): RideTrip => ({
  id: `trip-${requestedAt}`,
  passengerId: "passenger-1",
  passengerName: "Pasajera Demo",
  origin,
  destination,
  estimate: {
    currency: "PEN",
    distanceKm: 6.5,
    durationMinutes: 22,
    estimatedFare: 25,
    fareBreakdown: {
      subtotal: 22,
      serviceFee: 1.5,
      discountAmount: 1.5,
      total: 25
    },
    appliedPromotion: null,
    route: {
      points: [origin, destination]
    }
  },
  status: "requested",
  requestedAt,
  ...patch
});

const buildPromotion = (patch: Partial<Promotion> = {}): Promotion => ({
  id: "promo-1",
  name: "Promo Demo",
  code: "DIVA10",
  kind: "flat",
  audience: "all",
  applyMode: "code",
  value: 10,
  minFare: 20,
  description: "Promo de prueba",
  isActive: true,
  createdAt: "2026-03-11T10:00:00.000Z",
  ...patch
});

const buildTimelineEvent = (
  patch: Partial<TripTimelineEvent> = {},
  occurredAt = "2026-03-11T10:10:00.000Z"
): TripTimelineEvent => ({
  id: `event-${occurredAt}`,
  tripId: "trip-1",
  type: "driver_assigned",
  occurredAt,
  actorId: "driver-1",
  actorRole: "driver",
  message: "Conductora en camino",
  ...patch
});

test("business service hydrates state, appends audit and applies the best eligible promotion", async () => {
  let currentPricing = { ...basePricing };
  let currentOperationalZones: OperationalZone[] = [];
  const businessAuditLog: BusinessAuditEntry[] = [];
  const promotionsById = new Map<string, Promotion>();
  const tripRepository = createTripRepositoryDouble({
    listTripsByPassenger: async () => [buildTrip()]
  });
  const businessRepository = createBusinessRepositoryDouble(basePricing, {
    getPricingConfig: () => currentPricing,
    getOperationalZones: () => currentOperationalZones,
    cacheOperationalZones: (zones) => {
      currentOperationalZones = [...zones];
      return zones;
    },
    cachePricingConfig: (pricingConfig) => {
      currentPricing = pricingConfig;
      return pricingConfig;
    },
    cachePromotion: (promotion) => {
      promotionsById.set(promotion.id, promotion);
      return promotion;
    },
    cacheBusinessAuditEntry: (entry) => {
      businessAuditLog.unshift(entry);
      return entry;
    },
    hydrateSnapshot: (snapshot) => {
      currentPricing = snapshot.pricing;
      currentOperationalZones = [...snapshot.operationalZones];
      promotionsById.clear();
      for (const promotion of snapshot.promotions) {
        promotionsById.set(promotion.id, promotion);
      }
      businessAuditLog.length = 0;
      businessAuditLog.push(...snapshot.auditLog);
      return {
        pricing: currentPricing,
        operationalZones: snapshot.operationalZones,
        promotions: Array.from(promotionsById.values()).sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt)
        ),
        auditLog: [...businessAuditLog]
      };
    },
    listPromotions: () =>
      Array.from(promotionsById.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    listBusinessAuditEntries: () => [...businessAuditLog],
    listOperationalZones: () => [...currentOperationalZones]
  });

  const service = createBusinessService({
    businessRepository,
    tripRepository
  });

  const snapshot = service.hydrateBusinessState({
    pricing: { ...basePricing, surgeMultiplier: 1.3 },
    promotions: [
      buildPromotion(),
      buildPromotion({
        id: "promo-2",
        code: "VIP20",
        kind: "percentage",
        value: 20,
        audience: "returning_passenger",
        applyMode: "code",
        createdAt: "2026-03-11T11:00:00.000Z"
      })
    ],
    operationalZones: [defaultOperationalZone],
    auditLog: []
  });

  assert.equal(snapshot.pricing.surgeMultiplier, 1.3);
  assert.equal(snapshot.operationalZones[0]?.id, defaultOperationalZone.id);
  assert.equal(snapshot.promotions[0]?.id, "promo-2");

  const auditEntry = service.appendBusinessAudit(
    passengerSession,
    "promotion_updated",
    "Promo actualizada"
  );
  assert.equal(auditEntry.actorId, passengerSession.user.id);
  assert.equal(businessAuditLog[0]?.summary, "Promo actualizada");

  const estimate = await service.estimateRide(
    {
      origin,
      destination,
      promoCode: "VIP20"
    },
    passengerSession.user.id
  );

  assert.equal(estimate.appliedPromotion?.code, "VIP20");
  assert.ok(estimate.fareBreakdown.discountAmount > 0);
  assert.equal(estimate.route.points.length, 6);
  assert.equal(estimate.estimatedFare, estimate.fareBreakdown.total);
  assert.equal(service.resolveOperationalZone(origin, destination)?.id, defaultOperationalZone.id);
});

test("trip service resolves cache, creates timeline events and personalizes driver notifications", async () => {
  const tripsById = new Map<string, RideTrip>();
  const persistedTrip = buildTrip({
    id: "trip-1",
    status: "matched",
    driverId: driverSession.user.id,
    driverName: driverSession.user.fullName
  });
  const completedTrip = buildTrip({
    id: "trip-completed",
    status: "trip_completed",
    driverId: driverSession.user.id,
    driverName: driverSession.user.fullName,
    estimate: {
      ...buildTrip().estimate,
      estimatedFare: 32,
      fareBreakdown: {
        subtotal: 30,
        serviceFee: 2,
        discountAmount: 0,
        total: 32
      }
    }
  });
  const eventStore = [
    buildTimelineEvent({}, "2026-03-11T10:10:00.000Z"),
    buildTimelineEvent(
      { id: "event-2", type: "trip_completed", message: "Viaje completado" },
      "2026-03-11T10:20:00.000Z"
    ),
    buildTimelineEvent(
      { id: "event-3", type: "incident_created", actorRole: "passenger", message: "Incidencia reportada" },
      "2026-03-11T10:30:00.000Z"
    )
  ];
  const tripEventsById = new Map<string, TripTimelineEvent>();
  const driverProfilesById = new Map<string, DriverProfile>();
  const directoryRepository = createDirectoryRepositoryDouble({
    getDriverProfileById: async () => {
      driverProfilesById.set(driverProfile.id, driverProfile);
      return driverProfile;
    }
  });
  const tripRepository = createTripRepositoryDouble({
    getTripById: async () => {
      tripsById.set(persistedTrip.id, persistedTrip);
      return persistedTrip;
    },
    listEventsByTrip: async () => eventStore,
    listRecentEvents: async () => eventStore,
    listTrips: async () => [persistedTrip, completedTrip],
    listTripsByDriver: async () => [persistedTrip, completedTrip],
    listTripsByPassenger: async () => [persistedTrip],
    listTripsByStatus: async () => [persistedTrip],
    patchCachedTrip: (tripId, patch) => {
      const nextTrip = { ...(tripsById.get(tripId) ?? persistedTrip), ...patch };
      tripsById.set(tripId, nextTrip);
      return nextTrip;
    },
    appendEvent: async (event) => {
      tripEventsById.set(event.id, event);
      return event;
    }
  });

  const service = createTripService({
    getOperationalZones: () => [defaultOperationalZone],
    getPricingConfig: () => basePricing,
    directoryRepository,
    tripRepository
  });

  const activePassengerTrip = await service.getPassengerActiveTrip(passengerSession.user.id);
  assert.equal(activePassengerTrip?.id, "trip-1");

  const resolvedDriverProfile = await service.getDriverProfileById(driverProfile.id);
  assert.equal(resolvedDriverProfile?.licenseNumber, driverProfile.licenseNumber);

  const patchedTrip = service.patchTrip("trip-1", { status: "driver_arrived" });
  assert.equal(patchedTrip?.status, "driver_arrived");

  const createdEvent = await service.createTripEvent({
    tripId: "trip-1",
    type: "trip_started",
    occurredAt: "2026-03-11T10:40:00.000Z",
    actorId: "driver-1",
    actorRole: "driver",
    message: "Viaje iniciado"
  });
  assert.match(createdEvent.id, /^event-/);

  const timeline = await service.getTripTimeline("trip-1");
  assert.equal(timeline.events[0]?.id, "event-3");

  const notifications = await service.getRecentOperationalNotifications(
    driverSession,
    persistedTrip
  );
  assert.equal(notifications.length, 3);
  assert.equal(notifications[0]?.level, "warning");
  assert.match(notifications[2]?.message ?? "", /^Tu actualizacion:/);

  const earnings = await service.getDriverEarnings(driverSession.user.id);
  assert.equal(earnings.completedTrips, 1);
  assert.equal(earnings.grossEarnings, completedTrip.estimate.estimatedFare);
});

test("trip service expires stale requested trips and emits a timeline event", async () => {
  const staleTrip = buildTrip(
    {
      id: "trip-stale"
    },
    "2026-03-11T09:00:00.000Z"
  );
  const savedTrips: RideTrip[] = [];
  const savedEvents: TripTimelineEvent[] = [];

  const service = createTripService({
    getOperationalZones: () => [defaultOperationalZone],
    getPricingConfig: () => basePricing,
    directoryRepository: createDirectoryRepositoryDouble(),
    tripRepository: createTripRepositoryDouble({
      listTripsByStatus: async () => [staleTrip],
      saveTrip: async (trip) => {
        savedTrips.push(trip);
        return trip;
      },
      patchCachedTrip: (_tripId, patch) => ({
        ...staleTrip,
        ...patch
      }),
      appendEvent: async (event) => {
        savedEvents.push(event);
        return event;
      }
    })
  });

  const expiredTrips = await service.expireStaleRequestedTrips();

  assert.equal(expiredTrips.length, 1);
  assert.equal(expiredTrips[0]?.trip.status, "expired");
  assert.equal(savedTrips[0]?.status, "expired");
  assert.equal(savedEvents[0]?.type, "trip_expired");
});

test("driver queue is ordered by proximity when the driver has a last known location", async () => {
  const freshRequestedAt = new Date().toISOString();
  const nearestTrip = buildTrip(
    {
      id: "trip-near",
      requestedAt: freshRequestedAt,
      origin: {
        ...origin,
        latitude: -12.1318,
        longitude: -77.0302
      }
    },
    freshRequestedAt
  );
  const farTrip = buildTrip(
    {
      id: "trip-far",
      requestedAt: freshRequestedAt,
      origin: {
        ...origin,
        latitude: -12.08,
        longitude: -76.97
      }
    },
    freshRequestedAt
  );

  const service = createTripService({
    getOperationalZones: () => [defaultOperationalZone],
    getPricingConfig: () => basePricing,
    directoryRepository: createDirectoryRepositoryDouble({
      getDriverProfileById: async () => ({
        ...driverProfile,
        availabilityStatus: "online",
        lastKnownLocation: {
          latitude: -12.1317,
          longitude: -77.0301
        }
      })
    }),
    tripRepository: createTripRepositoryDouble({
      getTripById: async (tripId) => [farTrip, nearestTrip].find((trip) => trip.id === tripId) ?? null,
      listTripsByStatus: async (status) =>
        [farTrip, nearestTrip].filter((trip) => trip.status === status),
      saveTrip: async (trip) => trip,
      patchCachedTrip: (tripId, patch) => ({
        ...([farTrip, nearestTrip].find((trip) => trip.id === tripId) as RideTrip),
        ...patch
      })
    })
  });

  const queue = await service.getDriverQueue(driverProfile.id);

  assert.equal(queue.trips.length, 1);
  assert.equal(queue.trips[0]?.id, "trip-near");
  assert.equal(queue.trips[0]?.reservedDriverId, driverProfile.id);
  assert.equal(queue.reassignedOffers.length, 0);
});

test("driver queue hides trips reserved for another driver during the reservation window", async () => {
  const sharedTrip = buildTrip({
    id: "trip-shared",
    requestedAt: new Date().toISOString()
  });
  let mutableTrips: RideTrip[] = [sharedTrip];
  const getMutableTripById = (tripId: string) =>
    mutableTrips.find((trip) => trip.id === tripId) ?? null;

  const service = createTripService({
    getOperationalZones: () => [defaultOperationalZone],
    getPricingConfig: () => basePricing,
    directoryRepository: createDirectoryRepositoryDouble({
      getDriverProfileById: async (driverId) => ({
        ...driverProfile,
        id: driverId,
        availabilityStatus: "online",
        lastKnownLocation: {
          latitude: -12.1317,
          longitude: -77.0301
        }
      })
    }),
    tripRepository: createTripRepositoryDouble({
      getTripById: async (tripId) => getMutableTripById(tripId),
      listTripsByStatus: async (status) => mutableTrips.filter((trip) => trip.status === status),
      saveTrip: async (trip) => {
        mutableTrips = mutableTrips.map((currentTrip) =>
          currentTrip.id === trip.id ? trip : currentTrip
        );
        return getMutableTripById(trip.id) ?? trip;
      },
      patchCachedTrip: (tripId, patch) => {
        const currentTrip = getMutableTripById(tripId);
        if (!currentTrip) {
          return null;
        }

        const nextTrip = {
          ...currentTrip,
          ...patch
        };
        mutableTrips = mutableTrips.map((trip) => (trip.id === tripId ? nextTrip : trip));
        return nextTrip;
      }
    })
  });

  const firstDriverQueue = await service.getDriverQueue("driver-1");
  const secondDriverQueue = await service.getDriverQueue("driver-2");

  assert.equal(firstDriverQueue.trips.length, 1);
  assert.equal(mutableTrips[0]?.reservedDriverId, "driver-1");
  assert.equal(secondDriverQueue.trips.length, 0);
  assert.equal(secondDriverQueue.reassignedOffers.length, 0);
});

test("expired reservation escalates to the next eligible driver and recycles after exhaustion", async () => {
  const now = Date.now();
  let mutableTrip = buildTrip({
    id: "trip-escalation",
    requestedAt: new Date(now - 5_000).toISOString(),
    reservedDriverId: "driver-1",
    reservedAt: new Date(now - 30_000).toISOString(),
    reservedUntil: new Date(now - 10_000).toISOString(),
    offeredDriverIds: ["driver-1"]
  });
  const driverOne = {
    ...driverProfile,
    id: "driver-1",
    approvalStatus: "approved" as const,
    availabilityStatus: "online" as const,
    lastKnownLocation: {
      latitude: -12.1317,
      longitude: -77.0301
    }
  };
  const driverTwo = {
    ...driverProfile,
    id: "driver-2",
    approvalStatus: "approved" as const,
    availabilityStatus: "online" as const,
    lastKnownLocation: {
      latitude: -12.13175,
      longitude: -77.03015
    }
  };

  const service = createTripService({
    getOperationalZones: () => [defaultOperationalZone],
    getPricingConfig: () => basePricing,
    directoryRepository: createDirectoryRepositoryDouble({
      getDriverProfileById: async (driverId) =>
        [driverOne, driverTwo].find((driver) => driver.id === driverId) ?? null,
      listDriverProfiles: async () => [driverOne, driverTwo]
    }),
    tripRepository: createTripRepositoryDouble({
      getTripById: async () => mutableTrip,
      listTripsByStatus: async (status) => (mutableTrip.status === status ? [mutableTrip] : []),
      saveTrip: async (trip) => {
        mutableTrip = trip;
        return trip;
      },
      patchCachedTrip: (_tripId, patch) => ({
        ...mutableTrip,
        ...patch
      })
    })
  });

  const firstDriverQueue = await service.getDriverQueue("driver-1");
  assert.equal(firstDriverQueue.trips.length, 0);

  const secondDriverQueue = await service.getDriverQueue("driver-2");
  assert.equal(secondDriverQueue.trips.length, 1);
  assert.equal(secondDriverQueue.trips[0]?.reservedDriverId, "driver-2");
  assert.deepEqual(secondDriverQueue.trips[0]?.offeredDriverIds, ["driver-1", "driver-2"]);
  assert.equal(secondDriverQueue.reassignedOffers.length, 1);
  assert.equal(secondDriverQueue.reassignedOffers[0]?.timelineEvent.type, "trip_offer_reassigned");

  mutableTrip = {
    ...mutableTrip,
    reservedDriverId: "driver-2",
    reservedAt: new Date(now - 25_000).toISOString(),
    reservedUntil: new Date(now - 5_000).toISOString()
  };

  const recycledQueue = await service.getDriverQueue("driver-1");
  assert.equal(recycledQueue.trips.length, 1);
  assert.equal(recycledQueue.trips[0]?.reservedDriverId, "driver-1");
  assert.deepEqual(recycledQueue.trips[0]?.offeredDriverIds, ["driver-1"]);
  assert.equal(recycledQueue.reassignedOffers.length, 0);
});

test("driver queue excludes trips outside the driver's operational zone", async () => {
  const freshRequestedAt = new Date().toISOString();
  const inZoneTrip = buildTrip({
    id: "trip-in-zone",
    requestedAt: freshRequestedAt,
    operationalZoneId: defaultOperationalZone.id
  });
  const outOfZoneTrip = buildTrip({
    id: "trip-out-zone",
    requestedAt: freshRequestedAt,
    operationalZoneId: "callao-norte"
  });

  const service = createTripService({
    getOperationalZones: () => [
      defaultOperationalZone,
      {
        id: "callao-norte",
        name: "Callao Norte",
        center: {
          latitude: -11.98,
          longitude: -77.15
        },
        radiusKm: 5,
        isActive: true
      }
    ],
    getPricingConfig: () => basePricing,
    directoryRepository: createDirectoryRepositoryDouble({
      getDriverProfileById: async () => ({
        ...driverProfile,
        availabilityStatus: "online",
        lastKnownLocation: {
          latitude: -12.1317,
          longitude: -77.0301
        }
      })
    }),
    tripRepository: createTripRepositoryDouble({
      getTripById: async (tripId) =>
        [inZoneTrip, outOfZoneTrip].find((trip) => trip.id === tripId) ?? null,
      listTripsByStatus: async (status) =>
        [inZoneTrip, outOfZoneTrip].filter((trip) => trip.status === status),
      saveTrip: async (trip) => trip,
      patchCachedTrip: (tripId, patch) => ({
        ...([inZoneTrip, outOfZoneTrip].find((trip) => trip.id === tripId) as RideTrip),
        ...patch
      })
    })
  });

  const queue = await service.getDriverQueue(driverProfile.id);

  assert.equal(queue.trips.length, 1);
  assert.equal(queue.trips[0]?.id, "trip-in-zone");
});

test("ops service computes dashboard totals and commercial metrics from trip and incident state", async () => {
  const completedTrip = buildTrip(
    {
      id: "trip-completed",
      status: "trip_completed",
      estimate: {
        ...buildTrip().estimate,
        estimatedFare: 32,
        fareBreakdown: {
          subtotal: 30,
          serviceFee: 2,
          discountAmount: 5,
          total: 32
        },
        appliedPromotion: {
          promotionId: "promo-1",
          name: "Promo Demo",
          code: "DIVA10",
          discountAmount: 5
        }
      }
    },
    "2026-03-11T11:00:00.000Z"
  );
  const activeTrip = buildTrip(
    {
      id: "trip-active",
      status: "driver_en_route",
      driverId: "driver-1",
      operationalZoneId: defaultOperationalZone.id,
      offeredDriverIds: ["driver-1", "driver-2"],
      estimate: {
        ...buildTrip().estimate,
        fareBreakdown: {
          subtotal: 22,
          serviceFee: 1.5,
          discountAmount: 0,
          total: 23.5
        },
        estimatedFare: 23.5
      }
    },
    "2026-03-11T12:00:00.000Z"
  );
  const cancelledTrip = buildTrip(
    {
      id: "trip-cancelled",
      status: "cancelled",
      estimate: {
        ...buildTrip().estimate,
        fareBreakdown: {
          subtotal: 22,
          serviceFee: 1.5,
          discountAmount: 0,
          total: 23.5
        },
        estimatedFare: 23.5
      }
    },
    "2026-03-11T09:00:00.000Z"
  );
  const reservedTrip = buildTrip(
    {
      id: "trip-reserved",
      status: "requested",
      operationalZoneId: defaultOperationalZone.id,
      reservedDriverId: "driver-2",
      reservedAt: new Date(Date.now() - 5_000).toISOString(),
      reservedUntil: new Date(Date.now() + 60_000).toISOString(),
      offeredDriverIds: ["driver-1", "driver-2"],
      estimate: {
        ...buildTrip().estimate,
        fareBreakdown: {
          subtotal: 22,
          serviceFee: 1.5,
          discountAmount: 0,
          total: 23.5
        },
        estimatedFare: 23.5
      }
    },
    new Date().toISOString()
  );
  const expiredTrip = buildTrip(
    {
      id: "trip-expired",
      status: "expired",
      operationalZoneId: defaultOperationalZone.id,
      estimate: {
        ...buildTrip().estimate,
        fareBreakdown: {
          subtotal: 22,
          serviceFee: 1.5,
          discountAmount: 0,
          total: 23.5
        },
        estimatedFare: 23.5
      }
    },
    "2026-03-11T08:00:00.000Z"
  );
  const incidents: TripIncident[] = [
    {
      id: "incident-open",
      tripId: activeTrip.id,
      reporterRole: "passenger",
      reporterId: "passenger-1",
      severity: "medium",
      category: "ops",
      notes: "Pendiente",
      createdAt: "2026-03-11T12:10:00.000Z",
      status: "open"
    },
    {
      id: "incident-resolved",
      tripId: completedTrip.id,
      reporterRole: "driver",
      reporterId: "driver-1",
      severity: "low",
      category: "ops",
      notes: "Cerrada",
      createdAt: "2026-03-11T11:10:00.000Z",
      status: "resolved"
    }
  ];
  const eventsByTripId = new Map<string, TripTimelineEvent[]>([
    [
      completedTrip.id,
      [
        buildTimelineEvent(
          {
            id: "event-match-completed",
            tripId: completedTrip.id,
            type: "trip_matched",
            occurredAt: "2026-03-11T11:01:00.000Z",
            message: "Match completado"
          },
          "2026-03-11T11:01:00.000Z"
        )
      ]
    ],
    [
      activeTrip.id,
      [
        buildTimelineEvent(
          {
            id: "event-reassigned",
            tripId: activeTrip.id,
            type: "trip_offer_reassigned",
            occurredAt: "2026-03-11T12:00:20.000Z",
            message: "Oferta reasignada"
          },
          "2026-03-11T12:00:20.000Z"
        ),
        buildTimelineEvent(
          {
            id: "event-match-active",
            tripId: activeTrip.id,
            type: "trip_matched",
            occurredAt: "2026-03-11T12:01:30.000Z",
            message: "Match activo"
          },
          "2026-03-11T12:01:30.000Z"
        )
      ]
    ]
  ]);

  const service = createOpsService({
    businessRepository: createBusinessRepositoryDouble(basePricing, {
      listOperationalZones: () => [defaultOperationalZone]
    }),
    directoryRepository: createDirectoryRepositoryDouble({
      listDriverProfiles: async () => [
        {
          ...driverProfile,
          id: "driver-1",
          fullName: "Conductora Uno",
          approvalStatus: "approved",
          availabilityStatus: "online"
        },
        {
          ...driverProfile,
          id: "driver-2",
          fullName: "Conductora Dos",
          approvalStatus: "approved",
          availabilityStatus: "online"
        }
      ]
    }),
    tripRepository: createTripRepositoryDouble({
      listIncidents: async () => incidents,
      listEventsByTrip: async (tripId) => eventsByTripId.get(tripId) ?? [],
      listRecentEvents: async () => [buildTimelineEvent()],
      listTrips: async () => [activeTrip, completedTrip, cancelledTrip, reservedTrip, expiredTrip],
      listTripsByDriver: async () => [activeTrip],
      listTripsByPassenger: async () => [activeTrip, completedTrip, cancelledTrip],
      listTripsByStatus: async (status) =>
        [completedTrip, activeTrip, cancelledTrip, reservedTrip, expiredTrip].filter(
          (trip) => trip.status === status
        )
    })
  });

  const snapshot = await service.getOpsSnapshot();
  assert.equal(snapshot.totals.active, 1);
  assert.equal(snapshot.totals.completed, 1);
  assert.equal(snapshot.totals.cancelled, 1);
  assert.equal(snapshot.totals.openIncidents, 1);

  const metrics = await service.getCommercialMetrics();
  assert.equal(metrics.totalRevenue, 32);
  assert.equal(metrics.totalDiscountAmount, 5);
  assert.equal(metrics.averageCompletedFare, 32);
  assert.equal(metrics.matchedTrips, 2);
  assert.equal(metrics.expiredRequests, 1);
  assert.equal(metrics.pendingReservedTrips, 1);
  assert.equal(metrics.reassignedOffers, 1);
  assert.equal(metrics.averageSecondsToMatch, 75);
  assert.equal(metrics.zoneHealth[0]?.zoneId, defaultOperationalZone.id);
  assert.equal(metrics.zoneHealth[0]?.expiredRequests, 1);
  assert.ok(metrics.driverAttention.some((driver) => driver.driverId === "driver-1"));
  assert.ok(metrics.driverAttention.some((driver) => driver.driverId === "driver-2"));
  assert.equal(
    metrics.driverAttention.find((driver) => driver.driverId === "driver-2")?.activeReservations,
    1
  );
  assert.equal(metrics.promoPerformance[0]?.code, "DIVA10");

  const events = await service.getOpsEventStream();
  assert.equal(events.length, 1);
});

test("realtime service fans out expected events and deduplicates repeated publications", async () => {
  const published: Array<{
    event: Omit<RealtimeEnvelope, "id" | "occurredAt">;
    targets: { ops?: boolean; userIds?: string[]; roles?: string[] };
  }> = [];
  const trip = buildTrip({
    id: "trip-rt",
    status: "matched",
    driverId: "driver-1"
  });
  const timelineEvent = buildTimelineEvent({
    id: "event-rt",
    tripId: trip.id,
    message: "Conductora asignada"
  });

  const realtimeHub = {
    register: async () => undefined,
    publish: (
      event: Omit<RealtimeEnvelope, "id" | "occurredAt">,
      targets: { ops?: boolean; userIds?: string[]; roles?: string[] }
    ) => {
      published.push({ event, targets });
    },
    close: async () => undefined
  };

  const service = createRealtimeService({
    realtimeHub,
    supabase: null,
    schema: "public",
    getTripById: async () => trip,
    getEventById: async () => timelineEvent,
    hydrateEvent: (event) => event,
    getDriverProfile: async () => driverProfile,
    hydrateDriverProfile: (profile) => profile,
    getPassengerProfile: async () => null,
    hydratePassengerProfile: (profile) => profile,
    getPricingConfig: async () => basePricing,
    getPromotionById: async () => buildPromotion(),
    hydratePromotion: (promotion) => promotion,
    getBusinessAuditEntryById: async () => null,
    hydrateBusinessAuditEntry: (entry) => entry
  });

  service.publishTripRealtime(trip, "trip_matched");
  service.publishTripRealtime(trip, "trip_matched");
  const tripRefreshEvents = published.filter((entry) => entry.event.tripId === trip.id);
  assert.equal(tripRefreshEvents.length, 6);

  service.publishTripTimelineRealtime(trip, "timeline_updated", timelineEvent);
  assert.ok(
    published.some(
      (entry) =>
        entry.event.type === "notifications.refresh" &&
        entry.event.notification?.message === timelineEvent.message
    )
  );

  service.publishDirectoryRealtime("profile_changed", { userIds: ["driver-1"] }, { driverProfile });
  assert.ok(
    published.some(
      (entry) =>
        entry.event.type === "driver.profile.refresh" &&
        entry.targets.userIds?.includes("driver-1")
    )
  );

  service.publishBusinessRealtime("pricing_updated", { pricing: basePricing });
  assert.ok(
    published.some(
      (entry) => entry.event.type === "business.refresh" && entry.event.pricing?.currency === "PEN"
    )
  );

  service.supabaseRealtimeBridge.start();
  await service.supabaseRealtimeBridge.close();
});

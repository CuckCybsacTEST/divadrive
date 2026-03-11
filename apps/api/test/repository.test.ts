import assert from "node:assert/strict";
import test from "node:test";
import type {
  DriverProfile,
  PassengerProfile,
  PricingConfig,
  Promotion,
  RideTrip,
  TripIncident,
  TripTimelineEvent
} from "@diva-drive/domain";
import { ApiError } from "../src/errors.js";
import { createBusinessRepository } from "../src/repositories/business-repository.js";
import { createDirectoryRepository } from "../src/repositories/directory-repository.js";
import { createTripRepository } from "../src/repositories/trip-repository.js";

const pricing: PricingConfig = {
  currency: "PEN",
  baseFare: 8,
  perKmRate: 2,
  perMinuteRate: 0.3,
  minimumFare: 10,
  serviceFee: 1.5,
  surgeMultiplier: 1
};

const promotion: Promotion = {
  id: "promo-1",
  name: "Promo Test",
  code: "DIVA10",
  kind: "flat",
  audience: "all",
  applyMode: "code",
  value: 5,
  minFare: 10,
  description: "Promo test",
  isActive: true,
  createdAt: "2026-03-11T10:00:00.000Z"
};

const trip: RideTrip = {
  id: "trip-1",
  passengerId: "passenger-1",
  passengerName: "Pasajera",
  origin: {
    label: "A",
    address: "A",
    latitude: -12.1,
    longitude: -77.0
  },
  destination: {
    label: "B",
    address: "B",
    latitude: -12.2,
    longitude: -77.1
  },
  estimate: {
    currency: "PEN",
    distanceKm: 4,
    durationMinutes: 15,
    estimatedFare: 20,
    fareBreakdown: {
      subtotal: 18,
      serviceFee: 2,
      discountAmount: 0,
      total: 20
    },
    appliedPromotion: null,
    route: {
      points: []
    }
  },
  status: "requested",
  requestedAt: "2026-03-11T10:00:00.000Z"
};

const incident: TripIncident = {
  id: "incident-1",
  tripId: "trip-1",
  reporterRole: "passenger",
  reporterId: "passenger-1",
  severity: "medium",
  category: "ops",
  notes: "test",
  createdAt: "2026-03-11T10:05:00.000Z",
  status: "open"
};

const driverProfile: DriverProfile = {
  id: "driver-1",
  fullName: "Conductora",
  phone: "999333444",
  city: "Lima",
  approvalStatus: "approved",
  documentsSubmitted: true,
  licenseNumber: "LIC-1",
  vehicleDescription: "Sedan",
  createdAt: "2026-03-11T10:00:00.000Z"
};

const passengerProfile: PassengerProfile = {
  id: "passenger-1",
  fullName: "Pasajera",
  phone: "999111222",
  city: "Lima",
  createdAt: "2026-03-11T10:00:00.000Z"
};

const timelineEvent: TripTimelineEvent = {
  id: "event-1",
  tripId: "trip-1",
  type: "trip_requested",
  occurredAt: "2026-03-11T10:00:00.000Z",
  message: "Viaje solicitado"
};

test("business repository maps unique conflicts and generic persistence failures", async () => {
  const repository = createBusinessRepository({
    businessAuditLog: [],
    getPricingConfigState: () => pricing,
    promotionsById: new Map(),
    setPricingConfigState: () => undefined,
    appendBusinessAuditEntry: async (entry) => entry,
    savePricingConfig: async () => {
      throw new Error("pricing offline");
    },
    savePromotion: async () => {
      throw {
        code: "23505",
        message: "duplicate key value violates unique constraint"
      };
    }
  });

  await assert.rejects(() => repository.savePromotion(promotion), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "promotion_code_conflict");
    return true;
  });

  await assert.rejects(() => repository.savePricingConfig(pricing), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "pricing_persistence_failed");
    return true;
  });
});

test("trip and directory repositories map persistence failures to domain errors", async () => {
  const tripRepository = createTripRepository({
    incidentsById: new Map(),
    tripEventsById: new Map(),
    tripsById: new Map(),
    appendEvent: async (event) => event,
    getIncident: async () => incident,
    getTrip: async () => trip,
    listEventsByTrip: async () => [timelineEvent],
    listRecentEvents: async () => [timelineEvent],
    listTripsByDriver: async () => [trip],
    listTripsByPassenger: async () => [trip],
    listTripsByStatus: async () => [trip],
    readIncidents: async () => [incident],
    readTrips: async () => [trip],
    saveIncident: async () => {
      throw new Error("incident down");
    },
    saveTrip: async () => {
      throw new Error("trip down");
    }
  });
  const directoryRepository = createDirectoryRepository({
    driverProfilesById: new Map(),
    passengerProfilesById: new Map(),
    getDriverProfile: async () => driverProfile,
    getPassengerProfile: async () => passengerProfile,
    listDriverProfiles: async () => [driverProfile],
    listPassengerProfiles: async () => [passengerProfile],
    saveDriverProfile: async () => {
      throw new Error("driver down");
    },
    savePassengerProfile: async (profile) => profile
  });

  await assert.rejects(() => tripRepository.saveTrip(trip), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "trip_persistence_failed");
    return true;
  });

  await assert.rejects(() => tripRepository.saveIncident(incident), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "incident_persistence_failed");
    return true;
  });

  await assert.rejects(() => directoryRepository.saveDriverProfile(driverProfile), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "driver_profile_persistence_failed");
    return true;
  });
});

test("domain repositories hydrate and cache read models behind a typed interface", async () => {
  let currentPricing = pricing;
  const tripRepository = createTripRepository({
    incidentsById: new Map(),
    tripEventsById: new Map(),
    tripsById: new Map(),
    appendEvent: async (event) => event,
    getIncident: async () => incident,
    getTrip: async () => trip,
    listEventsByTrip: async () => [timelineEvent],
    listRecentEvents: async () => [timelineEvent],
    listTripsByDriver: async () => [trip],
    listTripsByPassenger: async () => [trip],
    listTripsByStatus: async () => [trip],
    readIncidents: async () => [incident],
    readTrips: async () => [trip],
    saveIncident: async (nextIncident) => nextIncident,
    saveTrip: async (nextTrip) => nextTrip
  });
  const directoryRepository = createDirectoryRepository({
    driverProfilesById: new Map(),
    passengerProfilesById: new Map(),
    getDriverProfile: async () => driverProfile,
    getPassengerProfile: async () => passengerProfile,
    listDriverProfiles: async () => [driverProfile],
    listPassengerProfiles: async () => [passengerProfile],
    saveDriverProfile: async (profile) => profile,
    savePassengerProfile: async (profile) => profile
  });
  const businessRepository = createBusinessRepository({
    businessAuditLog: [],
    getPricingConfigState: () => currentPricing,
    promotionsById: new Map(),
    setPricingConfigState: (nextPricing) => {
      currentPricing = nextPricing;
    },
    appendBusinessAuditEntry: async (entry) => entry,
    savePricingConfig: async (config) => config,
    savePromotion: async (nextPromotion) => nextPromotion
  });

  assert.equal((await tripRepository.getTripById(trip.id))?.id, trip.id);
  assert.equal((await directoryRepository.getDriverProfileById(driverProfile.id))?.id, driverProfile.id);

  businessRepository.hydrateSnapshot({
    pricing,
    promotions: [promotion],
    auditLog: []
  });
  assert.equal(businessRepository.getSnapshot().promotions[0]?.code, "DIVA10");
  assert.equal((await tripRepository.listEventsByTrip(trip.id))[0]?.id, timelineEvent.id);
});

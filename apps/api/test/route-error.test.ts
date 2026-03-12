import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { z } from "zod";
import type { DriverProfile, PricingConfig, Promotion, RideTrip, TripIncident } from "@diva-drive/domain";
import { ApiError, isApiError } from "../src/errors.js";
import { registerAuthRoutes } from "../src/routes/auth-routes.js";
import { registerOpsRoutes } from "../src/routes/ops-routes.js";

const buildApp = () => {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (isApiError(error)) {
      reply.status(error.statusCode).send({ error: error.code });
      return;
    }

    reply.status(500).send({ error: "internal_server_error" });
  });
  return app;
};

test("auth routes map duplicate persistence errors to sign_up_failed", async () => {
  const app = buildApp();

  registerAuthRoutes({
    app,
    signInSchema: z.object({
      email: z.string().email(),
      password: z.string().min(8),
      role: z.enum(["passenger", "driver", "operator", "admin"]).optional()
    }),
    signUpSchema: z.object({
      email: z.string().email(),
      password: z.string().min(8),
      fullName: z.string().min(3),
      phone: z.string().min(9),
      role: z.enum(["passenger", "driver", "operator", "admin"])
    }),
    refreshSessionSchema: z.object({
      refreshToken: z.string().min(1)
    }),
    requireSession: async () => null,
    ensureProfileForSession: async () => undefined,
    signInWithSupabase: async () => {
      throw new Error("not_used");
    },
    signUpWithSupabase: async () => {
      throw {
        code: "23505",
        message: "duplicate key value violates unique constraint"
      };
    },
    refreshSupabaseSession: async () => {
      throw new Error("not_used");
    },
    isSupabaseReady: true,
    getDriverProfile: async () => null,
    getPassengerProfile: async () => null,
    publishDirectoryRealtime: () => undefined
  });

  const response = await app.inject({
    method: "POST",
    url: "/auth/sign-up",
    payload: {
      email: "duplicate@test.dev",
      password: "DivaDrive123",
      fullName: "Duplicada Test",
      phone: "999111222",
      role: "passenger"
    }
  });

  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.json(), {
    error: "sign_up_failed"
  });

  await app.close();
});

test("ops routes map promotion code conflicts to promotion_code_conflict", async () => {
  const app = buildApp();
  const pricingConfigSchema = z.object({
    currency: z.string().min(3),
    baseFare: z.number().nonnegative(),
    perKmRate: z.number().nonnegative(),
    perMinuteRate: z.number().nonnegative(),
    minimumFare: z.number().nonnegative(),
    serviceFee: z.number().nonnegative(),
    surgeMultiplier: z.number().min(1),
    driverPayoutRate: z.number().min(0.1).max(1)
  });
  const promotionSchema = z.object({
    name: z.string().min(2),
    code: z.string().min(2),
    kind: z.enum(["flat", "percentage"]),
    audience: z.enum(["all", "new_passenger", "returning_passenger"]),
    applyMode: z.enum(["automatic", "code"]),
    value: z.number().positive(),
    minFare: z.number().nonnegative(),
    description: z.string().min(4),
    isActive: z.boolean()
  });

  registerOpsRoutes({
    app,
    requireSession: async () => ({
      accessToken: "token",
      refreshToken: "refresh",
      expiresAt: null,
      user: {
        id: "operator-1",
        role: "operator",
        fullName: "Operadora Test",
        phone: "999555666",
        email: "ops@test.dev"
      }
    }),
    requireAnyRole: (session) => session,
    placeSearchSchema: z.object({ query: z.string().min(1) }),
    searchablePlaces: [],
    getOpsSnapshot: async () => ({
      queueTrips: [],
      activeTrips: [],
      completedTrips: [],
      cancelledTrips: [],
      incidents: [],
      totals: {
        requested: 0,
        active: 0,
        completed: 0,
        cancelled: 0,
        openIncidents: 0
      }
    }),
    hydrateBusinessState: (snapshot) => snapshot,
    getPricingConfig: async () => ({
      currency: "PEN",
      baseFare: 8,
      perKmRate: 2,
      perMinuteRate: 0.3,
      minimumFare: 10,
      serviceFee: 1.5,
      surgeMultiplier: 1,
      driverPayoutRate: 0.82
    }),
    listPromotions: async () => [],
    listOperationalZones: async () => [],
    listBusinessAuditEntries: async () => [],
    getCommercialMetrics: async () => ({}),
    getOpsEventStream: async () => [],
    listDriverProfiles: async () => [],
    listPassengerProfiles: async () => [],
    hydrateDirectoryState: (snapshot) => snapshot,
    readTrips: async () => [],
    hydrateTrip: (trip: RideTrip) => trip,
    readIncidents: async () => [],
    hydrateIncident: (incident: TripIncident) => incident,
    incidentStatusSchema: z.object({
      status: z.enum(["open", "reviewing", "resolved"])
    }),
    incidentsById: new Map<string, TripIncident>(),
    getIncident: async () => null,
    getTripById: async () => null,
    saveIncident: async (incident) => incident,
    publishTripRealtime: () => undefined,
    driverApprovalSchema: z.object({
      approvalStatus: z.enum(["pending", "approved", "rejected"])
    }),
    driverAvailabilitySchema: z.object({
      availabilityStatus: z.enum(["offline", "online"])
    }),
    driverProfilesById: new Map<string, DriverProfile>(),
    saveDriverProfile: async (profile) => profile,
    publishDirectoryRealtime: () => undefined,
    pricingConfigSchema,
    savePricingConfig: async (config: PricingConfig) => config,
    setPricingConfig: () => undefined,
    zoneConfigSchema: z.object({
      operationalZones: z.array(
        z.object({
          id: z.string().min(1),
          name: z.string().min(2),
          center: z.object({
            latitude: z.number(),
            longitude: z.number()
          }),
          radiusKm: z.number().positive(),
          isActive: z.boolean()
        })
      )
    }),
    setOperationalZones: async (zones) => zones,
    appendBusinessAudit: () => ({
      id: "audit-1",
      actorId: "operator-1",
      actorRole: "operator",
      action: "promotion_created",
      summary: "test",
      occurredAt: new Date().toISOString()
    }),
    appendBusinessAuditEntry: async (entry) => entry,
    publishBusinessRealtime: () => undefined,
    getBusinessSnapshot: () => ({
      pricing: {
        currency: "PEN",
        baseFare: 8,
        perKmRate: 2,
        perMinuteRate: 0.3,
        minimumFare: 10,
        serviceFee: 1.5,
        surgeMultiplier: 1,
        driverPayoutRate: 0.82
      },
      operationalZones: [],
      promotions: [],
      auditLog: []
    }),
    promotionSchema,
    savePromotion: async () => {
      throw new ApiError(409, "promotion_code_conflict");
    },
    promotionsById: new Map<string, Promotion>()
  });

  const response = await app.inject({
    method: "POST",
    url: "/ops/promotions",
    headers: {
      authorization: "Bearer token"
    },
    payload: {
      name: "Promo Test",
      code: "DIVA10",
      kind: "flat",
      audience: "all",
      applyMode: "code",
      value: 5,
      minFare: 10,
      description: "Promo duplicada",
      isActive: true
    }
  });

  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.json(), {
    error: "promotion_code_conflict"
  });

  await app.close();
});

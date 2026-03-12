import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import { app, bootstrapApp } from "../src/index.js";

const execFileAsync = promisify(execFile);

test.after(async () => {
  await app.close();
});

const request = async <T>(
  server: FastifyInstance,
  options: {
    method: "GET" | "POST";
    url: string;
    token?: string;
    payload?: unknown;
  }
): Promise<{ statusCode: number; body: T }> => {
  const response = await server.inject({
    method: options.method,
    url: options.url,
    payload: options.payload,
    headers: options.token
      ? {
          authorization: `Bearer ${options.token}`
        }
      : undefined
  });

  return {
    statusCode: response.statusCode,
    body: response.json() as T
  };
};

const runAuthUnavailableProbe = async () => {
  const script = `
    const { bootstrapApp } = await import('./src/index.ts');
    const server = await bootstrapApp();
    const response = await server.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: {
        email: 'disabled@divadrive.test',
        password: 'DivaDrive123',
        role: 'passenger'
      }
    });
    console.log(JSON.stringify({ statusCode: response.statusCode, body: response.json() }));
    await server.close();
  `;

  const oneLineScript = script.replace(/\r?\n/g, " ").trim();

  const { stdout } = await execFileAsync(
    process.execPath,
    [
      "--input-type=module",
      "--import",
      "tsx",
      "--eval",
      oneLineScript
    ],
    {
      cwd: resolve(process.cwd(), "."),
      env: {
        ...process.env,
        SUPABASE_ENABLED: "false"
      }
    }
  );

  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const payload = lines
    .map((line) => {
      try {
        return JSON.parse(line) as { statusCode?: number; body?: { error?: string } };
      } catch {
        return null;
      }
    })
    .findLast(
      (entry): entry is { statusCode: number; body: { error: string } } =>
        entry !== null &&
        typeof entry.statusCode === "number" &&
        typeof entry.body === "object" &&
        entry.body !== null &&
        typeof entry.body.error === "string"
    );

  if (!payload) {
    throw new Error("auth_unavailable_probe_failed");
  }

  return payload;
};

test("critical flow covers auth, approval, trip lifecycle and incident resolution", async (t) => {
  const server = await bootstrapApp();

  const stamp = `${Date.now()}-${Math.round(Math.random() * 1000)}`;

  const passengerSignUp = await request<{
    accessToken: string;
    user: { id: string; fullName: string; role: string; email: string };
  }>(server, {
    method: "POST",
    url: "/auth/sign-up",
    payload: {
      email: `passenger.${stamp}@divadrive.test`,
      password: "DivaDrive123",
      fullName: "Pasajera Test",
      phone: "999111222",
      role: "passenger"
    }
  });

  if (passengerSignUp.statusCode === 503) {
    t.skip("Supabase Auth no esta habilitado en este entorno.");
    return;
  }

  assert.equal(passengerSignUp.statusCode, 201);

  const driverSignUp = await request<{
    accessToken: string;
    user: { id: string; fullName: string; role: string; email: string };
  }>(server, {
    method: "POST",
    url: "/auth/sign-up",
    payload: {
      email: `driver.${stamp}@divadrive.test`,
      password: "DivaDrive123",
      fullName: "Conductora Test",
      phone: "999333444",
      role: "driver"
    }
  });
  assert.equal(driverSignUp.statusCode, 201);

  const operatorSignUp = await request<{
    accessToken: string;
    user: { id: string; fullName: string; role: string; email: string };
  }>(server, {
    method: "POST",
    url: "/auth/sign-up",
    payload: {
      email: `operator.${stamp}@divadrive.test`,
      password: "DivaDrive123",
      fullName: "Operadora Test",
      phone: "999555666",
      role: "operator"
    }
  });
  assert.equal(operatorSignUp.statusCode, 201);

  const approval = await request<{ approvalStatus: string }>(server, {
    method: "POST",
    url: `/ops/drivers/${driverSignUp.body.user.id}/approval`,
    token: operatorSignUp.body.accessToken,
    payload: {
      approvalStatus: "approved"
    }
  });
  assert.equal(approval.statusCode, 200);
  assert.equal(approval.body.approvalStatus, "approved");

  const driverOnline = await request<{ availabilityStatus: string }>(server, {
    method: "POST",
    url: "/driver/availability",
    token: driverSignUp.body.accessToken,
    payload: {
      availabilityStatus: "online",
      currentLocation: {
        latitude: -12.1317,
        longitude: -77.0301
      }
    }
  });
  assert.equal(driverOnline.statusCode, 200);
  assert.equal(driverOnline.body.availabilityStatus, "online");

  const tripCreate = await request<{
    id: string;
    status: string;
  }>(server, {
    method: "POST",
    url: "/trips",
    token: passengerSignUp.body.accessToken,
    payload: {
      passengerId: passengerSignUp.body.user.id,
      passengerName: passengerSignUp.body.user.fullName,
      origin: {
        label: "Larcomar",
        address: "Malecon de la Reserva 610, Miraflores",
        latitude: -12.1317,
        longitude: -77.0301
      },
      destination: {
        label: "Jockey Plaza",
        address: "Av. Javier Prado Este 4200, Santiago de Surco",
        latitude: -12.0866,
        longitude: -76.9765
      },
      promoCode: "DIVA10"
    }
  });
  assert.equal(tripCreate.statusCode, 201);
  assert.equal(tripCreate.body.status, "requested");

  const outOfZoneTrip = await request<{ error: string }>(server, {
    method: "POST",
    url: "/trips",
    token: passengerSignUp.body.accessToken,
    payload: {
      passengerId: passengerSignUp.body.user.id,
      passengerName: passengerSignUp.body.user.fullName,
      origin: {
        label: "Chancay",
        address: "Zona fuera de operacion",
        latitude: -11.56,
        longitude: -77.27
      },
      destination: {
        label: "Huacho",
        address: "Zona fuera de operacion",
        latitude: -11.11,
        longitude: -77.61
      }
    }
  });
  assert.equal(outOfZoneTrip.statusCode, 403);
  assert.equal(outOfZoneTrip.body.error, "trip_outside_operational_zone");

  const driverQueue = await request<{ trips: Array<{ id: string; reservedDriverId?: string }> }>(
    server,
    {
      method: "GET",
      url: "/driver/trips/queue",
      token: driverSignUp.body.accessToken
    }
  );
  assert.equal(driverQueue.statusCode, 200);
  assert.equal(driverQueue.body.trips.length, 1);
  assert.equal(driverQueue.body.trips[0]?.id, tripCreate.body.id);
  assert.equal(driverQueue.body.trips[0]?.reservedDriverId, driverSignUp.body.user.id);

  const acceptTrip = await request<{ status: string }>(server, {
    method: "POST",
    url: `/driver/trips/${tripCreate.body.id}/accept`,
    token: driverSignUp.body.accessToken,
    payload: {}
  });
  assert.equal(acceptTrip.statusCode, 200);
  assert.equal(acceptTrip.body.status, "matched");

  for (const status of [
    "driver_en_route",
    "driver_arrived",
    "trip_started",
    "trip_completed"
  ] as const) {
    const update = await request<{ status: string }>(server, {
      method: "POST",
      url: `/driver/trips/${tripCreate.body.id}/status`,
      token: driverSignUp.body.accessToken,
      payload: {
        status
      }
    });

    assert.equal(update.statusCode, 200);
    assert.equal(update.body.status, status);
  }

  const driverEarnings = await request<{
    completedTrips: number;
    grossEarnings: number;
    platformFees: number;
    netEarnings: number;
  }>(server, {
    method: "GET",
    url: "/driver/earnings",
    token: driverSignUp.body.accessToken
  });
  assert.equal(driverEarnings.statusCode, 200);
  assert.equal(driverEarnings.body.completedTrips, 1);
  assert.ok(driverEarnings.body.grossEarnings > 0);
  assert.equal(
    Number((driverEarnings.body.netEarnings + driverEarnings.body.platformFees).toFixed(2)),
    driverEarnings.body.grossEarnings
  );
  assert.ok(driverEarnings.body.netEarnings >= 0);

  const incident = await request<{ id: string; status: string }>(server, {
    method: "POST",
    url: "/incidents",
    token: passengerSignUp.body.accessToken,
    payload: {
      tripId: tripCreate.body.id,
      severity: "medium",
      category: "operacion",
      notes: "Incidencia automatizada de prueba"
    }
  });
  assert.equal(incident.statusCode, 201);
  assert.equal(incident.body.status, "open");

  const resolveIncident = await request<{ status: string }>(server, {
    method: "POST",
    url: `/ops/incidents/${incident.body.id}/status`,
    token: operatorSignUp.body.accessToken,
    payload: {
      status: "resolved"
    }
  });
  assert.equal(resolveIncident.statusCode, 200);
  assert.equal(resolveIncident.body.status, "resolved");

  const timeline = await request<{ events: Array<{ type: string }> }>(server, {
    method: "GET",
    url: `/trips/${tripCreate.body.id}/events`,
    token: passengerSignUp.body.accessToken
  });
  assert.equal(timeline.statusCode, 200);
  assert.ok(timeline.body.events.length >= 6);
  assert.ok(timeline.body.events.some((event) => event.type === "trip_completed"));

  const dashboard = await request<{
    totals: { completed: number };
    incidents: Array<{ id: string; status: string }>;
  }>(server, {
    method: "GET",
    url: "/ops/dashboard",
    token: operatorSignUp.body.accessToken
  });
  assert.equal(dashboard.statusCode, 200);
  assert.ok(dashboard.body.totals.completed >= 1);
  assert.ok(
    dashboard.body.incidents.some(
      (item) => item.id === incident.body.id && item.status === "resolved"
    )
  );
});

test("authorization and transition guards reject invalid actors and invalid state changes", async (t) => {
  const server = await bootstrapApp();

  const stamp = `${Date.now()}-${Math.round(Math.random() * 1000)}`;

  const passenger = await request<{
    accessToken: string;
    user: { id: string; fullName: string; role: string };
  }>(server, {
    method: "POST",
    url: "/auth/sign-up",
    payload: {
      email: `guard-passenger.${stamp}@divadrive.test`,
      password: "DivaDrive123",
      fullName: "Pasajera Guard",
      phone: "999111223",
      role: "passenger"
    }
  });

  if (passenger.statusCode === 503) {
    t.skip("Supabase Auth no esta habilitado en este entorno.");
    return;
  }

  const intruderPassenger = await request<{
    accessToken: string;
    user: { id: string; fullName: string; role: string };
  }>(server, {
    method: "POST",
    url: "/auth/sign-up",
    payload: {
      email: `guard-passenger-2.${stamp}@divadrive.test`,
      password: "DivaDrive123",
      fullName: "Pasajera Intrusa",
      phone: "999111224",
      role: "passenger"
    }
  });

  const unapprovedDriver = await request<{
    accessToken: string;
    user: { id: string; fullName: string; role: string };
  }>(server, {
    method: "POST",
    url: "/auth/sign-up",
    payload: {
      email: `guard-driver.${stamp}@divadrive.test`,
      password: "DivaDrive123",
      fullName: "Conductora Guard",
      phone: "999333445",
      role: "driver"
    }
  });

  const operator = await request<{
    accessToken: string;
    user: { id: string; fullName: string; role: string };
  }>(server, {
    method: "POST",
    url: "/auth/sign-up",
    payload: {
      email: `guard-operator.${stamp}@divadrive.test`,
      password: "DivaDrive123",
      fullName: "Operadora Guard",
      phone: "999555667",
      role: "operator"
    }
  });

  assert.equal(passenger.statusCode, 201);
  assert.equal(intruderPassenger.statusCode, 201);
  assert.equal(unapprovedDriver.statusCode, 201);
  assert.equal(operator.statusCode, 201);

  const opsDenied = await request<{ error: string }>(server, {
    method: "GET",
    url: "/ops/dashboard",
    token: passenger.body.accessToken
  });
  assert.equal(opsDenied.statusCode, 401);
  assert.equal(opsDenied.body.error, "invalid_session");

  const tripCreate = await request<{ id: string; status: string }>(server, {
    method: "POST",
    url: "/trips",
    token: passenger.body.accessToken,
    payload: {
      passengerId: passenger.body.user.id,
      passengerName: passenger.body.user.fullName,
      origin: {
        label: "Larcomar",
        address: "Malecon de la Reserva 610, Miraflores",
        latitude: -12.1317,
        longitude: -77.0301
      },
      destination: {
        label: "Jockey Plaza",
        address: "Av. Javier Prado Este 4200, Santiago de Surco",
        latitude: -12.0866,
        longitude: -76.9765
      }
    }
  });
  assert.equal(tripCreate.statusCode, 201);

  const acceptDenied = await request<{ error: string }>(server, {
    method: "POST",
    url: `/driver/trips/${tripCreate.body.id}/accept`,
    token: unapprovedDriver.body.accessToken,
    payload: {}
  });
  assert.equal(acceptDenied.statusCode, 403);
  assert.equal(acceptDenied.body.error, "driver_not_approved");

  const approveDriver = await request<{ approvalStatus: string }>(server, {
    method: "POST",
    url: `/ops/drivers/${unapprovedDriver.body.user.id}/approval`,
    token: operator.body.accessToken,
    payload: {
      approvalStatus: "approved"
    }
  });
  assert.equal(approveDriver.statusCode, 200);

  const offlineAcceptDenied = await request<{ error: string }>(server, {
    method: "POST",
    url: `/driver/trips/${tripCreate.body.id}/accept`,
    token: unapprovedDriver.body.accessToken,
    payload: {}
  });
  assert.equal(offlineAcceptDenied.statusCode, 403);
  assert.equal(offlineAcceptDenied.body.error, "driver_offline");

  const goOnline = await request<{ availabilityStatus: string }>(server, {
    method: "POST",
    url: "/driver/availability",
    token: unapprovedDriver.body.accessToken,
    payload: {
      availabilityStatus: "online"
    }
  });
  assert.equal(goOnline.statusCode, 200);
  assert.equal(goOnline.body.availabilityStatus, "online");

  const acceptWithoutReservation = await request<{ error: string }>(server, {
    method: "POST",
    url: `/driver/trips/${tripCreate.body.id}/accept`,
    token: unapprovedDriver.body.accessToken,
    payload: {}
  });
  assert.equal(acceptWithoutReservation.statusCode, 409);
  assert.equal(acceptWithoutReservation.body.error, "trip_reservation_required");

  const driverQueueAfterOnline = await request<{ trips: Array<{ id: string }> }>(server, {
    method: "GET",
    url: "/driver/trips/queue",
    token: unapprovedDriver.body.accessToken
  });
  assert.equal(driverQueueAfterOnline.statusCode, 200);
  assert.equal(driverQueueAfterOnline.body.trips.length, 1);
  assert.equal(driverQueueAfterOnline.body.trips[0]?.id, tripCreate.body.id);

  const acceptedTrip = await request<{ status: string }>(server, {
    method: "POST",
    url: `/driver/trips/${tripCreate.body.id}/accept`,
    token: unapprovedDriver.body.accessToken,
    payload: {}
  });
  assert.equal(acceptedTrip.statusCode, 200);
  assert.equal(acceptedTrip.body.status, "matched");

  const invalidTransition = await request<{ error: string }>(server, {
    method: "POST",
    url: `/driver/trips/${tripCreate.body.id}/status`,
    token: unapprovedDriver.body.accessToken,
    payload: {
      status: "trip_started"
    }
  });
  assert.equal(invalidTransition.statusCode, 409);
  assert.equal(invalidTransition.body.error, "invalid_status_transition");

  const unauthorizedEvents = await request<{ error: string }>(server, {
    method: "GET",
    url: `/trips/${tripCreate.body.id}/events`,
    token: intruderPassenger.body.accessToken
  });
  assert.equal(unauthorizedEvents.statusCode, 403);
  assert.equal(unauthorizedEvents.body.error, "trip_events_not_allowed");

  const unauthorizedCancel = await request<{ error: string }>(server, {
    method: "POST",
    url: `/trips/${tripCreate.body.id}/cancel`,
    token: intruderPassenger.body.accessToken,
    payload: {
      reason: "No me pertenece"
    }
  });
  assert.equal(unauthorizedCancel.statusCode, 403);
  assert.equal(unauthorizedCancel.body.error, "trip_cancel_not_allowed");
});

test("business endpoints persist pricing, promotions and audit trail", async (t) => {
  const server = await bootstrapApp();

  const stamp = `${Date.now()}-${Math.round(Math.random() * 1000)}`;

  const operator = await request<{
    accessToken: string;
    user: { id: string; fullName: string; role: string };
  }>(server, {
    method: "POST",
    url: "/auth/sign-up",
    payload: {
      email: `biz-operator.${stamp}@divadrive.test`,
      password: "DivaDrive123",
      fullName: "Operadora Business",
      phone: "999555668",
      role: "operator"
    }
  });

  if (operator.statusCode === 503) {
    t.skip("Supabase Auth no esta habilitado en este entorno.");
    return;
  }

  assert.equal(operator.statusCode, 201);

  const pricing = await request<{
    pricing: { currency: string; baseFare: number; surgeMultiplier: number; driverPayoutRate: number };
    auditLog: Array<{ action: string; actorId: string }>;
  }>(server, {
    method: "POST",
    url: "/ops/pricing",
    token: operator.body.accessToken,
    payload: {
      currency: "PEN",
      baseFare: 7.5,
      perKmRate: 2.1,
      perMinuteRate: 0.3,
      minimumFare: 10,
      serviceFee: 1.5,
      surgeMultiplier: 1.4,
      driverPayoutRate: 0.8
    }
  });
  assert.equal(pricing.statusCode, 200);
  assert.equal(pricing.body.pricing.baseFare, 7.5);
  assert.equal(pricing.body.pricing.surgeMultiplier, 1.4);
  assert.equal(pricing.body.pricing.driverPayoutRate, 0.8);
  assert.ok(
    pricing.body.auditLog.some(
      (entry) => entry.action === "pricing_updated" && entry.actorId === operator.body.user.id
    )
  );

  const createdPromotion = await request<{
    id: string;
    code: string;
    isActive: boolean;
    audience: string;
  }>(server, {
    method: "POST",
    url: "/ops/promotions",
    token: operator.body.accessToken,
    payload: {
      name: "Promo Business Test",
      code: `BIZ${stamp.replace(/[^0-9]/g, "").slice(-10)}`,
      kind: "flat",
      audience: "all",
      applyMode: "code",
      value: 4,
      minFare: 15,
      description: "Promocion creada desde prueba automatizada",
      isActive: true
    }
  });
  assert.equal(createdPromotion.statusCode, 201);
  assert.equal(createdPromotion.body.isActive, true);

  const updatedPromotion = await request<{
    id: string;
    code: string;
    isActive: boolean;
    description: string;
  }>(server, {
    method: "POST",
    url: `/ops/promotions/${createdPromotion.body.id}`,
    token: operator.body.accessToken,
    payload: {
      name: "Promo Business Test",
      code: createdPromotion.body.code,
      kind: "flat",
      audience: "all",
      applyMode: "code",
      value: 4,
      minFare: 15,
      description: "Promocion actualizada desde prueba automatizada",
      isActive: false
    }
  });
  assert.equal(updatedPromotion.statusCode, 200);
  assert.equal(updatedPromotion.body.isActive, false);

  const businessSnapshot = await request<{
    pricing: { baseFare: number; surgeMultiplier: number; driverPayoutRate: number };
    promotions: Array<{ id: string; isActive: boolean; description: string }>;
    auditLog: Array<{ action: string; actorId: string }>;
  }>(server, {
    method: "GET",
    url: "/ops/business",
    token: operator.body.accessToken
  });
  assert.equal(businessSnapshot.statusCode, 200);
  assert.equal(businessSnapshot.body.pricing.baseFare, 7.5);
  assert.ok(
    businessSnapshot.body.promotions.some(
      (promotion) =>
        promotion.id === createdPromotion.body.id &&
        promotion.isActive === false &&
        promotion.description === "Promocion actualizada desde prueba automatizada"
    )
  );
  assert.ok(
    businessSnapshot.body.auditLog.filter((entry) => entry.actorId === operator.body.user.id)
      .length >= 3
  );
  assert.ok(
    businessSnapshot.body.auditLog.some((entry) => entry.action === "promotion_created")
  );
  assert.ok(
    businessSnapshot.body.auditLog.some((entry) => entry.action === "promotion_updated")
  );
});

test("auth edge cases return the expected errors", async (t) => {
  const server = await bootstrapApp();

  const stamp = `${Date.now()}-${Math.round(Math.random() * 1000)}`;

  const passenger = await request<{
    accessToken: string;
    refreshToken: string;
    user: { id: string; email: string; role: string };
  }>(server, {
    method: "POST",
    url: "/auth/sign-up",
    payload: {
      email: `auth-passenger.${stamp}@divadrive.test`,
      password: "DivaDrive123",
      fullName: "Auth Passenger",
      phone: "999111225",
      role: "passenger"
    }
  });

  if (passenger.statusCode === 503) {
    t.skip("Supabase Auth no esta habilitado en este entorno.");
    return;
  }

  assert.equal(passenger.statusCode, 201);

  const roleMismatch = await request<{ error: string }>(server, {
    method: "POST",
    url: "/auth/sign-in",
    payload: {
      email: passenger.body.user.email,
      password: "DivaDrive123",
      role: "driver"
    }
  });
  assert.equal(roleMismatch.statusCode, 403);
  assert.equal(roleMismatch.body.error, "role_mismatch");

  const invalidRefresh = await request<{ error: string }>(server, {
    method: "POST",
    url: "/auth/refresh",
    payload: {
      refreshToken: "invalid-refresh-token"
    }
  });
  assert.equal(invalidRefresh.statusCode, 401);
  assert.equal(invalidRefresh.body.error, "invalid_refresh_token");

  const unavailable = await runAuthUnavailableProbe();
  assert.equal(unavailable.statusCode, 503);
  assert.equal(unavailable.body.error, "auth_unavailable");
});

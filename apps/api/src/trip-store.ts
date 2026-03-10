import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RideTrip } from "@diva-drive/domain";
import { isSupabaseReady, supabaseAdmin } from "./supabase.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const dataDir = resolve(currentDir, "../data");
const tripsFile = resolve(dataDir, "trips.json");

const ensureDataFile = async () => {
  await mkdir(dataDir, { recursive: true });

  try {
    await readFile(tripsFile, "utf8");
  } catch {
    await writeFile(tripsFile, "[]\n", "utf8");
  }
};

export const readLocalTrips = async (): Promise<RideTrip[]> => {
  await ensureDataFile();
  const content = await readFile(tripsFile, "utf8");
  return JSON.parse(content) as RideTrip[];
};

export const writeLocalTrips = async (trips: RideTrip[]) => {
  await ensureDataFile();
  await writeFile(tripsFile, `${JSON.stringify(trips, null, 2)}\n`, "utf8");
};

export const readTrips = async (): Promise<RideTrip[]> => {
  if (!isSupabaseReady || !supabaseAdmin) {
    return readLocalTrips();
  }

  const { data, error } = await supabaseAdmin
    .from("trips")
    .select("*")
    .order("requested_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    passengerId: row.passenger_id,
    passengerName: row.passenger_name,
    driverId: row.driver_id ?? undefined,
    driverName: row.driver_name ?? undefined,
    status: row.status,
    requestedAt: row.requested_at,
    requestedPromoCode: row.requested_promo_code ?? undefined,
    origin: row.origin,
    destination: row.destination,
    estimate: row.estimate,
    driverEtaMinutes: row.driver_eta_minutes ?? undefined,
    currentDriverLocation: row.current_driver_location ?? undefined,
    cancellationReason: row.cancellation_reason ?? undefined,
    cancelledByRole: row.cancelled_by_role ?? undefined,
    cancelledAt: row.cancelled_at ?? undefined
  })) as RideTrip[];
};

export const writeTrips = async (trips: RideTrip[]) => {
  if (!isSupabaseReady || !supabaseAdmin) {
    await writeLocalTrips(trips);
    return;
  }

  if (trips.length === 0) {
    return;
  }

  const payload = trips.map((trip) => ({
    id: trip.id,
    passenger_id: trip.passengerId,
    passenger_name: trip.passengerName,
    driver_id: trip.driverId ?? null,
    driver_name: trip.driverName ?? null,
    status: trip.status,
    requested_at: trip.requestedAt,
    requested_promo_code: trip.requestedPromoCode ?? null,
    origin: trip.origin,
    destination: trip.destination,
    estimate: trip.estimate,
    driver_eta_minutes: trip.driverEtaMinutes ?? null,
    current_driver_location: trip.currentDriverLocation ?? null,
    cancellation_reason: trip.cancellationReason ?? null,
    cancelled_by_role: trip.cancelledByRole ?? null,
    cancelled_at: trip.cancelledAt ?? null
  }));

  const { error } = await supabaseAdmin.from("trips").upsert(payload);

  if (error) {
    throw error;
  }
};

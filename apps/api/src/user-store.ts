import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DriverProfile, PassengerProfile } from "@diva-drive/domain";
import { isSupabaseReady, supabaseAdmin } from "./supabase.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const dataDir = resolve(currentDir, "../data");
const usersFile = resolve(dataDir, "users.json");

interface UserStorePayload {
  drivers: DriverProfile[];
  passengers: PassengerProfile[];
}

const emptyPayload: UserStorePayload = {
  drivers: [],
  passengers: []
};

const ensureDataFile = async () => {
  await mkdir(dataDir, { recursive: true });

  try {
    await readFile(usersFile, "utf8");
  } catch {
    await writeFile(usersFile, `${JSON.stringify(emptyPayload, null, 2)}\n`, "utf8");
  }
};

export const readLocalUsers = async (): Promise<UserStorePayload> => {
  await ensureDataFile();
  const content = await readFile(usersFile, "utf8");
  return JSON.parse(content) as UserStorePayload;
};

export const writeLocalUsers = async (payload: UserStorePayload) => {
  await ensureDataFile();
  await writeFile(usersFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

export const readUsers = async (): Promise<UserStorePayload> => {
  if (!isSupabaseReady || !supabaseAdmin) {
    return readLocalUsers();
  }

  const [{ data: drivers, error: driverError }, { data: passengers, error: passengerError }] =
    await Promise.all([
      supabaseAdmin.from("driver_profiles").select("*").order("created_at", { ascending: true }),
      supabaseAdmin.from("passenger_profiles").select("*").order("created_at", { ascending: true })
    ]);

  if (driverError) {
    throw driverError;
  }

  if (passengerError) {
    throw passengerError;
  }

  return {
    drivers: (drivers ?? []).map((row) => ({
      id: row.id,
      fullName: row.full_name,
      phone: row.phone,
      city: row.city,
      approvalStatus: row.approval_status,
      documentsSubmitted: row.documents_submitted,
      licenseNumber: row.license_number,
      vehicleDescription: row.vehicle_description,
      createdAt: row.created_at
    })) as DriverProfile[],
    passengers: (passengers ?? []).map((row) => ({
      id: row.id,
      fullName: row.full_name,
      phone: row.phone,
      city: row.city,
      createdAt: row.created_at
    })) as PassengerProfile[]
  };
};

export const writeUsers = async (payload: UserStorePayload) => {
  if (!isSupabaseReady || !supabaseAdmin) {
    await writeLocalUsers(payload);
    return;
  }

  if (payload.drivers.length > 0) {
    const { error } = await supabaseAdmin.from("driver_profiles").upsert(
      payload.drivers.map((driver) => ({
        id: driver.id,
        full_name: driver.fullName,
        phone: driver.phone,
        city: driver.city,
        approval_status: driver.approvalStatus,
        documents_submitted: driver.documentsSubmitted,
        license_number: driver.licenseNumber,
        vehicle_description: driver.vehicleDescription,
        created_at: driver.createdAt
      }))
    );

    if (error) {
      throw error;
    }
  }

  if (payload.passengers.length > 0) {
    const { error } = await supabaseAdmin.from("passenger_profiles").upsert(
      payload.passengers.map((passenger) => ({
        id: passenger.id,
        full_name: passenger.fullName,
        phone: passenger.phone,
        city: passenger.city,
        created_at: passenger.createdAt
      }))
    );

    if (error) {
      throw error;
    }
  }
};

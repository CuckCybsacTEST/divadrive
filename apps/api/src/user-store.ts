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
    drivers: (drivers ?? []).map(mapDriverRow) as DriverProfile[],
    passengers: (passengers ?? []).map(mapPassengerRow) as PassengerProfile[]
  };
};

export const listDriverProfiles = async (): Promise<DriverProfile[]> => {
  if (!isSupabaseReady || !supabaseAdmin) {
    return (await readLocalUsers()).drivers;
  }

  const { data, error } = await supabaseAdmin
    .from("driver_profiles")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map(mapDriverRow) as DriverProfile[];
};

export const listPassengerProfiles = async (): Promise<PassengerProfile[]> => {
  if (!isSupabaseReady || !supabaseAdmin) {
    return (await readLocalUsers()).passengers;
  }

  const { data, error } = await supabaseAdmin
    .from("passenger_profiles")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map(mapPassengerRow) as PassengerProfile[];
};

const mapDriverRow = (row: {
  id: string;
  full_name: string;
  phone: string;
  city: string;
  approval_status: DriverProfile["approvalStatus"];
  documents_submitted: boolean;
  license_number: string;
  vehicle_description: string;
  created_at: string;
}): DriverProfile => ({
  id: row.id,
  fullName: row.full_name,
  phone: row.phone,
  city: row.city,
  approvalStatus: row.approval_status,
  documentsSubmitted: row.documents_submitted,
  licenseNumber: row.license_number,
  vehicleDescription: row.vehicle_description,
  createdAt: row.created_at
});

const mapPassengerRow = (row: {
  id: string;
  full_name: string;
  phone: string;
  city: string;
  created_at: string;
}): PassengerProfile => ({
  id: row.id,
  fullName: row.full_name,
  phone: row.phone,
  city: row.city,
  createdAt: row.created_at
});

const mapDriverPayload = (driver: DriverProfile) => ({
  id: driver.id,
  full_name: driver.fullName,
  phone: driver.phone,
  city: driver.city,
  approval_status: driver.approvalStatus,
  documents_submitted: driver.documentsSubmitted,
  license_number: driver.licenseNumber,
  vehicle_description: driver.vehicleDescription,
  created_at: driver.createdAt
});

const mapPassengerPayload = (passenger: PassengerProfile) => ({
  id: passenger.id,
  full_name: passenger.fullName,
  phone: passenger.phone,
  city: passenger.city,
  created_at: passenger.createdAt
});

export const writeUsers = async (payload: UserStorePayload) => {
  if (!isSupabaseReady || !supabaseAdmin) {
    await writeLocalUsers(payload);
    return;
  }

  if (payload.drivers.length > 0) {
    const { error } = await supabaseAdmin.from("driver_profiles").upsert(
      payload.drivers.map(mapDriverPayload)
    );

    if (error) {
      throw error;
    }
  }

  if (payload.passengers.length > 0) {
    const { error } = await supabaseAdmin.from("passenger_profiles").upsert(
      payload.passengers.map(mapPassengerPayload)
    );

    if (error) {
      throw error;
    }
  }
};

export const saveDriverProfile = async (driver: DriverProfile) => {
  if (!isSupabaseReady || !supabaseAdmin) {
    const users = await readLocalUsers();
    users.drivers = users.drivers.filter((entry) => entry.id !== driver.id);
    users.drivers.push(driver);
    await writeLocalUsers(users);
    return driver;
  }

  const { data, error } = await supabaseAdmin
    .from("driver_profiles")
    .upsert(mapDriverPayload(driver))
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return mapDriverRow(data);
};

export const getDriverProfile = async (driverId: string): Promise<DriverProfile | null> => {
  if (!isSupabaseReady || !supabaseAdmin) {
    return (await readLocalUsers()).drivers.find((entry) => entry.id === driverId) ?? null;
  }

  const { data, error } = await supabaseAdmin
    .from("driver_profiles")
    .select("*")
    .eq("id", driverId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? mapDriverRow(data) : null;
};

export const savePassengerProfile = async (passenger: PassengerProfile) => {
  if (!isSupabaseReady || !supabaseAdmin) {
    const users = await readLocalUsers();
    users.passengers = users.passengers.filter((entry) => entry.id !== passenger.id);
    users.passengers.push(passenger);
    await writeLocalUsers(users);
    return passenger;
  }

  const { data, error } = await supabaseAdmin
    .from("passenger_profiles")
    .upsert(mapPassengerPayload(passenger))
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return mapPassengerRow(data);
};

export const getPassengerProfile = async (
  passengerId: string
): Promise<PassengerProfile | null> => {
  if (!isSupabaseReady || !supabaseAdmin) {
    return (await readLocalUsers()).passengers.find((entry) => entry.id === passengerId) ?? null;
  }

  const { data, error } = await supabaseAdmin
    .from("passenger_profiles")
    .select("*")
    .eq("id", passengerId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? mapPassengerRow(data) : null;
};

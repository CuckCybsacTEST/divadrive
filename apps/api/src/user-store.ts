import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DriverProfile,
  InternalUserProfile,
  PassengerProfile
} from "@diva-drive/domain";
import { isSupabaseReady, supabaseAdmin } from "./supabase.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const dataDir = resolve(currentDir, "../data");
const usersFile = resolve(dataDir, "users.json");

interface UserStorePayload {
  drivers: DriverProfile[];
  passengers: PassengerProfile[];
  internalUsers: InternalUserProfile[];
}

const emptyPayload: UserStorePayload = {
  drivers: [],
  passengers: [],
  internalUsers: []
};

const normalizeDriverProfile = (driver: DriverProfile): DriverProfile => ({
  ...driver,
  operationalStatus: driver.operationalStatus ?? "active",
  availabilityStatus: driver.availabilityStatus ?? "offline",
  reviewNotes:
    typeof driver.reviewNotes === "string" && driver.reviewNotes.trim().length > 0
      ? driver.reviewNotes.trim()
      : undefined
});

const normalizeUserPayload = (value: unknown): UserStorePayload => {
  if (!value || typeof value !== "object") {
    return emptyPayload;
  }

  const candidate = value as Partial<UserStorePayload>;

  return {
    drivers: Array.isArray(candidate.drivers)
      ? candidate.drivers.map((driver) => normalizeDriverProfile(driver as DriverProfile))
      : [],
    passengers: Array.isArray(candidate.passengers) ? candidate.passengers : [],
    internalUsers: Array.isArray(candidate.internalUsers) ? candidate.internalUsers : []
  };
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
  return normalizeUserPayload(JSON.parse(content) as unknown);
};

export const writeLocalUsers = async (payload: UserStorePayload) => {
  await ensureDataFile();
  await writeFile(usersFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

export const readUsers = async (): Promise<UserStorePayload> => {
  if (!isSupabaseReady || !supabaseAdmin) {
    return readLocalUsers();
  }

  const [
    { data: drivers, error: driverError },
    { data: passengers, error: passengerError },
    { data: internalUsers, error: internalUsersError }
  ] =
    await Promise.all([
      supabaseAdmin.from("driver_profiles").select("*").order("created_at", { ascending: true }),
      supabaseAdmin.from("passenger_profiles").select("*").order("created_at", { ascending: true }),
      supabaseAdmin
        .from("internal_user_profiles")
        .select("*")
        .order("created_at", { ascending: true })
    ]);

  if (driverError) {
    throw driverError;
  }

  if (passengerError) {
    throw passengerError;
  }

  if (internalUsersError) {
    throw internalUsersError;
  }

  return {
    drivers: (drivers ?? []).map(mapDriverRow) as DriverProfile[],
    passengers: (passengers ?? []).map(mapPassengerRow) as PassengerProfile[],
    internalUsers: (internalUsers ?? []).map(mapInternalUserRow) as InternalUserProfile[]
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

export const listInternalUserProfiles = async (): Promise<InternalUserProfile[]> => {
  if (!isSupabaseReady || !supabaseAdmin) {
    return (await readLocalUsers()).internalUsers;
  }

  const { data, error } = await supabaseAdmin
    .from("internal_user_profiles")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map(mapInternalUserRow) as InternalUserProfile[];
};

const mapDriverRow = (row: {
  id: string;
  full_name: string;
  phone: string;
  city: string;
  approval_status: DriverProfile["approvalStatus"];
  operational_status?: DriverProfile["operationalStatus"];
  documents_submitted: boolean;
  license_number: string;
  vehicle_description: string;
  review_notes?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  created_at: string;
}): DriverProfile => normalizeDriverProfile({
  id: row.id,
  fullName: row.full_name,
  phone: row.phone,
  city: row.city,
  approvalStatus: row.approval_status,
  operationalStatus: row.operational_status ?? "active",
  documentsSubmitted: row.documents_submitted,
  licenseNumber: row.license_number,
  vehicleDescription: row.vehicle_description,
  reviewNotes: row.review_notes ?? undefined,
  reviewedAt: row.reviewed_at ?? undefined,
  reviewedBy: row.reviewed_by ?? undefined,
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

const mapInternalUserRow = (row: {
  id: string;
  role: InternalUserProfile["role"];
  full_name: string;
  phone: string;
  email: string;
  city: string;
  is_active: boolean;
  created_at: string;
}): InternalUserProfile => ({
  id: row.id,
  role: row.role,
  fullName: row.full_name,
  phone: row.phone,
  email: row.email,
  city: row.city,
  isActive: row.is_active,
  createdAt: row.created_at
});

const mapDriverPayload = (driver: DriverProfile) => ({
  id: driver.id,
  full_name: driver.fullName,
  phone: driver.phone,
  city: driver.city,
  approval_status: driver.approvalStatus,
  operational_status: driver.operationalStatus,
  documents_submitted: driver.documentsSubmitted,
  license_number: driver.licenseNumber,
  vehicle_description: driver.vehicleDescription,
  review_notes: driver.reviewNotes ?? null,
  reviewed_at: driver.reviewedAt ?? null,
  reviewed_by: driver.reviewedBy ?? null,
  created_at: driver.createdAt
});

const mapPassengerPayload = (passenger: PassengerProfile) => ({
  id: passenger.id,
  full_name: passenger.fullName,
  phone: passenger.phone,
  city: passenger.city,
  created_at: passenger.createdAt
});

const mapInternalUserPayload = (internalUser: InternalUserProfile) => ({
  id: internalUser.id,
  role: internalUser.role,
  full_name: internalUser.fullName,
  phone: internalUser.phone,
  email: internalUser.email,
  city: internalUser.city,
  is_active: internalUser.isActive,
  created_at: internalUser.createdAt
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

  if (payload.internalUsers.length > 0) {
    const { error } = await supabaseAdmin.from("internal_user_profiles").upsert(
      payload.internalUsers.map(mapInternalUserPayload)
    );

    if (error) {
      throw error;
    }
  }
};

export const saveDriverProfile = async (driver: DriverProfile) => {
  const normalizedDriver = normalizeDriverProfile(driver);

  if (!isSupabaseReady || !supabaseAdmin) {
    const users = await readLocalUsers();
    users.drivers = users.drivers.filter((entry) => entry.id !== normalizedDriver.id);
    users.drivers.push(normalizedDriver);
    await writeLocalUsers(users);
    return normalizedDriver;
  }

  const { data, error } = await supabaseAdmin
    .from("driver_profiles")
    .upsert(mapDriverPayload(normalizedDriver))
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

export const saveInternalUserProfile = async (internalUser: InternalUserProfile) => {
  if (!isSupabaseReady || !supabaseAdmin) {
    const users = await readLocalUsers();
    users.internalUsers = users.internalUsers.filter((entry) => entry.id !== internalUser.id);
    users.internalUsers.push(internalUser);
    await writeLocalUsers(users);
    return internalUser;
  }

  const { data, error } = await supabaseAdmin
    .from("internal_user_profiles")
    .upsert(mapInternalUserPayload(internalUser))
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return mapInternalUserRow(data);
};

export const getInternalUserProfile = async (
  internalUserId: string
): Promise<InternalUserProfile | null> => {
  if (!isSupabaseReady || !supabaseAdmin) {
    return (await readLocalUsers()).internalUsers.find((entry) => entry.id === internalUserId) ?? null;
  }

  const { data, error } = await supabaseAdmin
    .from("internal_user_profiles")
    .select("*")
    .eq("id", internalUserId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? mapInternalUserRow(data) : null;
};

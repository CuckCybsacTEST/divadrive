import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TripIncident } from "@diva-drive/domain";
import { isSupabaseReady, supabaseAdmin } from "./supabase.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const dataDir = resolve(currentDir, "../data");
const incidentsFile = resolve(dataDir, "incidents.json");

const ensureDataFile = async () => {
  await mkdir(dataDir, { recursive: true });

  try {
    await readFile(incidentsFile, "utf8");
  } catch {
    await writeFile(incidentsFile, "[]\n", "utf8");
  }
};

export const readLocalIncidents = async (): Promise<TripIncident[]> => {
  await ensureDataFile();
  const content = await readFile(incidentsFile, "utf8");
  return JSON.parse(content) as TripIncident[];
};

export const writeLocalIncidents = async (incidents: TripIncident[]) => {
  await ensureDataFile();
  await writeFile(incidentsFile, `${JSON.stringify(incidents, null, 2)}\n`, "utf8");
};

export const readIncidents = async (): Promise<TripIncident[]> => {
  if (!isSupabaseReady || !supabaseAdmin) {
    return readLocalIncidents();
  }

  const { data, error } = await supabaseAdmin
    .from("trip_incidents")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map(mapIncidentRow) as TripIncident[];
};

export const getIncident = async (incidentId: string): Promise<TripIncident | null> => {
  if (!isSupabaseReady || !supabaseAdmin) {
    return (await readLocalIncidents()).find((entry) => entry.id === incidentId) ?? null;
  }

  const { data, error } = await supabaseAdmin
    .from("trip_incidents")
    .select("*")
    .eq("id", incidentId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? mapIncidentRow(data) : null;
};

export const listIncidentsByTrip = async (tripId: string): Promise<TripIncident[]> => {
  if (!isSupabaseReady || !supabaseAdmin) {
    return (await readLocalIncidents()).filter((entry) => entry.tripId === tripId);
  }

  const { data, error } = await supabaseAdmin
    .from("trip_incidents")
    .select("*")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map(mapIncidentRow) as TripIncident[];
};

const mapIncidentRow = (row: {
  id: string;
  trip_id: string;
  reporter_role: TripIncident["reporterRole"];
  reporter_id: string;
  severity: TripIncident["severity"];
  category: string;
  notes: string;
  created_at: string;
  status: TripIncident["status"];
}): TripIncident => ({
  id: row.id,
  tripId: row.trip_id,
  reporterRole: row.reporter_role,
  reporterId: row.reporter_id,
  severity: row.severity,
  category: row.category,
  notes: row.notes,
  createdAt: row.created_at,
  status: row.status
});

const mapIncidentPayload = (incident: TripIncident) => ({
  id: incident.id,
  trip_id: incident.tripId,
  reporter_role: incident.reporterRole,
  reporter_id: incident.reporterId,
  severity: incident.severity,
  category: incident.category,
  notes: incident.notes,
  created_at: incident.createdAt,
  status: incident.status
});

export const writeIncidents = async (incidents: TripIncident[]) => {
  if (!isSupabaseReady || !supabaseAdmin) {
    await writeLocalIncidents(incidents);
    return;
  }

  if (incidents.length === 0) {
    return;
  }

  const payload = incidents.map(mapIncidentPayload);

  const { error } = await supabaseAdmin.from("trip_incidents").upsert(payload);

  if (error) {
    throw error;
  }
};

export const saveIncident = async (incident: TripIncident) => {
  if (!isSupabaseReady || !supabaseAdmin) {
    const incidents = await readLocalIncidents();
    const nextIncidents = incidents.filter((entry) => entry.id !== incident.id);
    nextIncidents.push(incident);
    await writeLocalIncidents(nextIncidents);
    return incident;
  }

  const { data, error } = await supabaseAdmin
    .from("trip_incidents")
    .upsert(mapIncidentPayload(incident))
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return mapIncidentRow(data);
};

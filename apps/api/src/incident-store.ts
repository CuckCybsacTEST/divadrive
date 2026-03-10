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

  return (data ?? []).map((row) => ({
    id: row.id,
    tripId: row.trip_id,
    reporterRole: row.reporter_role,
    reporterId: row.reporter_id,
    severity: row.severity,
    category: row.category,
    notes: row.notes,
    createdAt: row.created_at,
    status: row.status
  })) as TripIncident[];
};

export const writeIncidents = async (incidents: TripIncident[]) => {
  if (!isSupabaseReady || !supabaseAdmin) {
    await writeLocalIncidents(incidents);
    return;
  }

  if (incidents.length === 0) {
    return;
  }

  const payload = incidents.map((incident) => ({
    id: incident.id,
    trip_id: incident.tripId,
    reporter_role: incident.reporterRole,
    reporter_id: incident.reporterId,
    severity: incident.severity,
    category: incident.category,
    notes: incident.notes,
    created_at: incident.createdAt,
    status: incident.status
  }));

  const { error } = await supabaseAdmin.from("trip_incidents").upsert(payload);

  if (error) {
    throw error;
  }
};

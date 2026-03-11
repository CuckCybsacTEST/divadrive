import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TripTimelineEvent } from "@diva-drive/domain";
import { isSupabaseReady, supabaseAdmin } from "./supabase.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const dataDir = resolve(currentDir, "../data");
const eventsFile = resolve(dataDir, "events.json");

const ensureDataFile = async () => {
  await mkdir(dataDir, { recursive: true });

  try {
    await readFile(eventsFile, "utf8");
  } catch {
    await writeFile(eventsFile, "[]\n", "utf8");
  }
};

export const readLocalEvents = async (): Promise<TripTimelineEvent[]> => {
  await ensureDataFile();
  const content = await readFile(eventsFile, "utf8");
  return JSON.parse(content) as TripTimelineEvent[];
};

export const writeLocalEvents = async (events: TripTimelineEvent[]) => {
  await ensureDataFile();
  await writeFile(eventsFile, `${JSON.stringify(events, null, 2)}\n`, "utf8");
};

export const readEvents = async (): Promise<TripTimelineEvent[]> => {
  if (!isSupabaseReady || !supabaseAdmin) {
    return readLocalEvents();
  }

  const { data, error } = await supabaseAdmin
    .from("trip_events")
    .select("*")
    .order("occurred_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map(mapEventRow) as TripTimelineEvent[];
};

export const listEventsByTrip = async (tripId: string): Promise<TripTimelineEvent[]> => {
  if (!isSupabaseReady || !supabaseAdmin) {
    return (await readLocalEvents()).filter((entry) => entry.tripId === tripId);
  }

  const { data, error } = await supabaseAdmin
    .from("trip_events")
    .select("*")
    .eq("trip_id", tripId)
    .order("occurred_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []).map(mapEventRow) as TripTimelineEvent[];
};

export const getEventById = async (eventId: string): Promise<TripTimelineEvent | null> => {
  if (!isSupabaseReady || !supabaseAdmin) {
    return (await readLocalEvents()).find((entry) => entry.id === eventId) ?? null;
  }

  const { data, error } = await supabaseAdmin
    .from("trip_events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? mapEventRow(data) : null;
};

export const listRecentEvents = async (limit = 30): Promise<TripTimelineEvent[]> => {
  if (!isSupabaseReady || !supabaseAdmin) {
    return (await readLocalEvents())
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, limit);
  }

  const { data, error } = await supabaseAdmin
    .from("trip_events")
    .select("*")
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data ?? []).map(mapEventRow) as TripTimelineEvent[];
};

const mapEventRow = (row: {
  id: string;
  trip_id: string;
  type: TripTimelineEvent["type"];
  occurred_at: string;
  actor_id: string | null;
  actor_role: TripTimelineEvent["actorRole"] | null;
  message: string;
}): TripTimelineEvent => ({
  id: row.id,
  tripId: row.trip_id,
  type: row.type,
  occurredAt: row.occurred_at,
  actorId: row.actor_id ?? undefined,
  actorRole: row.actor_role ?? undefined,
  message: row.message
});

const mapEventPayload = (event: TripTimelineEvent) => ({
  id: event.id,
  trip_id: event.tripId,
  type: event.type,
  occurred_at: event.occurredAt,
  actor_id: event.actorId ?? null,
  actor_role: event.actorRole ?? null,
  message: event.message
});

export const writeEvents = async (events: TripTimelineEvent[]) => {
  if (!isSupabaseReady || !supabaseAdmin) {
    await writeLocalEvents(events);
    return;
  }

  if (events.length === 0) {
    return;
  }

  const payload = events.map(mapEventPayload);

  const { error } = await supabaseAdmin.from("trip_events").upsert(payload);

  if (error) {
    throw error;
  }
};

export const appendEvent = async (event: TripTimelineEvent) => {
  if (!isSupabaseReady || !supabaseAdmin) {
    const events = await readLocalEvents();
    events.push(event);
    await writeLocalEvents(events);
    return event;
  }

  const { data, error } = await supabaseAdmin
    .from("trip_events")
    .insert(mapEventPayload(event))
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return mapEventRow(data);
};

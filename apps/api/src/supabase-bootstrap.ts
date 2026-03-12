import { isSupabaseReady, supabaseAdmin } from "./supabase.js";
import { readLocalBusinessRules, writeBusinessRules } from "./business-store.js";
import { readLocalEvents, writeEvents } from "./event-store.js";
import { readLocalIncidents, writeIncidents } from "./incident-store.js";
import { readLocalTrips, writeTrips } from "./trip-store.js";
import { readLocalUsers, writeUsers } from "./user-store.js";

const tableHasRows = async (table: string) => {
  if (!isSupabaseReady || !supabaseAdmin) {
    return false;
  }

  const { count, error } = await supabaseAdmin
    .from(table)
    .select("*", { count: "exact", head: true });

  if (error) {
    throw error;
  }

  return (count ?? 0) > 0;
};

export const syncLocalDataToSupabase = async () => {
  if (!isSupabaseReady || !supabaseAdmin) {
    return;
  }

  const [
    hasPassengers,
    hasDrivers,
    hasInternalUsers,
    hasTrips,
    hasIncidents,
    hasEvents,
    hasBusinessConfig,
    hasPromotions,
    hasBusinessAuditLog
  ] = await Promise.all([
    tableHasRows("passenger_profiles"),
    tableHasRows("driver_profiles"),
    tableHasRows("internal_user_profiles"),
    tableHasRows("trips"),
    tableHasRows("trip_incidents"),
    tableHasRows("trip_events"),
    tableHasRows("business_config"),
    tableHasRows("promotions"),
    tableHasRows("business_audit_log")
  ]);

  if (!hasPassengers || !hasDrivers || !hasInternalUsers) {
    const localUsers = await readLocalUsers();
    if (
      localUsers.drivers.length > 0 ||
      localUsers.passengers.length > 0 ||
      localUsers.internalUsers.length > 0
    ) {
      await writeUsers(localUsers);
    }
  }

  if (!hasTrips) {
    const localTrips = await readLocalTrips();
    if (localTrips.length > 0) {
      await writeTrips(localTrips);
    }
  }

  if (!hasIncidents) {
    const localIncidents = await readLocalIncidents();
    if (localIncidents.length > 0) {
      await writeIncidents(localIncidents);
    }
  }

  if (!hasEvents) {
    const localEvents = await readLocalEvents();
    if (localEvents.length > 0) {
      await writeEvents(localEvents);
    }
  }

  if (!hasBusinessConfig || !hasPromotions || !hasBusinessAuditLog) {
    const localBusinessRules = await readLocalBusinessRules();
    await writeBusinessRules(localBusinessRules);
  }
};

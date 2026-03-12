import type {
  DriverAttentionSnapshot,
  CommercialMetricsSnapshot,
  OpsDashboardSnapshot,
  ZoneOperationalHealth
} from "@diva-drive/domain";
import type {
  BusinessRepository,
  DirectoryRepository,
  TripRepository
} from "../repositories/contracts.js";

interface OpsServiceDependencies {
  directoryRepository: Pick<DirectoryRepository, "listDriverProfiles">;
  businessRepository: Pick<BusinessRepository, "listOperationalZones">;
  tripRepository: Pick<
    TripRepository,
    | "listIncidents"
    | "listEventsByTrip"
    | "listRecentEvents"
    | "listTrips"
    | "listTripsByStatus"
  >;
}

export const createOpsService = ({
  businessRepository,
  directoryRepository,
  tripRepository
}: OpsServiceDependencies) => {
  const getOpsEventStream = async () => tripRepository.listRecentEvents(30);

  const getOpsSnapshot = async (): Promise<OpsDashboardSnapshot> => {
    const [requestedTrips, completedTripsRaw, cancelledTripsRaw, allTripsRaw, incidentsRaw] =
      await Promise.all([
        tripRepository.listTripsByStatus("requested"),
        tripRepository.listTripsByStatus("trip_completed"),
        tripRepository.listTripsByStatus("cancelled"),
        tripRepository.listTrips(),
        tripRepository.listIncidents()
      ]);
    const allTrips = allTripsRaw.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    const queueTrips = requestedTrips.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    const completedTrips = completedTripsRaw.sort((a, b) =>
      b.requestedAt.localeCompare(a.requestedAt)
    );
    const cancelledTrips = cancelledTripsRaw.sort((a, b) =>
      b.requestedAt.localeCompare(a.requestedAt)
    );
    const activeTrips = allTrips.filter(
      (trip) =>
        trip.status !== "requested" &&
        trip.status !== "trip_completed" &&
        trip.status !== "cancelled" &&
        trip.status !== "expired"
    );
    const incidents = incidentsRaw.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return {
      queueTrips,
      activeTrips,
      completedTrips,
      cancelledTrips,
      incidents,
      totals: {
        requested: queueTrips.length,
        active: activeTrips.length,
        completed: completedTrips.length,
        cancelled: cancelledTrips.length,
        openIncidents: incidents.filter((incident) => incident.status !== "resolved").length
      }
    };
  };

  const getCommercialMetrics = async (): Promise<CommercialMetricsSnapshot> => {
    const [allTrips, driverProfiles, operationalZones] = await Promise.all([
      tripRepository.listTrips(),
      directoryRepository.listDriverProfiles(),
      Promise.resolve(businessRepository.listOperationalZones())
    ]);
    const completedTrips = allTrips.filter((trip) => trip.status === "trip_completed");
    const cancelledTrips = allTrips.filter((trip) => trip.status === "cancelled");
    const matchedTrips = allTrips.filter(
      (trip) =>
        trip.status === "matched" ||
        trip.status === "driver_en_route" ||
        trip.status === "driver_arrived" ||
        trip.status === "trip_started" ||
        trip.status === "trip_completed"
    );
    const expiredTrips = allTrips.filter((trip) => trip.status === "expired");
    const pendingReservedTrips = allTrips.filter(
      (trip) => {
        if (trip.status !== "requested" || !trip.reservedDriverId || !trip.reservedUntil) {
          return false;
        }

        return new Date(trip.reservedUntil).getTime() > Date.now();
      }
    );
    const totalRevenue = Number(
      completedTrips.reduce((sum, trip) => sum + trip.estimate.estimatedFare, 0).toFixed(2)
    );
    const totalDiscountAmount = Number(
      allTrips
        .reduce((sum, trip) => sum + trip.estimate.fareBreakdown.discountAmount, 0)
        .toFixed(2)
    );
    const averageCompletedFare =
      completedTrips.length === 0
        ? 0
        : Number((totalRevenue / completedTrips.length).toFixed(2));

    const promoPerformanceMap = new Map<string, { uses: number; totalDiscountAmount: number }>();

    for (const trip of allTrips) {
      const appliedPromotion = trip.estimate.appliedPromotion;
      if (!appliedPromotion) {
        continue;
      }

      const current = promoPerformanceMap.get(appliedPromotion.code) ?? {
        uses: 0,
        totalDiscountAmount: 0
      };

      current.uses += 1;
      current.totalDiscountAmount = Number(
        (current.totalDiscountAmount + appliedPromotion.discountAmount).toFixed(2)
      );
      promoPerformanceMap.set(appliedPromotion.code, current);
    }

    const timelines = await Promise.all(
      matchedTrips.map(async (trip) => ({
        trip,
        events: await tripRepository.listEventsByTrip(trip.id)
      }))
    );

    const reassignedOffers = timelines.reduce(
      (sum, entry) =>
        sum +
        entry.events.filter((event) => event.type === "trip_offer_reassigned").length,
      0
    );
    const matchDurationsSeconds = timelines
      .map((entry) => {
        const matchedEvent = entry.events.find((event) => event.type === "trip_matched");
        if (!matchedEvent) {
          return null;
        }

        return Math.max(
          0,
          Math.round(
            (new Date(matchedEvent.occurredAt).getTime() -
              new Date(entry.trip.requestedAt).getTime()) /
              1000
          )
        );
      })
      .filter((value): value is number => value !== null);
    const averageSecondsToMatch =
      matchDurationsSeconds.length === 0
        ? 0
        : Math.round(
            matchDurationsSeconds.reduce((sum, value) => sum + value, 0) /
              matchDurationsSeconds.length
          );
    const zoneHealth: ZoneOperationalHealth[] = operationalZones
      .map((zone) => {
        const zoneTrips = allTrips.filter((trip) => trip.operationalZoneId === zone.id);
        const zoneTripIds = new Set(zoneTrips.map((trip) => trip.id));
        const zoneReassignedOffers = timelines.reduce(
          (sum, entry) =>
            zoneTripIds.has(entry.trip.id)
              ? sum +
                entry.events.filter((event) => event.type === "trip_offer_reassigned").length
              : sum,
          0
        );

        return {
          zoneId: zone.id,
          zoneName: zone.name,
          requestedTrips: zoneTrips.filter((trip) => trip.status === "requested").length,
          expiredRequests: zoneTrips.filter((trip) => trip.status === "expired").length,
          reassignedOffers: zoneReassignedOffers,
          pendingReservations: zoneTrips.filter(
            (trip) =>
              trip.status === "requested" &&
              Boolean(trip.reservedDriverId && trip.reservedUntil) &&
              new Date(trip.reservedUntil ?? 0).getTime() > Date.now()
          ).length
        };
      })
      .sort(
        (a, b) =>
          b.expiredRequests +
            b.reassignedOffers +
            b.pendingReservations -
          (a.expiredRequests + a.reassignedOffers + a.pendingReservations)
      );

    const driverAttention: DriverAttentionSnapshot[] = driverProfiles
      .filter((driver) => driver.approvalStatus === "approved")
      .map((driver) => {
        const currentlyReservedTrips = allTrips.filter(
          (trip) =>
            trip.status === "requested" &&
            trip.reservedDriverId === driver.id &&
            Boolean(trip.reservedUntil) &&
            new Date(trip.reservedUntil ?? 0).getTime() > Date.now()
        );
        const reassignedAwayOffers = allTrips.filter(
          (trip) =>
            trip.status === "requested" &&
            trip.reservedDriverId !== driver.id &&
            trip.offeredDriverIds?.includes(driver.id)
        ).length;

        return {
          driverId: driver.id,
          fullName: driver.fullName,
          activeReservations: currentlyReservedTrips.length,
          reassignedAwayOffers,
          currentOfferZoneId: currentlyReservedTrips[0]?.operationalZoneId
        };
      })
      .filter((driver) => driver.activeReservations > 0 || driver.reassignedAwayOffers > 0)
      .sort(
        (a, b) =>
          b.reassignedAwayOffers + b.activeReservations -
          (a.reassignedAwayOffers + a.activeReservations)
      );

    return {
      totalRevenue,
      totalDiscountAmount,
      completedTrips: completedTrips.length,
      cancelledTrips: cancelledTrips.length,
      averageCompletedFare,
      matchedTrips: matchedTrips.length,
      expiredRequests: expiredTrips.length,
      pendingReservedTrips: pendingReservedTrips.length,
      reassignedOffers,
      averageSecondsToMatch,
      zoneHealth,
      driverAttention,
      promoPerformance: Array.from(promoPerformanceMap.entries())
        .map(([code, value]) => ({
          code,
          uses: value.uses,
          totalDiscountAmount: value.totalDiscountAmount
        }))
        .sort((a, b) => b.uses - a.uses)
    };
  };

  return {
    getCommercialMetrics,
    getOpsEventStream,
    getOpsSnapshot
  };
};

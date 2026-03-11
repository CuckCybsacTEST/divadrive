import type {
  CommercialMetricsSnapshot,
  OpsDashboardSnapshot
} from "@diva-drive/domain";
import type { TripRepository } from "../repositories/contracts.js";

interface OpsServiceDependencies {
  tripRepository: Pick<
    TripRepository,
    | "listIncidents"
    | "listRecentEvents"
    | "listTrips"
    | "listTripsByStatus"
  >;
}

export const createOpsService = ({ tripRepository }: OpsServiceDependencies) => {
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
    const allTrips = await tripRepository.listTrips();
    const completedTrips = allTrips.filter((trip) => trip.status === "trip_completed");
    const cancelledTrips = allTrips.filter((trip) => trip.status === "cancelled");
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

    return {
      totalRevenue,
      totalDiscountAmount,
      completedTrips: completedTrips.length,
      cancelledTrips: cancelledTrips.length,
      averageCompletedFare,
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

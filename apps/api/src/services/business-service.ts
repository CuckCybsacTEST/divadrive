import type {
  BusinessAuditEntry,
  BusinessRulesSnapshot,
  Coordinates,
  OperationalZone,
  PricingConfig,
  RideEstimate,
  RideEstimateRequest,
  AuthSession
} from "@diva-drive/domain";
import { resolveOperationalZoneForRoute } from "@diva-drive/domain";
import type { BusinessRepository, TripRepository } from "../repositories/contracts.js";

interface BusinessServiceDependencies {
  businessRepository: Pick<
    BusinessRepository,
    | "cacheBusinessAuditEntry"
    | "getPricingConfig"
    | "getSnapshot"
    | "hydrateSnapshot"
    | "listBusinessAuditEntries"
    | "listOperationalZones"
    | "listPromotions"
  >;
  tripRepository: Pick<TripRepository, "listTripsByPassenger">;
}

const toRadians = (value: number) => (value * Math.PI) / 180;

export const createBusinessService = ({
  businessRepository,
  tripRepository
}: BusinessServiceDependencies) => {
  const getBusinessSnapshot = (): BusinessRulesSnapshot => businessRepository.getSnapshot();

  const hydrateBusinessState = (snapshot: BusinessRulesSnapshot) =>
    businessRepository.hydrateSnapshot(snapshot);

  const listOperationalZones = (): OperationalZone[] => businessRepository.listOperationalZones();

  const resolveOperationalZone = (
    origin: Coordinates,
    destination: Coordinates
  ): OperationalZone | null =>
    resolveOperationalZoneForRoute(origin, destination, businessRepository.listOperationalZones());

  const appendBusinessAudit = (
    session: AuthSession,
    action: BusinessAuditEntry["action"],
    summary: string
  ) => {
    const entry = {
      id: `biz-${Date.now()}-${businessRepository.listBusinessAuditEntries().length + 1}`,
      actorId: session.user.id,
      actorRole: session.user.role as BusinessAuditEntry["actorRole"],
      action,
      summary,
      occurredAt: new Date().toISOString()
    };
    businessRepository.cacheBusinessAuditEntry(entry);
    return entry;
  };

  const isPassengerNew = async (passengerId: string) => {
    const trips = await tripRepository.listTripsByPassenger(passengerId);
    return !trips.some((trip) => trip.passengerId === passengerId);
  };

  const buildAppliedPromotion = async (
    fareBeforeDiscount: number,
    passengerId: string,
    requestedPromoCode?: string
  ) => {
    const normalizedCode = requestedPromoCode?.trim().toUpperCase();
    const audience = (await isPassengerNew(passengerId))
      ? "new_passenger"
      : "returning_passenger";
    const eligiblePromotions = businessRepository.listPromotions().filter((promotion) => {
      if (!promotion.isActive || fareBeforeDiscount < promotion.minFare) {
        return false;
      }

      if (promotion.audience !== "all" && promotion.audience !== audience) {
        return false;
      }

      if (promotion.applyMode === "code") {
        return normalizedCode === promotion.code;
      }

      return !normalizedCode || normalizedCode === promotion.code;
    });

    if (eligiblePromotions.length === 0) {
      return null;
    }

    const candidates = eligiblePromotions
      .map((promotion) => {
        const rawDiscount =
          promotion.kind === "flat"
            ? promotion.value
            : (fareBeforeDiscount * promotion.value) / 100;
        const discountAmount = Number(Math.min(rawDiscount, fareBeforeDiscount).toFixed(2));

        return {
          promotionId: promotion.id,
          name: promotion.name,
          code: promotion.code,
          discountAmount
        };
      })
      .sort((a, b) => b.discountAmount - a.discountAmount);

    return candidates[0] ?? null;
  };

  const estimateRide = async (
    { origin, destination, promoCode }: RideEstimateRequest,
    passengerId: string
  ): Promise<RideEstimate> => {
    const pricingConfig: PricingConfig = businessRepository.getPricingConfig();
    const earthRadiusKm = 6371;
    const deltaLatitude = toRadians(destination.latitude - origin.latitude);
    const deltaLongitude = toRadians(destination.longitude - origin.longitude);
    const latitudeA = toRadians(origin.latitude);
    const latitudeB = toRadians(destination.latitude);

    const haversine =
      Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2) +
      Math.cos(latitudeA) *
        Math.cos(latitudeB) *
        Math.sin(deltaLongitude / 2) *
        Math.sin(deltaLongitude / 2);

    const distanceKm = Number(
      (earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))).toFixed(1)
    );
    const trafficFactor =
      Math.abs(destination.longitude - origin.longitude) > 0.04 ? 1.22 : 1.08;
    const durationMinutes = Math.max(8, Math.round(distanceKm * 3.4 * trafficFactor));
    const subtotal = Math.max(
      pricingConfig.minimumFare,
      Number(
        (
          (pricingConfig.baseFare +
            distanceKm * pricingConfig.perKmRate +
            durationMinutes * pricingConfig.perMinuteRate) *
          pricingConfig.surgeMultiplier
        ).toFixed(2)
      )
    );
    const serviceFee = Number(pricingConfig.serviceFee.toFixed(2));
    const fareBeforeDiscount = Number((subtotal + serviceFee).toFixed(2));
    const appliedPromotion = await buildAppliedPromotion(
      fareBeforeDiscount,
      passengerId,
      promoCode
    );
    const discountAmount = Number((appliedPromotion?.discountAmount ?? 0).toFixed(2));
    const estimatedFare = Number(Math.max(fareBeforeDiscount - discountAmount, 0).toFixed(2));
    const routePoints = Array.from({ length: 6 }, (_, index) => {
      const progress = index / 5;
      const arc = Math.sin(progress * Math.PI) * 0.006;
      return {
        latitude:
          origin.latitude + (destination.latitude - origin.latitude) * progress + arc / 2,
        longitude:
          origin.longitude + (destination.longitude - origin.longitude) * progress - arc
      };
    });

    return {
      currency: pricingConfig.currency,
      distanceKm,
      durationMinutes,
      estimatedFare,
      fareBreakdown: {
        subtotal,
        serviceFee,
        discountAmount,
        total: estimatedFare
      },
      appliedPromotion,
      route: {
        points: routePoints
      }
    };
  };

  return {
    appendBusinessAudit,
    estimateRide,
    getBusinessSnapshot,
    hydrateBusinessState,
    listOperationalZones,
    resolveOperationalZone
  };
};

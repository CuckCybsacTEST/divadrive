import type {
  Coordinates,
  DriverAvailabilityStatus,
  DriverOperationalStatus,
  DriverProfile,
  InternalUserProfile,
  PassengerProfile
} from "@diva-drive/domain";
import { mapPersistenceError } from "../errors.js";
import type { DirectoryRepository, DirectoryWriteRepository } from "./contracts.js";

interface DirectoryRepositoryDependencies {
  driverProfilesById: Map<string, DriverProfile>;
  internalUserProfilesById: Map<string, InternalUserProfile>;
  passengerProfilesById: Map<string, PassengerProfile>;
  getDriverProfile: (driverId: string) => Promise<DriverProfile | null>;
  getInternalUserProfile: (internalUserId: string) => Promise<InternalUserProfile | null>;
  getPassengerProfile: (passengerId: string) => Promise<PassengerProfile | null>;
  listDriverProfiles: () => Promise<DriverProfile[]>;
  listInternalUserProfiles: () => Promise<InternalUserProfile[]>;
  listPassengerProfiles: () => Promise<PassengerProfile[]>;
  saveDriverProfile: (profile: DriverProfile) => Promise<DriverProfile>;
  saveInternalUserProfile: (profile: InternalUserProfile) => Promise<InternalUserProfile>;
  savePassengerProfile: (profile: PassengerProfile) => Promise<PassengerProfile>;
}

export const createDirectoryRepository = ({
  driverProfilesById,
  internalUserProfilesById,
  passengerProfilesById,
  getDriverProfile,
  getInternalUserProfile,
  getPassengerProfile,
  listDriverProfiles,
  listInternalUserProfiles,
  listPassengerProfiles,
  saveDriverProfile,
  saveInternalUserProfile,
  savePassengerProfile
}: DirectoryRepositoryDependencies): DirectoryRepository => {
  const normalizeDriverProfile = (
    profile: DriverProfile,
    fallback?: {
      availabilityStatus?: DriverAvailabilityStatus;
      operationalStatus?: DriverOperationalStatus;
      lastKnownLocation?: Coordinates;
      lastLocationAt?: string;
      reviewNotes?: string;
      reviewedAt?: string;
      reviewedBy?: string;
    }
  ): DriverProfile => ({
    ...profile,
    operationalStatus:
      profile.operationalStatus ??
      fallback?.operationalStatus ??
      driverProfilesById.get(profile.id)?.operationalStatus ??
      "active",
    availabilityStatus:
      profile.availabilityStatus ??
      fallback?.availabilityStatus ??
      driverProfilesById.get(profile.id)?.availabilityStatus ??
      "offline",
    lastKnownLocation:
      profile.lastKnownLocation ??
      fallback?.lastKnownLocation ??
      driverProfilesById.get(profile.id)?.lastKnownLocation,
    lastLocationAt:
      profile.lastLocationAt ??
      fallback?.lastLocationAt ??
      driverProfilesById.get(profile.id)?.lastLocationAt,
    reviewNotes:
      profile.reviewNotes ??
      fallback?.reviewNotes ??
      driverProfilesById.get(profile.id)?.reviewNotes,
    reviewedAt:
      profile.reviewedAt ??
      fallback?.reviewedAt ??
      driverProfilesById.get(profile.id)?.reviewedAt,
    reviewedBy:
      profile.reviewedBy ??
      fallback?.reviewedBy ??
      driverProfilesById.get(profile.id)?.reviewedBy
  });

  const cacheDriverProfile = (
    profile: DriverProfile,
    fallback?: {
      availabilityStatus?: DriverAvailabilityStatus;
      operationalStatus?: DriverOperationalStatus;
      lastKnownLocation?: Coordinates;
      lastLocationAt?: string;
      reviewNotes?: string;
      reviewedAt?: string;
      reviewedBy?: string;
    }
  ) => {
    const normalizedProfile = normalizeDriverProfile(profile, fallback);
    driverProfilesById.set(normalizedProfile.id, normalizedProfile);
    return normalizedProfile;
  };

  const cachePassengerProfile = (profile: PassengerProfile) => {
    passengerProfilesById.set(profile.id, profile);
    return profile;
  };

  const cacheInternalUserProfile = (profile: InternalUserProfile) => {
    internalUserProfilesById.set(profile.id, profile);
    return profile;
  };

  return {
    cacheDriverProfile,
    cacheInternalUserProfile,
    cachePassengerProfile,

    async getDriverProfileById(driverId) {
      const cachedProfile = driverProfilesById.get(driverId);
      if (cachedProfile) {
        return cachedProfile;
      }

      const profile = await getDriverProfile(driverId);
      return profile ? cacheDriverProfile(profile) : null;
    },

    async getPassengerProfileById(passengerId) {
      const cachedProfile = passengerProfilesById.get(passengerId);
      if (cachedProfile) {
        return cachedProfile;
      }

      const profile = await getPassengerProfile(passengerId);
      return profile ? cachePassengerProfile(profile) : null;
    },

    async getInternalUserProfileById(internalUserId) {
      const cachedProfile = internalUserProfilesById.get(internalUserId);
      if (cachedProfile) {
        return cachedProfile;
      }

      const profile = await getInternalUserProfile(internalUserId);
      return profile ? cacheInternalUserProfile(profile) : null;
    },

    hydrateSnapshot(payload) {
      driverProfilesById.clear();
      internalUserProfilesById.clear();
      passengerProfilesById.clear();

      for (const driver of payload.drivers) {
        cacheDriverProfile(driver);
      }

      for (const passenger of payload.passengers) {
        cachePassengerProfile(passenger);
      }

      for (const internalUser of payload.internalUsers) {
        cacheInternalUserProfile(internalUser);
      }

      return {
        drivers: [...payload.drivers].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        passengers: [...payload.passengers].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        internalUsers: [...payload.internalUsers].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      };
    },

    async listDriverProfiles() {
      return (await listDriverProfiles()).map((profile) => cacheDriverProfile(profile));
    },

    async listInternalUserProfiles() {
      return (await listInternalUserProfiles()).map(cacheInternalUserProfile);
    },

    async listPassengerProfiles() {
      return (await listPassengerProfiles()).map(cachePassengerProfile);
    },

    async saveDriverProfile(profile) {
      try {
        return cacheDriverProfile(
          await saveDriverProfile(profile),
          {
            availabilityStatus: profile.availabilityStatus,
            operationalStatus: profile.operationalStatus,
            lastKnownLocation: profile.lastKnownLocation,
            lastLocationAt: profile.lastLocationAt,
            reviewNotes: profile.reviewNotes,
            reviewedAt: profile.reviewedAt,
            reviewedBy: profile.reviewedBy
          }
        );
      } catch (error) {
        return mapPersistenceError(error, {
          conflictCode: "driver_profile_persistence_failed",
          fallbackCode: "driver_profile_persistence_failed"
        });
      }
    },

    async savePassengerProfile(profile) {
      try {
        return cachePassengerProfile(await savePassengerProfile(profile));
      } catch (error) {
        return mapPersistenceError(error, {
          conflictCode: "driver_profile_persistence_failed",
          fallbackCode: "driver_profile_persistence_failed"
        });
      }
    },

    async saveInternalUserProfile(profile) {
      try {
        return cacheInternalUserProfile(await saveInternalUserProfile(profile));
      } catch (error) {
        return mapPersistenceError(error, {
          conflictCode: "driver_profile_persistence_failed",
          fallbackCode: "driver_profile_persistence_failed"
        });
      }
    }
  };
};

export const createDirectoryWriteRepository = (
  dependencies: DirectoryRepositoryDependencies
): DirectoryWriteRepository => createDirectoryRepository(dependencies);

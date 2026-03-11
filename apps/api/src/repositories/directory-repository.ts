import type {
  Coordinates,
  DriverAvailabilityStatus,
  DriverProfile,
  PassengerProfile
} from "@diva-drive/domain";
import { mapPersistenceError } from "../errors.js";
import type { DirectoryRepository, DirectoryWriteRepository } from "./contracts.js";

interface DirectoryRepositoryDependencies {
  driverProfilesById: Map<string, DriverProfile>;
  passengerProfilesById: Map<string, PassengerProfile>;
  getDriverProfile: (driverId: string) => Promise<DriverProfile | null>;
  getPassengerProfile: (passengerId: string) => Promise<PassengerProfile | null>;
  listDriverProfiles: () => Promise<DriverProfile[]>;
  listPassengerProfiles: () => Promise<PassengerProfile[]>;
  saveDriverProfile: (profile: DriverProfile) => Promise<DriverProfile>;
  savePassengerProfile: (profile: PassengerProfile) => Promise<PassengerProfile>;
}

export const createDirectoryRepository = ({
  driverProfilesById,
  passengerProfilesById,
  getDriverProfile,
  getPassengerProfile,
  listDriverProfiles,
  listPassengerProfiles,
  saveDriverProfile,
  savePassengerProfile
}: DirectoryRepositoryDependencies): DirectoryRepository => {
  const normalizeDriverProfile = (
    profile: DriverProfile,
    fallback?: {
      availabilityStatus?: DriverAvailabilityStatus;
      lastKnownLocation?: Coordinates;
      lastLocationAt?: string;
    }
  ): DriverProfile => ({
    ...profile,
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
      driverProfilesById.get(profile.id)?.lastLocationAt
  });

  const cacheDriverProfile = (
    profile: DriverProfile,
    fallback?: {
      availabilityStatus?: DriverAvailabilityStatus;
      lastKnownLocation?: Coordinates;
      lastLocationAt?: string;
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

  return {
    cacheDriverProfile,
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

    hydrateSnapshot(payload) {
      driverProfilesById.clear();
      passengerProfilesById.clear();

      for (const driver of payload.drivers) {
        cacheDriverProfile(driver);
      }

      for (const passenger of payload.passengers) {
        cachePassengerProfile(passenger);
      }

      return {
        drivers: [...payload.drivers].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        passengers: [...payload.passengers].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      };
    },

    async listDriverProfiles() {
      return (await listDriverProfiles()).map((profile) => cacheDriverProfile(profile));
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
            lastKnownLocation: profile.lastKnownLocation,
            lastLocationAt: profile.lastLocationAt
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
    }
  };
};

export const createDirectoryWriteRepository = (
  dependencies: DirectoryRepositoryDependencies
): DirectoryWriteRepository => createDirectoryRepository(dependencies);

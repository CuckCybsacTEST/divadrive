import type { User } from "@supabase/supabase-js";
import type {
  AuthSession,
  DriverProfile,
  InternalUserProfile,
  PassengerProfile
} from "@diva-drive/domain";

interface SignInPayload {
  email: string;
  password: string;
  role?: AuthSession["user"]["role"];
}

interface SignUpPayload {
  email: string;
  password: string;
  fullName: string;
  phone: string;
  role: AuthSession["user"]["role"];
}

interface AuthServiceDependencies {
  isSupabaseReady: boolean;
  isSupabaseAuthReady: boolean;
  supabaseAdmin: {
    auth: {
      admin: {
        createUser: (payload: {
          email: string;
          password: string;
          email_confirm: boolean;
          user_metadata: {
            full_name: string;
            phone: string;
            role: AuthSession["user"]["role"];
          };
          app_metadata: {
            role: AuthSession["user"]["role"];
          };
        }) => Promise<{
          data: { user: User | null };
          error: Error | null;
        }>;
      };
    };
  } | null;
  supabaseAuth: {
    auth: {
      signInWithPassword: (payload: {
        email: string;
        password: string;
      }) => Promise<{
        data: {
          session: {
            access_token: string;
            refresh_token: string;
            expires_at?: number | null;
          } | null;
          user: User | null;
        };
        error: Error | null;
      }>;
      refreshSession: (payload: {
        refresh_token: string;
      }) => Promise<{
        data: {
          session: {
            access_token: string;
            refresh_token: string;
            expires_at?: number | null;
          } | null;
          user: User | null;
        };
        error: Error | null;
      }>;
    };
  } | null;
  getDriverProfile: (driverId: string) => Promise<DriverProfile | null>;
  getPassengerProfile: (passengerId: string) => Promise<PassengerProfile | null>;
  getInternalUserProfile: (internalUserId: string) => Promise<InternalUserProfile | null>;
  saveDriverProfile: (profile: DriverProfile) => Promise<DriverProfile>;
  saveInternalUserProfile: (profile: InternalUserProfile) => Promise<InternalUserProfile>;
  savePassengerProfile: (profile: PassengerProfile) => Promise<PassengerProfile>;
  driverProfilesById: Map<string, DriverProfile>;
  internalUserProfilesById: Map<string, InternalUserProfile>;
  passengerProfilesById: Map<string, PassengerProfile>;
  defaultCity: string;
  userRoles: readonly AuthSession["user"]["role"][];
}

export const createAuthService = ({
  isSupabaseReady,
  isSupabaseAuthReady,
  supabaseAdmin,
  supabaseAuth,
  getDriverProfile,
  getPassengerProfile,
  getInternalUserProfile,
  saveDriverProfile,
  saveInternalUserProfile,
  savePassengerProfile,
  driverProfilesById,
  internalUserProfilesById,
  passengerProfilesById,
  defaultCity,
  userRoles
}: AuthServiceDependencies) => {
  const inferUserRole = (user: User): AuthSession["user"]["role"] => {
    const roleCandidate = user.app_metadata?.role ?? user.user_metadata?.role;
    return userRoles.includes(roleCandidate) ? roleCandidate : "passenger";
  };

  const toAuthSession = (
    user: User,
    tokens: {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: number | null;
    }
  ): AuthSession => ({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? "",
    expiresAt: tokens.expiresAt ? new Date(tokens.expiresAt * 1000).toISOString() : null,
    user: {
      id: user.id,
      role: inferUserRole(user),
      fullName:
        user.user_metadata?.full_name ??
        user.user_metadata?.fullName ??
        user.email?.split("@")[0] ??
        "Cuenta DIVA",
      phone: user.user_metadata?.phone ?? user.phone ?? "",
      email: user.email ?? ""
    }
  });

  const signInWithSupabase = async (payload: SignInPayload): Promise<AuthSession> => {
    if (!isSupabaseAuthReady || !supabaseAuth) {
      throw new Error("supabase_auth_not_ready");
    }

    const { data, error } = await supabaseAuth.auth.signInWithPassword({
      email: payload.email,
      password: payload.password
    });

    if (error || !data.session || !data.user) {
      throw error ?? new Error("invalid_auth_credentials");
    }

    const session = toAuthSession(data.user, {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at ?? null
    });

    if (session.user.role === "operator" || session.user.role === "admin") {
      const internalProfile = await getInternalUserProfile(session.user.id);

      if (internalProfile && !internalProfile.isActive) {
        throw new Error("account_inactive");
      }
    }

    if (payload.role && session.user.role !== payload.role) {
      throw new Error("role_mismatch");
    }

    return session;
  };

  const signUpWithSupabase = async (payload: SignUpPayload): Promise<AuthSession> => {
    if (!isSupabaseReady || !supabaseAdmin || !isSupabaseAuthReady || !supabaseAuth) {
      throw new Error("supabase_auth_not_ready");
    }

    const { data: createdUserData, error: createUserError } =
      await supabaseAdmin.auth.admin.createUser({
        email: payload.email,
        password: payload.password,
        email_confirm: true,
        user_metadata: {
          full_name: payload.fullName,
          phone: payload.phone,
          role: payload.role
        },
        app_metadata: {
          role: payload.role
        }
      });

    if (createUserError || !createdUserData.user) {
      throw createUserError ?? new Error("sign_up_failed");
    }

    return signInWithSupabase({
      email: payload.email,
      password: payload.password,
      role: payload.role
    });
  };

  const refreshSupabaseSession = async (refreshToken: string): Promise<AuthSession> => {
    if (!isSupabaseAuthReady || !supabaseAuth) {
      throw new Error("supabase_auth_not_ready");
    }

    const { data, error } = await supabaseAuth.auth.refreshSession({
      refresh_token: refreshToken
    });

    if (error || !data.session || !data.user) {
      throw error ?? new Error("session_refresh_failed");
    }

    return toAuthSession(data.user, {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at ?? null
    });
  };

  const ensureProfileForSession = async (session: AuthSession) => {
    if (session.user.role === "driver" && !(await getDriverProfile(session.user.id))) {
      const profile: DriverProfile = {
        id: session.user.id,
        fullName: session.user.fullName,
        phone: session.user.phone,
        city: defaultCity,
        approvalStatus: "pending",
        operationalStatus: "active",
        availabilityStatus: "offline",
        documentsSubmitted: true,
        licenseNumber: `LIC-${session.user.id.slice(-4)}`,
        vehicleDescription: "Sedan blanco - onboarding inicial",
        createdAt: new Date().toISOString()
      };
      driverProfilesById.set(profile.id, profile);
      await saveDriverProfile(profile);
    }

    if (session.user.role === "passenger" && !(await getPassengerProfile(session.user.id))) {
      const profile: PassengerProfile = {
        id: session.user.id,
        fullName: session.user.fullName,
        phone: session.user.phone,
        city: defaultCity,
        createdAt: new Date().toISOString()
      };
      passengerProfilesById.set(profile.id, profile);
      await savePassengerProfile(profile);
    }

    if (
      (session.user.role === "operator" || session.user.role === "admin") &&
      !(await getInternalUserProfile(session.user.id))
    ) {
      const profile: InternalUserProfile = {
        id: session.user.id,
        role: session.user.role,
        fullName: session.user.fullName,
        phone: session.user.phone,
        email: session.user.email,
        city: defaultCity,
        isActive: true,
        createdAt: new Date().toISOString()
      };
      internalUserProfilesById.set(profile.id, profile);
      await saveInternalUserProfile(profile);
    }
  };

  return {
    ensureProfileForSession,
    refreshSupabaseSession,
    signInWithSupabase,
    signUpWithSupabase,
    toAuthSession
  };
};

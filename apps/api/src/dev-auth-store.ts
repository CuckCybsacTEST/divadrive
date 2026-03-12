import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthSession } from "@diva-drive/domain";

interface DevAuthUser {
  id: string;
  email: string;
  password: string;
  role: AuthSession["user"]["role"];
  fullName: string;
  phone: string;
  isActive: boolean;
  createdAt: string;
}

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

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const dataDir = resolve(currentDir, "../data");
const authUsersFile = resolve(dataDir, "auth-users.json");

const defaultAdminUser: DevAuthUser = {
  id: "admin-dev-0001",
  email: "admin@divadrive.local",
  password: "123456789",
  role: "admin",
  fullName: "Admin",
  phone: "999999999",
  isActive: true,
  createdAt: "2026-03-12T00:00:00.000Z"
};

const isDevAuthUser = (value: unknown): value is DevAuthUser => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<DevAuthUser>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.email === "string" &&
    typeof candidate.password === "string" &&
    typeof candidate.role === "string" &&
    typeof candidate.fullName === "string" &&
    typeof candidate.phone === "string"
  );
};

const ensureDataFile = async () => {
  await mkdir(dataDir, { recursive: true });

  try {
    await readFile(authUsersFile, "utf8");
  } catch {
    await writeFile(authUsersFile, `${JSON.stringify([defaultAdminUser], null, 2)}\n`, "utf8");
  }
};

const readAuthUsers = async (): Promise<DevAuthUser[]> => {
  await ensureDataFile();
  const content = await readFile(authUsersFile, "utf8");
  const parsed = JSON.parse(content) as unknown;

  if (!Array.isArray(parsed)) {
    return [defaultAdminUser];
  }

  const users = parsed.filter(isDevAuthUser).map((user) => ({
    ...user,
    isActive: user.isActive ?? true
  }));
  return users.length > 0 ? users : [defaultAdminUser];
};

const writeAuthUsers = async (users: DevAuthUser[]) => {
  await ensureDataFile();
  await writeFile(authUsersFile, `${JSON.stringify(users, null, 2)}\n`, "utf8");
};

const toAuthSession = (user: DevAuthUser): AuthSession => ({
  accessToken: `dev-session-${randomUUID()}`,
  refreshToken: `dev-refresh-${randomUUID()}`,
  expiresAt: null,
  user: {
    id: user.id,
    role: user.role,
    fullName: user.fullName,
    phone: user.phone,
    email: user.email
  }
});

export const signInLocalUser = async (payload: SignInPayload): Promise<AuthSession> => {
  const users = await readAuthUsers();
  const user = users.find(
    (candidate) =>
      candidate.email.toLowerCase() === payload.email.toLowerCase() &&
      candidate.password === payload.password
  );

  if (!user) {
    throw new Error("invalid_credentials");
  }

  if (!user.isActive) {
    throw new Error("account_inactive");
  }

  if (payload.role && user.role !== payload.role) {
    throw new Error("role_mismatch");
  }

  return toAuthSession(user);
};

export const signUpLocalUser = async (payload: SignUpPayload): Promise<AuthSession> => {
  const users = await readAuthUsers();
  const alreadyExists = users.some(
    (candidate) => candidate.email.toLowerCase() === payload.email.toLowerCase()
  );

  if (alreadyExists) {
    throw new Error("sign_up_failed");
  }

  const user: DevAuthUser = {
    id: `${payload.role}-dev-${randomUUID()}`,
    email: payload.email,
    password: payload.password,
    role: payload.role,
    fullName: payload.fullName,
    phone: payload.phone,
    isActive: true,
    createdAt: new Date().toISOString()
  };

  await writeAuthUsers([...users, user]);
  return toAuthSession(user);
};

export const setLocalAuthUserStatus = async (userId: string, isActive: boolean) => {
  const users = await readAuthUsers();
  const nextUsers = users.map((user) =>
    user.id === userId
      ? {
          ...user,
          isActive
        }
      : user
  );

  await writeAuthUsers(nextUsers);
};

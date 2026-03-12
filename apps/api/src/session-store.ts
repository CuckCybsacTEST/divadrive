import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthSession } from "@diva-drive/domain";

interface StoredSession extends AuthSession {
  createdAt: string;
}

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const dataDir = resolve(currentDir, "../data");
const sessionsFile = resolve(dataDir, "sessions.json");

const isStoredSession = (value: unknown): value is StoredSession => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<StoredSession>;

  return (
    typeof candidate.accessToken === "string" &&
    candidate.accessToken.length > 0 &&
    typeof candidate.user?.id === "string" &&
    typeof candidate.user?.role === "string" &&
    typeof candidate.user?.fullName === "string" &&
    typeof candidate.user?.phone === "string" &&
    typeof candidate.user?.email === "string"
  );
};

const ensureDataFile = async () => {
  await mkdir(dataDir, { recursive: true });

  try {
    await readFile(sessionsFile, "utf8");
  } catch {
    await writeFile(sessionsFile, "[]\n", "utf8");
  }
};

const readStoredSessions = async (): Promise<StoredSession[]> => {
  await ensureDataFile();
  const content = await readFile(sessionsFile, "utf8");
  const parsed = JSON.parse(content) as unknown;

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter(isStoredSession);
};

const writeStoredSessions = async (sessions: StoredSession[]) => {
  await ensureDataFile();
  await writeFile(sessionsFile, `${JSON.stringify(sessions, null, 2)}\n`, "utf8");
};

export const readSession = async (accessToken: string): Promise<AuthSession | null> => {
  const sessions = await readStoredSessions();
  return sessions.find((session) => session.accessToken === accessToken) ?? null;
};

export const readSessionByRefreshToken = async (
  refreshToken: string
): Promise<AuthSession | null> => {
  const sessions = await readStoredSessions();
  return sessions.find((session) => session.refreshToken === refreshToken) ?? null;
};

export const writeSession = async (session: AuthSession) => {
  const sessions = await readStoredSessions();
  const nextSessions = [
    {
      ...session,
      createdAt: new Date().toISOString()
    },
    ...sessions.filter(
      (storedSession) =>
        storedSession.accessToken !== session.accessToken &&
        storedSession.refreshToken !== session.refreshToken
    )
  ];

  await writeStoredSessions(nextSessions);
};

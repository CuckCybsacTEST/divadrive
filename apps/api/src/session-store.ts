import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthSession } from "@diva-drive/domain";
import { isSupabaseReady, supabaseAdmin } from "./supabase.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const dataDir = resolve(currentDir, "../data");
const sessionsFile = resolve(dataDir, "sessions.json");

interface PersistedSession extends AuthSession {
  createdAt: string;
}

const isMissingTableError = (error: { code?: string } | null) =>
  error?.code === "42P01" || error?.code === "PGRST205";

const ensureDataFile = async () => {
  await mkdir(dataDir, { recursive: true });

  try {
    await readFile(sessionsFile, "utf8");
  } catch {
    await writeFile(sessionsFile, "[]\n", "utf8");
  }
};

const readLocalSessions = async (): Promise<PersistedSession[]> => {
  await ensureDataFile();
  const content = await readFile(sessionsFile, "utf8");
  return JSON.parse(content) as PersistedSession[];
};

const writeLocalSessions = async (sessions: PersistedSession[]) => {
  await ensureDataFile();
  await writeFile(sessionsFile, `${JSON.stringify(sessions, null, 2)}\n`, "utf8");
};

export const readSession = async (accessToken: string): Promise<AuthSession | null> => {
  if (!isSupabaseReady || !supabaseAdmin) {
    const sessions = await readLocalSessions();
    const session = sessions.find((entry) => entry.accessToken === accessToken);
    return session
      ? {
          accessToken: session.accessToken,
          user: session.user
        }
      : null;
  }

  const { data, error } = await supabaseAdmin
    .from("api_sessions")
    .select("*")
    .eq("access_token", accessToken)
    .maybeSingle();

  if (isMissingTableError(error)) {
    const sessions = await readLocalSessions();
    const session = sessions.find((entry) => entry.accessToken === accessToken);
    return session
      ? {
          accessToken: session.accessToken,
          user: session.user
        }
      : null;
  }

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  return {
    accessToken: data.access_token,
    user: {
      id: data.user_id,
      role: data.role,
      fullName: data.full_name,
      phone: data.phone
    }
  } as AuthSession;
};

export const writeSession = async (session: AuthSession) => {
  const createdAt = new Date().toISOString();

  if (!isSupabaseReady || !supabaseAdmin) {
    const sessions = await readLocalSessions();
    const nextSessions = sessions.filter((entry) => entry.accessToken !== session.accessToken);
    nextSessions.push({
      ...session,
      createdAt
    });
    await writeLocalSessions(nextSessions);
    return;
  }

  const { error } = await supabaseAdmin.from("api_sessions").upsert({
    access_token: session.accessToken,
    user_id: session.user.id,
    role: session.user.role,
    full_name: session.user.fullName,
    phone: session.user.phone,
    created_at: createdAt
  });

  if (isMissingTableError(error)) {
    const sessions = await readLocalSessions();
    const nextSessions = sessions.filter((entry) => entry.accessToken !== session.accessToken);
    nextSessions.push({
      ...session,
      createdAt
    });
    await writeLocalSessions(nextSessions);
    return;
  }

  if (error) {
    throw error;
  }
};

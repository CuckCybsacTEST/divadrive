import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DriverProfile, PassengerProfile } from "@diva-drive/domain";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const dataDir = resolve(currentDir, "../data");
const usersFile = resolve(dataDir, "users.json");

interface UserStorePayload {
  drivers: DriverProfile[];
  passengers: PassengerProfile[];
}

const emptyPayload: UserStorePayload = {
  drivers: [],
  passengers: []
};

const ensureDataFile = async () => {
  await mkdir(dataDir, { recursive: true });

  try {
    await readFile(usersFile, "utf8");
  } catch {
    await writeFile(usersFile, `${JSON.stringify(emptyPayload, null, 2)}\n`, "utf8");
  }
};

export const readUsers = async (): Promise<UserStorePayload> => {
  await ensureDataFile();
  const content = await readFile(usersFile, "utf8");
  return JSON.parse(content) as UserStorePayload;
};

export const writeUsers = async (payload: UserStorePayload) => {
  await ensureDataFile();
  await writeFile(usersFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RideTrip } from "@diva-drive/domain";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const dataDir = resolve(currentDir, "../data");
const tripsFile = resolve(dataDir, "trips.json");

const ensureDataFile = async () => {
  await mkdir(dataDir, { recursive: true });

  try {
    await readFile(tripsFile, "utf8");
  } catch {
    await writeFile(tripsFile, "[]\n", "utf8");
  }
};

export const readTrips = async (): Promise<RideTrip[]> => {
  await ensureDataFile();
  const content = await readFile(tripsFile, "utf8");
  return JSON.parse(content) as RideTrip[];
};

export const writeTrips = async (trips: RideTrip[]) => {
  await ensureDataFile();
  await writeFile(tripsFile, `${JSON.stringify(trips, null, 2)}\n`, "utf8");
};

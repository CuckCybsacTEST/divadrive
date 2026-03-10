import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TripIncident } from "@diva-drive/domain";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const dataDir = resolve(currentDir, "../data");
const incidentsFile = resolve(dataDir, "incidents.json");

const ensureDataFile = async () => {
  await mkdir(dataDir, { recursive: true });

  try {
    await readFile(incidentsFile, "utf8");
  } catch {
    await writeFile(incidentsFile, "[]\n", "utf8");
  }
};

export const readIncidents = async (): Promise<TripIncident[]> => {
  await ensureDataFile();
  const content = await readFile(incidentsFile, "utf8");
  return JSON.parse(content) as TripIncident[];
};

export const writeIncidents = async (incidents: TripIncident[]) => {
  await ensureDataFile();
  await writeFile(incidentsFile, `${JSON.stringify(incidents, null, 2)}\n`, "utf8");
};

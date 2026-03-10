import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TripTimelineEvent } from "@diva-drive/domain";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const dataDir = resolve(currentDir, "../data");
const eventsFile = resolve(dataDir, "events.json");

const ensureDataFile = async () => {
  await mkdir(dataDir, { recursive: true });

  try {
    await readFile(eventsFile, "utf8");
  } catch {
    await writeFile(eventsFile, "[]\n", "utf8");
  }
};

export const readEvents = async (): Promise<TripTimelineEvent[]> => {
  await ensureDataFile();
  const content = await readFile(eventsFile, "utf8");
  return JSON.parse(content) as TripTimelineEvent[];
};

export const writeEvents = async (events: TripTimelineEvent[]) => {
  await ensureDataFile();
  await writeFile(eventsFile, `${JSON.stringify(events, null, 2)}\n`, "utf8");
};

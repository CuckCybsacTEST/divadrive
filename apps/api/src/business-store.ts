import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PRICING_CONFIG,
  DEFAULT_PROMOTIONS,
  type BusinessRulesSnapshot
} from "@diva-drive/domain";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const dataDir = resolve(currentDir, "../data");
const businessFile = resolve(dataDir, "business.json");

const defaultBusinessRules: BusinessRulesSnapshot = {
  pricing: DEFAULT_PRICING_CONFIG,
  promotions: DEFAULT_PROMOTIONS
};

const ensureDataFile = async () => {
  await mkdir(dataDir, { recursive: true });

  try {
    await readFile(businessFile, "utf8");
  } catch {
    await writeFile(businessFile, `${JSON.stringify(defaultBusinessRules, null, 2)}\n`, "utf8");
  }
};

export const readBusinessRules = async (): Promise<BusinessRulesSnapshot> => {
  await ensureDataFile();
  const content = await readFile(businessFile, "utf8");
  return JSON.parse(content) as BusinessRulesSnapshot;
};

export const writeBusinessRules = async (payload: BusinessRulesSnapshot) => {
  await ensureDataFile();
  await writeFile(businessFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

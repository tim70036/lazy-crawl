import { createConsola } from "consola";

const LOG_LEVELS: Record<string, number> = {
  fatal: 0, error: 0, warn: 1, log: 2, info: 3, debug: 4, trace: 5,
};

const envLevel = process.env.LOG_LEVEL?.toLowerCase();
const level = envLevel && envLevel in LOG_LEVELS ? LOG_LEVELS[envLevel] : 3;

export const log = createConsola({ level, formatOptions: { date: false } });

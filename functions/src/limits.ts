import { HOUR } from "./schedule";

/**
 * Each new family contact gets an SMS from us. Contacts can be edited, so cap how many new
 * numbers can be added per phone number: enough for the initial two plus a couple of corrections.
 */
export const MAX_NEW_CONTACTS_PER_DAY = 4;
export const CONTACT_LIMIT_WINDOW = 24 * HOUR;

/**
 * Sliding-window limiter. `history` holds epoch millis of earlier additions.
 * Returns the updated history, or null when adding `count` more would exceed the limit.
 */
export function recordContactAdditions(history: number[], count: number, now: number): number[] | null {
  const recent = history.filter((at) => now - at < CONTACT_LIMIT_WINDOW);
  if (count === 0) return recent;
  if (recent.length + count > MAX_NEW_CONTACTS_PER_DAY) return null;
  return [...recent, ...Array<number>(count).fill(now)];
}

/**
 * Time is two integers and a formatter.
 *
 * It used to be a string that `advanceClock` re-parsed every tick with
 * `/Day\s+(\d+).*?(\d{1,2}):(\d{2})/`, adding five minutes and serialising it
 * back. That regex returned its input unchanged on a miss, so a malformed
 * clock froze time permanently with no error, and nothing in the repo read the
 * result anyway.
 *
 * A day runs 08:00 to 20:00 — twelve waking hours over 24 moves, so one move
 * is exactly 30 minutes. Slot 0 opens the day at 08:00; the move taken in slot
 * 23 ends it at 20:00.
 */

export const DAY_START_MINUTES = 8 * 60;
export const MINUTES_PER_MOVE = 30;
export const MOVES_PER_DAY = 24;

export type DayBand = "morning" | "afternoon" | "evening";

export function minutesAt(slot: number): number {
  return DAY_START_MINUTES + slot * MINUTES_PER_MOVE;
}

export function timeAt(slot: number): string {
  const total = minutesAt(slot);
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function formatClock(day: number, slot: number): string {
  return `Day ${day} — ${timeAt(slot)}`;
}

export function movesLeft(slot: number): number {
  return Math.max(0, MOVES_PER_DAY - slot);
}

export function bandFor(slot: number): DayBand {
  if (slot < 8) return "morning";
  if (slot < 16) return "afternoon";
  return "evening";
}

/** True once the day's 24 moves are spent and the night pass is owed. */
export function dayIsSpent(slot: number): boolean {
  return slot >= MOVES_PER_DAY;
}

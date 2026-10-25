import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { DateTime } from "luxon";
import {
  MINUTE, ScheduleSettings, Tracking,
  afterCountedTime, countedTime, decide, isQuietHour, nextDueAfterConfirmation, nextOccurrence,
} from "../schedule";

const TZ = "Europe/Warsaw";
/** The example from the spec: question at 21:00, reminders every 2h, 15 min delays, no quiet hours. */
const evening: ScheduleSettings = {
  checkInHour: 21, checkInMinute: 0, reminderIntervalMinutes: 120, timezone: TZ,
  quietStartHour: 0, quietEndHour: 0, escalateAfterMinutes: 15, policeAfterHours: 24,
};
const withNight: ScheduleSettings = { ...evening, quietStartHour: 0, quietEndHour: 8 };
const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toMillis();
const hhmm = (ms: number) => DateTime.fromMillis(ms, { zone: TZ }).toFormat("HH:mm");

const okUntil = (due: number): Tracking => ({
  state: "ok", nextDueAt: due, pendingSince: null, lastReminderAt: null, remindersSent: 0, nudgedAt: null,
  escalatedAt: null, workNotifiedAt: null, policeNotifiedAt: null,
});

/** Simulates the scheduler: runs `decide` every 5 minutes, collecting actions as "HH:mm". */
function simulate(settings: ScheduleSettings, start: Tracking, from: number, to: number) {
  let tracking = start;
  let nextActionAt: number | null = start.nextDueAt;
  const log: { at: number; action: string }[] = [];
  for (let now = from; now <= to; now += 5 * MINUTE) {
    if (nextActionAt === null || now < nextActionAt) continue;
    const d = decide(tracking, settings, now);
    d.actions.forEach((action) => log.push({ at: now, action }));
    tracking = d.tracking;
    nextActionAt = d.nextActionAt;
  }
  const times = (action: string) => log.filter((e) => e.action === action).map((e) => hhmm(e.at));
  return { tracking, nextActionAt, times };
}

describe("nextOccurrence", () => {
  it("returns today when the time is still ahead", () => {
    assert.equal(nextOccurrence(at("2026-03-10T09:00"), 10, 0, TZ), at("2026-03-10T10:00"));
  });
  it("returns tomorrow when the time has passed", () => {
    assert.equal(nextOccurrence(at("2026-03-10T10:00"), 10, 0, TZ), at("2026-03-11T10:00"));
  });
  it("handles daylight saving change", () => {
    assert.equal(nextOccurrence(at("2026-03-28T12:00"), 10, 0, TZ), at("2026-03-29T10:00"));
  });
});

describe("nextDueAfterConfirmation", () => {
  it("skips today's question when confirming shortly before it", () => {
    assert.equal(nextDueAfterConfirmation(at("2026-03-10T20:00"), evening), at("2026-03-11T21:00"));
  });
  it("asks the same evening after confirming a reminder late at night", () => {
    assert.equal(nextDueAfterConfirmation(at("2026-03-11T01:00"), evening), at("2026-03-11T21:00"));
  });
});

describe("quiet hours", () => {
  it("wrap around midnight", () => {
    const s = { ...evening, quietStartHour: 22, quietEndHour: 8 };
    assert.equal(isQuietHour(at("2026-03-10T23:00"), s), true);
    assert.equal(isQuietHour(at("2026-03-10T07:59"), s), true);
    assert.equal(isQuietHour(at("2026-03-10T08:00"), s), false);
  });
  it("are not counted towards delays", () => {
    assert.equal(countedTime(at("2026-03-10T23:50"), at("2026-03-11T08:05"), withNight), 15 * MINUTE);
    assert.equal(afterCountedTime(at("2026-03-10T23:50"), 15 * MINUTE, withNight), at("2026-03-11T08:05"));
  });
});

describe("decide", () => {
  const due = at("2026-03-10T21:00");

  it("does nothing before the question is due", () => {
    const d = decide(okUntil(due), evening, due - MINUTE);
    assert.deepEqual(d.actions, []);
    assert.equal(d.nextActionAt, due);
  });

  it("follows the spec example: 21:00, reminders 23/1/3, SMS 3:15, family 3:30, work 3:45", () => {
    const { times, tracking } = simulate(evening, okUntil(due), due, at("2026-03-11T04:00"));
    assert.deepEqual(times("push").slice(0, 4), ["21:00", "23:00", "01:00", "03:00"]);
    assert.deepEqual(times("nudgeUser"), ["03:15"]);
    assert.deepEqual(times("escalate"), ["03:30"]);
    assert.deepEqual(times("notifyWork"), ["03:45"]);
    assert.equal(tracking.state, "escalated");
  });

  it("sends no pushes between the last reminder and the alarm", () => {
    const { times } = simulate(evening, okUntil(due), due, at("2026-03-11T03:29"));
    assert.equal(times("push").length, 4);
  });

  it("after the alarm: a push every 30 minutes for 3 hours, then silence", () => {
    const { times, nextActionAt } = simulate(
      { ...evening, policeAfterHours: 1 }, okUntil(due), due, at("2026-03-11T12:00"),
    );
    assert.deepEqual(times("push").slice(4), ["03:30", "04:00", "04:30", "05:00", "05:30", "06:00"]);
    assert.equal(nextActionAt, null);
  });

  it("skips quiet hours before the alarm and resumes when they end", () => {
    const { times } = simulate(withNight, okUntil(due), due, at("2026-03-11T16:00"));
    // 01:00 and 03:00 fall in quiet hours 0–8: reminders 23:00, 08:00, 10:00.
    assert.deepEqual(times("push").slice(0, 4), ["21:00", "23:00", "08:00", "10:00"]);
    assert.deepEqual(times("nudgeUser"), ["10:15"]);
    assert.deepEqual(times("escalate"), ["10:30"]);
  });

  it("pauses the SMS delay during quiet hours", () => {
    const s = { ...withNight, checkInHour: 22, checkInMinute: 20, reminderIntervalMinutes: 30 };
    const start = at("2026-03-10T22:20");
    const { times } = simulate(s, okUntil(start), start, at("2026-03-11T12:00"));
    assert.deepEqual(times("push").slice(0, 4), ["22:20", "22:50", "23:20", "23:50"]);
    // 10 minutes counted before midnight, the remaining 5 from 08:00.
    assert.deepEqual(times("nudgeUser"), ["08:05"]);
    assert.deepEqual(times("escalate"), ["08:20"]);
  });

  it("notifies work one delay after the family, even once quiet hours begin", () => {
    const s = {
      ...evening, checkInHour: 17, checkInMinute: 30, reminderIntervalMinutes: 60, quietStartHour: 21, quietEndHour: 6,
    };
    const start = at("2026-03-10T17:30");
    // Question 17:30, reminders 18:30, 19:30, 20:30; SMS 20:45; family 21:00; work 21:15 despite quiet hours.
    const { times } = simulate(s, okUntil(start), start, at("2026-03-11T08:00"));
    assert.deepEqual(times("escalate"), ["21:00"]);
    assert.deepEqual(times("notifyWork"), ["21:15"]);
  });

  it("ignores quiet hours after the alarm", () => {
    const s = { ...evening, checkInHour: 18, reminderIntervalMinutes: 60, quietStartHour: 23, quietEndHour: 6 };
    const start = at("2026-03-10T18:00");
    const { times } = simulate(s, okUntil(start), start, at("2026-03-11T06:00"));
    // Question 18:00, reminders 19, 20, 21; SMS 21:15; alarm 21:30; pushes continue into quiet hours.
    assert.deepEqual(times("escalate"), ["21:30"]);
    assert.ok(times("push").includes("23:30"));
  });
});

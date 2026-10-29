import { DateTime } from "luxon";

// Pure check-in state machine. No Firebase imports so it can be unit tested.

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/** How often to remind after a missed daily check-in; the user picks one. */
export const ALLOWED_REMINDER_INTERVALS_MINUTES = [30, 60, 120, 180, 240] as const;

/** Reminders after the daily question before the person gets an SMS. */
export const REMINDERS_BEFORE_SMS = 3;

/** Time between the SMS to the person and the phone call to them. */
export const CALL_AFTER_SMS = 5 * MINUTE;

/**
 * After family and work are alerted: a push every 30 minutes for 3 hours, regardless of the user's
 * settings and quiet hours, then nothing until the person confirms.
 */
export const AFTER_ALARM_REMINDER_INTERVAL = 30 * MINUTE;
export const AFTER_ALARM_REMINDER_WINDOW = 3 * HOUR;

/** Confirming at 20:00 for a 21:00 check-in should not ask again an hour later. */
const CONFIRMATION_MARGIN = 6 * HOUR;
/**
 * The scheduler runs every 5 minutes. A step due a few milliseconds after a run would otherwise wait for the
 * next one, so steps due within this window are treated as due now (see also TICK_LOOKAHEAD in index.ts).
 */
export const TICK_TOLERANCE = 2 * MINUTE;
const MIN_GAP = MINUTE;

export type CheckState = "ok" | "pending" | "escalated";
/** nudgeUser: SMS (and a call, if voice works) to the person who is not answering. */
/** nudgeUser texts the person, callUser phones them; escalate alerts the family, notifyWork the work contact. */
export type Action = "push" | "nudgeUser" | "callUser" | "escalate" | "notifyWork" | "notifyPolice";

export interface ScheduleSettings {
  /** Time of the daily question. */
  checkInHour: number;
  checkInMinute: number;
  /** Time between reminders after a missed question; one of ALLOWED_REMINDER_INTERVALS_MINUTES. */
  reminderIntervalMinutes: number;
  timezone: string;
  /**
   * Before the alarm: no reminders between quietStartHour and quietEndHour (local time),
   * and that time does not count towards the SMS and alarm delays. Ignored after the alarm.
   */
  quietStartHour: number;
  quietEndHour: number;
  /** Delay between the stages: last reminder → SMS to the person; call to the person → family → work. */
  escalateAfterMinutes: number;
  /** Notify the police contact this long after the family (currently not offered in the app). */
  policeAfterHours: number;
}

/** All timestamps are epoch milliseconds. */
export interface Tracking {
  state: CheckState;
  nextDueAt: number;
  pendingSince: number | null;
  lastReminderAt: number | null;
  /** Pushes sent for the current pending check-in, the daily question included. */
  remindersSent: number;
  nudgedAt: number | null;
  userCalledAt: number | null;
  escalatedAt: number | null;
  workNotifiedAt: number | null;
  policeNotifiedAt: number | null;
}

export interface Decision {
  tracking: Tracking;
  actions: Action[];
  /** Null when nothing more will happen until the person confirms. */
  nextActionAt: number | null;
}

const hasQuietHours = (s: ScheduleSettings) => s.quietStartHour !== s.quietEndHour;

/** First occurrence of hour:minute in `timezone` strictly after `after`. */
export function nextOccurrence(after: number, hour: number, minute: number, timezone: string): number {
  const base = DateTime.fromMillis(after, { zone: timezone });
  let candidate = base.set({ hour, minute, second: 0, millisecond: 0 });
  if (candidate.toMillis() <= after) {
    candidate = base.plus({ days: 1 }).set({ hour, minute, second: 0, millisecond: 0 });
  }
  return candidate.toMillis();
}

export function isQuietHour(now: number, s: ScheduleSettings): boolean {
  const { quietStartHour: start, quietEndHour: end } = s;
  if (start === end) return false;
  const hour = DateTime.fromMillis(now, { zone: s.timezone }).hour;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** Next daily question strictly after `after`. */
export function nextCheckIn(after: number, s: ScheduleSettings): number {
  return nextOccurrence(after, s.checkInHour, s.checkInMinute, s.timezone);
}

export function nextDueAfterConfirmation(now: number, s: ScheduleSettings): number {
  return nextCheckIn(now + CONFIRMATION_MARGIN, s);
}

/** Time between `from` and `to` outside quiet hours. */
export function countedTime(from: number, to: number, s: ScheduleSettings): number {
  if (!hasQuietHours(s)) return Math.max(0, to - from);
  let t = from;
  let total = 0;
  while (t < to) {
    if (isQuietHour(t, s)) {
      t = Math.min(to, nextOccurrence(t, s.quietEndHour, 0, s.timezone));
    } else {
      const boundary = Math.min(to, nextOccurrence(t, s.quietStartHour, 0, s.timezone));
      total += boundary - t;
      t = boundary;
    }
  }
  return total;
}

/** Inverse of countedTime: the moment at which `duration` of counted time has passed since `from`. */
export function afterCountedTime(from: number, duration: number, s: ScheduleSettings): number {
  if (!hasQuietHours(s)) return from + duration;
  let t = from;
  let remaining = duration;
  for (;;) {
    if (isQuietHour(t, s)) {
      t = nextOccurrence(t, s.quietEndHour, 0, s.timezone);
      continue;
    }
    const boundary = nextOccurrence(t, s.quietStartHour, 0, s.timezone);
    if (t + remaining <= boundary) return t + remaining;
    remaining -= boundary - t;
    t = boundary;
  }
}

/**
 * Advances the state machine to `now`: which side effects to run and when to look again.
 *
 * Daily question at T, R = reminderIntervalMinutes, E = escalateAfterMinutes (E counted outside quiet hours):
 *   T                         push: the daily question (even in quiet hours)
 *   T+R, T+2R, T+3R           3 reminder pushes, skipping quiet hours (resumed when they end)
 *   3rd reminder + E          nudgeUser: SMS to the person
 *   SMS + 5 min               callUser: phone call to the person ("press 1")
 *   call + E                  escalate: SMS and phone call to family contacts
 *   family + E                notifyWork: SMS to the work contact (wall-clock: quiet hours no longer apply)
 *   family .. +3h             a push every 30 min, ignoring all settings; then silence until confirmed
 *   family + P                notifyPolice (wall-clock)
 */
export function decide(current: Tracking, s: ScheduleSettings, now: number): Decision {
  let t = { ...current };

  if (t.state === "ok") {
    if (now < t.nextDueAt - TICK_TOLERANCE) {
      return { tracking: t, actions: [], nextActionAt: t.nextDueAt };
    }
    t = {
      ...t, state: "pending", pendingSince: t.nextDueAt, lastReminderAt: null, remindersSent: 0,
      nudgedAt: null, userCalledAt: null, escalatedAt: null, workNotifiedAt: null, policeNotifiedAt: null,
    };
  }
  t.pendingSince ??= now;
  const actions: Action[] = [];
  const delay = s.escalateAfterMinutes * MINUTE;
  const remindersDone = t.remindersSent > REMINDERS_BEFORE_SMS;

  if (remindersDone && t.nudgedAt === null && countedTime(t.lastReminderAt!, now, s) >= delay - TICK_TOLERANCE) {
    actions.push("nudgeUser");
    t.nudgedAt = now;
  } else if (t.nudgedAt !== null && t.userCalledAt === null && countedTime(t.nudgedAt, now, s) >= CALL_AFTER_SMS - TICK_TOLERANCE) {
    actions.push("callUser");
    t.userCalledAt = now;
  } else if (t.userCalledAt !== null && t.escalatedAt === null && countedTime(t.userCalledAt, now, s) >= delay - TICK_TOLERANCE) {
    actions.push("escalate");
    t.escalatedAt = now;
    t.state = "escalated";
  }
  // After the family alarm quiet hours no longer apply, so these use wall-clock time.
  if (t.escalatedAt !== null && t.workNotifiedAt === null && now - t.escalatedAt >= delay - TICK_TOLERANCE) {
    actions.push("notifyWork");
    t.workNotifiedAt = now;
  }
  if (t.escalatedAt !== null && t.policeNotifiedAt === null && now - t.escalatedAt >= s.policeAfterHours * HOUR - TICK_TOLERANCE) {
    actions.push("notifyPolice");
    t.policeNotifiedAt = now;
  }

  // Pushes: the daily question and 3 reminders; nothing while waiting for the SMS and alarm;
  // after the alarm every 30 minutes for 3 hours.
  const afterAlarm = t.escalatedAt !== null;
  const pushing = afterAlarm ? now < t.escalatedAt! + AFTER_ALARM_REMINDER_WINDOW : !remindersDone;
  const every = afterAlarm ? AFTER_ALARM_REMINDER_INTERVAL : s.reminderIntervalMinutes * MINUTE;
  const quiet = !afterAlarm && isQuietHour(now, s);
  if (pushing && (t.lastReminderAt === null || (!quiet && now - t.lastReminderAt >= every - TICK_TOLERANCE))) {
    actions.push("push");
    t.lastReminderAt = now;
    t.remindersSent += 1;
  }

  const candidates: number[] = [];
  const stillPushing = afterAlarm
    ? now < t.escalatedAt! + AFTER_ALARM_REMINDER_WINDOW
    : t.remindersSent <= REMINDERS_BEFORE_SMS;
  if (stillPushing) {
    candidates.push(quiet ? nextOccurrence(now, s.quietEndHour, 0, s.timezone) : t.lastReminderAt! + every);
  }
  if (t.remindersSent > REMINDERS_BEFORE_SMS && t.nudgedAt === null) {
    candidates.push(afterCountedTime(t.lastReminderAt!, delay, s));
  } else if (t.nudgedAt !== null && t.userCalledAt === null) {
    candidates.push(afterCountedTime(t.nudgedAt, CALL_AFTER_SMS, s));
  } else if (t.userCalledAt !== null && t.escalatedAt === null) {
    candidates.push(afterCountedTime(t.userCalledAt, delay, s));
  }
  if (t.escalatedAt !== null && t.workNotifiedAt === null) candidates.push(t.escalatedAt + delay);
  if (t.escalatedAt !== null && t.policeNotifiedAt === null) {
    candidates.push(t.escalatedAt + s.policeAfterHours * HOUR);
  }

  const nextActionAt = candidates.length > 0 ? Math.max(Math.min(...candidates), now + MIN_GAP) : null;
  return { tracking: t, actions, nextActionAt };
}

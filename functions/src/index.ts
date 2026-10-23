import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { DocumentData, DocumentReference, FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import * as logger from "firebase-functions/logger";
import { setGlobalOptions } from "firebase-functions/v2";
import { CallableRequest, HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { DateTime } from "luxon";
import { Lang, asLang, displayPhone, formatDuration, t } from "./messages";
import {
  Action, HOUR, MINUTE, ScheduleSettings, Tracking,
  afterCountedTime, decide, nextCheckIn, nextDueAfterConfirmation,
} from "./schedule";
import {
  DATABASE_ID, REGION, TELEPHONY_SECRETS, checkInCallText, messageCallText, newReportId, spokenPhone, telephony,
} from "./telephony";
import { Contact, formatAddress, validateProfile } from "./validation";
import { recordContactAdditions } from "./limits";

setGlobalOptions({ region: REGION, maxInstances: 10 });
initializeApp();
const db = getFirestore(DATABASE_ID);

const ESCALATION_RETRY = 15 * MINUTE;

/**
 * When enforced, callables only accept requests from the genuine app (Play Integrity, or a registered
 * debug token). Off until the app is registered in Firebase Console → App Check; until then tokens are
 * verified when present but not required. The SMSAPI callback is protected by unguessable report ids.
 */
const ENFORCE_APP_CHECK = false;
const CALLABLE_OPTIONS = { enforceAppCheck: ENFORCE_APP_CHECK };

// ---------- Firestore mapping ----------

const toMillis = (v: unknown): number | null => (v instanceof Timestamp ? v.toMillis() : null);
const toTimestamp = (v: number | null): Timestamp | null => (v === null ? null : Timestamp.fromMillis(v));

function userRef(uid: string): DocumentReference {
  return db.collection("users").doc(uid);
}

function settingsOf(d: DocumentData): ScheduleSettings {
  return {
    checkInHour: d.checkInHour ?? 10,
    checkInMinute: d.checkInMinute ?? 0,
    reminderIntervalMinutes: d.reminderIntervalMinutes ?? 60,
    timezone: d.timezone ?? "Europe/Warsaw",
    quietStartHour: d.quietStartHour ?? 22,
    quietEndHour: d.quietEndHour ?? 8,
    escalateAfterMinutes: d.escalateAfterMinutes ?? (d.escalateAfterHours ?? 1) * 60,
    policeAfterHours: d.policeAfterHours ?? 24,
  };
}

function trackingOf(d: DocumentData): Tracking {
  return {
    state: d.state ?? "ok",
    nextDueAt: toMillis(d.nextDueAt) ?? Date.now(),
    pendingSince: toMillis(d.pendingSince),
    lastReminderAt: toMillis(d.lastReminderAt),
    remindersSent: d.remindersSent ?? 0,
    nudgedAt: toMillis(d.nudgedAt),
    escalatedAt: toMillis(d.escalatedAt),
    policeNotifiedAt: toMillis(d.policeNotifiedAt),
  };
}

/** Tracking for a confirmed user whose next check-in is at `nextDueAt`. */
function okTracking(nextDueAt: number): Tracking {
  return {
    state: "ok", nextDueAt, pendingSince: null, lastReminderAt: null, remindersSent: 0, nudgedAt: null,
    escalatedAt: null, policeNotifiedAt: null,
  };
}

function trackingFields(tr: Tracking): DocumentData {
  return {
    state: tr.state,
    nextDueAt: toTimestamp(tr.nextDueAt),
    pendingSince: toTimestamp(tr.pendingSince),
    lastReminderAt: toTimestamp(tr.lastReminderAt),
    remindersSent: tr.remindersSent,
    nudgedAt: toTimestamp(tr.nudgedAt),
    escalatedAt: toTimestamp(tr.escalatedAt),
    policeNotifiedAt: toTimestamp(tr.policeNotifiedAt),
  };
}

/** Error fields worth logging; Error.message is not enumerable, so plain logging drops it. */
function describeError(e: unknown): Record<string, unknown> {
  if (!(e instanceof Error)) return { error: e };
  const { code, status, moreInfo } = e as Error & { code?: unknown; status?: unknown; moreInfo?: unknown };
  return { error: e.message, code, status, moreInfo };
}

function logRejected(message: string, results: PromiseSettledResult<unknown>[]): void {
  results.forEach((r) => {
    if (r.status === "rejected") logger.error(message, describeError(r.reason));
  });
}

async function logEvent(ref: DocumentReference, type: string, extra: DocumentData = {}): Promise<void> {
  await ref.collection("events").add({ type, at: FieldValue.serverTimestamp(), ...extra });
}

function requireAuth(req: CallableRequest): { uid: string; phone: string | undefined } {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first");
  return { uid: req.auth.uid, phone: req.auth.token.phone_number };
}

// ---------- Confirmation ----------

async function confirmAlive(uid: string, via: "app" | "notification" | "phone"): Promise<void> {
  const ref = userRef(uid);
  const now = Date.now();
  const previous = await db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data();
    if (!data?.displayName) throw new HttpsError("failed-precondition", "Profile not set up");
    const nextDue = nextDueAfterConfirmation(now, settingsOf(data));
    tx.update(ref, {
      ...trackingFields(okTracking(nextDue)),
      nextActionAt: toTimestamp(nextDue),
      lastConfirmedAt: toTimestamp(now),
      escalationNotified: FieldValue.delete(),
      policeNotified: FieldValue.delete(),
    });
    return data;
  });
  await logEvent(ref, "confirmed", { via });

  // Tell everyone we alarmed that the person is fine.
  // Several contacts may share a number (useful when testing): one all-clear per number is enough.
  const notified = [...new Set<string>(previous.escalationNotified ?? [])];
  if (notified.length > 0) {
    const tel = telephony();
    const lang = asLang(previous.language);
    const body = t(lang, "allClearSms", { name: previous.displayName });
    const results = await Promise.allSettled(notified.map((phone) => tel.sms(phone, body)));
    logRejected("all-clear SMS failed", results);
  }
  const police: string[] = previous.policeNotified ?? [];
  if (police.length > 0) {
    const lang = asLang(previous.language);
    const text = messageCallText(t(lang, "policeAllClearVoice", {
      name: previous.displayName,
      address: formatAddress(previous.address, t(lang, "addressNotes")) || t(lang, "unknownAddress"),
    }));
    const tel = telephony();
    logRejected("police all-clear call failed", await Promise.allSettled(police.map((phone) => tel.call(phone, text))));
  }
}

// ---------- Side effects of the state machine ----------

async function sendPush(ref: DocumentReference, data: DocumentData): Promise<void> {
  const token: string | undefined = data.fcmToken;
  if (!token) return;
  try {
    await getMessaging().send({
      token,
      data: { type: "checkin_reminder" },
      android: { priority: "high", ttl: 60 * MINUTE },
    });
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-argument") {
      await ref.update({ fcmToken: FieldValue.delete() });
    }
    throw e;
  }
}

/** The person did not answer the pushes: SMS them directly, plus a "press 1" call if voice works. */
async function nudgeUser(ref: DocumentReference, data: DocumentData, tracking: Tracking): Promise<void> {
  const lang = asLang(data.language);
  const settings = settingsOf(data);
  const escalateIn = afterCountedTime(tracking.nudgedAt!, settings.escalateAfterMinutes * MINUTE, settings) - tracking.nudgedAt!;
  const tel = telephony();
  await tel.sms(data.phone, t(lang, "nudgeSms", { name: data.displayName, escalateIn: formatDuration(lang, escalateIn) }));
  await logEvent(ref, "nudge_user");

  const reportId = newReportId();
  // Stored before calling so the report can never arrive for an unknown id.
  await db.collection("calls").doc(reportId).set({
    uid: ref.id, phone: data.phone, createdAt: FieldValue.serverTimestamp(),
  });
  try {
    await tel.call(data.phone, checkInCallText(lang, data.displayName), reportId);
    await logEvent(ref, "call_user", { reportId });
  } catch (e) {
    // Voice is optional (e.g. VMS not enabled on the account); the SMS already went out.
    logger.warn("check-in call failed", { uid: ref.id, ...describeError(e) });
  }
}

/** Facts about the person for alert messages. */
function alertParams(data: DocumentData, tracking: Tracking, now: number, lang: Lang) {
  const lastConfirmed = toMillis(data.lastConfirmedAt);
  return {
    name: data.displayName,
    phone: displayPhone(data.phone),
    phoneSpoken: spokenPhone(data.phone),
    address: formatAddress(data.address, t(lang, "addressNotes")) || t(lang, "unknownAddress"),
    duration: formatDuration(lang, now - (tracking.pendingSince ?? now)),
    last: lastConfirmed
      ? DateTime.fromMillis(lastConfirmed, { zone: settingsOf(data).timezone }).setLocale(lang).toFormat("d LLL yyyy, HH:mm")
      : t(lang, "never"),
  };
}

function contactsOf(data: DocumentData, kind: Contact["kind"]): Contact[] {
  return ((data.contacts ?? []) as Contact[]).filter((c) => c.kind === kind);
}

/** Alarm: SMS (and a call, if voice works) to family and work contacts. */
async function escalate(ref: DocumentReference, data: DocumentData, tracking: Tracking, now: number): Promise<void> {
  const family = contactsOf(data, "family");
  const work = contactsOf(data, "work");
  if (family.length + work.length === 0) {
    logger.warn("escalation without contacts", { uid: ref.id });
    await logEvent(ref, "escalation_no_contacts");
    return;
  }

  const lang: Lang = asLang(data.language);
  const settings = settingsOf(data);
  const police = contactsOf(data, "police").length > 0
    ? t(lang, "familySmsPolice", { policeIn: formatDuration(lang, settings.policeAfterHours * HOUR) })
    : "";
  const params = {
    ...alertParams(data, tracking, now, lang),
    police,
    family: family.map((c) => `${c.name} ${displayPhone(c.phone)}`).join(", "),
  };
  const workSms = family.length > 0 ? "workSms" : "workSmsNoFamily";
  const all = [
    ...family.map((contact) => ({ contact, sms: t(lang, "familySms", params), voice: t(lang, "familyVoice", params) })),
    ...work.map((contact) => ({ contact, sms: t(lang, workSms, params), voice: t(lang, "workVoice", params) })),
  ];
  // Contacts sharing a number get each distinct message once (family and work texts differ).
  const recipients = all.filter((r, i) => all.findIndex((o) => o.contact.phone === r.contact.phone && o.sms === r.sms) === i);

  const tel = telephony();
  const results = await Promise.allSettled(recipients.map(async ({ contact, sms, voice }) => {
    // The SMS carries the details, so once it is sent the contact counts as notified;
    // a failed follow-up call must not make the whole escalation retry and resend the SMS.
    await tel.sms(contact.phone, sms);
    try {
      await tel.call(contact.phone, messageCallText(voice));
    } catch (e) {
      logger.warn("escalation call failed", { uid: ref.id, kind: contact.kind, ...describeError(e) });
    }
    return contact.phone;
  }));

  logRejected("escalation contact failed", results);
  const notified = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  await ref.update({ escalationNotified: notified });
  await logEvent(ref, "escalation", { notified: notified.length, failed: recipients.length - notified.length });
  if (notified.length === 0) throw new Error("all escalation notifications failed");
}

/** Second alarm, policeAfterHours after the family: voice call to the police contact. */
async function notifyPolice(ref: DocumentReference, data: DocumentData, tracking: Tracking, now: number): Promise<void> {
  const police = contactsOf(data, "police");
  if (police.length === 0) return;

  const lang: Lang = asLang(data.language);
  const text = messageCallText(t(lang, "policeVoice", alertParams(data, tracking, now, lang)));
  const tel = telephony();
  const results = await Promise.allSettled(police.map(async (contact) => {
    await tel.call(contact.phone, text);
    return contact.phone;
  }));

  logRejected("police notification failed", results);
  const notified = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (notified.length === 0) throw new Error("police notification failed");
  await ref.update({ policeNotified: notified });
  await logEvent(ref, "police_notified", { notified: notified.length });
}

async function runAction(
  action: Action, ref: DocumentReference, data: DocumentData, tracking: Tracking, now: number,
): Promise<void> {
  switch (action) {
    case "push": return sendPush(ref, data);
    case "nudgeUser": return nudgeUser(ref, data, tracking);
    case "escalate": return escalate(ref, data, tracking, now);
    case "notifyPolice": return notifyPolice(ref, data, tracking, now);
  }
}

async function processUser(ref: DocumentReference, now: number): Promise<void> {
  // The transaction claims the work, so overlapping ticks never act twice.
  const claimed = await db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data();
    if (!data) return null;
    const nextActionAt = toMillis(data.nextActionAt);
    if (nextActionAt === null || nextActionAt > now) return null;
    const before = trackingOf(data);
    const decision = decide(before, settingsOf(data), now);
    tx.update(ref, { ...trackingFields(decision.tracking), nextActionAt: toTimestamp(decision.nextActionAt) });
    return { data, before, decision };
  });
  if (!claimed) return;

  const { data, before, decision } = claimed;
  for (const action of decision.actions) {
    try {
      await runAction(action, ref, data, decision.tracking, now);
    } catch (e) {
      logger.error(`action ${action} failed`, { uid: ref.id, ...describeError(e) });
      if (action === "escalate") {
        // Escalation is the one thing that must not be lost: undo and retry soon.
        await ref.update({
          state: before.state === "ok" ? "pending" : before.state,
          escalatedAt: null,
          nextActionAt: toTimestamp(now + ESCALATION_RETRY),
        });
      } else if (action === "notifyPolice") {
        // E.g. voice calls are only possible 8:00–22:00: retry until it goes through.
        await ref.update({ policeNotifiedAt: null, nextActionAt: toTimestamp(now + ESCALATION_RETRY) });
      } else if (action === "nudgeUser") {
        // Not retried: the escalation timer is already running, so a failed SMS must not delay it.
        await logEvent(ref, "nudge_user_failed");
      }
    }
  }
}

// ---------- Exported functions ----------

/** Runs the state machine for every user whose next action is due. */
export const tick = onSchedule(
  { schedule: "every 5 minutes", timeZone: "Etc/UTC", secrets: TELEPHONY_SECRETS, timeoutSeconds: 300 },
  async () => {
    const now = Date.now();
    const due = await db.collection("users")
      .where("nextActionAt", "<=", Timestamp.fromMillis(now))
      .orderBy("nextActionAt")
      .limit(500)
      .get();
    const results = await Promise.allSettled(due.docs.map((doc) => processUser(doc.ref, now)));
    logRejected("processUser failed", results);
    logger.info("tick", { due: due.size });
  },
);

export const confirm = onCall({ ...CALLABLE_OPTIONS, secrets: TELEPHONY_SECRETS }, async (req) => {
  const { uid } = requireAuth(req);
  const via = req.data?.via === "notification" ? "notification" : "app";
  await confirmAlive(uid, via);
  return { ok: true };
});

export const saveProfile = onCall({ ...CALLABLE_OPTIONS, secrets: TELEPHONY_SECRETS }, async (req) => {
  const { uid, phone } = requireAuth(req);
  if (!phone) throw new HttpsError("failed-precondition", "Account has no verified phone number");
  const input = validateProfile(req.data);
  const ref = userRef(uid);
  // Keyed by phone number so deleting and recreating the account does not reset the limit.
  const limitRef = db.collection("limits").doc(phone);
  const now = Date.now();

  const newNotifiedContacts = await db.runTransaction(async (tx) => {
    const existing = (await tx.get(ref)).data();
    const limits = (await tx.get(limitRef)).data();

    const knownPhones = new Set(((existing?.contacts ?? []) as Contact[]).map((c) => c.phone));
    const added = input.contacts.filter((c) => !knownPhones.has(c.phone));
    // Only family and work contacts get an SMS, so only they count towards the limit.
    const addedTexted = added.filter((c) => c.kind !== "police");
    const history = recordContactAdditions(limits?.contactAdditions ?? [], addedTexted.length, now);
    if (history === null) {
      throw new HttpsError("resource-exhausted", "Too many new contacts today, try again tomorrow");
    }
    if (addedTexted.length > 0) tx.set(limitRef, { contactAdditions: history });

    const update: DocumentData = { ...input, phone, updatedAt: FieldValue.serverTimestamp() };

    // The document may already exist with just an FCM token (see registerFcmToken).
    if (!existing?.displayName) {
      const nextDue = nextCheckIn(now, input);
      Object.assign(update, trackingFields(okTracking(nextDue)));
      update.nextActionAt = toTimestamp(nextDue);
      update.createdAt = FieldValue.serverTimestamp();
    } else if ((existing.state ?? "ok") === "ok") {
      // Reschedule for the new check-in time; a pending check-in keeps its escalation timeline.
      const lastConfirmed = toMillis(existing.lastConfirmedAt);
      const nextDue = lastConfirmed
        ? Math.max(nextCheckIn(now, input), nextDueAfterConfirmation(lastConfirmed, input))
        : nextCheckIn(now, input);
      update.nextDueAt = toTimestamp(nextDue);
      update.nextActionAt = toTimestamp(nextDue);
    }
    tx.set(ref, update, { merge: true });

    return addedTexted;
  });

  // Let new contacts know why they may hear from us (best effort).
  if (newNotifiedContacts.length > 0) {
    const tel = telephony();
    const body = t(input.language, "contactAddedSms", { name: input.displayName, phone: displayPhone(phone) });
    const results = await Promise.allSettled(newNotifiedContacts.map((c) => tel.sms(c.phone, body)));
    logRejected("contact intro SMS failed", results);
  }
  return { ok: true };
});

export const registerFcmToken = onCall(CALLABLE_OPTIONS, async (req) => {
  const { uid } = requireAuth(req);
  const token = req.data?.token;
  if (typeof token !== "string" || token.length === 0 || token.length > 4096) {
    throw new HttpsError("invalid-argument", "token is required");
  }
  await userRef(uid).set({ fcmToken: token }, { merge: true });
  return { ok: true };
});

export const deleteAccount = onCall(CALLABLE_OPTIONS, async (req) => {
  const { uid } = requireAuth(req);
  await db.recursiveDelete(userRef(uid));
  await getAuth().deleteUser(uid);
  return { ok: true };
});

/** Calls older than this cannot confirm anymore, even with a valid report id. */
const CALL_REPORT_MAX_AGE = 24 * HOUR;

/**
 * SMSAPI posts voice call reports here (form fields MsgId, status, pressed, to, idx; batched reports
 * are comma-separated). A report for a check-in call with key 1 pressed confirms the user.
 * Reports are not signed: they are matched by the unguessable idx we generated, and the phone number.
 */
export const smsapiCallback = onRequest({ secrets: TELEPHONY_SECRETS, invoker: "public" }, async (req, res) => {
  const params = { ...(req.query as Record<string, unknown>), ...((req.body ?? {}) as Record<string, unknown>) };
  const field = (name: string) => String(params[name] ?? "").split(",");
  const ids = field("idx");
  const pressed = field("pressed");
  const numbers = field("to");

  for (let i = 0; i < ids.length; i++) {
    const reportId = ids[i]?.trim();
    if (!reportId || pressed[i]?.trim() !== "1") continue;
    const callRef = db.collection("calls").doc(reportId);
    const call = (await callRef.get()).data();
    const createdAt = toMillis(call?.createdAt);
    const samePhone = call?.phone?.replace(/^\+/, "") === numbers[i]?.trim().replace(/^\+/, "");
    if (!call?.uid || call.confirmedAt || !createdAt || Date.now() - createdAt > CALL_REPORT_MAX_AGE || !samePhone) {
      logger.warn("ignored call report", { reportId });
      continue;
    }
    try {
      await confirmAlive(call.uid, "phone");
      await callRef.update({ confirmedAt: FieldValue.serverTimestamp() });
    } catch (e) {
      logger.error("phone confirmation failed", { reportId, ...describeError(e) });
    }
  }
  // SMSAPI retries until it gets "OK".
  res.send("OK");
});

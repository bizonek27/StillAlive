import { randomUUID } from "node:crypto";
import { defineSecret, defineString, projectID } from "firebase-functions/params";
import { Lang, t } from "./messages";

export const REGION = "europe-central2";
/** Named Firestore database in europe-central2 (the "(default)" one lives in the US). */
export const DATABASE_ID = "stillalive";

// SMSAPI.pl — https://www.smsapi.pl/docs
const API_URL = "https://api.smsapi.pl";

export const smsapiToken = defineSecret("SMSAPI_TOKEN");
export const smsapiSender = defineString("SMSAPI_SENDER", {
  default: "",
  description: "Sender name registered in the SMSAPI panel (e.g. StillAlive); empty uses the account default",
});
export const smsapiTestMode = defineString("SMSAPI_TEST_MODE", {
  default: "false",
  description: "\"true\" validates requests with SMSAPI without sending anything or charging",
});

/** Every function that sends SMS or makes calls must declare these. */
export const TELEPHONY_SECRETS = [smsapiToken];

/**
 * Polish characters turn an SMS into Unicode (70 instead of 160 characters per part, so 2–3× the cost).
 * Normalizing replaces ą→a, ł→l etc.; texts stay readable and are much cheaper.
 */
const NORMALIZE_SMS = true;

/** SMSAPI only offers Polish voices (ewa, jacek, jan, maja). */
const LECTOR = "ewa";

export interface Telephony {
  sms(to: string, body: string): Promise<void>;
  /**
   * Text-to-speech voice call. With `reportId`, SMSAPI posts the delivery report (and the key pressed,
   * if any) to the smsapiCallback function with idx = reportId.
   */
  call(to: string, text: string, reportId?: string): Promise<void>;
}

class SmsapiError extends Error {
  constructor(readonly code: number, message: string) {
    super(`SMSAPI error ${code}: ${message}`);
  }
}

async function post(path: string, params: Record<string, string>): Promise<void> {
  const body = new URLSearchParams({ ...params, format: "json" });
  if (smsapiTestMode.value() === "true") body.set("test", "1");
  const response = await fetch(`${API_URL}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${smsapiToken.value()}` },
    body,
  });
  const json = (await response.json().catch(() => ({}))) as { error?: number; message?: string };
  if (!response.ok || json.error) {
    throw new SmsapiError(json.error ?? response.status, json.message ?? response.statusText);
  }
}

/** SMSAPI expects numbers without the leading "+". */
const toSmsapiNumber = (e164: string) => e164.replace(/^\+/, "");

export function telephony(): Telephony {
  const from = smsapiSender.value();
  return {
    async sms(to, body) {
      await post("sms.do", {
        to: toSmsapiNumber(to),
        message: body,
        encoding: "utf-8",
        ...(NORMALIZE_SMS ? { normalize: "1" } : {}),
        ...(from ? { from } : {}),
      });
    },
    async call(to, text, reportId) {
      await post("vms.do", {
        to: toSmsapiNumber(to),
        tts: text,
        tts_lector: LECTOR,
        ...(reportId ? { idx: reportId, notify_url: callbackUrl() } : {}),
      });
    },
  };
}

/** Public URL SMSAPI posts voice call reports to. */
export function callbackUrl(): string {
  return `https://${REGION}-${projectID.value()}.cloudfunctions.net/smsapiCallback`;
}

/** Unguessable id linking a call report back to the user; the report itself is not signed. */
export function newReportId(): string {
  return randomUUID();
}

/** Call to the user: "press 1 if you are okay", said twice. */
export function checkInCallText(lang: Lang, name: string): string {
  const prompt = t(lang, "callPrompt", { name });
  return `${prompt} ${prompt}`;
}

/** One-way voice message, repeated so the listener catches it. */
export function messageCallText(message: string): string {
  return `${message} ${message}`;
}

/** "+48123456789" -> "+ 4 8 1 2 3 ..." so text-to-speech reads digits one by one. */
export function spokenPhone(phone: string): string {
  return phone.split("").join(" ");
}

import { IANAZone } from "luxon";
import { HttpsError } from "firebase-functions/v2/https";
import { Lang, asLang } from "./messages";
import { ALLOWED_REMINDER_INTERVALS_MINUTES } from "./schedule";

export type ContactKind = "family" | "work" | "police";

export interface Contact {
  name: string;
  phone: string;
  kind: ContactKind;
}

export interface Address {
  street: string;
  building: string;
  apartment: string;
  postalCode: string;
  city: string;
  /** Anything that helps whoever comes: floor, intercom code, who has a spare key. */
  notes: string;
}

export interface ProfileInput {
  displayName: string;
  address: Address;
  language: Lang;
  checkInHour: number;
  checkInMinute: number;
  reminderIntervalMinutes: number;
  timezone: string;
  quietStartHour: number;
  quietEndHour: number;
  escalateAfterMinutes: number;
  policeAfterHours: number;
  contacts: Contact[];
}

export const MAX_CONTACTS: Record<ContactKind, number> = { family: 2, work: 1, police: 1 };
export const DEFAULT_REMINDER_INTERVAL_MINUTES = 60;
/** The scheduler runs every 5 minutes, so finer values would not be honoured. */
export const ESCALATE_AFTER_MINUTES = { min: 5, max: 48 * 60, step: 5 };
/** Testing aid: lets one phone stand in for several contacts. Turn off before release (mirrors Models.kt). */
export const ALLOW_DUPLICATE_CONTACT_PHONES = true;
export const POLICE_AFTER_HOURS = { min: 1, max: 48, default: 24 };

const E164 = /^\+[1-9]\d{6,14}$/;

function invalid(message: string): never {
  throw new HttpsError("invalid-argument", message);
}

function text(value: unknown, field: string, maxLength: number, required: boolean): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (required && !s) invalid(`${field} is required`);
  if (s.length > maxLength) invalid(`${field} is too long`);
  return s;
}

function int(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    invalid(`${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function record(value: unknown): Record<string, unknown> {
  return (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
}

export function isPhoneNumber(value: string): boolean {
  return E164.test(value);
}

function validateAddress(value: unknown): Address {
  const a = record(value);
  return {
    street: text(a.street, "address.street", 100, true),
    building: text(a.building, "address.building", 20, true),
    apartment: text(a.apartment, "address.apartment", 20, false),
    postalCode: text(a.postalCode, "address.postalCode", 12, true),
    city: text(a.city, "address.city", 80, true),
    notes: text(a.notes, "address.notes", 300, false),
  };
}

function validateContacts(value: unknown): Contact[] {
  const raw = Array.isArray(value) ? value : [];
  if (raw.length > Object.values(MAX_CONTACTS).reduce((a, b) => a + b)) invalid("too many contacts");
  const contacts = raw.map((c, i): Contact => {
    const contact = record(c);
    const phone = text(contact.phone, `contacts[${i}].phone`, 16, true);
    if (!isPhoneNumber(phone)) invalid(`contacts[${i}].phone must be in E.164 format, e.g. +48123456789`);
    return {
      name: text(contact.name, `contacts[${i}].name`, 80, true),
      phone,
      kind: contact.kind === "police" || contact.kind === "work" ? contact.kind : "family",
    };
  });
  for (const [kind, max] of Object.entries(MAX_CONTACTS)) {
    if (contacts.filter((c) => c.kind === kind).length > max) invalid(`at most ${max} ${kind} contacts allowed`);
  }
  if (!ALLOW_DUPLICATE_CONTACT_PHONES && new Set(contacts.map((c) => c.phone)).size !== contacts.length) {
    invalid("duplicate contact phone numbers");
  }
  return contacts;
}

function validateEscalateAfter(d: Record<string, unknown>): number {
  // Older app versions send whole hours.
  const minutes = d.escalateAfterMinutes === undefined && typeof d.escalateAfterHours === "number"
    ? d.escalateAfterHours * 60
    : d.escalateAfterMinutes;
  const value = int(minutes, "escalateAfterMinutes", ESCALATE_AFTER_MINUTES.min, ESCALATE_AFTER_MINUTES.max);
  if (value % ESCALATE_AFTER_MINUTES.step !== 0) invalid("escalateAfterMinutes must be a multiple of 5");
  return value;
}

export function validateProfile(data: unknown): ProfileInput {
  if (typeof data !== "object" || data === null) invalid("profile is required");
  const d = data as Record<string, unknown>;

  const timezone = text(d.timezone, "timezone", 64, true);
  if (!IANAZone.isValidZone(timezone)) invalid("timezone is not a valid IANA zone");

  // Older app versions do not send it.
  const reminderIntervalMinutes = d.reminderIntervalMinutes ?? DEFAULT_REMINDER_INTERVAL_MINUTES;
  if (!(ALLOWED_REMINDER_INTERVALS_MINUTES as readonly unknown[]).includes(reminderIntervalMinutes)) {
    invalid(`reminderIntervalMinutes must be one of ${ALLOWED_REMINDER_INTERVALS_MINUTES.join(", ")}`);
  }

  return {
    displayName: text(d.displayName, "displayName", 80, true),
    address: validateAddress(d.address),
    language: asLang(d.language),
    checkInHour: int(d.checkInHour, "checkInHour", 0, 23),
    checkInMinute: int(d.checkInMinute, "checkInMinute", 0, 59),
    reminderIntervalMinutes: reminderIntervalMinutes as number,
    timezone,
    quietStartHour: int(d.quietStartHour, "quietStartHour", 0, 23),
    quietEndHour: int(d.quietEndHour, "quietEndHour", 0, 23),
    escalateAfterMinutes: validateEscalateAfter(d),
    // Optional so app versions without this setting can still save.
    policeAfterHours: d.policeAfterHours === undefined
      ? POLICE_AFTER_HOURS.default
      : int(d.policeAfterHours, "policeAfterHours", POLICE_AFTER_HOURS.min, POLICE_AFTER_HOURS.max),
    contacts: validateContacts(d.contacts),
  };
}

/** One line for SMS and text-to-speech, e.g. "Polna 5/3, 00-001 Warszawa. Uwagi: klucz u sąsiadki". */
export function formatAddress(address: unknown, notesLabel: string): string {
  if (typeof address === "string") return address; // Profiles saved before the address was split up.
  const a = record(address) as Partial<Address>;
  const building = [a.building, a.apartment].filter(Boolean).join("/");
  const line = [[a.street, building].filter(Boolean).join(" "), [a.postalCode, a.city].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return a.notes ? `${line}. ${notesLabel}: ${a.notes}` : line;
}

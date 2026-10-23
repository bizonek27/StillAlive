import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { formatAddress, validateProfile } from "../validation";

const valid = {
  displayName: "Anna Nowak",
  address: { street: "Polna", building: "5", apartment: "3", postalCode: "00-001", city: "Warszawa", notes: "" },
  language: "pl",
  checkInHour: 21, checkInMinute: 0, reminderIntervalMinutes: 120, timezone: "Europe/Warsaw",
  quietStartHour: 22, quietEndHour: 8, escalateAfterMinutes: 10,
  contacts: [
    { name: "Jan", phone: "+48600000001", kind: "family" },
    { name: "Ola", phone: "+48600000002", kind: "family" },
    { name: "Szef", phone: "+48600000009", kind: "work" },
  ],
};

describe("validateProfile", () => {
  it("accepts two family contacts and one from work", () => {
    assert.equal(validateProfile(valid).contacts.length, 3);
  });
  it("rejects a third family contact", () => {
    const family = valid.contacts.filter((c) => c.kind === "family");
    const contacts = [...family, { name: "Ewa", phone: "+48600000003", kind: "family" }];
    assert.throws(() => validateProfile({ ...valid, contacts }), /family contacts/);
  });
  it("rejects reminder intervals outside the allowed list", () => {
    assert.throws(() => validateProfile({ ...valid, reminderIntervalMinutes: 45 }), /reminderIntervalMinutes/);
  });
  it("defaults the reminder interval for older app versions", () => {
    const { reminderIntervalMinutes, ...old } = valid;
    assert.equal(validateProfile({ ...old, intervalHours: 24 }).reminderIntervalMinutes, 60);
  });
  it("rejects a second work contact", () => {
    const contacts = [...valid.contacts, { name: "Kolega", phone: "+48600000008", kind: "work" }];
    assert.throws(() => validateProfile({ ...valid, contacts }), /work contacts/);
  });
  it("limits the escalation delay", () => {
    assert.throws(() => validateProfile({ ...valid, escalateAfterMinutes: 72 * 60 }), /escalateAfterMinutes/);
    assert.throws(() => validateProfile({ ...valid, escalateAfterMinutes: 0 }), /escalateAfterMinutes/);
    assert.throws(() => validateProfile({ ...valid, escalateAfterMinutes: 12 }), /multiple of 5/);
  });
  it("converts whole hours from older app versions", () => {
    const { escalateAfterMinutes, ...old } = valid;
    assert.equal(validateProfile({ ...old, escalateAfterHours: 2 }).escalateAfterMinutes, 120);
  });
  it("requires the essential address fields", () => {
    assert.throws(() => validateProfile({ ...valid, address: { ...valid.address, city: "" } }), /address.city/);
  });
});

describe("formatAddress", () => {
  it("joins the parts into one line", () => {
    assert.equal(formatAddress(valid.address, "Uwagi"), "Polna 5/3, 00-001 Warszawa");
  });
  it("appends notes", () => {
    assert.equal(
      formatAddress({ ...valid.address, apartment: "", notes: "klucz u sąsiadki" }, "Uwagi"),
      "Polna 5, 00-001 Warszawa. Uwagi: klucz u sąsiadki",
    );
  });
  it("passes through addresses saved as plain text", () => {
    assert.equal(formatAddress("Polna 5, Warszawa", "Uwagi"), "Polna 5, Warszawa");
  });
});

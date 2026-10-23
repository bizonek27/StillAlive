import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { CONTACT_LIMIT_WINDOW, MAX_NEW_CONTACTS_PER_DAY, recordContactAdditions } from "../limits";
import { HOUR } from "../schedule";

describe("recordContactAdditions", () => {
  const now = 1_000 * CONTACT_LIMIT_WINDOW;

  it("allows the daily maximum at once", () => {
    assert.equal(recordContactAdditions([], MAX_NEW_CONTACTS_PER_DAY, now)?.length, MAX_NEW_CONTACTS_PER_DAY);
  });

  it("rejects additions beyond the daily limit", () => {
    const full = Array<number>(MAX_NEW_CONTACTS_PER_DAY).fill(now - HOUR);
    assert.equal(recordContactAdditions(full, 1, now), null);
  });

  it("forgets additions older than the window", () => {
    const old = Array<number>(MAX_NEW_CONTACTS_PER_DAY).fill(now - CONTACT_LIMIT_WINDOW);
    assert.deepEqual(recordContactAdditions(old, 1, now), [now]);
  });

  it("does not count saves without new contacts", () => {
    const full = Array<number>(MAX_NEW_CONTACTS_PER_DAY).fill(now - HOUR);
    assert.deepEqual(recordContactAdditions(full, 0, now), full);
  });
});

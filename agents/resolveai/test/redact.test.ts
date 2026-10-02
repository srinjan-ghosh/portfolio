import { describe, expect, it } from "vitest";
import { redact } from "../src/redact.js";

describe("redact", () => {
  it("removes card numbers, SSNs and phone numbers", () => {
    const r = redact("card 4111 1111 1111 1111, ssn 123-45-6789, call 415-555-0132");
    expect(r.text).toBe("card [REDACTED_CARD], ssn [REDACTED_SSN], call [REDACTED_PHONE]");
    expect(r.count).toBe(3);
  });
  it("leaves order IDs and prices alone", () => {
    expect(redact("order A1042 cost $249.00").text).toBe("order A1042 cost $249.00");
  });
});

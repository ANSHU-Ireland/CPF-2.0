import { describe, expect, it } from "vitest";
import { redactPii } from "../src/redaction.js";

describe("redactPii", () => {
  it("redacts email addresses", () => {
    const result = redactPii("Contact jane.doe@example.com for details.");
    expect(result.redactedText).toBe("Contact [REDACTED_EMAIL] for details.");
    expect(result.redactionsApplied).toEqual(["email"]);
  });

  it("redacts every occurrence of a known name, case-insensitively", () => {
    const result = redactPii("Jane Doe wrote this. jane doe reviewed it too.", ["Jane Doe"]);
    expect(result.redactedText).toBe("[REDACTED_NAME] wrote this. [REDACTED_NAME] reviewed it too.");
    expect(result.redactionsApplied).toEqual(["name"]);
  });

  it("redacts both emails and known names in the same pass", () => {
    const result = redactPii("Jane Doe (jane@example.com) submitted evidence.", ["Jane Doe"]);
    expect(result.redactedText).toBe("[REDACTED_NAME] ([REDACTED_EMAIL]) submitted evidence.");
    expect(result.redactionsApplied).toEqual(["email", "name"]);
  });

  it("is a no-op when there is nothing to redact", () => {
    const result = redactPii("No personal data appears in this evidence summary.", ["Someone Else"]);
    expect(result.redactedText).toBe("No personal data appears in this evidence summary.");
    expect(result.redactionsApplied).toEqual([]);
  });

  it("ignores blank entries in the known-names list", () => {
    const result = redactPii("Plain text.", ["", "   "]);
    expect(result.redactedText).toBe("Plain text.");
    expect(result.redactionsApplied).toEqual([]);
  });
});

/**
 * PII redaction pass, applied to every outbound prompt before it ever
 * reaches a provider adapter (ADR-0005). Two layers: a generic e-mail regex,
 * and an explicit candidate/user "known names" list injected by the caller
 * (the gateway itself never looks anything up — callers own knowing which
 * names are in scope for a given invocation).
 */

export interface RedactionResult {
  redactedText: string;
  /** e.g. ["email", "name"] — categories only, never the redacted value itself. */
  redactionsApplied: string[];
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactPii(text: string, knownNames: readonly string[] = []): RedactionResult {
  const applied = new Set<string>();

  let redacted = text.replace(EMAIL_RE, () => {
    applied.add("email");
    return "[REDACTED_EMAIL]";
  });

  for (const rawName of knownNames) {
    const name = rawName.trim();
    if (!name) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, "gi");
    if (pattern.test(redacted)) {
      applied.add("name");
      redacted = redacted.replace(pattern, "[REDACTED_NAME]");
    }
  }

  return { redactedText: redacted, redactionsApplied: [...applied].sort() };
}

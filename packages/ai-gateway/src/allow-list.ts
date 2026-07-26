import type { ModelPin } from "./types.js";

export class AiModelNotAllowedError extends Error {
  readonly code = "AI_MODEL_NOT_ALLOWED" as const;
  constructor(pin: ModelPin) {
    super(`Model ${pin.provider}/${pin.model}@${pin.version} is not on the allow-list.`);
    this.name = "AiModelNotAllowedError";
  }
}

/** Every model call must be pinned to an explicit, allow-listed provider+model+version (ADR-0005). */
export function assertModelAllowed(pin: ModelPin, allowList: readonly ModelPin[]): void {
  const allowed = allowList.some(
    (entry) => entry.provider === pin.provider && entry.model === pin.model && entry.version === pin.version,
  );
  if (!allowed) throw new AiModelNotAllowedError(pin);
}

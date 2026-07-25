/**
 * Versioned candidate-facing notice identifiers recorded in every disclosure
 * record. The notice *content* is a legal work-product (LR-04) maintained in
 * docs/compliance; these versions bind an acknowledgement to exactly what was
 * shown. Bump on any content change.
 */
export const NOTICE_VERSIONS = {
  privacyNotice: "2026-07-25.draft-1",
  aiUseNotice: "2026-07-25.draft-1",
  telemetryNotice: "2026-07-25.draft-1",
  assessmentRules: "2026-07-25.draft-1",
} as const;

/** Evidence-event types that must never be accepted, from any client. */
export const FORBIDDEN_EVENT_TYPES = new Set([
  "raw_keystroke",
  "external_clipboard_content",
  "screen_recording",
  "camera_frame",
  "microphone_audio",
]);

/** Categories a candidate workspace client may submit. Others are server-generated. */
export const CANDIDATE_SUBMITTABLE_CATEGORIES = new Set([
  "workspace_evidence",
  "integrity_signal",
]);

export const MAX_EVENT_PAYLOAD_BYTES = 32 * 1024;
export const INVITATION_TTL_DAYS = 14;
export const ACTIVATION_TTL_HOURS = 72;
export const DSR_DUE_DAYS = 30;
export const CANDIDATE_IMPORT_MAX_BYTES = 1024 * 1024;
export const CANDIDATE_IMPORT_MAX_ROWS = 2000;

/** Sliding session renewal: each activity extends expiry, capped by the absolute limit below. */
export const SESSION_SLIDING_TTL_HOURS = 12;
/** Hard cap on session lifetime regardless of activity (CPF-27). */
export const SESSION_ABSOLUTE_TTL_HOURS = 24;
/** Sensitive actions (e.g. org data export) require re-authentication within this window. */
export const STEP_UP_FRESHNESS_MINUTES = 5;


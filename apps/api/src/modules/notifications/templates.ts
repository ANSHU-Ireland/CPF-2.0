/**
 * Notification templates (CPF-37).
 *
 * All interpolated content is HTML-escaped — templates never embed raw
 * access tokens or activation tokens (those remain single-use, out-of-band,
 * shown-once values returned directly by the issuing API call).
 *
 * Scope note: the invitation-issued notice currently goes to the inviting
 * hiring manager only, as a courier reminder — direct-to-candidate e-mail
 * delivery is intentionally out of scope for this pass (no org-level
 * consent/enablement setting exists yet for candidate contact).
 */
import { escapeHtml } from "./mail.js";

export interface RenderedMessage {
  subject: string;
  body: string;
}

export function invitationIssuedTemplate(params: {
  candidateName: string;
  jobTitle: string;
  orgName: string;
}): RenderedMessage {
  const name = escapeHtml(params.candidateName);
  const job = escapeHtml(params.jobTitle);
  const org = escapeHtml(params.orgName);
  return {
    subject: `Assessment invitation ready to send — ${job}`,
    body: `<p>An assessment invitation for <strong>${name}</strong> (role: ${job}, organisation: ${org}) has been issued. Deliver the access link to the candidate out of band — it is shown only once at issuance and is not included in this notice.</p>`,
  };
}

export function activationTokenIssuedTemplate(params: { displayName: string }): RenderedMessage {
  const name = escapeHtml(params.displayName);
  return {
    subject: "CPF account activation issued",
    body: `<p>An activation token for <strong>${name}</strong>'s account has been issued to the inviting administrator. It is shown only once at issuance and is not included in this notice.</p>`,
  };
}

export function dataRightsReceivedTemplate(params: { requestType: string; dueAt: string }): RenderedMessage {
  const type = escapeHtml(params.requestType);
  const dueAt = escapeHtml(params.dueAt);
  return {
    subject: `Data rights request received — ${type}`,
    body: `<p>A ${type} request has been received and is due by ${dueAt}.</p>`,
  };
}

export function dataRightsDueSoonTemplate(params: { requestType: string; dueAt: string }): RenderedMessage {
  const type = escapeHtml(params.requestType);
  const dueAt = escapeHtml(params.dueAt);
  return {
    subject: `Reminder — data rights request due soon (${type})`,
    body: `<p>A ${type} request is due by ${dueAt} and has not yet been resolved.</p>`,
  };
}

/**
 * Typed API client. Implements the CPF error contract: every non-2xx response
 * is surfaced as an ApiError with a stable code, safe message, and request id.
 * No mock modes — this client only ever talks to the real API.
 */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    retryable: boolean;
    details?: Array<{ path: string; message: string }>;
  };
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string;
  readonly retryable: boolean;

  constructor(status: number, body: ApiErrorBody["error"]) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.requestId = body.requestId;
    this.retryable = body.retryable;
  }
}

let sessionToken: string | null = sessionStorage.getItem("cpf.token");

export function setSessionToken(token: string | null): void {
  sessionToken = token;
  if (token === null) sessionStorage.removeItem("cpf.token");
  else sessionStorage.setItem("cpf.token", token);
}

export function hasSessionToken(): boolean {
  return sessionToken !== null;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: { auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (opts.auth !== false && sessionToken) headers.authorization = `Bearer ${sessionToken}`;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? null : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, {
      code: "NETWORK_ERROR",
      message: "The CPF API could not be reached. Check your connection and try again.",
      requestId: "n/a",
      retryable: true,
    });
  }
  if (response.status === 204) return undefined as T;
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorBody =
      json && typeof json === "object" && "error" in json
        ? (json as ApiErrorBody).error
        : {
            code: "UNEXPECTED_RESPONSE",
            message: "The server returned an unexpected response.",
            requestId: "n/a",
            retryable: false,
          };
    throw new ApiError(response.status, errorBody);
  }
  return json as T;
}

export const api = {
  get: <T>(path: string, opts?: { auth?: boolean }) => request<T>("GET", path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: { auth?: boolean }) => request<T>("POST", path, body, opts),
  put: <T>(path: string, body?: unknown, opts?: { auth?: boolean }) => request<T>("PUT", path, body, opts),
  delete: <T>(path: string, opts?: { auth?: boolean }) => request<T>("DELETE", path, undefined, opts),
};

// ---------------------------------------------------------------------------
// Response types for the endpoints this application consumes
// ---------------------------------------------------------------------------

export interface Membership {
  organisationId: string;
  role: string;
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
  user: { id: string; displayName: string; email: string };
  memberships: Membership[];
}

export interface TemplateSummary {
  code: string;
  roleFamily: string;
  title: string;
  subtitle: string;
  targetLevel: string;
  timebox: string;
  frameworkVersion: string;
  criteriaCount: number;
  criticalCriteriaCount: number;
}

export interface Criterion {
  id: string;
  dimension: string;
  weight: number;
  critical: boolean;
  observableStandard: string;
  evidenceAndRedFlag: string;
  interviewProbe: string;
}

export interface TemplateDetail extends TemplateSummary {
  purpose: string;
  simulation: string;
  approvedTools: string;
  constraints: string;
  deliverables: string;
  reviewerInstruction: string;
  stages: Array<{
    stage: string;
    durationMinutes: number | null;
    candidateAction: string;
    evidenceCaptured: string;
  }>;
  criteria: Criterion[];
}

export interface SessionRow {
  id: string;
  status: string;
  created_at: string;
  started_at: string | null;
  submitted_at: string | null;
  has_accommodations: boolean;
  candidate_id: string;
  candidate_name: string;
  candidate_email: string;
  job_title: string;
  template_code: string;
  review_id: string | null;
  review_status: string | null;
  reviewer_user_id: string | null;
}

export interface OrgUser {
  id: string;
  email: string;
  display_name: string;
  status: string;
  mfa_enrolled: boolean;
  roles: string[];
}

export interface CandidateRow {
  id: string;
  email: string;
  full_name: string;
  status: string;
  created_at: string;
}

export interface JobProfileRow {
  id: string;
  title: string;
  role_family: string;
  status: string;
  created_at: string;
}

export interface ReviewQueueRow {
  id: string;
  status: string;
  created_at: string;
  session_id: string;
  submitted_at: string | null;
}

export interface StoredScore {
  criterion_id: string;
  reviewer1_score: number | null;
  reviewer2_score: number | null;
  adjudicated_score: number | null;
  evidence_note: string | null;
  confidence: string | null;
}

export interface ReviewDetail {
  id: string;
  session_id: string;
  status: string;
  final_rationale: string | null;
  confidence: string | null;
  limitations: string | null;
  scores: StoredScore[];
}

export interface EvidenceEventRow {
  id: number;
  category: string;
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: string;
}

export interface ReviewEvidence {
  template: {
    code: string;
    title: string;
    criteria: Criterion[];
    reviewerInstruction: string;
  } | null;
  workspaceEvidence: EvidenceEventRow[];
  integrityContext: { guidance: string; signals: EvidenceEventRow[] };
}

export interface EvaluationPreview {
  overallEvidenceIndex: number | null;
  overallBand: string | null;
  scoredCoverage: number;
  evidenceNoteCoverage: number;
  decisionSupportRoute: string;
  adjudicationsRequired: string[];
  criticalConcerns: Array<{ criterionId: string; finalScore: number }>;
  dimensions: DimensionSummary[];
  governanceNote: string;
}

export interface DimensionSummary {
  key: string;
  name: string;
  weight: number;
  achievementIndex: number | null;
  band: string;
  scoredWeight: number;
  totalWeight: number;
}

export interface EvidenceProfile {
  reviewerSummary: {
    rationale: string;
    confidence: string;
    limitations: string;
    finalisedAt: string;
  };
  accommodationsNote: string | null;
  dimensions: DimensionSummary[];
  collaborationProfile: CollaborationDimensionSummary[];
  criticalConcerns: Array<{ criterionId: string; finalScore: number }>;
  decisionSupportRoute: string;
  interviewProbes: Array<{ criterionId: string; probe: string }>;
  governanceNote: string;
}

export interface CollaborationDimensionSummary {
  dimension: string;
  band: string;
  claims: Array<{ claim: string; band: string; limitations: string | null; counterEvidence: string | null }>;
}

export interface Claim {
  id: string;
  dimension: string;
  claim: string;
  evidenceBand: string;
  evidenceReferences: string[];
  counterEvidence: string | null;
  reviewerConfidence: string;
  limitations: string | null;
  rationale: string;
  createdAt: string;
}

export interface ResponsibleUseAck {
  version: string;
  title: string;
  sections: string[];
  acknowledged: boolean;
  acknowledgedAt: string | null;
}

export interface ScoreAnchor {
  score: number;
  anchor: string;
  interpretation: string;
}

export interface ScoringModel {
  frameworkVersion: string;
  scoreAnchors: ScoreAnchor[];
}

export interface DataRightsRow {
  id: string;
  candidate_id: string;
  candidate_name: string;
  candidate_email: string;
  request_type: string;
  status: string;
  received_at: string;
  due_at: string;
  resolved_at: string | null;
  overdue: boolean;
}

export interface LegalHoldRow {
  id: string;
  candidate_id: string;
  candidate_name: string;
  candidate_email: string;
  reason: string;
  placed_at: string;
  released_at: string | null;
}

export interface CandidatePortalView {
  candidateName: string;
  invitationStatus: string;
  expiresAt: string;
  assessment: {
    code: string;
    title: string;
    subtitle: string;
    timebox: string;
    purpose: string;
    approvedTools: string;
    constraints: string;
    stages: TemplateDetail["stages"];
  };
  notices: Record<string, string>;
  session: { id: string; status: string } | null;
}

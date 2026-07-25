import { useEffect, useReducer, useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "react-router";
import {
  api,
  ApiError,
  type Criterion,
  type EvaluationPreview,
  type ReviewDetail,
  type ReviewEvidence,
  type ScoringModel,
  type StoredScore,
} from "../api.js";
import { Alert, BandBadge, ErrorState, Field, Loading, Modal, StatusPill, formatDate } from "../ui.js";
import { useQuery } from "../useQuery.js";

const CONFIDENCE_LEVELS = ["high", "medium-high", "medium", "low", "insufficient"] as const;
type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

interface ScoreDraft {
  reviewer1Score?: number | undefined;
  reviewer2Score?: number | undefined;
  adjudicatedScore?: number | undefined;
  evidenceNote?: string | undefined;
  confidence?: ConfidenceLevel | undefined;
}

type Drafts = Record<string, ScoreDraft>;

type DraftAction =
  | { type: "hydrate"; scores: StoredScore[] }
  | { type: "setScore"; criterionId: string; score: number | undefined }
  | { type: "setNote"; criterionId: string; note: string }
  | { type: "setConfidence"; criterionId: string; confidence: ConfidenceLevel | undefined };

function draftsReducer(state: Drafts, action: DraftAction): Drafts {
  switch (action.type) {
    case "hydrate": {
      const next: Drafts = {};
      for (const s of action.scores) {
        next[s.criterion_id] = {
          ...(s.reviewer1_score != null ? { reviewer1Score: s.reviewer1_score } : {}),
          ...(s.reviewer2_score != null ? { reviewer2Score: s.reviewer2_score } : {}),
          ...(s.adjudicated_score != null ? { adjudicatedScore: s.adjudicated_score } : {}),
          ...(s.evidence_note != null ? { evidenceNote: s.evidence_note } : {}),
          ...(s.confidence != null ? { confidence: s.confidence as ConfidenceLevel } : {}),
        };
      }
      return next;
    }
    case "setScore":
      return {
        ...state,
        [action.criterionId]: { ...state[action.criterionId], reviewer1Score: action.score },
      };
    case "setNote":
      return {
        ...state,
        [action.criterionId]: { ...state[action.criterionId], evidenceNote: action.note },
      };
    case "setConfidence":
      return {
        ...state,
        [action.criterionId]: { ...state[action.criterionId], confidence: action.confidence },
      };
    default:
      return state;
  }
}

function EvidenceTimeline({ evidence }: { evidence: ReviewEvidence }): ReactNode {
  if (evidence.workspaceEvidence.length === 0) {
    return <p className="muted">No workspace evidence recorded yet.</p>;
  }
  return (
    <ol className="stack">
      {evidence.workspaceEvidence.map((e) => (
        <li key={e.id} className="card">
          <div className="spread">
            <strong>{e.event_type.replaceAll("_", " ")}</strong>
            <span className="muted">{formatDate(e.occurred_at)}</span>
          </div>
          {typeof e.payload.note === "string" ? <p>{e.payload.note}</p> : null}
          {typeof e.payload.content === "string" ? <p>{e.payload.content}</p> : null}
        </li>
      ))}
    </ol>
  );
}

function IntegrityContextPanel({ evidence }: { evidence: ReviewEvidence }): ReactNode {
  return (
    <div className="stack">
      <Alert kind="info">{evidence.integrityContext.guidance}</Alert>
      {evidence.integrityContext.signals.length === 0 ? (
        <p className="muted">No integrity signals recorded.</p>
      ) : (
        <ol className="stack">
          {evidence.integrityContext.signals.map((s) => (
            <li key={s.id} className="card">
              <div className="spread">
                <strong>{s.event_type.replaceAll("_", " ")}</strong>
                <span className="muted">{formatDate(s.occurred_at)}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function CriterionRow({
  criterion,
  draft,
  anchors,
  onScore,
  onNote,
  onConfidence,
}: {
  criterion: Criterion;
  draft: ScoreDraft | undefined;
  anchors: ScoringModel["scoreAnchors"];
  onScore: (score: number | undefined) => void;
  onNote: (note: string) => void;
  onConfidence: (confidence: ConfidenceLevel | undefined) => void;
}): ReactNode {
  return (
    <fieldset className="card">
      <legend>
        {criterion.id} — {criterion.dimension} {criterion.critical ? <span className="pill">Critical</span> : null}
      </legend>
      <p>{criterion.observableStandard}</p>
      <details>
        <summary>Evidence &amp; red flags</summary>
        <p>{criterion.evidenceAndRedFlag}</p>
      </details>

      <div className="row" role="radiogroup" aria-label={`Score for ${criterion.id}`}>
        {anchors.map((a) => (
          <label key={a.score} className="row" title={a.interpretation}>
            <input
              type="radio"
              name={`score-${criterion.id}`}
              value={a.score}
              checked={draft?.reviewer1Score === a.score}
              onChange={() => onScore(a.score)}
            />
            {a.score} — {a.anchor}
          </label>
        ))}
        <button
          type="button"
          className="btn secondary"
          onClick={() => onScore(undefined)}
          disabled={draft?.reviewer1Score === undefined}
        >
          Clear score
        </button>
      </div>

      <Field label="Evidence note">
        {({ id }) => (
          <textarea id={id} value={draft?.evidenceNote ?? ""} onChange={(e) => onNote(e.target.value)} />
        )}
      </Field>
      <Field label="Confidence">
        {({ id }) => (
          <select
            id={id}
            value={draft?.confidence ?? ""}
            onChange={(e) => onConfidence(e.target.value ? (e.target.value as ConfidenceLevel) : undefined)}
          >
            <option value="">Not assessed</option>
            {CONFIDENCE_LEVELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
      </Field>
    </fieldset>
  );
}

function FinaliseModal({
  orgId,
  reviewId,
  onClose,
  onFinalised,
}: {
  orgId: string;
  reviewId: string;
  onClose: () => void;
  onFinalised: () => void;
}): ReactNode {
  const [rationale, setRationale] = useState("");
  const [confidence, setConfidence] = useState<ConfidenceLevel | "">("");
  const [limitations, setLimitations] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const valid = rationale.trim().length >= 20 && confidence !== "" && limitations.trim().length >= 10;

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/v1/orgs/${orgId}/reviews/${reviewId}/finalise`, { rationale, confidence, limitations });
      onFinalised();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finalise this review.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open title="Finalise review" onClose={onClose}>
      {error ? <Alert kind="danger">{error}</Alert> : null}
      <form onSubmit={(e) => void onSubmit(e)}>
        <Field label="Rationale" hint="At least 20 characters">
          {({ id, describedBy }) => (
            <textarea
              id={id}
              aria-describedby={describedBy}
              required
              minLength={20}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
            />
          )}
        </Field>
        <Field label="Confidence">
          {({ id }) => (
            <select id={id} required value={confidence} onChange={(e) => setConfidence(e.target.value as ConfidenceLevel)}>
              <option value="">Select…</option>
              {CONFIDENCE_LEVELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Limitations" hint="At least 10 characters">
          {({ id, describedBy }) => (
            <textarea
              id={id}
              aria-describedby={describedBy}
              required
              minLength={10}
              value={limitations}
              onChange={(e) => setLimitations(e.target.value)}
            />
          )}
        </Field>
        <button type="submit" className="btn" disabled={submitting || !valid}>
          {submitting ? "Finalising…" : "Finalise review"}
        </button>
      </form>
    </Modal>
  );
}

/** Reviewer workspace: evidence, scoring, adjudication, finalisation. */
export function ReviewWorkspacePage(): ReactNode {
  const { orgId, reviewId } = useParams();
  const detail = useQuery(() => api.get<ReviewDetail>(`/v1/orgs/${orgId}/reviews/${reviewId}`), [orgId, reviewId]);
  const evidence = useQuery(() => api.get<ReviewEvidence>(`/v1/orgs/${orgId}/reviews/${reviewId}/evidence`), [orgId, reviewId]);
  const scoringModel = useQuery(() => api.get<ScoringModel>("/v1/framework/scoring-model"), []);
  const preview = useQuery(() => api.get<EvaluationPreview>(`/v1/orgs/${orgId}/reviews/${reviewId}/preview`), [orgId, reviewId]);

  const [drafts, dispatch] = useReducer(draftsReducer, {});
  const [savedSnapshot, setSavedSnapshot] = useState<string>("{}");
  const [tab, setTab] = useState<"evidence" | "integrity">("evidence");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [finaliseOpen, setFinaliseOpen] = useState(false);

  useEffect(() => {
    if (detail.data) {
      dispatch({ type: "hydrate", scores: detail.data.scores });
      setSavedSnapshot(JSON.stringify(detail.data.scores));
    }
  }, [detail.data]);

  const dirty = JSON.stringify(drafts) !== savedSnapshot && detail.data !== null;

  useEffect(() => {
    function guard(e: BeforeUnloadEvent): void {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  async function onSave(): Promise<void> {
    if (!evidence.data?.template) return;
    setSaving(true);
    setSaveError(null);
    try {
      const scores = evidence.data.template.criteria.map((c) => ({
        criterionId: c.id,
        ...(drafts[c.id] ?? {}),
      }));
      await api.put(`/v1/orgs/${orgId}/reviews/${reviewId}/scores`, { scores });
      setSavedSnapshot(JSON.stringify(drafts));
      preview.reload();
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Could not save scores.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (detail.loading || evidence.loading || scoringModel.loading) return <Loading label="Loading review…" />;
  if (detail.error) return <ErrorState error={detail.error} onRetry={detail.reload} />;
  if (evidence.error) return <ErrorState error={evidence.error} onRetry={evidence.reload} />;
  if (scoringModel.error) return <ErrorState error={scoringModel.error} onRetry={scoringModel.reload} />;
  if (!detail.data || !evidence.data || !scoringModel.data) return null;

  const template = evidence.data.template;
  const scoreAnchors = scoringModel.data.scoreAnchors;

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h1>Reviewer workspace</h1>
          <p className="muted">
            {template?.title ?? "Assessment"} · <StatusPill value={detail.data.status} />
          </p>
        </div>
        <div className="row">
          {dirty ? <span className="pill">Unsaved changes</span> : null}
          <button type="button" className="btn secondary" onClick={() => void onSave()} disabled={saving}>
            {saving ? "Saving…" : "Save scores"}
          </button>
          <button type="button" className="btn" onClick={() => setFinaliseOpen(true)} disabled={detail.data.status === "finalised"}>
            Finalise
          </button>
        </div>
      </div>

      {saveError ? <Alert kind="danger">{saveError}</Alert> : null}

      <div className="row" role="tablist" aria-label="Evidence views">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "evidence"}
          className="btn secondary"
          onClick={() => setTab("evidence")}
        >
          Evidence
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "integrity"}
          className="btn secondary"
          onClick={() => setTab("integrity")}
        >
          Integrity context
        </button>
      </div>
      <div role="tabpanel">
        {tab === "evidence" ? <EvidenceTimeline evidence={evidence.data} /> : <IntegrityContextPanel evidence={evidence.data} />}
      </div>

      {preview.data ? (
        <div className="card stack">
          <h2>Decision-support preview</h2>
          <p>
            Coverage: {(preview.data.scoredCoverage * 100).toFixed(0)}% · Route: {preview.data.decisionSupportRoute}
          </p>
          <div className="row">
            {preview.data.dimensions.map((d) => (
              <BandBadge key={d.key} band={d.band} />
            ))}
          </div>
          {preview.data.adjudicationsRequired.length > 0 ? (
            <Alert kind="warning">
              Reviewer variance requires adjudication for: {preview.data.adjudicationsRequired.join(", ")}
            </Alert>
          ) : null}
        </div>
      ) : null}

      <h2>Rubric</h2>
      {template ? (
        <div className="stack">
          {template.criteria.map((c) => (
            <CriterionRow
              key={c.id}
              criterion={c}
              draft={drafts[c.id]}
              anchors={scoreAnchors}
              onScore={(score) => dispatch({ type: "setScore", criterionId: c.id, score })}
              onNote={(note) => dispatch({ type: "setNote", criterionId: c.id, note })}
              onConfidence={(confidence) => dispatch({ type: "setConfidence", criterionId: c.id, confidence })}
            />
          ))}
        </div>
      ) : (
        <p className="muted">The assessment template for this session could not be loaded.</p>
      )}

      {finaliseOpen ? (
        <FinaliseModal
          orgId={orgId!}
          reviewId={reviewId!}
          onClose={() => setFinaliseOpen(false)}
          onFinalised={() => detail.reload()}
        />
      ) : null}
    </div>
  );
}


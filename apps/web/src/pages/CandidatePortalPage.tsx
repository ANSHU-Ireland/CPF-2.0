import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "react-router";
import { ApiError, api, type CandidatePortalView } from "../api.js";
import { Alert, EmptyState, ErrorState, Loading } from "../ui.js";
import { useQuery } from "../useQuery.js";

const NOTICE_META: Record<string, { label: string; body: string }> = {
  privacyNotice: {
    label: "Privacy notice",
    body: "How your personal data is collected, used, and retained during this assessment. (DRAFT — legal text pending review LR-04.)",
  },
  aiUseNotice: {
    label: "AI use notice",
    body: "What AI assistance is, and is not, permitted, and how any AI-assisted work must be disclosed. (DRAFT — legal text pending review LR-04.)",
  },
  telemetryNotice: {
    label: "Telemetry notice",
    body: "What activity signals (for example, tab focus changes) are recorded during the assessment, and why. (DRAFT — legal text pending review LR-04.)",
  },
  assessmentRules: {
    label: "Assessment rules",
    body: "The rules governing conduct during this assessment, including what evidence is captured. (DRAFT — legal text pending review LR-04.)",
  },
};

const DATA_RIGHTS_TYPES = [
  "access",
  "rectification",
  "erasure",
  "restriction",
  "objection",
  "portability",
  "challenge",
  "human_review",
] as const;

const TERMINAL_COPY: Record<string, string> = {
  submitted: "Your assessment has been submitted. It is now waiting to be reviewed.",
  under_review: "Your assessment is currently being reviewed.",
  review_finalised: "Your assessment review has been finalised. The employer will be in touch about next steps.",
  report_issued: "Your assessment has been reviewed and the report has been issued to the employer.",
  withdrawn: "You withdrew from this assessment.",
  expired: "This assessment window has expired.",
  invalidated: "This assessment session was invalidated.",
};

function NoticeDetails({
  noticeKey,
  version,
  onOpened,
}: {
  noticeKey: string;
  version: string;
  onOpened: (key: string) => void;
}): ReactNode {
  const meta = NOTICE_META[noticeKey] ?? { label: noticeKey, body: "" };
  return (
    <details onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && onOpened(noticeKey)}>
      <summary>
        {meta.label} <span className="muted">(version {version})</span>
      </summary>
      <p>{meta.body}</p>
    </details>
  );
}

function DisclosurePanel({ token, view, onChanged }: { token: string; view: CandidatePortalView; onChanged: () => void }): ReactNode {
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [accommodation, setAccommodation] = useState("");
  const [accommodationSent, setAccommodationSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const noticeKeys = Object.keys(view.notices);
  const allOpened = noticeKeys.every((k) => opened.has(k));

  async function onAcknowledge(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/v1/candidate/${token}/disclosure/acknowledge`, undefined, { auth: false });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record your acknowledgement.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onAccommodation(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!accommodation.trim()) return;
    try {
      await api.post(`/v1/candidate/${token}/accommodations`, { note: accommodation }, { auth: false });
      setAccommodationSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record your accommodation request.");
    }
  }

  return (
    <div className="stack">
      <h2>Before you begin</h2>
      <p className="muted">Please open and review each notice below before continuing.</p>
      {error ? <Alert kind="danger">{error}</Alert> : null}
      <div className="stack">
        {noticeKeys.map((k) => (
          <NoticeDetails key={k} noticeKey={k} version={view.notices[k]!} onOpened={(key) => setOpened((s) => new Set(s).add(key))} />
        ))}
      </div>
      <button type="button" className="btn" disabled={!allOpened || submitting} onClick={() => void onAcknowledge()}>
        {submitting ? "Recording…" : "Acknowledge and continue"}
      </button>

      <form onSubmit={(e) => void onAccommodation(e)} className="stack">
        <label htmlFor="accommodation-note">Request an accommodation (optional)</label>
        <textarea
          id="accommodation-note"
          value={accommodation}
          onChange={(e) => setAccommodation(e.target.value)}
          placeholder="Describe any accommodation you need for this assessment."
        />
        <button type="submit" className="btn secondary" disabled={!accommodation.trim()}>
          Submit accommodation request
        </button>
        {accommodationSent ? <Alert kind="success">Your accommodation request has been recorded.</Alert> : null}
      </form>
    </div>
  );
}

function Workspace({ token, onChanged }: { token: string; onChanged: () => void }): ReactNode {
  const [work, setWork] = useState("");
  const [note, setNote] = useState("");
  const [savedSnapshot, setSavedSnapshot] = useState("{}");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify({ work, note }) !== savedSnapshot;

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await api.post(
        `/v1/candidate/${token}/events`,
        { category: "workspace_evidence", eventType: "artifact_saved", payload: { content: work, verificationNote: note } },
        { auth: false },
      );
      setSavedSnapshot(JSON.stringify({ work, note }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your evidence.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    const interval = setInterval(() => {
      if (dirty) void save();
    }, 60_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, work, note]);

  useEffect(() => {
    function onVisibility(): void {
      const eventType = document.hidden ? "focus_lost" : "focus_returned";
      void api.post(`/v1/candidate/${token}/events`, { category: "integrity_signal", eventType, payload: {} }, { auth: false });
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [token]);

  async function onPause(): Promise<void> {
    await api.post(`/v1/candidate/${token}/pause`, undefined, { auth: false });
    onChanged();
  }

  async function onSubmit(): Promise<void> {
    if (!window.confirm("Submit your assessment? You will not be able to make further changes after submitting.")) {
      return;
    }
    setError(null);
    try {
      await api.post(`/v1/candidate/${token}/submit`, undefined, { auth: false });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit your assessment.");
    }
  }

  return (
    <div className="stack">
      <h2>Your workspace</h2>
      <Alert kind="info">
        No AI assistant is configured in this environment. Any AI-assisted work must be your own, verifiable, and
        disclosed per the assessment rules.
      </Alert>
      {error ? <Alert kind="danger">{error}</Alert> : null}

      <label htmlFor="work-area">Your work</label>
      <textarea id="work-area" value={work} onChange={(e) => setWork(e.target.value)} rows={10} />

      <label htmlFor="verification-note">Verification note</label>
      <textarea
        id="verification-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Describe how a reviewer could verify this work is yours."
      />

      <div className="row">
        {dirty ? <span className="pill">Unsaved changes</span> : null}
        <button type="button" className="btn secondary" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save evidence"}
        </button>
        <button type="button" className="btn secondary" onClick={() => void onPause()}>
          Pause
        </button>
        <button type="button" className="btn" onClick={() => void onSubmit()}>
          Submit assessment
        </button>
      </div>
    </div>
  );
}

function DataRightsCentre({ token }: { token: string }): ReactNode {
  const [requestType, setRequestType] = useState<(typeof DATA_RIGHTS_TYPES)[number] | "">("");
  const [detail, setDetail] = useState("");
  const [receipt, setReceipt] = useState<{ requestId: string; dueAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!requestType) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.post<{ requestId: string; dueAt: string }>(
        `/v1/candidate/${token}/data-rights`,
        { requestType, detail: detail.trim() || undefined },
        { auth: false },
      );
      setReceipt(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit your request.");
    } finally {
      setSubmitting(false);
    }
  }

  if (receipt) {
    return (
      <div className="card stack">
        <h3>Request received</h3>
        <p>
          Reference: <code>{receipt.requestId}</code>
        </p>
        <p className="muted">Due by {new Date(receipt.dueAt).toLocaleDateString()}</p>
        <button type="button" className="btn secondary" onClick={() => setReceipt(null)}>
          Raise another request
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="stack">
      <h3>Your data rights</h3>
      {error ? <Alert kind="danger">{error}</Alert> : null}
      <label htmlFor="dsr-type">Request type</label>
      <select id="dsr-type" required value={requestType} onChange={(e) => setRequestType(e.target.value as typeof requestType)}>
        <option value="">Select…</option>
        {DATA_RIGHTS_TYPES.map((t) => (
          <option key={t} value={t}>
            {t.replaceAll("_", " ")}
          </option>
        ))}
      </select>
      <label htmlFor="dsr-detail">Detail (optional)</label>
      <textarea id="dsr-detail" value={detail} onChange={(e) => setDetail(e.target.value)} />
      <button type="submit" className="btn" disabled={!requestType || submitting}>
        {submitting ? "Submitting…" : "Submit request"}
      </button>
    </form>
  );
}

/**
 * Public, token-authenticated candidate portal (disclosure, session
 * lifecycle, evidence submission).
 */
export function CandidatePortalPage(): ReactNode {
  const { token } = useParams();
  const view = useQuery(() => api.get<CandidatePortalView>(`/v1/candidate/${token}`, { auth: false }), [token]);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  async function onAccept(): Promise<void> {
    setAccepting(true);
    setAcceptError(null);
    try {
      await api.post(`/v1/candidate/${token}/accept`, undefined, { auth: false });
      view.reload();
    } catch (err) {
      setAcceptError(err instanceof Error ? err.message : "Could not start your assessment.");
    } finally {
      if (mounted.current) setAccepting(false);
    }
  }

  async function onResume(): Promise<void> {
    await api.post(`/v1/candidate/${token}/resume`, undefined, { auth: false });
    view.reload();
  }

  async function onStart(): Promise<void> {
    await api.post(`/v1/candidate/${token}/start`, undefined, { auth: false });
    view.reload();
  }

  if (view.loading) return <Loading label="Loading your assessment…" />;
  if (view.error) {
    if (view.error instanceof ApiError && view.error.code === "INVITATION_NOT_FOUND") {
      return (
        <main className="shell-main" style={{ maxWidth: 640, margin: "10vh auto" }}>
          <EmptyState
            title="This link is invalid or has expired"
            hint="If you believe this is a mistake, contact the organisation that invited you for a new link."
          />
        </main>
      );
    }
    return (
      <main className="shell-main" style={{ maxWidth: 640, margin: "10vh auto" }}>
        <ErrorState error={view.error} onRetry={view.reload} />
      </main>
    );
  }
  if (!view.data) return null;
  const data = view.data;
  const status = data.session?.status ?? null;

  return (
    <main className="shell-main" style={{ maxWidth: 640, margin: "10vh auto" }}>
      <div className="stack">
        <h1>{data.assessment.title}</h1>
        <p className="muted">{data.assessment.subtitle}</p>

        {status === null ? (
          <div className="stack">
            <p>{data.assessment.purpose}</p>
            <p className="muted">Timebox: {data.assessment.timebox}</p>
            <h2>Stages</h2>
            <ol>
              {data.assessment.stages.map((s) => (
                <li key={s.stage}>
                  {s.stage} {s.durationMinutes ? `(${s.durationMinutes} min)` : null}
                </li>
              ))}
            </ol>
            <h2>Notices</h2>
            <ul>
              {Object.entries(data.notices).map(([k, v]) => (
                <li key={k}>
                  {NOTICE_META[k]?.label ?? k} (version {v})
                </li>
              ))}
            </ul>
            {acceptError ? <Alert kind="danger">{acceptError}</Alert> : null}
            <button type="button" className="btn" disabled={accepting} onClick={() => void onAccept()}>
              {accepting ? "Starting…" : "Begin"}
            </button>
          </div>
        ) : null}

        {status === "disclosure_pending" && token ? (
          <DisclosurePanel token={token} view={data} onChanged={() => view.reload()} />
        ) : null}

        {status === "ready" ? (
          <div className="stack">
            <p>You have completed the disclosure step. You may start your assessment when ready.</p>
            <button type="button" className="btn" onClick={() => void onStart()}>
              Start assessment
            </button>
          </div>
        ) : null}

        {status === "in_progress" && token ? <Workspace token={token} onChanged={() => view.reload()} /> : null}

        {status === "paused" ? (
          <div className="stack">
            <p>Your assessment is paused.</p>
            <button type="button" className="btn" onClick={() => void onResume()}>
              Resume assessment
            </button>
          </div>
        ) : null}

        {status && status in TERMINAL_COPY ? (
          <div className="stack">
            <Alert kind="info">{TERMINAL_COPY[status]}</Alert>
            {token ? <DataRightsCentre token={token} /> : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}

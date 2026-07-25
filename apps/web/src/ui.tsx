import { useEffect, useId, useRef, type ReactNode } from "react";
import { ApiError } from "./api.js";

/** Loading state with polite announcement for assistive technology. */
export function Loading({ label = "Loading…" }: { label?: string }): ReactNode {
  return (
    <div className="state-block" role="status" aria-live="polite">
      {label}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }): ReactNode {
  return (
    <div className="state-block">
      <h3>{title}</h3>
      {hint ? <p className="muted">{hint}</p> : null}
    </div>
  );
}

/** Error state mapping the API error contract to safe, actionable copy. */
export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}): ReactNode {
  const apiError = error instanceof ApiError ? error : null;
  const permission = apiError?.status === 403;
  const message =
    apiError?.message ?? "Something went wrong. If this keeps happening, contact support.";
  return (
    <div className="state-block" role="alert">
      <h3>{permission ? "You do not have access to this" : "Could not load this view"}</h3>
      <p className="muted">{message}</p>
      {apiError ? (
        <p className="muted">
          <small>
            Code {apiError.code} · Request {apiError.requestId}
          </small>
        </p>
      ) : null}
      {onRetry && (apiError?.retryable ?? true) && !permission ? (
        <button type="button" className="btn secondary" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function Alert({
  kind,
  children,
}: {
  kind: "info" | "success" | "warning" | "danger";
  children: ReactNode;
}): ReactNode {
  return (
    <div className={`alert ${kind}`} role={kind === "danger" ? "alert" : "status"}>
      {children}
    </div>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: (ids: { id: string; describedBy: string | undefined }) => ReactNode;
}

/** Accessible form field: persistent label, hint, and inline error wiring. */
export function Field({ label, hint, error, children }: FieldProps): ReactNode {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <span className="hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {children({ id, describedBy })}
      {error ? (
        <span className="error-text" id={errorId}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** Native-dialog modal with focus containment and Escape support. */
export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}): ReactNode {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" aria-label={title} onClose={onClose} onCancel={onClose}>
      <div className="spread" style={{ marginBottom: "var(--space-4)" }}>
        <h2>{title}</h2>
        <button type="button" className="btn secondary" onClick={onClose}>
          Close
        </button>
      </div>
      {children}
    </dialog>
  );
}

const BAND_CLASS: Record<string, string> = {
  "Limited evidence": "limited",
  "Mixed evidence": "mixed",
  "Supported evidence": "supported",
  "Strong evidence": "strong",
};

/** Evidence band badge — text label always present, never colour-only. */
export function BandBadge({ band }: { band: string }): ReactNode {
  return <span className={`pill band ${BAND_CLASS[band] ?? ""}`}>{band}</span>;
}

export function StatusPill({ value }: { value: string }): ReactNode {
  return <span className="pill">{value.replaceAll("_", " ")}</span>;
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

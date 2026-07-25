import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { CandidatePortalPage } from "../src/pages/CandidatePortalPage.js";

const ASSESSMENT = {
  code: "SE1",
  title: "Software Engineer I",
  subtitle: "Practical assessment",
  timebox: "90 minutes",
  purpose: "Assess practical software engineering ability.",
  approvedTools: "Editor, docs.",
  constraints: "No external collaboration.",
  stages: [{ stage: "Brief", durationMinutes: 10, candidateAction: "Read", evidenceCaptured: "n/a" }],
};

const NOTICES = {
  privacyNotice: "2026-07-25.draft-1",
  aiUseNotice: "2026-07-25.draft-1",
  telemetryNotice: "2026-07-25.draft-1",
  assessmentRules: "2026-07-25.draft-1",
};

function view(overrides: Record<string, unknown> = {}) {
  return {
    candidateName: "Ada Lovelace",
    invitationStatus: "opened",
    expiresAt: "2026-08-01T00:00:00.000Z",
    assessment: ASSESSMENT,
    notices: NOTICES,
    session: null,
    ...overrides,
  };
}

function stubFetch(landing: Record<string, unknown>, onCall?: (path: string, init?: RequestInit) => unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const custom = onCall?.(path, init);
        if (custom !== undefined) return Promise.resolve(custom);
        return Promise.resolve({ status: 200, ok: true, json: async () => ({}) });
      }
      return Promise.resolve({ status: 200, ok: true, json: async () => landing });
    }),
  );
}

function renderPortal(): void {
  render(
    <MemoryRouter initialEntries={["/candidate/tok-1"]}>
      <Routes>
        <Route path="/candidate/:token" element={<CandidatePortalPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CandidatePortalPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("never shows Start assessment before disclosure acknowledgement, and enables Acknowledge only once every notice has been opened", async () => {
    stubFetch(view({ session: { id: "s-1", status: "disclosure_pending" } }));
    renderPortal();

    await screen.findByText("Before you begin");
    expect(screen.queryByRole("button", { name: "Start assessment" })).toBeNull();

    const ackButton = screen.getByRole("button", { name: "Acknowledge and continue" });
    expect((ackButton as HTMLButtonElement).disabled).toBe(true);

    const details = document.querySelectorAll("details");
    expect(details.length).toBe(4);
    for (const d of Array.from(details)) {
      d.open = true;
      d.dispatchEvent(new Event("toggle"));
    }

    await waitFor(() => expect((ackButton as HTMLButtonElement).disabled).toBe(false));
  });

  it("only ever sends the workspace_evidence category when saving evidence, never a forbidden category", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    stubFetch(view({ session: { id: "s-1", status: "in_progress" } }), (path, init) => {
      if (path.endsWith("/events")) {
        calls.push({ path, body: init?.body ? JSON.parse(init.body as string) : null });
      }
      return undefined;
    });
    renderPortal();

    await screen.findByText("Your workspace");
    await userEvent.type(screen.getByLabelText("Your work"), "My solution");
    await userEvent.click(screen.getByRole("button", { name: "Save evidence" }));

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    for (const call of calls) {
      const body = call.body as { category: string; eventType: string };
      expect(body.category).toBe("workspace_evidence");
      expect(["raw_keystroke", "external_clipboard_content", "screen_recording", "camera_frame", "microphone_audio"]).not.toContain(
        body.eventType,
      );
    }
  });

  it("requires window.confirm before submitting, and only submits when confirmed", async () => {
    let submitCalled = false;
    stubFetch(view({ session: { id: "s-1", status: "in_progress" } }), (path) => {
      if (path.endsWith("/submit")) {
        submitCalled = true;
        return { status: 200, ok: true, json: async () => ({ status: "submitted" }) };
      }
      return undefined;
    });
    renderPortal();
    await screen.findByText("Your workspace");

    vi.stubGlobal("confirm", vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true));
    await userEvent.click(screen.getByRole("button", { name: "Submit assessment" }));
    expect(submitCalled).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Submit assessment" }));
    await waitFor(() => expect(submitCalled).toBe(true));
  });

  it("renders a data-rights receipt after a successful request in a terminal session state", async () => {
    stubFetch(view({ session: { id: "s-1", status: "submitted" } }), (path) => {
      if (path.endsWith("/data-rights")) {
        return { status: 201, ok: true, json: async () => ({ requestId: "dr-1", dueAt: "2026-08-20T00:00:00.000Z", status: "received" }) };
      }
      return undefined;
    });
    renderPortal();

    await screen.findByText("Your data rights");
    await userEvent.selectOptions(screen.getByLabelText("Request type"), "access");
    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));

    await screen.findByText("Request received");
    expect(screen.getByText("dr-1")).toBeTruthy();
  });
});

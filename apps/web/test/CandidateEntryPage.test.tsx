import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import type { ReactNode } from "react";
import { CandidateEntryPage } from "../src/pages/CandidateEntryPage.js";

function Portal(): ReactNode {
  return <p>Portal for token</p>;
}

describe("CandidateEntryPage", () => {
  afterEach(() => cleanup());

  it("navigates to the token-scoped portal route on submit", async () => {
    render(
      <MemoryRouter initialEntries={["/candidate"]}>
        <Routes>
          <Route path="/candidate" element={<CandidateEntryPage />} />
          <Route path="/candidate/:token" element={<Portal />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.type(screen.getByLabelText("Assessment link token"), "tok-123");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByText("Portal for token");
  });
});

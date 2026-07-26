import { describe, expect, it } from "vitest";
import { AiModelNotAllowedError, assertModelAllowed } from "../src/allow-list.js";

describe("assertModelAllowed", () => {
  const allowList = [{ provider: "openai-compatible", model: "gpt-4o-mini", version: "2024-07-18" }];

  it("allows an exact provider+model+version match", () => {
    expect(() =>
      assertModelAllowed({ provider: "openai-compatible", model: "gpt-4o-mini", version: "2024-07-18" }, allowList),
    ).not.toThrow();
  });

  it("rejects an unpinned version of an otherwise-allowed model", () => {
    expect(() =>
      assertModelAllowed({ provider: "openai-compatible", model: "gpt-4o-mini", version: "2099-01-01" }, allowList),
    ).toThrow(AiModelNotAllowedError);
  });

  it("rejects a model that never appears on the allow-list", () => {
    expect(() =>
      assertModelAllowed({ provider: "openai-compatible", model: "unlisted-model", version: "2024-07-18" }, allowList),
    ).toThrow(AiModelNotAllowedError);
  });
});

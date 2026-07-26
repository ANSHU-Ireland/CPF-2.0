import { describe, expect, it } from "vitest";
import { AiGatewayKilledError, assertNotKilled } from "../src/kill-switch.js";

describe("assertNotKilled", () => {
  it("allows the call when both switches are enabled", () => {
    expect(() => assertNotKilled({ platformEnabled: true, orgEnabled: true })).not.toThrow();
  });

  it("blocks and reports the platform scope when the platform switch is off", () => {
    try {
      assertNotKilled({ platformEnabled: false, orgEnabled: true });
      expect.unreachable("expected assertNotKilled to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AiGatewayKilledError);
      expect((err as AiGatewayKilledError).scope).toBe("platform");
    }
  });

  it("blocks and reports the org scope when only the org switch is off", () => {
    try {
      assertNotKilled({ platformEnabled: true, orgEnabled: false });
      expect.unreachable("expected assertNotKilled to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AiGatewayKilledError);
      expect((err as AiGatewayKilledError).scope).toBe("org");
    }
  });

  it("reports the platform scope first when both switches are off", () => {
    try {
      assertNotKilled({ platformEnabled: false, orgEnabled: false });
      expect.unreachable("expected assertNotKilled to throw");
    } catch (err) {
      expect((err as AiGatewayKilledError).scope).toBe("platform");
    }
  });
});

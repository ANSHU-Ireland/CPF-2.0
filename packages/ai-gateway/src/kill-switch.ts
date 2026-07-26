export type KillSwitchScope = "platform" | "org";

export class AiGatewayKilledError extends Error {
  readonly code = "AI_GATEWAY_KILLED" as const;
  constructor(public readonly scope: KillSwitchScope) {
    super(`AI gateway is disabled at the ${scope} level.`);
    this.name = "AiGatewayKilledError";
  }
}

export interface KillSwitchState {
  /** Global, deployer-controlled switch. Defaults to disabled — Phase 1 ships zero AI providers (ADR-0005). */
  platformEnabled: boolean;
  /** Per-organisation opt-in, independent of the platform switch. */
  orgEnabled: boolean;
}

/** Both the platform switch AND the org switch must be on — either one alone kills the call. */
export function assertNotKilled(state: KillSwitchState): void {
  if (!state.platformEnabled) throw new AiGatewayKilledError("platform");
  if (!state.orgEnabled) throw new AiGatewayKilledError("org");
}

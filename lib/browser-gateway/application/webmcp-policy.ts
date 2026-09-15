/**
 * WebMCP capability policy (US-004 AC31 / webmcp-strategy.md).
 *
 * WebMCP is a draft browser API (W3C Community Group, Chrome origin trial as of
 * Sept 2026). It is an OPTIONAL capability adapter for owned interactive web
 * applications, NOT a replacement for Browser Gateway on external sites and NOT
 * a hard dependency of core V1 browser execution.
 *
 * This policy is the trusted, engine-independent gate that decides:
 *  - whether WebMCP capability is enabled at all (feature flag `WEBMCP_ENABLED`,
 *    default `false`);
 *  - whether a page/domain is eligible for WebMCP tools (owned interactive apps
 *    only; external sites continue through Browser Gateway);
 *  - whether a page-provided tool may be used, given the current
 *    ContextBundle/Capability Matrix;
 *  - whether a side-effect tool requires approval;
 *  - that tool outputs are always treated as untrusted page content.
 *
 * Page-provided tools are UNTRUSTED capability descriptions until allowed by
 * this gateway policy. A WebMCP tool can never grant itself more permissions
 * than the current Capability Matrix allows, and tool registration never
 * exposes secrets or privileged functions merely because the current user is
 * authenticated.
 */

export interface WebMCPPolicyOptions {
  /** Feature flag. Defaults to `process.env.WEBMCP_ENABLED === 'true'`. */
  enabled: boolean;
  /** Domains of owned interactive apps eligible for WebMCP tools. */
  ownedDomains: string[];
}

/**
 * A capability description a page claims to expose via `document.modelContext`.
 * Untrusted until authorized by the gateway policy.
 */
export interface WebMCPTool {
  name: string;
  description: string;
  /** Capability identifiers the page claims the tool can perform. */
  claimedPermissions: string[];
  /** Whether the tool performs an external side effect (submit/send/publish). */
  sideEffect: boolean;
}

/**
 * The trusted capability surface the current ContextBundle allows. A page tool
 * may only be used if its claimed permissions are a subset of this matrix.
 */
export interface CapabilityMatrix {
  /** Capability identifiers the current context allows. */
  allowedPermissions: string[];
  /** Whether side-effect tools may run at all (approval still applies). */
  allowSideEffects: boolean;
}

export type PageEligibility =
  | { eligible: true }
  | { eligible: false; reason: 'not_owned' | 'webmcp_disabled' };

export type ToolAuthorization =
  | { status: 'allowed'; reason: string }
  | { status: 'denied'; reason: 'permission_expansion' | 'webmcp_disabled' };

export type SideEffectVerdict =
  | { status: 'allowed'; reason: string }
  | { status: 'approval_required'; reason: string };

export class WebMCPPolicy {
  private readonly enabled: boolean;
  private readonly ownedDomains: ReadonlySet<string>;

  constructor(options?: Partial<WebMCPPolicyOptions>) {
    this.enabled =
      options?.enabled ?? process.env.WEBMCP_ENABLED === 'true';
    this.ownedDomains = new Set(
      (options?.ownedDomains ?? []).map((d) => d.toLowerCase()),
    );
  }

  /** Whether WebMCP capability is enabled at all (feature flag). */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Classify whether a page/domain is eligible for WebMCP tools. Only owned
   * interactive apps are eligible; external sites continue through Browser
   * Gateway. When the feature flag is off, nothing is eligible.
   */
  classifyPage(domain: string): PageEligibility {
    if (!this.enabled) return { eligible: false, reason: 'webmcp_disabled' };
    if (!this.ownedDomains.has(domain.toLowerCase())) {
      return { eligible: false, reason: 'not_owned' };
    }
    return { eligible: true };
  }

  /**
   * Authorize a page-provided tool against the current Capability Matrix.
   * A WebMCP tool cannot grant itself more permissions than the matrix allows
   * (no permission expansion). Tool registration never exposes secrets or
   * privileged functions merely because the current user is authenticated —
   * the tool is only usable if its claimed permissions are already allowed.
   */
  authorizeTool(tool: WebMCPTool, matrix: CapabilityMatrix): ToolAuthorization {
    if (!this.enabled) return { status: 'denied', reason: 'webmcp_disabled' };

    const allowed = new Set(matrix.allowedPermissions);
    const expanded = tool.claimedPermissions.filter((p) => !allowed.has(p));
    if (expanded.length > 0) {
      return {
        status: 'denied',
        reason: 'permission_expansion',
      };
    }

    return {
      status: 'allowed',
      reason: `${tool.name} claimed permissions are within the allowed capability matrix`,
    };
  }

  /**
   * Side-effect tools still require approval where policy requires it. A page
   * tool cannot self-authorize a side effect; an explicit approval token is
   * required, mirroring the SafetyGate for browser actions.
   */
  assessSideEffect(
    tool: WebMCPTool,
    approval: { approved: boolean } | undefined,
  ): SideEffectVerdict {
    if (!tool.sideEffect) {
      return { status: 'allowed', reason: `${tool.name} is not a side-effect tool` };
    }
    if (approval?.approved === true) {
      return {
        status: 'allowed',
        reason: `${tool.name} is a side-effect tool with an explicit approval token`,
      };
    }
    return {
      status: 'approval_required',
      reason: `${tool.name} is a side-effect tool and requires explicit approval`,
    };
  }

  /**
   * Tool outputs are page content and therefore remain subject to
   * prompt-injection boundaries. Always true — a page tool's output is never
   * trusted as instructions or capability expansion.
   */
  isUntrustedOutput(): true {
    return true;
  }
}

/**
 * Convenience shared instance. Tests may construct their own with injected
 * options to avoid cross-test environment coupling.
 */
export const defaultWebMCPPolicy = new WebMCPPolicy();

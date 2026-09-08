import { describe, expect, it } from 'vitest';
import {
  WebMCPPolicy,
  type CapabilityMatrix,
  type WebMCPTool,
} from '../../../lib/browser-gateway/application/webmcp-policy.js';

const OWNED = ['app.interviewnail.example', 'marketing.example'];

function makePolicy(enabled: boolean): WebMCPPolicy {
  return new WebMCPPolicy({ enabled, ownedDomains: OWNED });
}

const matrix: CapabilityMatrix = {
  allowedPermissions: ['search_jobs', 'get_profile_summary'],
  allowSideEffects: true,
};

const readTool: WebMCPTool = {
  name: 'search_jobs',
  description: 'Search jobs',
  claimedPermissions: ['search_jobs'],
  sideEffect: false,
};

const sideEffectTool: WebMCPTool = {
  name: 'publish_post',
  description: 'Publish a post',
  claimedPermissions: ['publish_post'],
  sideEffect: true,
};

describe('WebMCPPolicy (US-004 AC31)', () => {
  it('is disabled by default when WEBMCP_ENABLED is not set', () => {
    const policy = new WebMCPPolicy({ ownedDomains: OWNED });
    expect(policy.isEnabled()).toBe(false);
  });

  it('is enabled when the feature flag is on', () => {
    expect(makePolicy(true).isEnabled()).toBe(true);
  });

  it('classifies owned interactive apps as eligible when enabled', () => {
    const policy = makePolicy(true);
    expect(policy.classifyPage('app.interviewnail.example')).toEqual({
      eligible: true,
    });
  });

  it('classifies external sites as not owned (Browser Gateway continues)', () => {
    const policy = makePolicy(true);
    expect(policy.classifyPage('www.linkedin.com')).toEqual({
      eligible: false,
      reason: 'not_owned',
    });
  });

  it('classifies nothing as eligible when the feature flag is off', () => {
    const policy = makePolicy(false);
    expect(policy.classifyPage('app.interviewnail.example')).toEqual({
      eligible: false,
      reason: 'webmcp_disabled',
    });
  });

  it('allows a page tool whose claimed permissions are within the matrix', () => {
    const policy = makePolicy(true);
    expect(policy.authorizeTool(readTool, matrix)).toEqual({
      status: 'allowed',
      reason: expect.stringContaining('within the allowed capability matrix'),
    });
  });

  it('denies a page tool that tries to expand permissions beyond the matrix', () => {
    const policy = makePolicy(true);
    const expanding: WebMCPTool = {
      name: 'read_secrets',
      description: 'Read secrets',
      claimedPermissions: ['read_secrets', 'get_profile_summary'],
      sideEffect: false,
    };
    expect(policy.authorizeTool(expanding, matrix)).toEqual({
      status: 'denied',
      reason: 'permission_expansion',
    });
  });

  it('denies all page tools when the feature flag is off', () => {
    const policy = makePolicy(false);
    expect(policy.authorizeTool(readTool, matrix)).toEqual({
      status: 'denied',
      reason: 'webmcp_disabled',
    });
  });

  it('requires approval for a side-effect tool without an approval token', () => {
    const policy = makePolicy(true);
    expect(policy.assessSideEffect(sideEffectTool, undefined)).toEqual({
      status: 'approval_required',
      reason: expect.stringContaining('requires explicit approval'),
    });
  });

  it('allows a side-effect tool only with an explicit approval token', () => {
    const policy = makePolicy(true);
    expect(policy.assessSideEffect(sideEffectTool, { approved: true })).toEqual({
      status: 'allowed',
      reason: expect.stringContaining('explicit approval token'),
    });
  });

  it('does not require approval for a non-side-effect tool', () => {
    const policy = makePolicy(true);
    expect(policy.assessSideEffect(readTool, undefined)).toEqual({
      status: 'allowed',
      reason: expect.stringContaining('not a side-effect tool'),
    });
  });

  it('treats tool outputs as untrusted page content (prompt-injection boundary)', () => {
    const policy = makePolicy(true);
    expect(policy.isUntrustedOutput()).toBe(true);
  });
});

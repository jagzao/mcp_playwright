import { describe, expect, it, beforeEach } from 'vitest';
import { EvidenceLedger, type EvidenceRecord } from '../../../lib/browser-gateway/application/evidence-ledger.js';

function record(overrides: Partial<EvidenceRecord> & { claim: string }): Omit<EvidenceRecord, 'evidenceId'> {
  return {
    claim: overrides.claim,
    sourceUrl: overrides.sourceUrl ?? 'https://source.example/1',
    sourceTitle: overrides.sourceTitle ?? 'Source',
    retrievedAt: overrides.retrievedAt ?? '2024-01-01T00:00:00.000Z',
    sourceType: overrides.sourceType ?? 'secondary',
    support: overrides.support ?? 'supports',
    relevance: overrides.relevance ?? 0.8,
    materiality: overrides.materiality ?? 'major',
    locator: overrides.locator ?? { kind: 'excerpt', excerpt: overrides.claim },
  };
}

describe('evidence-ledger (US-003)', () => {
  let ledger: EvidenceLedger;

  beforeEach(() => {
    ledger = new EvidenceLedger();
  });

  it('records claims/sources/locators with unique ids', () => {
    const a = ledger.add(record({ claim: 'X is true', sourceUrl: 'https://a.example/1', sourceTitle: 'A' }));
    const b = ledger.add(record({ claim: 'Y is true', sourceUrl: 'https://b.example/1', sourceTitle: 'B' }));

    expect(a.evidenceId).toBeTruthy();
    expect(b.evidenceId).not.toBe(a.evidenceId);
    expect(ledger.all()).toHaveLength(2);
    expect(ledger.all()[0]).toMatchObject({ claim: 'X is true', sourceTitle: 'A' });
    expect(ledger.all()[0].locator).toEqual({ kind: 'excerpt', excerpt: 'X is true' });
  });

  it('queries records by filters', () => {
    ledger.add(record({ claim: 'X', support: 'supports', sourceUrl: 'https://a.example' }));
    ledger.add(record({ claim: 'Y', support: 'contradicts', sourceUrl: 'https://b.example' }));

    expect(ledger.query({ claim: 'X' })).toHaveLength(1);
    expect(ledger.query({ support: 'contradicts' })).toHaveLength(1);
    expect(ledger.query({ sourceUrl: 'https://b.example' })).toHaveLength(1);
    expect(ledger.query({ support: 'neutral' })).toHaveLength(0);
  });

  it('finds single-source claims', () => {
    ledger.add(record({ claim: 'Lonely claim' }));
    ledger.add(record({ claim: 'Repeated claim' }));
    ledger.add(record({ claim: 'Repeated claim', sourceUrl: 'https://other.example' }));

    const single = ledger.singleSourceClaims();
    expect(single).toEqual(['Lonely claim']);
  });

  it('finds contradictions when the same claim is both supported and contradicted', () => {
    ledger.add(record({ claim: 'P', support: 'supports' }));
    ledger.add(record({ claim: 'P', support: 'contradicts' }));

    const contradictions = ledger.contradictions('major');
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0]).toMatchObject({
      claim: 'P',
      reason: 'independent sources disagree on: P',
    });
    expect(contradictions[0].supporting).toHaveLength(1);
    expect(contradictions[0].contradicting).toHaveLength(1);
  });

  it('does not treat identical-polarity records as a contradiction', () => {
    ledger.add(record({ claim: 'P', support: 'supports' }));
    ledger.add(record({ claim: 'P', support: 'supports' }));

    expect(ledger.contradictions('major')).toHaveLength(0);
  });

  it('respects materiality when finding contradictions', () => {
    ledger.add(record({ claim: 'P', support: 'supports', materiality: 'major' }));
    ledger.add(record({ claim: 'P', support: 'contradicts', materiality: 'background' }));

    // materiality restrict — none of the conflicting pair is 'major' on both sides
    expect(ledger.contradictions('major')).toHaveLength(0);
    // unfiltered still sees disagreement
    expect(ledger.contradictions()).toHaveLength(1);
  });
});

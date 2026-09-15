/**
 * Evidence Ledger (US-003 / Phase D).
 *
 * Decouples research conclusions from "what the final model remembers". Every
 * claim is backed by at least one source + a bounded excerpt and a retrievable
 * source locator, so conclusions can be audited without re-reading whole pages.
 *
 * Deliberately does NOT store full copyrighted page bodies. It retains bounded
 * evidence snippets and a locator (section/heading or bounded excerpt reference)
 * so the original can be retrieved on demand (per deep-research.md).
 */

export type EvidenceSupport = 'supports' | 'contradicts' | 'neutral';
/** "primary" / "secondary" reflect whether the source is first-party evidence. */
export type EvidenceSourceHierarchy = 'primary' | 'secondary';
/** Materiality for adversarial surfacing. */
export type EvidenceMateriality = 'major' | 'background';

export interface EvidenceLocator {
  kind: 'heading' | 'section-ref' | 'excerpt';
  /** Section/heading path when a structured page was read. */
  headingPath?: string;
  /** Bounded excerpt reference — the bounded evidence snippet itself. */
  excerpt: string;
}

export interface EvidenceRecord {
  evidenceId: string;
  claim: string;
  sourceUrl: string;
  sourceTitle: string;
  publishedAt?: string;
  retrievedAt: string;
  sourceType: EvidenceSourceHierarchy;
  support: EvidenceSupport;
  relevance: number; // 0..1
  locator: EvidenceLocator;
  /** Optional grouping so a single claim/source can hold multiple facts. */
  materiality: EvidenceMateriality;
}

export interface LedgerQueryFilters {
  claim?: string;
  sourceUrl?: string;
  support?: EvidenceSupport;
  sourceType?: EvidenceSourceHierarchy;
  materiality?: EvidenceMateriality;
}

export interface Contradiction {
  /** The proposition that independent/primary sources disagree on. */
  claim: string;
  supporting: EvidenceRecord[];
  contradicting: EvidenceRecord[];
  reason: string;
}

let counter = 0;

function nextId(): string {
  counter += 1;
  return `ev_${counter}`;
}

/**
 * Append-only ledger of bounded evidence. Supports querying by claim, source,
 * support polarity and finding single-source claims and contradictions.
 */
export class EvidenceLedger {
  private readonly records: EvidenceRecord[] = [];
  /** Reassignable to keep deterministic in tests. */
  protected _id = () => nextId();

  add(record: Omit<EvidenceRecord, 'evidenceId'>): EvidenceRecord {
    const entry: EvidenceRecord = { ...record, evidenceId: this._id() };
    this.records.push(entry);
    return entry;
  }

  all(): EvidenceRecord[] {
    return this.records.slice();
  }

  query(filters: LedgerQueryFilters = {}): EvidenceRecord[] {
    return this.records.filter((r) => {
      if (filters.claim && r.claim !== filters.claim) return false;
      if (filters.sourceUrl && r.sourceUrl !== filters.sourceUrl) return false;
      if (filters.support && r.support !== filters.support) return false;
      if (filters.sourceType && r.sourceType !== filters.sourceType) return false;
      if (filters.materiality && r.materiality !== filters.materiality) return false;
      return true;
    });
  }

  /** Claims that appear in exactly one evidence record (single-source risk). */
  singleSourceClaims(): string[] {
    const byClaim = new Map<string, number>();
    for (const r of this.records) byClaim.set(r.claim, (byClaim.get(r.claim) ?? 0) + 1);
    return [...byClaim.entries()]
      .filter(([, n]) => n === 1)
      .map(([claim]) => claim);
  }

  /**
   * Find material disagreements: the same claim has at least one `supports`
   * and at least one `contradicts` record. Optionally restrict to claims of a
   * given materiality.
   */
  contradictions(materiality?: EvidenceMateriality): Contradiction[] {
    const byClaim = new Map<string, EvidenceRecord[]>();
    for (const r of this.records) {
      if (materiality && r.materiality !== materiality) continue;
      const list = byClaim.get(r.claim) ?? [];
      list.push(r);
      byClaim.set(r.claim, list);
    }
    const out: Contradiction[] = [];
    for (const [claim, records] of byClaim) {
      const supporting = records.filter((r) => r.support === 'supports');
      const contradicting = records.filter((r) => r.support === 'contradicts');
      if (supporting.length > 0 && contradicting.length > 0) {
        out.push({
          claim,
          supporting,
          contradicting,
          reason: `independent sources disagree on: ${claim}`,
        });
      }
    }
    return out;
  }
}

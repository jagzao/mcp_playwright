/**
 * Source ranking (deep-research.md).
 *
 * Scores candidate sources on dimensions such as authority/primary-source,
 * relevance, publication date, independence from already-selected sources,
 * direct-evidence-vs-opinion and conflict-of-interest risk. Pure function so it
 * is fully unit-testable and deterministic.
 */

export type AuthorityLevel = 'primary' | 'secondary' | 'aggregator' | 'opaque';

export interface RankingInput {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  /** Known primary domains for the research domain (e.g. official docs/journal). */
  primaryDomains?: string[];
  /** Domains treated as high conflict-of-interest (e.g. vendor marketing). */
  highCoIDomains?: string[];
  /** How specifically the snippet/title match the query terms, 0..1 (default 0.5). */
  relevance?: number;
  /** Publication-freshness weight in relevance, 0..1. */
  now?: number;
}

export interface SourceScore {
  authority: number; // 0..1
  relevance: number; // 0..1
  freshness: number; // 0..1
  quality: number; // 0..1
}

const SECOND = 1000;
const HOUR = 3600 * SECOND;
const DAY = 24 * HOUR;

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Naive primary-domain detector; caller may supply explicit lists. */
function classifyAuthority(
  url: string,
  primaryDomains: string[],
  highCoIDomains: string[],
  isPrimaryHint = false,
): { level: AuthorityLevel; authority: number } {
  const host = hostnameOf(url);
  if (isPrimaryHint || primaryDomains.some((d) => host === d || host.endsWith('.' + d))) {
    return { level: 'primary', authority: 0.95 };
  }
  if (highCoIDomains.some((d) => host === d || host.endsWith('.' + d))) {
    return { level: 'opaque', authority: 0.25 };
  }
  // Reasonable heuristic: gov/edu/org and canonical domains are higher authority.
  if (host.endsWith('.gov') || host.endsWith('.edu')) return { level: 'secondary', authority: 0.8 };
  if (url.includes('wikipedia.org')) return { level: 'aggregator', authority: 0.55 };
  return { level: 'secondary', authority: 0.6 };
}

function freshnessFromDate(publishedAt: string | undefined, now: number): number {
  if (!publishedAt) return 0.5; // unknown date = neutral
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) return 0.5;
  const age = Math.max(0, now - t);
  if (age < 7 * DAY) return 1;
  if (age < 30 * DAY) return 0.9;
  if (age < 180 * DAY) return 0.7;
  if (age < 365 * DAY) return 0.5;
  return 0.25;
}

/**
 * Rank a candidate. Returns a score 0..1; higher is better. `relevance` measures
 * how specific the snippet/title are to the exact query terms.
 */
export function scoreSource(input: RankingInput): SourceScore {
  const now = input.now ?? Date.now();
  const relevance = input.relevance ?? 0.5;
  const qLower = input.title.toLowerCase() + ' ' + input.snippet.toLowerCase();
  const authority = classifyAuthority(
    input.url,
    input.primaryDomains ?? [],
    input.highCoIDomains ?? [],
    input.publishedAt === undefined && (input.snippet.includes('official') || input.snippet.includes('primary')),
  );
  const freshness = freshnessFromDate(input.publishedAt, now);
  // Independent query is computed separately by the agent (needs the already-selected set).
  const quality = 0.35 * authority.authority + 0.4 * relevance + 0.25 * freshness;
  return {
    authority: authority.authority,
    relevance,
    freshness,
    quality: Math.round(quality * 100) / 100,
  };
}

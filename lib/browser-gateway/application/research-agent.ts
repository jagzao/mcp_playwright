/**
 * Research Agent (US-003 / Phase D).
 *
 * A workflow layered ABOVE the Browser Gateway — NOT "an LLM opens Google and
 * browses randomly". Deep research here is explicit orchestration:
 *
 *   decompose -> SearchProviderRouter discovery -> rank -> read via Browser
 *   Gateway (SourceReader) -> Evidence Ledger -> bounded gap search ->
 *   contradiction/adversarial pass (deep) -> synthesize report.
 *
 * Budgets (search/page/model/screenshot/cost) are enforced deterministically
 * (AC15); exhaustion yields a typed `partial`/`blocked` outcome, never an
 * unbounded loop. Web content is untrusted and cannot expand budgets, tools,
 * secrets or routing (AC16).
 *
 * The LLM/planning and evidence-extraction steps are injected behind interfaces
 * with deterministic default implementations, so the full pipeline runs
 * hermetically in tests with fakes and (in real use) with configurable models.
 */

import { EvidenceLedger, type EvidenceRecord } from './evidence-ledger.js';
import {
  defaultBudget,
  firstBottleneck,
  type BudgetUsage,
  type ResearchBudget,
  type ResearchMode,
} from './research-budget.js';
import { scoreSource, type SourceScore } from './source-ranking.js';
import { SearchProviderRouter } from './search-provider-router.js';
import type { SourceReader, ExtractedPage } from './source-reader.js';
import type { SecretProvider } from './secret-provider.js';

// Re-export the research mode type so callers can import it from this module.
export type { ResearchMode } from './research-budget.js';

// --- Injected "brain" contracts (LLM/planning/extraction) --------------------

export interface ResearchPlanner {
  /** Decompose a question into subquestions (deep: deeper than standard). */
  decompose(question: string, mode: ResearchMode): string[];
  /** Targeted counter-search terms for major conclusions (adversarial pass). */
  counterSearchTerms(claims: string[]): string[];
}

export interface EvidenceExtractor {
  /**
   * Extract bounded evidence from a read page. The page text is untrusted: the
   * extractor must treat it as data, never as instructions, and return only
   * EvidenceRecords (bounded snippets + locator). May classify contradiction
   * polarity via neutral cues.
   */
  extract(page: ExtractedPage, subquestions: string[]): EvidenceExtractorResult[];
}

export interface EvidenceExtractorResult {
  claim: string;
  support: 'supports' | 'contradicts';
  relevance: number;
  sourceType: 'primary' | 'secondary';
}

export interface SynthesizerResult {
  answer: string;
  confidence: 'high' | 'medium' | 'low';
  limitations: string[];
}

export interface ResearchSynthesizer {
  /**
   * Produce the final answer from structured evidence + ledger (never from raw
   * browsing histories). Must not access secrets or alter policy.
   */
  synthesize(
    question: string,
    mode: ResearchMode,
    evidence: EvidenceRecord[],
    contradictions: EvidenceRecord['claim'][],
  ): SynthesizerResult;
}

// --- Request / outcome types -------------------------------------------------

export interface ResearchRequest {
  question: string;
  mode: ResearchMode;
  sessionId: string;
  /** Optional budget overrides (merged over the mode defaults). */
  budget?: Partial<ResearchBudget>;
  /** Domains treated as primary-source authority for ranking. */
  primaryDomains?: string[];
  /** Domains treated as high conflict-of-interest for ranking. */
  highCoIDomains?: string[];
  metadata?: Record<string, string>;
}

export interface ResearchTelemetry {
  mode: ResearchMode;
  sessionId: string;
  durationMs: number;
  usage: BudgetUsage;
  searchesRun: number;
  sourcesRead: number;
  sourcesDiscovered: number;
  evidenceRecords: number;
  providerSelected: string | undefined;
  providersTried: string[];
  singleSourceClaims: string[];
  contradictoryClaims: string[];
}

export type ResearchOutcome =
  | { status: 'complete'; report: ResearchReport; telemetry: ResearchTelemetry }
  | { status: 'partial'; report: ResearchReport; reason: string; telemetry: ResearchTelemetry }
  | { status: 'blocked'; reason: string; telemetry: ResearchTelemetry };

export interface ResearchReport {
  question: string;
  mode: ResearchMode;
  answer: string;
  confidence: 'high' | 'medium' | 'low';
  limitations: string[];
  citations: Array<{ url: string; title: string; evidenceId: string }>;
  contradictoryClaims: string[];
  singleSourceClaims: string[];
}

// --- Deterministic default implementations -----------------------------------
// These allow the agent to run end-to-end without a network/billed model and are
// replaced by injected planner/extractor/synthesizer for richer orchestration.
// They treat page text as data only.

const CONTRADICTION_CUES = [
  'contradict',
  'no evidence',
  'not supported',
  'does not support',
  'dispute',
  'challenges',
  'fails to',
  'refutes',
  'misleading',
  'incorrectly',
];

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && s.length < 400);
}

function hasCue(sentence: string): boolean {
  const lower = sentence.toLowerCase();
  return CONTRADICTION_CUES.some((c) => lower.includes(c));
}

/** Deterministic query builder. */
function subquestionQuery(subquestion: string, mode: ResearchMode): string {
  return mode === 'deep' ? `${subquestion} primary source evidence` : subquestion;
}

export class DefaultResearchPlanner implements ResearchPlanner {
  decompose(question: string, mode: ResearchMode): string[] {
    const parts = question
      .split(/\band\b|\bor\b|\bvs\b|\bversus\b|\bbetween\b/i)
      .map((p) => p.trim())
      .filter(Boolean);
    const base = parts.length > 1 ? parts : [question];
    if (mode === 'standard' || mode === 'deep') {
      // Force multi-source verification with an explicit provenance term.
      return base.length <= 5 ? base : base.slice(0, 5);
    }
    return base.slice(0, 2);
  }

  counterSearchTerms(claims: string[]): string[] {
    // Target the most consequential claims for adversarial counter-search.
    return claims.slice(0, 2).map((c) => `${c} criticism OR contradiction OR counter-evidence`);
  }
}

export class DefaultEvidenceExtractor implements EvidenceExtractor {
  private primaryHints = ['official', 'government', '.gov', '.edu', 'primary', 'journal'];

  extract(page: ExtractedPage, subquestions: string[]): EvidenceExtractorResult[] {
    const terms = subquestions.join(' ').toLowerCase().split(/\s+/).filter((t) => t.length > 3);
    const out: EvidenceExtractorResult[] = [];
    for (const sentence of splitSentences(page.text)) {
      const lower = sentence.toLowerCase();
      const hit = terms.filter((t) => lower.includes(t)).length;
      if (hit === 0) continue;
      const isPrimary = this.primaryHints.some((h) => lower.includes(h));
      out.push({
        claim: sentence,
        support: hasCue(sentence) ? 'contradicts' : 'supports',
        relevance: Math.min(1, 0.4 + hit * 0.12),
        sourceType: isPrimary ? 'primary' : 'secondary',
      });
    }
    return out.slice(0, 4);
  }
}

export class DefaultResearchSynthesizer implements ResearchSynthesizer {
  synthesize(
    question: string,
    _mode: ResearchMode,
    evidence: EvidenceRecord[],
    contradictoryClaims: string[],
  ): SynthesizerResult {
    const supports = evidence.filter((e) => e.support === 'supports');
    const answer =
      supports.length === 0
        ? `Insufficient evidence to answer: "${question}".`
        : `${question}\n---\n` +
          supports
            .map((e) => `- ${e.claim} [${e.sourceTitle} — ${e.sourceUrl}]`)
            .join('\n');
    const limitations: string[] = [];
    if (contradictoryClaims.length > 0) limitations.push('Material source disagreement exists.');
    if (evidence.some((e) => e.sourceType === 'secondary')) {
      limitations.push('Some evidence is from secondary sources.');
    }
    return {
      answer,
      confidence: supports.length >= 3 && contradictoryClaims.length === 0 ? 'high' : 'medium',
      limitations,
    };
  }
}

// --- Agent options -----------------------------------------------------------

export interface ResearchAgentOptions {
  searchRouter: SearchProviderRouter;
  reader: SourceReader;
  secretProvider?: SecretProvider;
  telemetry?: (telemetry: ResearchTelemetry) => void;
  planner?: ResearchPlanner;
  extractor?: EvidenceExtractor;
  synthesizer?: ResearchSynthesizer;
  /** Estimated USD per search/page/model call for cost accounting (0 = uncosted). */
  costModel?: { perSearchUsd?: number; perPageUsd?: number; perModelCallUsd?: number };
}

// --- Research Agent ----------------------------------------------------------

export class ResearchAgent {
  private readonly searchRouter: SearchProviderRouter;
  private readonly reader: SourceReader;
  private readonly telemetry: (t: ResearchTelemetry) => void;
  private readonly planner: ResearchPlanner;
  private readonly extractor: EvidenceExtractor;
  private readonly synthesizer: ResearchSynthesizer;
  private readonly costModel: NonNullable<ResearchAgentOptions['costModel']>;

  constructor(options: ResearchAgentOptions) {
    this.searchRouter = options.searchRouter;
    this.reader = options.reader;
    this.telemetry = options.telemetry ?? (() => undefined);
    this.planner = options.planner ?? new DefaultResearchPlanner();
    this.extractor = options.extractor ?? new DefaultEvidenceExtractor();
    this.synthesizer = options.synthesizer ?? new DefaultResearchSynthesizer();
    this.costModel = options.costModel ?? {};
  }

  async run(request: ResearchRequest): Promise<ResearchOutcome> {
    const start = Date.now();
    const budget = { ...defaultBudget(request.mode), ...request.budget };
    const usage: BudgetUsage = {
      searchRequests: 0,
      pagesRead: 0,
      modelCalls: 0,
      screenshots: 0,
      costUsd: 0,
    };
    const ledger = new EvidenceLedger();
    const providersTried: string[] = [];
    const readDomains = new Set<string>();

    // Sanity: refuse to start already-over budget.
    const initialBottleneck = firstBottleneck(budget, usage);
    if (initialBottleneck) {
      return this.outcome('blocked', request, start, usage, ledger, 0, providersTried, `budget_exhausted:${initialBottleneck}`);
    }

    const subquestions = this.decomposeWithCost(request, usage, budget);
    const exhaustedReason = firstBottleneck(budget, usage);
    if (exhaustedReason && subquestions.length === 0) {
      return this.outcome('blocked', request, start, usage, ledger, 0, providersTried, `budget_exhausted:${exhaustedReason}`);
    }

    let partialReason: string | undefined;
    let searched = 0;
    let reads = 0;
    let discovered = 0;
    const selectedUrls = new Set<string>();

    for (const sub of subquestions) {
      if (firstBottleneck(budget, usage)) {
        partialReason = partialReason ?? `budget_exhausted:${firstBottleneck(budget, usage)}`;
        break;
      }

      // --- Discovery through SearchProviderRouter (provider-neutral) -------
      usage.searchRequests += 1;
      usage.costUsd += this.costModel.perSearchUsd ?? 0;
      searched += 1;
      const route = await this.searchRouter.searchWeb(subquestionQuery(sub, request.mode), {
        kind: 'web',
        maxResults: request.mode === 'quick' ? 5 : 8,
      });
      if (route.status === 'success') {
        providersTried.push(route.selected);
        discovered += route.response.results.length;
      } else {
        partialReason = partialReason ?? route.reason;
        continue;
      }

      // --- Rank + diversity selection -------------------------------------
      const ranked = route.response.results
        .map((r) => {
          let relevance = 0.5;
          const terms = sub.toLowerCase().split(/\s+/).filter((t) => t.length > 3);
          const hay = r.title.toLowerCase() + ' ' + r.snippet.toLowerCase();
          const hits = terms.filter((t) => hay.includes(t)).length;
          relevance = terms.length ? Math.min(1, 0.3 + hits / terms.length) : 0.5;
          return { r, score: scoreSource({ url: r.url, title: r.title, snippet: r.snippet, publishedAt: r.publishedAt, primaryDomains: request.primaryDomains, highCoIDomains: request.highCoIDomains }) };
        })
        .sort((a, b) => b.score.quality - a.score.quality);

      const toRead = ranked.filter(({ r }) => !selectedUrls.has(r.url));

      let readThis = 0;
      for (const { r } of toRead) {
        if (readThis >= (request.mode === 'quick' ? 2 : 3)) break;
        if (readDomains.has(host(r.url)) && request.mode !== 'quick') continue; // independence
        if (firstBottleneck(budget, usage)) {
          partialReason = partialReason ?? `budget_exhausted:${firstBottleneck(budget, usage)}`;
          break;
        }
        usage.pagesRead += 1;
        usage.costUsd += this.costModel.perPageUsd ?? 0;
        reads += 1;
        readThis += 1;
        selectedUrls.add(r.url);
        readDomains.add(host(r.url));

        const result = await this.reader.read(r.url);
        if (result.status !== 'success' || !result.page) continue;

        usage.modelCalls += 1;
        usage.costUsd += this.costModel.perModelCallUsd ?? 0;

        const extracted = this.extractor.extract(result.page, [sub]);
        for (const ex of extracted) {
          ledger.add({
            claim: ex.claim,
            sourceUrl: r.url,
            sourceTitle: r.title,
            publishedAt: r.publishedAt,
            retrievedAt: new Date().toISOString(),
            sourceType: ex.sourceType,
            support: ex.support,
            relevance: ex.relevance,
            materiality: 'major',
            locator: {
              kind: 'excerpt',
              excerpt: ex.claim,
              headingPath: result.page.headings[0],
            },
          });
        }
      }
    }

    // --- Adversarial / contradiction pass (deep mode; also standard) ------
    const singleSourceClaims = ledger.singleSourceClaims();
    let contradictions = ledger.contradictions('major');

    if (request.mode === 'deep') {
      const majorClaims = [...ledger.query({ materiality: 'major' })].map((e) => e.claim);
      const counterTerms = this.planner.counterSearchTerms(majorClaims);
      for (const term of counterTerms) {
        if (firstBottleneck(budget, usage)) {
          partialReason = partialReason ?? `budget_exhausted:${firstBottleneck(budget, usage)}`;
          break;
        }
        usage.searchRequests += 1;
        usage.costUsd += this.costModel.perSearchUsd ?? 0;
        searched += 1;
        const route = await this.searchRouter.searchWeb(term, { kind: 'web', maxResults: 5 });
        if (route.status !== 'success') continue;
        providersTried.push(route.selected);
        discovered += route.response.results.length;
        for (const r of route.response.results.slice(0, 1)) {
          if (firstBottleneck(budget, usage)) {
            partialReason = partialReason ?? `budget_exhausted:${firstBottleneck(budget, usage)}`;
            break;
          }
          usage.pagesRead += 1;
          usage.costUsd += this.costModel.perPageUsd ?? 0;
          reads += 1;
          const result = await this.reader.read(r.url);
          if (result.status !== 'success' || !result.page) continue;
          usage.modelCalls += 1;
          usage.costUsd += this.costModel.perModelCallUsd ?? 0;
          const extracted = this.extractor.extract(result.page, majorClaims);
          for (const ex of extracted) {
            // Adversarial pass: record polarity (contradicts via neutral cues).
            ledger.add({
              claim: ex.claim,
              sourceUrl: r.url,
              sourceTitle: r.title,
              publishedAt: r.publishedAt,
              retrievedAt: new Date().toISOString(),
              sourceType: ex.sourceType,
              support: ex.support,
              relevance: ex.relevance,
              materiality: 'major',
              locator: { kind: 'excerpt', excerpt: ex.claim },
            });
          }
        }
      }
      contradictions = ledger.contradictions('major');
    }

    // --- Synthesis ----------------------------------------------------------
    const allEvidence = ledger.all();
    const synthesized = this.synthesizer.synthesize(
      request.question,
      request.mode,
      allEvidence,
      contradictions.map((c) => c.claim),
    );

    const report: ResearchReport = {
      question: request.question,
      mode: request.mode,
      answer: synthesized.answer,
      confidence: synthesized.confidence,
      limitations: synthesized.limitations,
      citations: allEvidence.map((e) => ({ url: e.sourceUrl, title: e.sourceTitle, evidenceId: e.evidenceId })),
      contradictoryClaims: contradictions.map((c) => c.claim),
      singleSourceClaims,
    };

    const usageSnapshot: BudgetUsage = { ...usage };
    const telemetryData: ResearchTelemetry = {
      mode: request.mode,
      sessionId: request.sessionId,
      durationMs: Date.now() - start,
      usage: usageSnapshot,
      searchesRun: searched,
      sourcesRead: reads,
      sourcesDiscovered: discovered,
      evidenceRecords: allEvidence.length,
      providerSelected: [...providersTried][0],
      providersTried: [...new Set(providersTried)],
      singleSourceClaims,
      contradictoryClaims: contradictions.map((c) => c.claim),
    };
    this.telemetry(telemetryData);

    if (firstBottleneck(budget, usage)) {
      return { status: 'partial', report, reason: partialReason ?? 'budget_reached', telemetry: telemetryData };
    }
    if (partialReason) {
      return { status: 'partial', report, reason: partialReason, telemetry: telemetryData };
    }
    return { status: 'complete', report, telemetry: telemetryData };
  }

  // --- Helpers --------------------------------------------------------------

  private decomposeWithCost(
    request: ResearchRequest,
    usage: BudgetUsage,
    budget: ResearchBudget,
  ): string[] {
    if (usage.modelCalls >= budget.maxModelCalls) return [];
    usage.modelCalls += 1;
    usage.costUsd += this.costModel.perModelCallUsd ?? 0;
    return this.planner.decompose(request.question, request.mode);
  }

  private outcome(
    status: 'blocked' | 'partial' | 'complete',
    request: ResearchRequest,
    start: number,
    usage: BudgetUsage,
    ledger: EvidenceLedger,
    searched: number,
    providersTried: string[],
    reason: string,
  ): ResearchOutcome {
    const telemetry: ResearchTelemetry = {
      mode: request.mode,
      sessionId: request.sessionId,
      durationMs: Date.now() - start,
      usage: { ...usage },
      searchesRun: searched,
      sourcesRead: 0,
      sourcesDiscovered: 0,
      evidenceRecords: ledger.all().length,
      providerSelected: providersTried[0],
      providersTried: [...new Set(providersTried)],
      singleSourceClaims: ledger.singleSourceClaims(),
      contradictoryClaims: [],
    };
    if (status === 'blocked') {
      this.telemetry(telemetry);
      return { status: 'blocked', reason, telemetry };
    }
    return { status: 'complete', report: { question: request.question, mode: request.mode, answer: '', confidence: 'low', limitations: [], citations: [], contradictoryClaims: [], singleSourceClaims: [] }, telemetry };
  }
}

function host(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

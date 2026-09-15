# Deep Research Architecture

Status: proposed.

## Goal

Support high-quality multi-source investigations without depending on the Codex built-in browser and without treating a browser engine as a search engine.

Deep research is a workflow layered above Browser Gateway.

## Key separation

```text
Research Agent
    |
    +--> SearchProviderRouter   discovery
    |
    +--> Browser Gateway       primary-source reading / protected pages
    |
    +--> Evidence Ledger       claims, citations, contradictions
    |
    +--> LLM Router            query planning + synthesis
```

Obscura is optimized for opening, inspecting and extracting pages. It should not be forced to perform every discovery query by scraping consumer search UIs.

## Search providers

Provider-neutral contract:

- search web;
- search news;
- optional image/video search;
- domain/date filters;
- result snippets and canonical URLs;
- usage/cost metadata.

### Initial routing recommendation

1. **Brave Search API** — default paid discovery provider for broad web/news search because of low per-request pricing and an independent web index.
2. **Exa** — semantic/people/company/scholarly/coding-oriented search fallback and difficult discovery tasks.
3. **Gemini Grounding with Google Search** — optional model-coupled research path when the selected Gemini plan/budget makes it attractive.
4. **Tavily** — optional alternative if evaluation proves higher relevance for a target research domain.

Provider choice remains configuration and benchmark-driven, not hard-coded.

## Research modes

### quick

Use for normal factual lookup.

- 1–2 search queries;
- 3–5 candidate sources;
- read best 1–3 sources;
- short answer with citations.

### standard

Use for recommendations/comparisons.

- decompose into 2–5 subquestions;
- multiple search queries;
- 5–12 distinct sources;
- explicit source-quality scoring;
- contradiction check;
- synthesized answer with evidence.

### deep

Use for strategic/technical decisions, market investigation, job-market analysis or any request explicitly asking for deep research.

- research plan + subquestions;
- iterative query expansion;
- source diversity requirements;
- primary sources preferred;
- evidence ledger;
- contradiction/adversarial pass;
- stop criteria based on evidence saturation/budget;
- final report with citations and confidence/limitations.

## Deep research pipeline

```text
1. Task intake
      |
2. Context resolution
      |
3. Question decomposition
      |
4. Search discovery
      |
5. Candidate source ranking
      |
6. Fetch/read via Obscura
      |      \
      |       -> Playwright for incompatibility/authenticated pages
      |
7. Evidence extraction
      |
8. Gap + contradiction analysis
      |
9. Additional targeted searches (bounded loop)
      |
10. Synthesis
      |
11. Citation/evidence validation
      |
12. Report + metrics
```

## Source ranking

Score candidates on dimensions such as:

- authority / primary-source status;
- relevance to the exact subquestion;
- publication/update date;
- independence from already-selected sources;
- direct evidence vs opinion;
- accessibility/extractability;
- conflict-of-interest risk.

Do not fill a report with many sites repeating the same press release.

## Evidence Ledger

Research must not depend on the final model remembering which claim came from which page.

Conceptual record:

```json
{
  "evidenceId": "ev_123",
  "claim": "...",
  "sourceUrl": "https://...",
  "sourceTitle": "...",
  "publishedAt": "...",
  "retrievedAt": "...",
  "sourceType": "primary",
  "support": "supports",
  "relevance": 0.93,
  "locator": "section/heading or bounded excerpt ref"
}
```

Avoid storing full copyrighted pages. Keep bounded evidence/snippets, extracted structured facts and a retrievable source locator.

## Contradiction loop

Before final synthesis, the Research Agent asks:

- Which important claims have only one source?
- Which sources disagree?
- Is a newer primary source available?
- Could this be marketing copy rather than evidence?
- Is the conclusion dependent on an assumption?

For high-impact claims, perform at least one targeted counter-search.

## LLM usage

Use cheaper models for repetitive search planning/extraction and stronger models for synthesis only when needed.

Initial policy:

- DeepSeek V4 Flash: query expansion, page triage, structured extraction.
- Gemini 3.8 Flash: long-horizon synthesis / difficult ambiguity.
- GPT-5.6 Luna: provider-diverse fallback or alternate synthesis.
- stronger/expensive model: explicit final escalation only when quality gates fail.

The Research Agent should send structured evidence to the synthesizer rather than entire raw browsing histories.

## Cost control

Every research task gets a budget envelope:

```json
{
  "mode": "deep",
  "maxSearchRequests": 30,
  "maxPagesRead": 40,
  "maxModelCalls": 20,
  "maxScreenshots": 3,
  "maxCostUsd": 2.00
}
```

Defaults must be configurable by project/intent.

Stop when:

- all required subquestions have supported answers;
- evidence saturation is reached;
- further searches return mostly duplicate evidence;
- budget is reached;
- a human decision is required.

## Authenticated/private research

Protected pages are a separate capability from public web research.

Examples:

- LinkedIn account/job data -> authorized LinkedIn SessionProfile;
- Facebook admin/profile -> authorized Facebook SessionProfile;
- Azure portal -> project-specific Microsoft SessionProfile.

Private/authenticated evidence must be tagged accordingly and must not be copied into unrelated project memory.

## Context-specific report destination

Research output belongs to the requesting domain:

- career/job investigation -> Interview Nail;
- content/social/competitor investigation -> Marketing;
- technical research for a project -> target project;
- cross-project/general strategic research -> OrquestadorZao.

Browser Gateway only returns execution results/evidence; it is not the durable research knowledge base.

## Prompt injection

Web content is hostile/untrusted input. Research pages can influence facts extracted from them but cannot alter:

- search budget;
- allowed tools;
- secrets access;
- approval policy;
- repository routing;
- system instructions.

## Quality gates for deep mode

A deep report is complete only when:

1. each major conclusion maps to evidence;
2. important claims use primary or multiple independent sources when feasible;
3. dates are checked for time-sensitive claims;
4. material contradictions are surfaced rather than silently averaged;
5. source URLs/locators are preserved for citation;
6. unsupported assumptions are labeled;
7. cost and research coverage metrics are emitted.

## MVP integration boundary

US-001 only needs the Browser Gateway primitives required by this workflow: engines, sessions, safe extraction, telemetry and model adapters.

Full SearchProviderRouter + Research Agent orchestration should be implemented as a follow-on user story rather than bloating the browser-engine MVP.

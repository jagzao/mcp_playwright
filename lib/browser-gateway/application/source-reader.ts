/**
 * Source reading abstraction for the Research Agent.
 *
 * Research reads pages through the Browser Gateway (Obscura-first, Playwright /
 * auth fallback) rather than opening a browser directly. The domain agent
 * depends only on this interface so tests can inject a fake reader producing
 * the exact page text/snapshot they need — no real network.
 *
 * Page bodies are untrusted: a hostile page cannot alter budgets, tools,
 * secrets, approval policy or routing (AC16). This interface returns only the
 * raw extracted text content plus safe metadata.
 */

export interface ExtractedPage {
  url: string;
  /** Best-effort document title. */
  title: string;
  /** Raw extracted text of the document. Untrusted input. */
  text: string;
  /** Headings discovered while reading, useful as bounded locators. */
  headings: string[];
  /** ISO fetch time. */
  fetchedAt: string;
}

export interface SourceReadResult {
  status: 'success' | 'blocked' | 'unavailable';
  /** Present only on success. Never contains raw secrets. */
  page?: ExtractedPage;
  reason?: string;
}

export interface SourceReader {
  /**
   * Read `url` and return its extracted text. The concrete engine (Obscura
   * first, Playwright fallback, auth fallback) is resolved by the injected
   * reader implementation, not by the research domain logic.
   */
  read(url: string): Promise<SourceReadResult>;
}

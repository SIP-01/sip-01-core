/**
 * Query-coverage re-ranking for merged search results.
 *
 * Every provider scores its own results (source priority bands + engine
 * position), but external engines rank by THEIR order — never by how many
 * of the query's words a result actually contains. This pass reweights the
 * merged list so word coverage drives the order, exactly as users expect:
 *
 *   "walk in the park"
 *     1. exact phrase / all 4 words present  → top
 *     2. 3 of 4 words                        → lower
 *     3. 2 of 4                              → lower still
 *     4. 1 of 4                              → near the bottom
 *     5. none (engine returned it loosely)   → sinks hard but stays
 *
 * Mechanics: score' = base × (0.55 + 0.45 × coverage), where coverage is
 * 50% title + 50% body (snippet + domain + tags + full event content for
 * Nostr-backed results — "if 4 words are in an article, it lists high").
 * The spread far exceeds the merge's ±5 recency tie-band, so coverage wins.
 * Keyword stakes are exempt: their placement is the exact-match contract
 * (a stake on "monero wallet" tops "monero wallet" by design).
 *
 * Deliberately NOT model-based: an AI rerank adds seconds of latency per
 * search and leaks the full result set to a third party. This is instant,
 * offline-capable, and private — and it's exactly the ranking rule asked for.
 */
import { wordCoverage, STOP_WORDS, type QueryTerms } from '@/engine/query/queryMatch';
import { parseQuery, collectTextLeaves, type ParsedQuery } from '@/engine/query/queryParser';
import { evaluateQuery, docFromSearchResult } from '@/engine/query/queryEngine';
import type { SearchResult } from '@/engine/providers/types';
import { voteTargetFor, type VoteTally } from '@/engine/votes';

/** Providers whose placement is contractual, not relevance-driven. */
const RERANK_EXEMPT = new Set(['keyword-stake']);

/** Multiplier floor for results with zero word overlap (loose engine hits). */
const NO_MATCH_FACTOR = 0.45;
/** How much of the base score is immune to coverage (keeps source priority sane). */
const BASE_WEIGHT = 0.55;
/**
 * Explainable ranking ladder: exact phrase > title match > term coverage.
 * Sized to clear the ±5 recency tie-band at typical provider bases (~80):
 * phrase ≈ +14 points, title ≈ +8 — strong enough to matter, small enough
 * that provider bands still show through for non-phrase queries.
 */
const PHRASE_BOOST = 1.18;
const TITLE_BOOST = 1.10;

/** Build legacy QueryTerms from the parsed query's text leaves only —
 *  filter values and operators never count as matchable words. */
function termsFromParsed(parsed: ParsedQuery): QueryTerms {
  const { terms, phrases } = collectTextLeaves(parsed.expr);
  const raw = [...terms, ...phrases]
    .join(' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  const meaningful = raw.filter((t) => !STOP_WORDS.has(t));
  return {
    terms: meaningful.length > 0 ? meaningful : raw,
    allTerms: [...new Set(raw)],
    phrase: raw.join(' ').trim(),
    onlyStopWords: raw.length > 0 && meaningful.length === 0,
  };
}

function coverageOf(result: SearchResult, terms: QueryTerms): number {
  const titleCov = wordCoverage([result.title], terms);
  const bodyCov = wordCoverage(
    [result.snippet, result.domain, ...(result.tags ?? []), result.nostrEvent?.content],
    terms,
  );
  return titleCov * 0.5 + bodyCov * 0.5;
}

/** Adjusted score: base reweighted by coverage, then phrase/title boosts. */
function scoreResult(result: SearchResult, terms: QueryTerms, parsed: ParsedQuery): number {
  const base = result.score ?? 50;
  if (RERANK_EXEMPT.has(result.provider)) return base;
  const cov = coverageOf(result, terms);
  let score = base * (cov === 0 ? NO_MATCH_FACTOR : BASE_WEIGHT + (1 - BASE_WEIGHT) * cov);
  // Explainable ladder signals from the authoritative local evaluation.
  const ev = evaluateQuery(docFromSearchResult(result), parsed);
  if (ev.phraseHit) score *= PHRASE_BOOST;
  if (ev.titleHit) score *= TITLE_BOOST;
  return score;
}

/**
 * Sort a merged result list by coverage-adjusted score (in place, returns
 * the same array). The query is parsed once (memoized); per-result scores
 * are memoized.
 */
export function sortByQueryRelevance(results: SearchResult[], query: string): SearchResult[] {
  const parsed = parseQuery(query);
  const terms = termsFromParsed(parsed);
  if (terms.terms.length === 0 && !parsed.hasFilters) return results;

  const adjusted = new Map<string, number>();
  const scoreOf = (r: SearchResult): number => {
    let s = adjusted.get(r.id);
    if (s === undefined) {
      s = scoreResult(r, terms, parsed);
      adjusted.set(r.id, s);
    }
    return s;
  };

  return results.sort((a, b) => {
    const diff = scoreOf(b) - scoreOf(a);
    // Same ±5 tie band as before: near-equal scores fall back to recency.
    if (Math.abs(diff) > 5) return diff;
    return (b.timestamp ?? 0) - (a.timestamp ?? 0);
  });
}


export interface CommunityVoteRankingOptions {
  enabled?: boolean;
  /** Votes needed to reach the full positive/negative adjustment. */
  minVotes?: number;
  /** Maximum score-point boost for trusted positive votes. */
  maxBoost?: number;
  /** Maximum score-point penalty for trusted negative votes. */
  maxPenalty?: number;
}

/**
 * Apply explainable, bounded community-vote influence after provider and
 * query-coverage ranking. Tallies have already deduplicated to the latest
 * reaction per author and may include NIP-85 voter weights. Positive
 * weighted votes improve a page's rank; negative weighted votes reduce it.
 * Raw counts remain available separately in the vote UI. No vote data means
 * no score change, and this pass never bypasses platform hard moderation.
 */
export function rankByCommunityVotes(
  results: SearchResult[],
  tallies: ReadonlyMap<string, VoteTally>,
  options: CommunityVoteRankingOptions = {},
): SearchResult[] {
  if (options.enabled === false || tallies.size === 0 || results.length === 0) return results;

  const minVotes = Number.isFinite(options.minVotes)
    ? Math.max(1, Math.min(100, Math.trunc(options.minVotes!)))
    : 3;
  const maxBoost = Number.isFinite(options.maxBoost)
    ? Math.max(0, Math.min(20, options.maxBoost!))
    : 6;
  const maxPenalty = Number.isFinite(options.maxPenalty)
    ? Math.max(0, Math.min(30, options.maxPenalty!))
    : 9;

  return results
    .map((result, index) => {
      if (RERANK_EXEMPT.has(result.provider)) return { result, index, score: result.score ?? 50 };
      const target = voteTargetFor(result);
      const tally = target ? tallies.get(target.key) : undefined;
      if (!tally) return { result, index, score: result.score ?? 50 };

      const weightedScore = tally.weightedScore;
      const magnitude = Math.min(1, Math.abs(weightedScore) / minVotes);
      const adjustment = weightedScore > 0
        ? maxBoost * magnitude
        : weightedScore < 0
          ? -maxPenalty * magnitude
          : 0;
      return { result, index, score: (result.score ?? 50) + adjustment };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ result, score }) => ({ ...result, score }));
}

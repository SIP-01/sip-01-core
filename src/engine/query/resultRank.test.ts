/**
 * Characterization tests — query-coverage re-ranking.
 *
 * Pin the ranking contract before extraction:
 *   - full-coverage results outrank loose engine hits (coverage drives order);
 *   - keyword stakes are exempt (their placement is the exact-match contract);
 *   - a query with no terms/filters is a pass-through.
 */
import { describe, it, expect } from 'vitest';

import { rankByCommunityVotes, sortByQueryRelevance } from './resultRank';
import type { SearchResult } from '@/engine/providers/types';

function result(partial: Partial<SearchResult> & { id: string }): SearchResult {
  return {
    title: '',
    url: `https://example.com/${partial.id}`,
    snippet: '',
    source: 'web',
    provider: 'searxng',
    score: 50,
    timestamp: 1_800_000_000,
    ...partial,
  };
}

describe('sortByQueryRelevance', () => {
  it('ranks full word coverage above zero coverage at equal base scores', () => {
    const strong = result({ id: 'strong', title: 'Nostr privacy guide', snippet: 'All about nostr and privacy.' });
    const loose = result({ id: 'loose', title: 'Unrelated page', snippet: 'Nothing relevant here.' });
    const sorted = sortByQueryRelevance([loose, strong], 'nostr privacy');
    expect(sorted[0].id).toBe('strong');
    expect(sorted[1].id).toBe('loose');
  });

  it('boosts exact-phrase title hits above partial matches', () => {
    const phrase = result({ id: 'phrase', title: 'decentralized search engines', snippet: 'A guide.' });
    const partial = result({ id: 'partial', title: 'search engines that are somewhat decentralized', snippet: 'Notes.' });
    const sorted = sortByQueryRelevance([partial, phrase], '"decentralized search"');
    expect(sorted[0].id).toBe('phrase');
  });

  it('never re-ranks keyword stakes — contractual placement is preserved', () => {
    const stake = result({
      id: 'stake',
      provider: 'keyword-stake',
      title: 'zzz qqq', // zero word overlap with the query
      snippet: '',
      score: 97,
    });
    const strong = result({ id: 'strong', title: 'monero wallet', snippet: 'the best monero wallet guide', score: 50 });
    const sorted = sortByQueryRelevance([strong, stake], 'monero wallet');
    expect(sorted[0].id).toBe('stake');
  });

  it('passes the list through untouched for empty/structure-only queries', () => {
    const a = result({ id: 'a' });
    const b = result({ id: 'b' });
    const sorted = sortByQueryRelevance([b, a], '');
    expect(sorted.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('falls back to recency inside the tie band', () => {
    // Identical text → identical coverage scores → the ±5 tie band sorts by
    // timestamp (newer first).
    const older = result({ id: 'older', title: 'nostr', snippet: 'nostr', timestamp: 1_000 });
    const newer = result({ id: 'newer', title: 'nostr', snippet: 'nostr', timestamp: 2_000 });
    const sorted = sortByQueryRelevance([older, newer], 'nostr');
    expect(sorted[0].id).toBe('newer');
  });
});


describe('rankByCommunityVotes', () => {
  it('moves positively voted links up and negatively voted links down', () => {
    const positive = result({ id: 'positive', score: 50 });
    const neutral = result({ id: 'neutral', score: 52 });
    const negative = result({ id: 'negative', score: 56 });
    const tallies = new Map([
      ['u:https://example.com/positive', { up: 4, down: 0, score: 4, weightedUp: 4, weightedDown: 0, weightedScore: 4 }],
      ['u:https://example.com/negative', { up: 0, down: 4, score: -4, weightedUp: 0, weightedDown: 4, weightedScore: -4 }],
    ]);
    const ranked = rankByCommunityVotes([neutral, negative, positive], tallies);
    expect(ranked.map((r) => r.id)).toEqual(['positive', 'neutral', 'negative']);
  });

  it('uses weighted vote influence and caps the maximum adjustment', () => {
    const positive = result({ id: 'positive', score: 50 });
    const tallies = new Map([
      ['u:https://example.com/positive', { up: 100, down: 0, score: 100, weightedUp: 1000, weightedDown: 0, weightedScore: 1000 }],
    ]);
    const ranked = rankByCommunityVotes([positive], tallies, { maxBoost: 4 });
    expect(ranked[0].score).toBe(54);
  });

  it('can be disabled without mutating or reordering results', () => {
    const a = result({ id: 'a', score: 40 });
    const b = result({ id: 'b', score: 60 });
    const tallies = new Map([
      ['u:https://example.com/a', { up: 5, down: 0, score: 5, weightedUp: 5, weightedDown: 0, weightedScore: 5 }],
    ]);
    const ranked = rankByCommunityVotes([a, b], tallies, { enabled: false });
    expect(ranked).toEqual([a, b]);
  });
});

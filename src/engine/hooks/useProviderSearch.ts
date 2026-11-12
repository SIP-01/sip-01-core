/**
 * Unified search hook — runs all providers in parallel, streams results, and auto-indexes.
 *
 * Each provider resolves independently so results appear incrementally:
 *   ✔ Nostr (124ms)
 *   ✔ Wikipedia (230ms)
 *   ⏳ SearXNG...
 *   ⏳ Hacker News...
 *
 * Returns per-provider status so the UI can show live progress indicators.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { SearchResult, SearchSource, ProviderSearchResponse } from '@/engine/providers/types';
import { getProvidersForPrivacy, getProvidersForSource } from '@/engine/providers/registry';
import { classifyQuery, providerAllowlistFor } from '@/engine/query/queryClassify';
import { parseQuery } from '@/engine/query/queryParser';
import { applyHardConstraints } from '@/engine/query/queryEngine';
import { sortByQueryRelevance } from '@/engine/query/resultRank';
import { isHiddenResult } from '@/engine/moderation';
import { useSearchIndexer } from '@/engine/hooks/useSearchIndexer';
import { useEngineRuntime } from '@/engine/runtime';
import { useWebOfTrustAssertions, type WebOfTrustLookupTarget } from '@/engine/hooks/useWebOfTrustAssertions';
import {
  evaluateWebOfTrust,
  nip85TargetForSearchResult,
  nip85TargetKey,
  resolveEffectiveWebOfTrustPolicy,
} from '@/engine/webOfTrust';

export type ProviderStatus = 'idle' | 'searching' | 'done' | 'error';

export interface ProviderState {
  id: string;
  name: string;
  source: SearchSource;
  status: ProviderStatus;
  resultCount: number;
  latencyMs?: number;
}

export interface UseProviderSearchOptions {
  query: string;
  source: SearchSource | 'all' | 'index';
  enabled?: boolean;
}

export interface UseProviderSearchResult {
  /** All results from all providers, merged and sorted. */
  results: SearchResult[];
  /** Per-provider status for progress indicators. */
  providers: ProviderState[];
  /** Overall loading state (at least one provider still searching). */
  isLoading: boolean;
  /** At least one provider is fetching (initial or refetch). */
  isFetching: boolean;
  /** All providers finished but no results found. */
  isEmpty: boolean;
  /** Search suggestions from web providers. */
  suggestions: string[];
  /** Count of results per source category. */
  counts: Record<SearchSource | 'all', number>;
  /** Whether Privacy Mode is active (Nostr-tier providers only). */
  privacyMode: boolean;
  /** Providers blocked by Privacy Mode for the current source. */
  suppressedProviders: { id: string; name: string }[];
}

/**
 * The minimum Nostr results before we skip web providers (Nostr-first strategy).
 * When searching "all", if Nostr returns this many results, web/wiki/news are
 * still queried but Nostr results are shown immediately.
 */
const _NOSTR_ENOUGH = 8;

export function useProviderSearch({
  query,
  source,
  enabled = true,
}: UseProviderSearchOptions): UseProviderSearchResult {
  const queryClient = useQueryClient();
  const runtime = useEngineRuntime();
  const privacyMode = runtime.privacyMode;
  // Result language filter — forwarded to every provider; engines that
  // support it filter server-side.
  const languageFilter = runtime.languageFilter;
  const activeProviders = useMemo(() => {
    let providers = getProvidersForPrivacy(source, privacyMode);
    // Host-disabled engines never run.
    if (runtime.disabledProviders.length > 0) {
      providers = providers.filter((p) => !runtime.disabledProviders.includes(p.id));
    }
    // Skip providers that can't possibly answer this query class
    // (a bare npub to SearXNG is pure waste + a privacy leak).
    const allowlist = providerAllowlistFor(classifyQuery(query));
    if (allowlist) providers = providers.filter((p) => allowlist.has(p.id));
    return providers;
  }, [source, privacyMode, query, runtime.disabledProviders]);
  /**
   * The parsed structured query — computed once per query string (memoized
   * in the parser too). Providers get it for operator translation/local
   * evaluation; the merge layer applies hard constraints to every result.
   */
  const parsedQuery = useMemo(() => parseQuery(query), [query]);
  /** Providers that exist for this source but are blocked by Privacy Mode. */
  const suppressedProviders = useMemo(() => {
    if (!privacyMode) return [];
    const active = new Set(activeProviders.map((p) => p.id));
    return getProvidersForSource(source).filter((p) => !active.has(p.id));
  }, [source, privacyMode, activeProviders]);
  const { indexResults } = useSearchIndexer();
  // Host-supplied moderation set — hidden URLs/event ids are filtered out.
  const moderationSet = runtime.moderation;

  // Provider states tracked outside React Query for per-provider granularity.
  const [providerStates, setProviderStates] = useState<Map<string, ProviderState>>(new Map());

  // ─── Result streaming ──────────────────────────────────────────────
  // Results render as each provider resolves instead of waiting for the
  // slowest one (SearXNG via proxy can take seconds; the Nostr index
  // answers in ~100ms). The final complete set still lands in the query
  // cache as `data`.
  // The stream is tagged with the key it belongs to: appends from a stale
  // (previous) query drop themselves, and a key mismatch renders as an
  // empty stream — no reset effect needed.
  const [streamEntry, setStreamEntry] = useState<{ key: string; results: SearchResult[] }>(() => ({
    key: `${query}||${source}||${privacyMode}||${languageFilter.join(',')}`,
    results: [],
  }));
  const streamKey = `${query}||${source}||${privacyMode}||${languageFilter.join(',')}`;
  const streamed = streamEntry.key === streamKey ? streamEntry.results : [];

  /** Append a provider's results to the visible stream (dedupe + constraints + coverage rank). */
  const appendStreamed = useCallback((key: string, fresh: SearchResult[], query: string) => {
    if (fresh.length === 0) return;
    setStreamEntry((prev) => {
      if (prev.key !== key) return prev; // stale provider from an old query
      // Hard constraints (filters + NOT) apply to EVERY provider's results —
      // an engine that misunderstood site: can't leak a wrong result through.
      const constrained = applyHardConstraints(fresh, parseQuery(query));
      const merged = deduplicateResults([...prev.results, ...constrained]);
      return { key: prev.key, results: sortByQueryRelevance(merged, query) };
    });
  }, []);

  const updateProviderState = useCallback((id: string, update: Partial<ProviderState>) => {
    setProviderStates((prev) => {
      const next = new Map(prev);
      const existing = next.get(id);
      if (existing) {
        next.set(id, { ...existing, ...update });
      }
      return next;
    });
  }, []);

  // Main query — runs all providers in parallel.
  const { data, isFetching } = useQuery<{
    results: SearchResult[];
    suggestions: string[];
  }>({
    queryKey: ['provider-search', query, source, privacyMode, languageFilter],
    queryFn: async ({ signal }) => {
      if (!query.trim()) return { results: [], suggestions: [] };

      // Initialize provider states.
      const initialStates = new Map<string, ProviderState>();
      for (const p of activeProviders) {
        initialStates.set(p.id, {
          id: p.id,
          name: p.name,
          source: p.source,
          status: 'searching',
          resultCount: 0,
        });
      }
      setProviderStates(initialStates);

      // Run all providers in parallel.
      const results: SearchResult[] = [];
      const allSuggestions: string[] = [];

      const settled = await Promise.allSettled(
        activeProviders.map(async (provider) => {
          const start = performance.now();
          try {
            const response: ProviderSearchResponse = await provider.search({
              query: query.trim(),
              signal,
              languages: languageFilter,
              parsed: parsedQuery,
            });

            const latencyMs = Math.round(performance.now() - start);

            updateProviderState(provider.id, {
              status: 'done',
              resultCount: response.results.length,
              latencyMs,
            });

            // Stream: show this provider's results immediately — the UI
            // re-renders per provider completion, not at the very end.
            appendStreamed(streamKey, response.results, query);
            return response;
          } catch {
            const latencyMs = Math.round(performance.now() - start);
            updateProviderState(provider.id, {
              status: 'error',
              resultCount: 0,
              latencyMs,
            });
            return { results: [], suggestions: [] } as ProviderSearchResponse;
          }
        }),
      );

      for (const s of settled) {
        if (s.status === 'fulfilled') {
          results.push(...s.value.results);
          if (s.value.suggestions) allSuggestions.push(...s.value.suggestions);
        }
      }

      // Deduplicate by URL (prefer the result with the higher score).
      const deduped = deduplicateResults(results);

      // Apply the query's hard constraints (structured filters + NOT) across
      // ALL providers — the local backstop that makes operators authoritative.
      const constrained = applyHardConstraints(deduped, parsedQuery);

      // Sort by coverage-adjusted score, then recency inside the tie band —
      // results matching all/most query words outrank loose engine hits.
      sortByQueryRelevance(constrained, query);

      return {
        results: constrained,
        suggestions: [...new Set(allSuggestions)].slice(0, 8),
      };
    },
    enabled: enabled && query.trim().length > 0,
    staleTime: 30_000,
    retry: 0,
    // No placeholderData — a new query streams fresh results instead of
    // showing the previous query's stale set.
  });

  // The visible result set: the completed (cached) data once available,
  // the live stream while providers are still resolving.
  const baseResults = data?.results ?? streamed;

  // Resolve a NIP-85 subject for each visible result. Nostr-backed results use
  // the author/indexer account; external results use their NIP-73 web identity.
  const webOfTrustTargets = useMemo(() => baseResults
    .map((result) => {
      const target = nip85TargetForSearchResult(result);
      return target ? { ...target, key: nip85TargetKey(target) } : null;
    })
    .filter((target): target is WebOfTrustLookupTarget => target !== null),
  [baseResults]);
  const webOfTrustAssertions = useWebOfTrustAssertions(webOfTrustTargets);
  const effectiveWebOfTrustPolicy = useMemo(() => {
    const config = runtime.webOfTrust;
    const personalPreference = config?.personalProviders?.length ? config.personalPreference : undefined;
    return config ? resolveEffectiveWebOfTrustPolicy(config.adminPolicy, personalPreference) : null;
  }, [runtime.webOfTrust]);

  // Hard moderation is applied first and cannot be bypassed by personal WoT.
  // The trust decision then uses only verified assertions from the selected
  // platform/personal providers. Unknown provider state follows admin policy.
  const allResults = useMemo(() => {
    const moderated = moderationSet
      ? baseResults.filter((result) => !isHiddenResult(result, moderationSet))
      : baseResults;
    const policy = effectiveWebOfTrustPolicy;
    if (!policy || policy.mode === 'off') return moderated;

    const decisions = moderated.map((result, index) => {
      const target = nip85TargetForSearchResult(result);
      const key = target ? nip85TargetKey(target) : '';
      const assertion = key ? webOfTrustAssertions.data?.ranks.get(key) : undefined;
      const kind = target?.kind;
      const platformReady = kind !== undefined && (webOfTrustAssertions.data?.platformReady.has(kind) ?? false);
      const personalReady = kind !== undefined && (webOfTrustAssertions.data?.personalReady.has(kind) ?? false);
      const decision = evaluateWebOfTrust(policy, {
        platformRank: assertion?.platformRank,
        personalRank: assertion?.personalRank,
        platformReady,
        personalReady,
      });
      return { result, index, decision };
    }).filter((entry) => entry.decision.included);

    // both-first elevates subjects accepted by both configured providers,
    // without pretending their provider-relative rank numbers are comparable.
    if (policy.mode === 'combined' && policy.strategy === 'both-first') {
      decisions.sort((a, b) => b.decision.trustTier - a.decision.trustTier || a.index - b.index);
    }
    return decisions.map((entry) => entry.result);
  }, [baseResults, moderationSet, effectiveWebOfTrustPolicy, webOfTrustAssertions.data]);
  const suggestions = data?.suggestions ?? [];

  // Reset provider states when query clears.
  const providers = useMemo(() => {
    if (!query.trim()) return [];
    return activeProviders.map((p) => providerStates.get(p.id) ?? {
      id: p.id,
      name: p.name,
      source: p.source,
      status: 'idle' as const,
      resultCount: 0,
    });
  }, [activeProviders, providerStates, query]);

  const isLoading = providers.some((p) => p.status === 'searching');
  const isEmpty = query.trim().length > 0 && !isLoading && allResults.length === 0;

  // Auto-index: contribute surfaced pages (SIP-01 kind 39697) + a hashed
  // term signal (kind 30078, no plaintext) to the shared Nostr index.
  const indexedQueryRef = useRef('');
  useEffect(() => {
    if (
      allResults.length > 0 &&
      query.trim() &&
      !isLoading &&
      indexedQueryRef.current !== query
    ) {
      indexedQueryRef.current = query;
      void indexResults(query, allResults);
    }
  }, [allResults, query, isLoading, indexResults]);

  // Counts per source.
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: allResults.length };
    for (const r of allResults) {
      c[r.source] = (c[r.source] ?? 0) + 1;
    }
    return c as Record<SearchSource | 'all', number>;
  }, [allResults]);

  // Invalidate stale queries when source changes.
  const prevSourceRef = useRef(source);
  useEffect(() => {
    if (prevSourceRef.current !== source) {
      prevSourceRef.current = source;
      if (query.trim()) {
        queryClient.invalidateQueries({ queryKey: ['provider-search', query, source] });
      }
    }
  }, [source, query, queryClient]);

  return {
    results: allResults,
    providers,
    isLoading,
    isFetching,
    isEmpty,
    suggestions,
    counts,
    privacyMode,
    suppressedProviders,
  };
}

/** Deduplicate results by normalized URL. Prefer higher-scored versions. */
function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const map = new Map<string, SearchResult>();

  for (const r of results) {
    const key = normalizeUrl(r.url) || r.id;
    const existing = map.get(key);
    if (!existing || (r.score ?? 0) > (existing.score ?? 0)) {
      map.set(key, r);
    }
  }

  return [...map.values()];
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.replace(/\/$/, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

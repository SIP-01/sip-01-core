/**
 * sip-01-core — public API.
 *
 * Reusable reference implementation of SIP-01 (Nostr kind 39697 "Web Index
 * Observation", wire schema "1") plus the search-engine core built around
 * it: provider registry + query stack, federation contract modules, relay
 * pool infrastructure, voting/moderation, and the AI answer layer.
 *
 * This is a LIBRARY, not an application: host identity (engine profile,
 * relay pools, moderation trust policy, user signer) is injected through
 * the seams — configureEngine()/configureRelays() at startup and
 * <EngineRuntimeProvider> around the host's UI.
 */

/* ------------------------------------------------------------------ */
/* Protocol — SIP-01 reference layer (wire-critical)                   */
/* ------------------------------------------------------------------ */
export * from './protocol/webIndex';
export * from './protocol/indexerIdentity';

/* ------------------------------------------------------------------ */
/* Federation — shared 0xsearchstr:* contract (frozen namespaces)      */
/* ------------------------------------------------------------------ */
export * from './federation/searchIndex';
export * from './federation/communityIndex';
export * from './federation/keywordStakes';
export * from './federation/termSignals';

/* ------------------------------------------------------------------ */
/* Core contracts & infrastructure                                     */
/* ------------------------------------------------------------------ */
export * from './lib/engineConfig';
export * from './lib/relayConfig';
export * from './lib/appRelays';
export * from './lib/searchRelays';
export * from './lib/relayUrls';
export * from './lib/corsProxy';
export * from './lib/storageMigration';
export * from './lib/sanitizeUrl';
export * from './lib/contentType';
export * from './lib/languageFilter';
export * from './lib/relayDiscovery';
export * from './lib/engine/observation';

/* ------------------------------------------------------------------ */
/* Engine — providers, query stack, votes, moderation, runtime, hooks  */
/* ------------------------------------------------------------------ */
export * from './engine/providers/types';
export * from './engine/providers/registry';
export * from './engine/providers/cached-index';
export * from './engine/providers/web-index';
export * from './engine/providers/nostr';
export * from './engine/providers/stakes';
export * from './engine/providers/searxng';
export * from './engine/providers/duckduckgo';
export * from './engine/providers/brave';
export * from './engine/providers/tor';
export * from './engine/providers/wikipedia';
export * from './engine/providers/hacker-news';
export * from './engine/providers/stackoverflow';
export * from './engine/providers/wiki';
export * from './engine/providers/git';
export * from './engine/providers/community';
export * from './engine/providers/parallel';
export * from './engine/providers/searxngInstances';
export * from './engine/providers/enginePriority';
export * from './engine/providers/braveProxy';
export * from './engine/query/queryParser';
export * from './engine/query/queryEngine';
export * from './engine/query/queryClassify';
export * from './engine/query/queryMatch';
export * from './engine/query/resultRank';
export * from './engine/query/calculator';
export * from './engine/votes';
export * from './engine/bookmarks';
export * from './engine/webOfTrust';
export * from './engine/moderation';
export * from './engine/runtime';
export * from './engine/hooks/useProviderSearch';
export * from './engine/hooks/useSearchIndexer';
export * from './engine/hooks/useInstantAnswer';
export * from './engine/hooks/useSearxngInstances';
export * from './engine/hooks/useVotes';
export * from './engine/hooks/useWebOfTrustAssertions';
export * from './engine/hooks/useTrendingTerms';
export * from './engine/hooks/useRecentIndexedDocs';
export * from './engine/hooks/useRecentStakes';
export * from './engine/hooks/useMyNode';
export * from './engine/hooks/useNetworkStats';
export * from './engine/hooks/useRelayDiscovery';
export * from './engine/hooks/useSearchRelayPool';

/* ------------------------------------------------------------------ */
/* AI — answer layer (OpenAI-compatible providers + engine proxy)      */
/* ------------------------------------------------------------------ */
export * from './ai/types';
export * from './ai/registry';
export * from './ai/openai-compatible';
export * from './ai/prompts';
export * from './ai/aiConfig';
export * from './ai/engineProxy';
export * from './ai/engineAdmin';
export * from './ai/hooks/useAIAnswer';
export * from './ai/hooks/useEngineAIStatus';

export * from './discovery/capability';
export * from './ai/capabilityPlugin';

/**
 * Vote hooks — NIP-25 reactions and Web-of-Trust-aware tallies.
 * Native Nostr events use kind 7. External web documents use kind 17 with
 * NIP-73 k/i tags. Legacy kind-7/r URL reactions remain readable.
 */
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import { type NostrEvent, type NostrFilter } from '@nostrify/nostrify';

import { queryRelayPool, publishToRelayPool } from '@/lib/searchRelays';
import { getIndexRelayUrls, getSearchRelayUrls } from '@/lib/appRelays';
import { getIndexerIdentity } from '@/protocol/indexerIdentity';
import { useEngineRuntime } from '@/engine/runtime';
import { useWebOfTrustAssertions } from '@/engine/hooks/useWebOfTrustAssertions';
import {
  VOTE_KIND,
  EXTERNAL_REACTION_KIND,
  buildVoteEvent,
  expandLegacyVoteTargets,
  legacyReactionUrls,
  setMyVote,
  tallyVotes,
  voteTargetFor,
  type VoteDirection,
  type VoteTarget,
} from '@/engine/votes';
import {
  evaluateWebOfTrust,
  resolveEffectiveWebOfTrustPolicy,
  webOfTrustVoteWeight,
} from '@/engine/webOfTrust';
import type { WebOfTrustLookupTarget } from '@/engine/hooks/useWebOfTrustAssertions';

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** Batch-fetch reactions, then apply the active platform/personal WoT to voters. */
export function useVoteCounts(targetKeys: string[]) {
  const runtime = useEngineRuntime();
  const key = targetKeys.slice(0, 20).sort().join(',');

  const reactionsQuery = useQuery<NostrEvent[]>({
    queryKey: ['vote-events', key],
    queryFn: async ({ signal }) => {
      const keys = key.split(',').filter(Boolean);
      if (keys.length === 0) return [];

      const eventIds = keys.filter((value) => value.startsWith('e:')).map((value) => value.slice(2));
      const urls = keys.filter((value) => value.startsWith('u:')).map((value) => value.slice(2));
      const filters: NostrFilter[] = [];

      if (eventIds.length > 0) {
        filters.push({ kinds: [VOTE_KIND], '#e': eventIds, limit: 500 });
      }
      if (urls.length > 0) {
        filters.push({ kinds: [EXTERNAL_REACTION_KIND], '#k': ['web'], '#i': urls, limit: 500 });
        // Kind 7 `r` tags used SIP-01 index normalization, not the NIP-73
        // identifier. Query both so historical reactions are still returned.
        filters.push({ kinds: [VOTE_KIND], '#r': legacyReactionUrls(urls), limit: 500 });
      }
      if (filters.length === 0) return [];

      const relayUrls = [...new Set([...getIndexRelayUrls(), ...getSearchRelayUrls()])];
      const settled = await queryRelayPool(relayUrls, filters, { signal, timeoutMs: 6000 });
      const events = new Map<string, NostrEvent>();
      for (const batch of settled) {
        for (const event of batch) {
          if (verifyEvent(event) && !events.has(event.id)) events.set(event.id, event);
        }
      }
      return [...events.values()];
    },
    enabled: key.length > 0,
    staleTime: 30_000,
    retry: 0,
  });

  // NIP-85 kind 30382 assertions describe voter trust. Fetch them from the
  // same selected platform/personal providers used by the search policy.
  const voterTargets = useMemo<WebOfTrustLookupTarget[]>(() => {
    const seen = new Set<string>();
    return (reactionsQuery.data ?? []).flatMap((event) => {
      if (!/^[0-9a-f]{64}$/i.test(event.pubkey) || seen.has(event.pubkey)) return [];
      seen.add(event.pubkey);
      return [{
        key: '30382:' + event.pubkey.toLowerCase(),
        kind: 30382,
        identifier: event.pubkey.toLowerCase(),
      }];
    });
  }, [reactionsQuery.data]);
  const voterAssertions = useWebOfTrustAssertions(voterTargets);

  const effectivePolicy = useMemo(() => {
    const config = runtime.webOfTrust;
    const personalPreference = config?.personalProviders?.length ? config.personalPreference : undefined;
    return config ? resolveEffectiveWebOfTrustPolicy(config.adminPolicy, personalPreference) : null;
  }, [runtime.webOfTrust]);

  const data = useMemo(() => {
    const events = reactionsQuery.data ?? [];
    const requestedKeys = key.split(',').filter(Boolean);
    const tallyOptions = {
      expandTargetKeys: (targetKey: string) => expandLegacyVoteTargets(targetKey, requestedKeys),
    };
    if (runtime.voteAuthorWeights) {
      return tallyVotes(events, { ...tallyOptions, authorWeights: runtime.voteAuthorWeights });
    }
    if (!effectivePolicy || effectivePolicy.mode === 'off') return tallyVotes(events, tallyOptions);

    const weights = new Map<string, number>();
    for (const event of events) {
      if (weights.has(event.pubkey)) continue;
      const voterKey = '30382:' + event.pubkey.toLowerCase();
      const assertion = voterAssertions.data?.ranks.get(voterKey);
      const decision = evaluateWebOfTrust(effectivePolicy, {
        platformRank: assertion?.platformRank,
        personalRank: assertion?.personalRank,
        platformReady: voterAssertions.data?.platformReady.has(30382) ?? false,
        personalReady: voterAssertions.data?.personalReady.has(30382) ?? false,
      });
      weights.set(event.pubkey, webOfTrustVoteWeight(decision));
    }
    return tallyVotes(events, { ...tallyOptions, authorWeights: weights });
  }, [key, reactionsQuery.data, runtime.voteAuthorWeights, effectivePolicy, voterAssertions.data]);

  return { ...reactionsQuery, data };
}

/** Publish NIP-25 reactions. Anonymous (device identity) by default. */
export function useVoteActions() {
  const runtime = useEngineRuntime();
  const queryClient = useQueryClient();
  const asIdentity = runtime.voteWithIdentity;

  const vote = useCallback(async (
    result: { url: string; source?: string; nostrEvent?: { id: string; kind?: number; pubkey?: string; tags?: string[][] } },
    direction: VoteDirection,
  ): Promise<VoteTarget> => {
    const target = voteTargetFor(result);
    if (!target) throw new Error('This result cannot be voted on');
    const template = buildVoteEvent(target, direction);

    if (asIdentity) {
      const signer = runtime.userSigner;
      if (!signer) throw new Error('voteWithIdentity requires EngineRuntime.userSigner');
      const signedEvent = await signer.signEvent({
        kind: template.kind,
        created_at: Math.floor(Date.now() / 1000),
        tags: template.tags,
        content: template.content,
      });
      const accepted = await publishToRelayPool(getIndexRelayUrls(), signedEvent, 5000);
      if (accepted === 0) throw new Error('No configured index relay accepted the vote.');
    } else {
      const identity = getIndexerIdentity();
      const signedEvent = finalizeEvent(
        {
          kind: template.kind,
          created_at: Math.floor(Date.now() / 1000),
          tags: template.tags,
          content: template.content,
        },
        hexToBytes(identity.secretHex),
      );
      const accepted = await publishToRelayPool(getIndexRelayUrls(), signedEvent, 5000);
      if (accepted === 0) throw new Error('No configured index relay accepted the vote.');
    }

    setMyVote(target.key, direction);
    void queryClient.invalidateQueries({ queryKey: ['vote-events'] });
    return target;
  }, [asIdentity, runtime.userSigner, queryClient]);

  return { vote, asIdentity, canVoteWithIdentity: !!runtime.userSigner };
}

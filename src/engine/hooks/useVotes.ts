/**
 * Vote hooks — NIP-25 reactions and Web-of-Trust-ready tallies.
 * Native Nostr events use kind 7. External web documents use kind 17 with
 * NIP-73 k/i tags. Legacy kind-7/r URL reactions remain readable.
 */
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { finalizeEvent } from 'nostr-tools/pure';
import { type NostrEvent, type NostrFilter } from '@nostrify/nostrify';

import { queryRelayPool, publishToRelayPool, getSearchRelay } from '@/lib/searchRelays';
import { getIndexRelayUrls, getSearchRelayUrls } from '@/lib/appRelays';
import { getIndexerIdentity } from '@/protocol/indexerIdentity';
import { useEngineRuntime } from '@/engine/runtime';
import {
  VOTE_KIND,
  EXTERNAL_REACTION_KIND,
  buildVoteEvent,
  setMyVote,
  tallyVotes,
  voteTargetFor,
  type VoteDirection,
  type VoteTally,
  type VoteTarget,
} from '@/engine/votes';

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function getVoteRelay(url: string) {
  return getSearchRelay(url);
}

/** Batch-fetch native and external NIP-25 reactions for visible targets. */
export function useVoteCounts(targetKeys: string[]) {
  const runtime = useEngineRuntime();
  const key = targetKeys.slice(0, 20).sort().join(',');

  return useQuery({
    queryKey: ['vote-tallies', key, runtime.voteAuthorWeights ? [...runtime.voteAuthorWeights.entries()].sort(([a], [b]) => a.localeCompare(b)) : 'raw'],
    queryFn: async ({ signal }) => {
      const keys = key.split(',').filter(Boolean);
      if (keys.length === 0) return new Map<string, VoteTally>();

      const eventIds = keys.filter((value) => value.startsWith('e:')).map((value) => value.slice(2));
      const urls = keys.filter((value) => value.startsWith('u:')).map((value) => value.slice(2));
      const filters: NostrFilter[] = [];

      if (eventIds.length > 0) {
        filters.push({ kinds: [VOTE_KIND], '#e': eventIds, limit: 500 });
      }
      if (urls.length > 0) {
        filters.push({ kinds: [EXTERNAL_REACTION_KIND], '#k': ['web'], '#i': urls, limit: 500 });
        // Read legacy URL reactions during migration; never publish this shape.
        filters.push({ kinds: [VOTE_KIND], '#r': urls, limit: 500 });
      }
      if (filters.length === 0) return new Map<string, VoteTally>();

      const relayUrls = [...new Set([...getIndexRelayUrls(), ...getSearchRelayUrls()])];
      const settled = await queryRelayPool(relayUrls, filters, { signal, timeoutMs: 6000 });
      const events = new Map<string, NostrEvent>();
      for (const batch of settled) {
        for (const event of batch) {
          if (!events.has(event.id)) events.set(event.id, event);
        }
      }
      return tallyVotes([...events.values()], { authorWeights: runtime.voteAuthorWeights });
    },
    enabled: key.length > 0,
    staleTime: 30_000,
    retry: 0,
  });
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
      await publishToRelayPool(getIndexRelayUrls(), signedEvent, 5000);
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
      await Promise.allSettled(
        getIndexRelayUrls().map(async (url) => {
          const relay = getVoteRelay(url);
          await relay.event(signedEvent, { signal: AbortSignal.timeout(5000) });
        }),
      );
    }

    setMyVote(target.key, direction);
    void queryClient.invalidateQueries({ queryKey: ['vote-tallies'] });
    return target;
  }, [asIdentity, runtime.userSigner, queryClient]);

  return { vote, asIdentity, canVoteWithIdentity: !!runtime.userSigner };
}

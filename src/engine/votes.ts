/**
 * NIP-25 voting for Nostr events and external web documents.
 * Native events use kind 7. External web content uses kind 17 with NIP-73
 * k/i identifiers. Legacy kind-7/r URL reactions are read-only compatibility.
 */
import type { NostrEvent } from '@nostrify/nostrify';
import { normalizeIndexUrl } from '@/protocol/webIndex';
import { readStoredWithLegacy, writeStoredCanonical } from '@/lib/storageMigration';

export const VOTE_KIND = 7;
export const EXTERNAL_REACTION_KIND = 17;
export type VoteDirection = 1 | -1;

export interface VoteTarget {
  key: string;
  kind: typeof VOTE_KIND | typeof EXTERNAL_REACTION_KIND;
  tags: string[][];
}

export function voteTargetFor(result: {
  url: string;
  source?: string;
  nostrEvent?: { id: string; kind?: number; pubkey?: string; tags?: string[][] };
}): VoteTarget | null {
  // SIP-01 observations and NIP-B0 bookmarks may be native Nostr events;
  // native-event results use kind 7, while URL-only web results use kind 17.
  if (result.source === 'nostr' && result.nostrEvent?.id) {
    const event = result.nostrEvent;
    const tags: string[][] = [['e', event.id]];
    if (event.pubkey) tags.push(['p', event.pubkey]);
    if (typeof event.kind === 'number') tags.push(['k', String(event.kind)]);
    if (event.kind !== undefined && event.kind >= 30000 && event.kind <= 39999 && event.pubkey) {
      const d = event.tags?.find(([name]) => name === 'd')?.[1];
      if (d !== undefined) tags.push(['a', String(event.kind) + ':' + event.pubkey + ':' + d]);
    }
    return { key: 'e:' + event.id, kind: VOTE_KIND, tags };
  }

  const normalized = normalizeIndexUrl(result.url);
  if (!normalized) return null;
  return {
    key: 'u:' + normalized,
    kind: EXTERNAL_REACTION_KIND,
    tags: [['k', 'web'], ['i', normalized]],
  };
}

export function buildVoteEvent(target: VoteTarget, direction: VoteDirection): {
  kind: number;
  content: string;
  tags: string[][];
} {
  return {
    kind: target.kind,
    content: direction === 1 ? '+' : '-',
    tags: [
      ...target.tags.map((tag) => [...tag]),
      ['alt', 'SIP-01 ' + (direction === 1 ? 'upvote' : 'downvote') + ' reaction'],
    ],
  };
}

export interface VoteTally {
  up: number;
  down: number;
  score: number;
  weightedUp: number;
  weightedDown: number;
  weightedScore: number;
}

export interface TallyVoteOptions {
  /** Weights are clamped to 0..5. Unlisted authors have weight 1. */
  authorWeights?: ReadonlyMap<string, number>;
}

function urlTargetKey(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeIndexUrl(value);
  return normalized ? 'u:' + normalized : null;
}

function eventTargetKey(event: NostrEvent): string | null {
  if (event.kind === VOTE_KIND) {
    const eventId = event.tags.find(([name]) => name === 'e')?.[1];
    if (eventId) return 'e:' + eventId;
    // Legacy URL reaction. Read this shape, but never write it.
    return urlTargetKey(event.tags.find(([name]) => name === 'r')?.[1]);
  }
  if (event.kind === EXTERNAL_REACTION_KIND) {
    const kinds = event.tags.filter(([name]) => name === 'k').map(([, value]) => value);
    if (!kinds.includes('web')) return null;
    return urlTargetKey(event.tags.find(([name]) => name === 'i')?.[1]);
  }
  return null;
}

function reactionDirection(event: NostrEvent): VoteDirection | null {
  // NIP-25: empty and '+' mean like; '-' means dislike. Emoji is not a vote.
  if (event.content === '+' || event.content === '') return 1;
  if (event.content === '-') return -1;
  return null;
}

/** Latest reaction per target and author wins; timestamp ties use event id. */
export function tallyVotes(
  events: NostrEvent[],
  options: TallyVoteOptions = {},
): Map<string, VoteTally> {
  const latest = new Map<string, {
    targetKey: string;
    direction: VoteDirection;
    createdAt: number;
    eventId: string;
    weight: number;
  }>();

  for (const event of events) {
    if (event.kind !== VOTE_KIND && event.kind !== EXTERNAL_REACTION_KIND) continue;
    const direction = reactionDirection(event);
    if (direction === null) continue;
    const targetKey = eventTargetKey(event);
    if (!targetKey) continue;

    const rawWeight = options.authorWeights?.get(event.pubkey) ?? 1;
    const weight = Number.isFinite(rawWeight) ? Math.min(5, Math.max(0, rawWeight)) : 1;
    const key = targetKey + '\\u0000' + event.pubkey;
    const existing = latest.get(key);
    if (
      !existing ||
      event.created_at > existing.createdAt ||
      (event.created_at === existing.createdAt && event.id > existing.eventId)
    ) {
      latest.set(key, { targetKey, direction, createdAt: event.created_at, eventId: event.id, weight });
    }
  }

  const tallies = new Map<string, VoteTally>();
  for (const vote of latest.values()) {
    const tally = tallies.get(vote.targetKey) ?? {
      up: 0, down: 0, score: 0,
      weightedUp: 0, weightedDown: 0, weightedScore: 0,
    };
    if (vote.direction === 1) {
      tally.up++;
      tally.weightedUp += vote.weight;
    } else {
      tally.down++;
      tally.weightedDown += vote.weight;
    }
    tally.score = tally.up - tally.down;
    tally.weightedScore = tally.weightedUp - tally.weightedDown;
    tallies.set(vote.targetKey, tally);
  }
  return tallies;
}

const LS_MY_VOTES = 'sip01:votes';
const LEGACY_LS_MY_VOTES = ['dsearch:votes', 'presearchstr:votes'] as const;

function readMyVotes(): Record<string, number> {
  try {
    const raw = readStoredWithLegacy(LS_MY_VOTES, LEGACY_LS_MY_VOTES);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getMyVote(targetKey: string): VoteDirection | null {
  const value = readMyVotes()[targetKey];
  return value === 1 || value === -1 ? value : null;
}

export function setMyVote(targetKey: string, direction: VoteDirection | null): void {
  try {
    const parsed = readMyVotes();
    if (direction === null) delete parsed[targetKey];
    else parsed[targetKey] = direction;
    writeStoredCanonical(LS_MY_VOTES, LEGACY_LS_MY_VOTES, JSON.stringify(parsed));
  } catch {
    // Storage unavailable — vote is still published.
  }
}

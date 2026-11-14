/**
 * NIP-25 voting for Nostr events and external web documents.
 * Native events use kind 7. External web content uses kind 17 with NIP-73
 * k/i identifiers. Legacy kind-7/r URL reactions are read-only compatibility.
 */
import type { NostrEvent } from '@nostrify/nostrify';
import { normalizeIndexUrl } from '@/protocol/webIndex';
import { normalizeNip73WebIdentifier } from '@/engine/bookmarks';
import { readStoredWithLegacy, writeStoredCanonical } from '@/lib/storageMigration';

export const VOTE_KIND = 7;
export const EXTERNAL_REACTION_KIND = 17;
export type VoteDirection = 1 | -1;

export interface VoteTarget {
  key: string;
  /** Legacy kind-7/r URL key, retained only to display historical tallies. */
  legacyKey?: string;
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

  const normalized = normalizeNip73WebIdentifier(result.url);
  if (!normalized) return null;
  const legacy = normalizeIndexUrl(result.url);
  return {
    key: 'u:' + normalized,
    ...(legacy && legacy !== normalized ? { legacyKey: 'u:' + legacy } : {}),
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
  /**
   * Rewrite a stored target key before per-author dedup. Used to fold a
   * legacy kind-7/r URL onto the NIP-73 key callers look up. Return every
   * key that should receive the vote. An empty list drops the event.
   */
  expandTargetKeys?: (targetKey: string) => readonly string[];
}

/**
 * `r` tag values to query for these NIP-73 URL keys. Historical reactions
 * were stored with SIP-01 index normalization (www/tracking/query order),
 * which is not the NIP-73 identifier.
 */
export function legacyReactionUrls(nip73Urls: readonly string[]): string[] {
  const urls = new Set<string>();
  for (const url of nip73Urls) {
    if (!url) continue;
    urls.add(url);
    const legacy = normalizeIndexUrl(url);
    if (legacy) urls.add(legacy);
  }
  return [...urls];
}

/**
 * Keys that should display `targetKey`. A legacy index URL is also attributed
 * to every requested NIP-73 key that normalizes to it. The requested key
 * itself is kept when it was asked for, so identical identities are unchanged.
 */
export function expandLegacyVoteTargets(
  targetKey: string,
  requestedKeys: readonly string[],
): readonly string[] {
  const requested = new Set(requestedKeys);
  const extras: string[] = [];
  if (targetKey.startsWith('u:')) {
    for (const key of requestedKeys) {
      if (!key.startsWith('u:') || key === targetKey) continue;
      const legacy = normalizeIndexUrl(key.slice(2));
      if (legacy && 'u:' + legacy === targetKey) extras.push(key);
    }
  }
  const own = requested.has(targetKey) ? [targetKey] : [];
  const destinations = [...own, ...extras];
  return destinations.length > 0 ? destinations : [targetKey];
}

function urlTargetKey(value: string | undefined, legacy = false): string | null {
  if (!value) return null;
  const normalized = legacy ? normalizeIndexUrl(value) : normalizeNip73WebIdentifier(value);
  return normalized ? 'u:' + normalized : null;
}

function eventTargetKey(event: NostrEvent): string | null {
  if (event.kind === VOTE_KIND) {
    const eventId = event.tags.find(([name]) => name === 'e')?.[1];
    if (eventId) return 'e:' + eventId;
    // Legacy URL reaction. Read this shape, but never write it.
    return urlTargetKey(event.tags.find(([name]) => name === 'r')?.[1], true);
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
    const storedKey = eventTargetKey(event);
    if (!storedKey) continue;
    const destinations = options.expandTargetKeys?.(storedKey) ?? [storedKey];
    if (destinations.length === 0) continue;

    const rawWeight = options.authorWeights?.get(event.pubkey) ?? 1;
    const weight = Number.isFinite(rawWeight) ? Math.min(5, Math.max(0, rawWeight)) : 1;
    for (const targetKey of destinations) {
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

/** Prefer the current key, then a legacy index-normalized URL key. */
export function rememberedVote(
  votes: Readonly<Record<string, number>>,
  targetKey: string,
): VoteDirection | null {
  const direct = votes[targetKey];
  if (direct === 1 || direct === -1) return direct;
  if (!targetKey.startsWith('u:')) return null;
  const legacy = normalizeIndexUrl(targetKey.slice(2));
  if (!legacy) return null;
  const historical = votes['u:' + legacy];
  return historical === 1 || historical === -1 ? historical : null;
}

export function getMyVote(targetKey: string): VoteDirection | null {
  return rememberedVote(readMyVotes(), targetKey);
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

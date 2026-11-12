/**
 * Web of Trust policy and NIP-85 Trusted Assertions.
 *
 * NIP-85 standardizes assertion records and provider discovery, not one
 * mandatory Web-of-Trust algorithm or multi-provider merge strategy.
 * Provider choice and policy are therefore injected by the host.
 */
import type { NostrEvent } from '@nostrify/nostrify';

export const NIP85_PROVIDER_LIST_KIND = 10040;
export const NIP85_USER_ASSERTION_KIND = 30382;
export const NIP85_EVENT_ASSERTION_KIND = 30383;
export const NIP85_ADDRESSABLE_ASSERTION_KIND = 30384;
export const NIP85_EXTERNAL_ID_ASSERTION_KIND = 30385;

export type Nip85RankService =
  | '30382:rank'
  | '30383:rank'
  | '30384:rank'
  | '30385:rank';

export interface Nip85ProviderReference {
  service: Nip85RankService;
  pubkey: string;
  relay: string;
}

export type PersonalWotPermission = 'disabled' | 'augment-only' | 'user-choice';
export type WotCombinationStrategy = 'intersection' | 'union' | 'both-first';
export type EffectiveWotMode = 'off' | 'platform' | 'personal' | 'combined';

export interface PlatformWebOfTrustPolicy {
  enabled: boolean;
  minimumRank: number;
  personalPermission: PersonalWotPermission;
  defaultStrategy: WotCombinationStrategy;
  allowedStrategies?: WotCombinationStrategy[];
  unknownBehavior: 'allow' | 'deny';
}

export interface PersonalWebOfTrustPreference {
  enabled: boolean;
  mode?: 'augment' | 'override';
  minimumRank?: number;
  strategy?: WotCombinationStrategy;
}

export interface EffectiveWebOfTrustPolicy {
  mode: EffectiveWotMode;
  strategy: WotCombinationStrategy;
  platformMinimumRank: number;
  personalMinimumRank: number;
  unknownBehavior: 'allow' | 'deny';
}

export interface Nip85RankTarget {
  kind: number;
  identifier: string;
  externalKind?: string;
}

export interface Nip85RankAssertion {
  providerPubkey: string;
  target: Nip85RankTarget;
  rank: number;
  hops?: number;
  createdAt: number;
  eventId: string;
}

const HEX_PUBKEY = /^[0-9a-f]{64}$/i;
const SERVICE_PATTERN = /^(30382|30383|30384|30385):rank$/;

function threshold(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, Math.trunc(value)));
}

function normalizeRelayHint(value: string): string | null {
  try {
    const relay = new URL(value);
    if (relay.protocol !== 'wss:' && relay.protocol !== 'ws:') return null;
    if (relay.protocol === 'ws:' && !relay.hostname.endsWith('.onion')) return null;
    return relay.toString();
  } catch {
    return null;
  }
}

/** Parse one NIP-85 kind-10040 row. Unknown service types are ignored. */
export function parseNip85ProviderRow(tag: string[]): Nip85ProviderReference | null {
  if (tag.length < 3) return null;
  const [service, pubkeyRaw, relayRaw] = tag;
  if (!SERVICE_PATTERN.test(service) || !HEX_PUBKEY.test(pubkeyRaw)) return null;
  const relay = normalizeRelayHint(relayRaw);
  if (!relay) return null;
  return {
    service: service as Nip85RankService,
    pubkey: pubkeyRaw.toLowerCase(),
    relay,
  };
}

/**
 * Read public and already-decrypted private provider rows. The host must
 * verify the kind-10040 event and use its account signer for private rows.
 */
export function parseNip85ProviderList(
  event: NostrEvent,
  ownerPubkey: string,
  privateTags: string[][] = [],
): Nip85ProviderReference[] {
  if (event.kind !== NIP85_PROVIDER_LIST_KIND || event.pubkey !== ownerPubkey) return [];
  const rows = [...event.tags, ...privateTags]
    .map(parseNip85ProviderRow)
    .filter((row): row is Nip85ProviderReference => row !== null);
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.service + ':' + row.pubkey + ':' + row.relay;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Parse a selected provider's rank assertion for one exact subject. */
export function parseNip85RankAssertion(
  event: NostrEvent,
  provider: Nip85ProviderReference,
  target: Nip85RankTarget,
): Nip85RankAssertion | null {
  const kind = Number(provider.service.split(':', 1)[0]);
  if (target.kind !== kind || event.kind !== kind || event.pubkey !== provider.pubkey) return null;

  const dTags = event.tags.filter(([name]) => name === 'd');
  if (dTags.length !== 1 || dTags[0][1] !== target.identifier) return null;

  if (target.externalKind) {
    const kinds = event.tags.filter(([name]) => name === 'k').map(([, value]) => value);
    if (!kinds.includes(target.externalKind)) return null;
  }

  const rankTags = event.tags.filter(([name]) => name === 'rank');
  if (rankTags.length !== 1 || !/^\d+$/.test(rankTags[0][1])) return null;
  const rank = Number(rankTags[0][1]);
  if (!Number.isInteger(rank) || rank < 0 || rank > 100) return null;

  const hopsRaw = event.tags.find(([name]) => name === 'hops')?.[1];
  const hops = hopsRaw && /^\d+$/.test(hopsRaw) ? Number(hopsRaw) : undefined;
  return {
    providerPubkey: provider.pubkey,
    target,
    rank,
    hops,
    createdAt: event.created_at,
    eventId: event.id,
  };
}

/** Resolve admin policy and the user's personal preference. */
export function resolveEffectiveWebOfTrustPolicy(
  admin: PlatformWebOfTrustPolicy,
  personal?: PersonalWebOfTrustPreference,
): EffectiveWebOfTrustPolicy {
  const personalEnabled = admin.personalPermission !== 'disabled' && personal?.enabled === true;
  const platformEnabled = admin.enabled;
  const platformMinimumRank = threshold(admin.minimumRank, 0);
  const personalMinimumRank = threshold(personal?.minimumRank, 0);

  if (!platformEnabled) {
    // An augment-only policy cannot replace a disabled platform network.
    // Personal-only mode is an override and therefore requires explicit
    // administrator permission through user-choice.
    if (personalEnabled && admin.personalPermission === 'user-choice') {
      return {
        mode: 'personal',
        strategy: admin.defaultStrategy,
        platformMinimumRank,
        personalMinimumRank,
        unknownBehavior: admin.unknownBehavior,
      };
    }
    return {
      mode: 'off',
      strategy: admin.defaultStrategy,
      platformMinimumRank,
      personalMinimumRank,
      unknownBehavior: admin.unknownBehavior,
    };
  }

  if (!personalEnabled) {
    return {
      mode: 'platform',
      strategy: admin.defaultStrategy,
      platformMinimumRank,
      personalMinimumRank,
      unknownBehavior: admin.unknownBehavior,
    };
  }

  if (admin.personalPermission === 'user-choice' && personal?.mode === 'override') {
    return {
      mode: 'personal',
      strategy: admin.defaultStrategy,
      platformMinimumRank,
      personalMinimumRank,
      unknownBehavior: admin.unknownBehavior,
    };
  }

  const allowed = admin.allowedStrategies ?? ['intersection', 'union', 'both-first'];
  const strategy = personal?.strategy && allowed.includes(personal.strategy)
    ? personal.strategy
    : admin.defaultStrategy;

  return {
    mode: 'combined',
    strategy,
    platformMinimumRank,
    personalMinimumRank,
    unknownBehavior: admin.unknownBehavior,
  };
}

export interface WebOfTrustEvidence {
  platformRank?: number | null;
  personalRank?: number | null;
  platformReady: boolean;
  personalReady: boolean;
}

export interface WebOfTrustDecision {
  included: boolean;
  /** 2 means accepted by both; 1 means accepted by one; 0 means no trust tier. */
  trustTier: 0 | 1 | 2;
  pending: boolean;
  reason: 'off' | 'platform' | 'personal' | 'both' | 'either' | 'unknown' | 'blocked' | 'outside';
}

/**
 * Combine provider membership without comparing unrelated rank scales.
 * Platform moderation is evaluated first and cannot be overridden.
 */
export function evaluateWebOfTrust(
  policy: EffectiveWebOfTrustPolicy,
  evidence: WebOfTrustEvidence,
  platformBlocked = false,
): WebOfTrustDecision {
  if (platformBlocked) return { included: false, trustTier: 0, pending: false, reason: 'blocked' };
  if (policy.mode === 'off') return { included: true, trustTier: 0, pending: false, reason: 'off' };

  const platformPass = evidence.platformRank !== undefined &&
    evidence.platformRank !== null &&
    evidence.platformRank >= policy.platformMinimumRank;
  const personalPass = evidence.personalRank !== undefined &&
    evidence.personalRank !== null &&
    evidence.personalRank >= policy.personalMinimumRank;

  if (policy.mode === 'platform') {
    if (!evidence.platformReady) {
      return {
        included: policy.unknownBehavior === 'allow',
        trustTier: 0,
        pending: true,
        reason: 'unknown',
      };
    }
    return platformPass
      ? { included: true, trustTier: 1, pending: false, reason: 'platform' }
      : { included: false, trustTier: 0, pending: false, reason: 'outside' };
  }

  if (policy.mode === 'personal') {
    if (!evidence.personalReady) {
      return {
        included: policy.unknownBehavior === 'allow',
        trustTier: 0,
        pending: true,
        reason: 'unknown',
      };
    }
    return personalPass
      ? { included: true, trustTier: 1, pending: false, reason: 'personal' }
      : { included: false, trustTier: 0, pending: false, reason: 'outside' };
  }

  if (!evidence.platformReady || !evidence.personalReady) {
    return {
      included: policy.unknownBehavior === 'allow',
      trustTier: 0,
      pending: true,
      reason: 'unknown',
    };
  }

  if (policy.strategy === 'intersection') {
    return platformPass && personalPass
      ? { included: true, trustTier: 2, pending: false, reason: 'both' }
      : { included: false, trustTier: 0, pending: false, reason: 'outside' };
  }

  if (platformPass && personalPass) {
    return { included: true, trustTier: 2, pending: false, reason: 'both' };
  }
  if (platformPass || personalPass) {
    return { included: true, trustTier: 1, pending: false, reason: 'either' };
  }
  return { included: false, trustTier: 0, pending: false, reason: 'outside' };
}

/** A conservative, explainable multiplier for vote influence. */
export function webOfTrustVoteWeight(decision: WebOfTrustDecision): number {
  if (decision.reason === 'off' || decision.pending) return 1;
  if (!decision.included) return 0;
  return decision.trustTier === 2 ? 2 : 1;
}
 

/** NIP-73 web identifier: normalized HTTP(S) URL without a fragment. */
export function normalizeNip85WebIdentifier(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

/** Choose the primary NIP-85 subject for a search result. */
export function nip85TargetForSearchResult(result: {
  url: string;
  source: string;
  nostrEvent?: { id?: string; kind?: number; pubkey?: string; tags?: string[][] };
}): Nip85RankTarget | null {
  const event = result.nostrEvent;

  // Nostr-native result: rank the event itself where NIP-85 defines a subject
  // type. Profiles/replaceable objects fall back to the author's user rank.
  if (result.source === 'nostr' && event?.id) {
    if (
      event.kind !== undefined &&
      event.kind >= 30000 &&
      event.kind <= 39999 &&
      event.pubkey &&
      /^[0-9a-f]{64}$/i.test(event.pubkey)
    ) {
      const d = event.tags?.find(([name]) => name === 'd')?.[1];
      if (d !== undefined) {
        return {
          kind: NIP85_ADDRESSABLE_ASSERTION_KIND,
          identifier: String(event.kind) + ':' + event.pubkey.toLowerCase() + ':' + d,
        };
      }
    }

    if (event.kind !== undefined && event.kind < 10000 && /^[0-9a-f]{64}$/i.test(event.id)) {
      return { kind: NIP85_EVENT_ASSERTION_KIND, identifier: event.id.toLowerCase() };
    }

    if (event.pubkey && HEX_PUBKEY.test(event.pubkey)) {
      return { kind: NIP85_USER_ASSERTION_KIND, identifier: event.pubkey.toLowerCase() };
    }
  }

  // Community bookmarks, SIP-01 observations and web search results all point
  // at external content. Their page trust is evaluated by the NIP-73 subject,
  // not by the author of the bookmark/submission wrapper.
  const url = normalizeNip85WebIdentifier(result.url);
  return url
    ? { kind: NIP85_EXTERNAL_ID_ASSERTION_KIND, identifier: url, externalKind: 'web' }
    : null;
}

/** Stable key shared by assertion lookup and result evaluation. */
export function nip85TargetKey(target: Nip85RankTarget): string {
  return String(target.kind) + ':' + target.identifier;
}


export interface Nip85ProviderListSigner {
  encrypt(peerPubkey: string, plaintext: string): Promise<string>;
  decrypt(peerPubkey: string, ciphertext: string): Promise<string>;
}

/** Build the user's NIP-85 kind-10040 preferred-provider list. */
export async function buildNip85ProviderListDraft(
  ownerPubkey: string,
  publicProviders: Nip85ProviderReference[],
  privateProviders: Nip85ProviderReference[],
  signer: Nip85ProviderListSigner,
): Promise<{ kind: number; content: string; tags: string[][] }> {
  if (!HEX_PUBKEY.test(ownerPubkey)) throw new Error('Owner pubkey must be 32-byte hex.');

  const toTag = (provider: Nip85ProviderReference): string[] => {
    const parsed = parseNip85ProviderRow([provider.service, provider.pubkey, provider.relay]);
    if (!parsed) throw new Error('Invalid NIP-85 service/provider/relay row.');
    return [parsed.service, parsed.pubkey, parsed.relay];
  };

  const tags = publicProviders.map(toTag);
  const privateTags = privateProviders.map(toTag);
  const content = privateTags.length > 0
    ? await signer.encrypt(ownerPubkey.toLowerCase(), JSON.stringify(privateTags))
    : '';

  return { kind: NIP85_PROVIDER_LIST_KIND, content, tags };
}

/** Decrypt private provider rows from kind 10040 with the account's NIP-44 signer. */
export async function decryptNip85PrivateProviderRows(
  event: NostrEvent,
  ownerPubkey: string,
  signer: Nip85ProviderListSigner,
): Promise<string[][]> {
  if (event.kind !== NIP85_PROVIDER_LIST_KIND || event.pubkey !== ownerPubkey) {
    throw new Error('NIP-85 provider list does not belong to the requested account.');
  }
  if (!event.content) return [];

  const plaintext = await signer.decrypt(ownerPubkey, event.content);
  const parsed: unknown = JSON.parse(plaintext);
  if (!Array.isArray(parsed) || !parsed.every((tag) =>
    Array.isArray(tag) && tag.length === 3 && tag.every((part) => typeof part === 'string'),
  )) {
    throw new Error('Decrypted NIP-85 provider content is not a provider-tag array.');
  }

  return parsed as string[][];
}

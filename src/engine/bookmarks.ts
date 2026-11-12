/**
 * NIP-51 bookmark lists and NIP-B0 individual web bookmarks.
 *
 * Keep the standards distinct:
 * - kind 10003 is the global, replaceable bookmark list.
 * - kind 30003 is a categorized, addressable bookmark set with a d tag.
 * - NIP-51 private items are JSON tag arrays encrypted with NIP-44.
 * - kind 39701 is an individually editable public web bookmark.
 *
 * Web URLs inside NIP-51 lists use NIP-73 i/k=web identifiers. Private web
 * URLs stay inside encrypted list content and are never mirrored to kind 39701.
 */
import type { NostrEvent } from '@nostrify/nostrify';

export const NIP51_GLOBAL_BOOKMARKS_KIND = 10003;
export const NIP51_BOOKMARK_SET_KIND = 30003;
export const NIP_B0_WEB_BOOKMARK_KIND = 39701;

export type Nip51BookmarkListKind =
  | typeof NIP51_GLOBAL_BOOKMARKS_KIND
  | typeof NIP51_BOOKMARK_SET_KIND;

export interface Nip44SelfSigner {
  encrypt(peerPubkey: string, plaintext: string): Promise<string>;
  decrypt(peerPubkey: string, ciphertext: string): Promise<string>;
}

export type Nip51BookmarkReference =
  | { type: 'event'; id: string; relayHint?: string }
  | { type: 'address'; address: string; relayHint?: string }
  | { type: 'web'; url: string };

export interface NipB0BookmarkInput {
  url: string;
  title?: string;
  description?: string;
  tags?: string[];
  publishedAt?: number;
}

export interface NipB0Bookmark {
  url: string;
  title: string;
  description: string;
  tags: string[];
  publishedAt: number;
  event: NostrEvent;
}

export interface Nip51BookmarkListInput {
  kind: Nip51BookmarkListKind;
  /** Required for kind 30003 and omitted for kind 10003. */
  dTag?: string;
  title?: string;
  publicItems: Nip51BookmarkReference[];
  privateItems: Nip51BookmarkReference[];
}

export interface Nip51BookmarkList {
  kind: Nip51BookmarkListKind;
  dTag?: string;
  title?: string;
  publicItems: Nip51BookmarkReference[];
  privateItems: Nip51BookmarkReference[];
  privateContentAvailable: boolean;
  event: NostrEvent;
}

function getTagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find(([tagName]) => tagName === name)?.[1];
}

function validHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * NIP-73 requires a normalized URL without a fragment. The NIP does not
 * prescribe a complete normalization algorithm; preserve path/query semantics.
 */
export function normalizeNip73WebIdentifier(value: string): string | null {
  const url = validHttpUrl(value);
  if (!url) return null;
  url.hash = '';
  return url.href;
}

/** NIP-B0 d tag: omit the scheme only for HTTPS URIs. */
export function nipB0DTagForUrl(value: string): string | null {
  const url = validHttpUrl(value);
  if (!url) return null;
  return url.protocol === 'https:' ? url.href.slice('https://'.length) : url.href;
}

function uriFromNipB0DTag(value: string): string | null {
  const candidate = value.includes('://') ? value : 'https://' + value;
  const url = validHttpUrl(candidate);
  return url?.href ?? null;
}

/** Build the public, addressable NIP-B0 kind-39701 bookmark draft. */
export function buildNipB0BookmarkEvent(input: NipB0BookmarkInput): {
  kind: number;
  content: string;
  tags: string[][];
} {
  const url = validHttpUrl(input.url);
  if (!url) throw new Error('NIP-B0 bookmarks require an http(s) URL.');
  const d = nipB0DTagForUrl(url.href);
  if (!d) throw new Error('Could not derive the NIP-B0 d tag.');

  const title = (input.title ?? '').trim();
  const description = (input.description ?? '').trim();
  const topics = [...new Set((input.tags ?? [])
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => /^[a-z0-9][a-z0-9-]{0,99}$/.test(tag)))].slice(0, 20);

  const tags: string[][] = [['d', d]];
  if (input.publishedAt !== undefined && Number.isInteger(input.publishedAt) && input.publishedAt >= 0) {
    tags.push(['published_at', String(input.publishedAt)]);
  }
  if (title) tags.push(['title', title]);
  for (const topic of topics) tags.push(['t', topic]);

  return { kind: NIP_B0_WEB_BOOKMARK_KIND, content: description, tags };
}

/** Parse a public NIP-B0 bookmark, validating structure and URL scheme. */
export function parseNipB0Bookmark(event: NostrEvent): NipB0Bookmark | null {
  if (event.kind !== NIP_B0_WEB_BOOKMARK_KIND) return null;
  const dTags = event.tags.filter(([name]) => name === 'd');
  if (dTags.length !== 1 || !dTags[0][1]) return null;

  const url = uriFromNipB0DTag(dTags[0][1]);
  if (!url) return null;

  const title = getTagValue(event, 'title')?.trim() || url;
  const publishedRaw = getTagValue(event, 'published_at');
  const publishedAt = publishedRaw && /^\d+$/.test(publishedRaw)
    ? Number(publishedRaw)
    : event.created_at;
  const tags = event.tags
    .filter(([name]) => name === 't')
    .map(([, value]) => value)
    .filter((value) => /^[a-z0-9][a-z0-9-]{0,99}$/.test(value))
    .slice(0, 20);

  return { url, title, description: event.content, tags, publishedAt, event };
}

function referenceToTags(reference: Nip51BookmarkReference): string[][] {
  switch (reference.type) {
    case 'event':
      if (!/^[0-9a-f]{64}$/i.test(reference.id)) throw new Error('Bookmark event id must be 32-byte hex.');
      return [reference.relayHint
        ? ['e', reference.id.toLowerCase(), reference.relayHint]
        : ['e', reference.id.toLowerCase()]];
    case 'address':
      if (!/^\d+:[0-9a-f]{64}:.+$/i.test(reference.address)) {
        throw new Error('Bookmark address must be kind:pubkey:d.');
      }
      return [reference.relayHint
        ? ['a', reference.address, reference.relayHint]
        : ['a', reference.address]];
    case 'web': {
      const identifier = normalizeNip73WebIdentifier(reference.url);
      if (!identifier) throw new Error('NIP-73 web bookmark requires an http(s) URL.');
      return [['i', identifier], ['k', 'web']];
    }
  }
}

function parseReferenceTags(tags: string[][]): Nip51BookmarkReference[] {
  const references: Nip51BookmarkReference[] = [];
  const hasWebKind = tags.some(([name, value]) => name === 'k' && value === 'web');

  for (const tag of tags) {
    const [name, value, relayHint] = tag;
    if (!value) continue;
    if (name === 'e' && /^[0-9a-f]{64}$/i.test(value)) {
      references.push({ type: 'event', id: value.toLowerCase(), relayHint });
    } else if (name === 'a' && /^\d+:[0-9a-f]{64}:.+$/i.test(value)) {
      references.push({ type: 'address', address: value, relayHint });
    } else if (name === 'i' && hasWebKind) {
      const url = normalizeNip73WebIdentifier(value);
      if (url) references.push({ type: 'web', url });
    }
  }
  return references;
}

/**
 * Build a NIP-51 list draft. Private references are NIP-44 encrypted to the
 * user's own pubkey through the logged-in signer. Never pass an nsec here.
 */
export async function buildNip51BookmarkListDraft(
  input: Nip51BookmarkListInput,
  ownerPubkey: string,
  signer: Nip44SelfSigner,
): Promise<{ kind: number; content: string; tags: string[][] }> {
  if (!/^[0-9a-f]{64}$/i.test(ownerPubkey)) throw new Error('Owner pubkey must be 32-byte hex.');
  if (input.kind === NIP51_BOOKMARK_SET_KIND && !input.dTag?.trim()) {
    throw new Error('NIP-51 bookmark sets (kind 30003) require a non-empty d tag.');
  }

  const tags: string[][] = [];
  if (input.kind === NIP51_BOOKMARK_SET_KIND) {
    tags.push(['d', input.dTag!.trim()]);
    const title = input.title?.trim();
    if (title) tags.push(['title', title]);
  }
  tags.push(...input.publicItems.flatMap(referenceToTags));

  const privateTags = input.privateItems.flatMap(referenceToTags);
  const content = privateTags.length > 0
    ? await signer.encrypt(ownerPubkey.toLowerCase(), JSON.stringify(privateTags))
    : '';

  return { kind: input.kind, content, tags };
}

/** Decode public refs and, when supplied, previously decrypted private refs. */
export function parseNip51BookmarkList(
  event: NostrEvent,
  privateTags?: string[][],
): Nip51BookmarkList | null {
  if (event.kind !== NIP51_GLOBAL_BOOKMARKS_KIND && event.kind !== NIP51_BOOKMARK_SET_KIND) return null;
  const dTag = getTagValue(event, 'd');
  if (event.kind === NIP51_BOOKMARK_SET_KIND && !dTag?.trim()) return null;

  return {
    kind: event.kind,
    dTag,
    title: getTagValue(event, 'title'),
    publicItems: parseReferenceTags(event.tags),
    privateItems: privateTags ? parseReferenceTags(privateTags) : [],
    privateContentAvailable: privateTags !== undefined || event.content.length === 0,
    event,
  };
}

/** Decrypt the NIP-51 private item tags through the logged-in user's signer. */
export async function decryptNip51PrivateItems(
  event: NostrEvent,
  ownerPubkey: string,
  signer: Nip44SelfSigner,
): Promise<string[][]> {
  if (event.kind !== NIP51_GLOBAL_BOOKMARKS_KIND && event.kind !== NIP51_BOOKMARK_SET_KIND) {
    throw new Error('Event is not a NIP-51 bookmark list.');
  }
  if (!event.content) return [];

  const plaintext = await signer.decrypt(ownerPubkey, event.content);
  const parsed: unknown = JSON.parse(plaintext);
  if (!Array.isArray(parsed) || !parsed.every((tag) =>
    Array.isArray(tag) && tag.length >= 2 && tag.every((part) => typeof part === 'string'),
  )) {
    throw new Error('Decrypted NIP-51 bookmark content is not a tag array.');
  }
  return parsed as string[][];
}

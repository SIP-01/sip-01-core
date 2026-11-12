/**
 * NIP-51/NIP-B0 bookmark lifecycle for SIP-01 hosts.
 *
 * Personal lists are fetched from the user's NIP-65 read relays and published
 * to the user's write relays. Private list content is only opened by the
 * logged-in signer's NIP-44 capability. No private key is handled here.
 */
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { getSearchRelay, publishToRelayPool } from '@/lib/searchRelays';
import { useEngineRuntime } from '@/engine/runtime';
import {
  NIP51_GLOBAL_BOOKMARKS_KIND,
  NIP51_BOOKMARK_SET_KIND,
  NIP_B0_WEB_BOOKMARK_KIND,
  buildNipB0BookmarkEvent,
  decryptNip51PrivateItems,
  mutateNip51BookmarkListDraft,
  parseNip51BookmarkList,
  type Nip51BookmarkList,
  type Nip51BookmarkListKind,
  type Nip51BookmarkReference,
  type NipB0BookmarkInput,
} from '@/engine/bookmarks';

export interface BookmarkListOptions {
  kind?: Nip51BookmarkListKind;
  dTag?: string;
  title?: string;
}

export type BookmarkVisibility = 'public' | 'private';

export interface BookmarkMutationResult {
  bookmarkEvent?: NostrEvent;
  listEvent: NostrEvent;
}

async function queryEvents(
  relays: string[],
  filter: NostrFilter,
  signal?: AbortSignal,
  requireAllRelays = false,
): Promise<NostrEvent[]> {
  if (relays.length === 0) throw new Error('Configure your NIP-65 read relays before using Nostr bookmarks.');

  const settled = await Promise.allSettled(relays.map((url) =>
    getSearchRelay(url).query([filter], {
      signal: signal ?? AbortSignal.timeout(8000),
    }),
  ));
  const successful = settled.filter(
    (result): result is PromiseFulfilledResult<NostrEvent[]> => result.status === 'fulfilled',
  );
  if (successful.length === 0) throw new Error('Could not read the bookmark list from any configured read relay.');
  if (requireAllRelays && successful.length !== relays.length) {
    throw new Error('Could not read every configured NIP-65 read relay; refusing to update a possibly stale bookmark list.');
  }

  const events = new Map<string, NostrEvent>();
  for (const result of successful) {
    for (const event of result.value) {
      if (!events.has(event.id)) events.set(event.id, event);
    }
  }
  return [...events.values()];
}

function latestList(
  events: NostrEvent[],
  kind: Nip51BookmarkListKind,
  dTag?: string,
): NostrEvent | null {
  return events
    .filter((event) =>
      event.kind === kind &&
      (kind !== NIP51_BOOKMARK_SET_KIND || event.tags.some(([name, value]) => name === 'd' && value === dTag)),
    )
    .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))[0] ?? null;
}

export function useBookmarks() {
  const runtime = useEngineRuntime();
  const queryClient = useQueryClient();
  const pubkey = runtime.userPubkey;
  const readRelays = useMemo(() => runtime.userReadRelays ?? [], [runtime.userReadRelays]);
  const writeRelays = useMemo(() => runtime.userWriteRelays ?? [], [runtime.userWriteRelays]);

  const listsQuery = useQuery({
    queryKey: ['nip51-bookmark-lists', pubkey, [...readRelays].sort()],
    queryFn: async ({ signal }): Promise<Nip51BookmarkList[]> => {
      if (!pubkey) return [];
      const events = await queryEvents(readRelays, {
        authors: [pubkey],
        kinds: [NIP51_GLOBAL_BOOKMARKS_KIND, NIP51_BOOKMARK_SET_KIND],
        limit: 500,
      }, signal);

      const latest = new Map<string, NostrEvent>();
      for (const event of events) {
        const d = event.kind === NIP51_BOOKMARK_SET_KIND
          ? event.tags.find(([name]) => name === 'd')?.[1] ?? ''
          : '';
        const key = String(event.kind) + ':' + d;
        const existing = latest.get(key);
        if (!existing || event.created_at > existing.created_at ||
          (event.created_at === existing.created_at && event.id > existing.id)) {
          latest.set(key, event);
        }
      }

      const parsed = await Promise.all([...latest.values()].map(async (event) => {
        const nip44 = runtime.userSigner?.nip44;
        const nip04 = runtime.userSigner?.nip04;
        const hasCompatibleDecryptor = event.content && (
          (event.content.includes('?iv=') && !!nip04) ||
          (!event.content.includes('?iv=') && !!nip44)
        );
        if (hasCompatibleDecryptor && runtime.userPubkey === event.pubkey) {
          try {
            const privateTags = await decryptNip51PrivateItems(event, pubkey, {
              decrypt: nip44?.decrypt,
              nip04,
            });
            return parseNip51BookmarkList(event, privateTags);
          } catch {
            // Keep public references visible but mark private content unavailable.
          }
        }
        return parseNip51BookmarkList(event);
      }));
      return parsed.filter((value): value is Nip51BookmarkList => value !== null);
    },
    enabled: !!pubkey && readRelays.length > 0,
    staleTime: 60_000,
    retry: 0,
  });

  const publish = useCallback(async (
    draft: { kind: number; content: string; tags: string[][] },
  ): Promise<NostrEvent> => {
    if (!runtime.userSigner || !pubkey) throw new Error('Log in with a Nostr signer before saving bookmarks.');
    if (writeRelays.length === 0) throw new Error('Configure your NIP-65 write relays before publishing bookmarks.');

    const signed = await runtime.userSigner.signEvent({
      kind: draft.kind,
      content: draft.content,
      tags: draft.tags,
      created_at: Math.floor(Date.now() / 1000),
    });
    const accepted = await publishToRelayPool(writeRelays, signed, 7000);
    if (accepted === 0) throw new Error('No configured NIP-65 write relay accepted the bookmark event.');
    return signed;
  }, [runtime.userSigner, pubkey, writeRelays]);

  const updateList = useCallback(async (
    references: Nip51BookmarkReference[],
    visibility: BookmarkVisibility,
    options: BookmarkListOptions = {},
    remove = false,
  ): Promise<NostrEvent> => {
    if (!runtime.userSigner || !pubkey) throw new Error('Log in with a Nostr signer before saving bookmarks.');
    const kind = options.kind ?? NIP51_GLOBAL_BOOKMARKS_KIND;
    if (kind === NIP51_BOOKMARK_SET_KIND && !options.dTag?.trim()) {
      throw new Error('A category d tag is required for a NIP-51 bookmark set.');
    }

    const existingEvents = await queryEvents(readRelays, {
      authors: [pubkey],
      kinds: [kind],
      ...(kind === NIP51_BOOKMARK_SET_KIND ? { '#d': [options.dTag!] } : {}),
      limit: 100,
    }, undefined, true);
    const existing = latestList(existingEvents, kind, options.dTag);
    const nip44 = runtime.userSigner.nip44;
    if ((visibility === 'private' || existing?.content) && !nip44) {
      throw new Error('Your Nostr signer must support NIP-44 to read or write private bookmark-list content.');
    }

    const safeSigner = nip44
      ? { ...nip44, nip04: runtime.userSigner.nip04 }
      : {
          encrypt: async () => { throw new Error('NIP-44 encryption is unavailable.'); },
          decrypt: async () => { throw new Error('NIP-44 decryption is unavailable.'); },
          nip04: runtime.userSigner.nip04,
        };

    const draft = await mutateNip51BookmarkListDraft(
      existing,
      pubkey,
      safeSigner,
      {
        kind,
        dTag: options.dTag,
        title: options.title,
        ...(visibility === 'public'
          ? (remove ? { removePublic: references } : { addPublic: references })
          : (remove ? { removePrivate: references } : { addPrivate: references })),
      },
    );
    const event = await publish(draft);
    void queryClient.invalidateQueries({ queryKey: ['nip51-bookmark-lists', pubkey] });
    return event;
  }, [runtime.userSigner, pubkey, readRelays, publish, queryClient]);

  const saveWebBookmark = useCallback(async (
    input: NipB0BookmarkInput,
    visibility: BookmarkVisibility,
    options: BookmarkListOptions = {},
  ): Promise<BookmarkMutationResult> => {
    if (visibility === 'private') {
      const listEvent = await updateList([{ type: 'web', url: input.url }], 'private', options);
      return { listEvent };
    }

    // Public web bookmarks have an individual NIP-B0 record and NIP-51
    // list references (addressable event plus NIP-73 URL identifier).
    const b0Draft = buildNipB0BookmarkEvent(input);
    const bookmarkEvent = await publish(b0Draft);
    const dTag = b0Draft.tags.find(([name]) => name === 'd')?.[1];
    if (!dTag) throw new Error('Could not derive the NIP-B0 bookmark coordinate.');

    const references: Nip51BookmarkReference[] = [
      { type: 'address', address: String(NIP_B0_WEB_BOOKMARK_KIND) + ':' + bookmarkEvent.pubkey + ':' + dTag },
      { type: 'web', url: input.url },
    ];
    const listEvent = await updateList(references, 'public', options);
    return { bookmarkEvent, listEvent };
  }, [publish, updateList]);

  const saveReference = useCallback(async (
    reference: Nip51BookmarkReference,
    visibility: BookmarkVisibility,
    options: BookmarkListOptions = {},
  ): Promise<NostrEvent> => updateList([reference], visibility, options), [updateList]);

  const removeReference = useCallback(async (
    reference: Nip51BookmarkReference,
    visibility: BookmarkVisibility,
    options: BookmarkListOptions = {},
  ): Promise<NostrEvent> => updateList([reference], visibility, options, true), [updateList]);

  return {
    lists: listsQuery.data ?? [],
    isLoading: listsQuery.isLoading,
    error: listsQuery.error,
    refetch: listsQuery.refetch,
    saveWebBookmark,
    saveReference,
    removeReference,
  };
}

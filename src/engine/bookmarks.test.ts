import { describe, expect, it } from 'vitest';
import {
  buildNipB0BookmarkEvent,
  nipB0DTagForUrl,
  normalizeNip73WebIdentifier,
  parseNipB0Bookmark,
  buildNip51BookmarkListDraft,
  mutateNip51BookmarkListDraft,
  parseNip51BookmarkList,
  decryptNip51PrivateItems,
} from './bookmarks';

const owner = 'a'.repeat(64);

describe('NIP-B0 public web bookmarks', () => {
  it('uses an HTTPS scheme-less d tag and preserves path/query semantics', () => {
    expect(nipB0DTagForUrl('https://example.com/article?id=4')).toBe('example.com/article?id=4');
    expect(nipB0DTagForUrl('http://example.com/article?id=4')).toBe('http://example.com/article?id=4');
    expect(normalizeNip73WebIdentifier('https://example.com/article#section')).toBe('https://example.com/article');
  });

  it('builds and parses a public kind-39701 event', () => {
    const draft = buildNipB0BookmarkEvent({
      url: 'https://example.com/article',
      title: 'Example',
      description: 'A saved page',
      tags: ['Nostr', 'privacy'],
      publishedAt: 100,
    });
    const event = {
      kind: draft.kind,
      pubkey: owner,
      id: 'b'.repeat(64),
      created_at: 100,
      tags: draft.tags,
      content: draft.content,
      sig: 'c'.repeat(128),
    };
    expect(parseNipB0Bookmark(event)?.url).toBe('https://example.com/article');
    expect(parseNipB0Bookmark({ ...event, tags: [] })).toBeNull();
  });
});

describe('NIP-51 legacy NIP-04 read compatibility', () => {
  it('decrypts legacy ?iv= content through the optional NIP-04 signer', async () => {
    const event = {
      kind: 10003,
      pubkey: owner,
      id: 'f'.repeat(64),
      created_at: 100,
      tags: [],
      content: 'legacy-ciphertext?iv=legacy-iv',
      sig: 'e'.repeat(128),
    };
    const signer = {
      nip04: {
        decrypt: async (peer: string, ciphertext: string) => {
          expect(peer).toBe(owner);
          expect(ciphertext).toContain('?iv=');
          return JSON.stringify([['i', 'https://legacy-private.example/'], ['k', 'web']]);
        },
      },
    };
    const privateTags = await decryptNip51PrivateItems(event, owner, signer);
    expect(privateTags).toEqual([
      ['i', 'https://legacy-private.example/'],
      ['k', 'web'],
    ]);
  });

  it('rewrites a legacy list using NIP-44 after a successful NIP-04 decrypt', async () => {
    let encrypted = '';
    const signer = {
      encrypt: async (peer: string, plaintext: string) => {
        expect(peer).toBe(owner);
        encrypted = plaintext;
        return 'fresh-nip44-ciphertext';
      },
      decrypt: async () => { throw new Error('NIP-44 must not be used for legacy ?iv= content'); },
      nip04: {
        decrypt: async (_peer: string, _ciphertext: string) =>
          JSON.stringify([['i', 'https://legacy-private.example/'], ['k', 'web']]),
      },
    };
    const existing = {
      kind: 10003,
      pubkey: owner,
      id: 'f'.repeat(64),
      created_at: 100,
      tags: [],
      content: 'legacy-ciphertext?iv=legacy-iv',
      sig: 'e'.repeat(128),
    };
    const draft = await mutateNip51BookmarkListDraft(existing, owner, signer, {
      kind: 10003,
      addPrivate: [{ type: 'web', url: 'https://new-private.example' }],
    });
    expect(draft.content).toBe('fresh-nip44-ciphertext');
    expect(JSON.parse(encrypted)).toEqual([
      ['i', 'https://legacy-private.example/'],
      ['k', 'web'],
      ['i', 'https://new-private.example/'],
    ]);
  });
});

describe('NIP-51 public and private bookmark lists', () => {
  it('keeps private URL references out of public tags', async () => {
    let encrypted = '';
    const signer = {
      encrypt: async (peer: string, plaintext: string) => {
        expect(peer).toBe(owner);
        encrypted = plaintext;
        return 'nip44-ciphertext';
      },
      decrypt: async (_peer: string, ciphertext: string) => {
        expect(ciphertext).toBe('nip44-ciphertext');
        return encrypted;
      },
    };
    const draft = await buildNip51BookmarkListDraft({
      kind: 10003,
      publicItems: [{ type: 'web', url: 'https://public.example' }],
      privateItems: [{ type: 'web', url: 'https://private.example' }],
    }, owner, signer);
    expect(draft.tags.some((tag) => tag[0] === 'i' && tag[1]?.includes('private.example'))).toBe(false);
    expect(JSON.parse(encrypted)).toEqual([['i', 'https://private.example/'], ['k', 'web']]);
  });

  it('requires a d tag for kind-30003 bookmark sets', async () => {
    const signer = { encrypt: async () => '', decrypt: async () => '' };
    await expect(buildNip51BookmarkListDraft({
      kind: 30003,
      publicItems: [],
      privateItems: [],
    }, owner, signer)).rejects.toThrow('require a non-empty d tag');
  });

  it('read-modify-writes a list while preserving existing public/private and unknown tags', async () => {
    const privateTags = [['i', 'https://private-old.example/'], ['k', 'web']];
    let encrypted = JSON.stringify(privateTags);
    const signer = {
      encrypt: async (_peer: string, plaintext: string) => {
        encrypted = plaintext;
        return 'next-ciphertext';
      },
      decrypt: async (_peer: string, ciphertext: string) => {
        expect(ciphertext).toBe('old-ciphertext');
        return JSON.stringify(privateTags);
      },
    };
    const existing = {
      kind: 10003,
      pubkey: owner,
      id: 'f'.repeat(64),
      created_at: 100,
      tags: [['e', '1'.repeat(64)], ['custom', 'preserve-me']],
      content: 'old-ciphertext',
      sig: 'e'.repeat(128),
    };
    const draft = await mutateNip51BookmarkListDraft(existing, owner, signer, {
      kind: 10003,
      addPublic: [{ type: 'web', url: 'https://public-new.example' }],
      addPrivate: [{ type: 'web', url: 'https://private-new.example' }],
      removePrivate: [{ type: 'web', url: 'https://private-old.example' }],
    });
    expect(draft.tags).toContainEqual(['e', '1'.repeat(64)]);
    expect(draft.tags).toContainEqual(['custom', 'preserve-me']);
    expect(draft.tags).toContainEqual(['i', 'https://public-new.example/']);
    expect(draft.tags.some((tag) => tag[0] === 'i' && tag[1]?.includes('private'))).toBe(false);
    expect(JSON.parse(encrypted)).toEqual([
      ['i', 'https://private-new.example/'],
      ['k', 'web'],
    ]);
  });

  it('refuses to overwrite private content when NIP-44 decryption fails', async () => {
    const existing = {
      kind: 10003,
      pubkey: owner,
      id: 'f'.repeat(64),
      created_at: 100,
      tags: [],
      content: 'unreadable-ciphertext',
      sig: 'e'.repeat(128),
    };
    const signer = {
      encrypt: async () => 'new-ciphertext',
      decrypt: async () => { throw new Error('signer locked'); },
    };
    await expect(mutateNip51BookmarkListDraft(existing, owner, signer, {
      kind: 10003,
      addPublic: [{ type: 'web', url: 'https://public.example' }],
    })).rejects.toThrow('signer locked');
  });

  it('decodes public and private references separately', async () => {
    const signer = {
      encrypt: async (_peer: string, value: string) => value,
      decrypt: async (_peer: string, value: string) => value,
    };
    const draft = await buildNip51BookmarkListDraft({
      kind: 10003,
      publicItems: [{ type: 'web', url: 'https://public.example' }],
      privateItems: [{ type: 'web', url: 'https://private.example' }],
    }, owner, signer);
    const event = {
      kind: draft.kind,
      pubkey: owner,
      id: 'd'.repeat(64),
      created_at: 100,
      tags: draft.tags,
      content: draft.content,
      sig: 'e'.repeat(128),
    };
    const privateTags = await decryptNip51PrivateItems(event, owner, signer);
    const parsed = parseNip51BookmarkList(event, privateTags);
    expect(parsed?.publicItems).toEqual([{ type: 'web', url: 'https://public.example/' }]);
    expect(parsed?.privateItems).toEqual([{ type: 'web', url: 'https://private.example/' }]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildNip85ProviderListDraft,
  decryptNip85PrivateProviderRows,
  evaluateWebOfTrust,
  parseNip85ProviderList,
  parseNip85ProviderRow,
  parseNip85RankAssertion,
  resolveEffectiveWebOfTrustPolicy,
  webOfTrustVoteWeight,
  nip85TargetForSearchResult,
  type PlatformWebOfTrustPolicy,
} from './webOfTrust';

const admin: PlatformWebOfTrustPolicy = {
  enabled: true,
  minimumRank: 50,
  personalPermission: 'user-choice',
  defaultStrategy: 'both-first',
  allowedStrategies: ['intersection', 'union', 'both-first'],
  unknownBehavior: 'allow',
};

describe('NIP-85 provider list', () => {
  it('round-trips public and NIP-44-private provider rows', async () => {
    const owner = 'b'.repeat(64);
    const publicProvider = {
      service: '30382:rank' as const,
      pubkey: 'a'.repeat(64),
      relay: 'wss://public.provider',
    };
    const privateProvider = {
      service: '30385:rank' as const,
      pubkey: 'c'.repeat(64),
      relay: 'wss://private.provider',
    };
    let encrypted = '';
    const signer = {
      encrypt: async (peer: string, plaintext: string) => {
        expect(peer).toBe(owner);
        encrypted = plaintext;
        return 'nip44-provider-ciphertext';
      },
      decrypt: async (peer: string, ciphertext: string) => {
        expect(peer).toBe(owner);
        expect(ciphertext).toBe('nip44-provider-ciphertext');
        return encrypted;
      },
    };
    const draft = await buildNip85ProviderListDraft(owner, [publicProvider], [privateProvider], signer);
    expect(draft.kind).toBe(10040);
    expect(draft.tags).toEqual([['30382:rank', 'a'.repeat(64), 'wss://public.provider/']]);

    const event = {
      kind: 10040,
      pubkey: owner,
      id: 'd'.repeat(64),
      created_at: 10,
      tags: draft.tags,
      content: draft.content,
      sig: 'e'.repeat(128),
    };
    const privateRows = await decryptNip85PrivateProviderRows(event, owner, signer);
    expect(parseNip85ProviderList(event, owner, privateRows)).toHaveLength(2);
  });

  it('rejects trying to decrypt another account\'s kind-10040 list', async () => {
    const signer = { encrypt: async () => '', decrypt: async () => '[]' };
    await expect(decryptNip85PrivateProviderRows({
      kind: 10040,
      pubkey: 'a'.repeat(64),
      id: 'b'.repeat(64),
      created_at: 1,
      tags: [],
      content: 'ciphertext',
      sig: 'c'.repeat(128),
    }, 'd'.repeat(64), signer)).rejects.toThrow('does not belong');
  });
});

describe('NIP-85 provider and assertion validation', () => {
  it('parses only supported provider rows with secure relay hints', () => {
    expect(parseNip85ProviderRow([
      '30382:rank',
      'a'.repeat(64),
      'wss://scores.example',
    ])).toEqual({
      service: '30382:rank',
      pubkey: 'a'.repeat(64),
      relay: 'wss://scores.example/',
    });
    expect(parseNip85ProviderRow(['30382:rank', 'bad', 'wss://scores.example'])).toBeNull();
    expect(parseNip85ProviderRow(['30382:rank', 'a'.repeat(64), 'ws://scores.example'])).toBeNull();
  });

  it('accepts an assertion only from the selected provider for the exact subject', () => {
    const provider = {
      service: '30382:rank' as const,
      pubkey: 'a'.repeat(64),
      relay: 'wss://scores.example/',
    };
    const event = {
      kind: 30382,
      pubkey: provider.pubkey,
      id: 'c'.repeat(64),
      created_at: 10,
      tags: [['d', 'b'.repeat(64)], ['rank', '81'], ['hops', '2']],
      content: '',
      sig: 'd'.repeat(128),
    };
    expect(parseNip85RankAssertion(event, provider, { kind: 30382, identifier: 'b'.repeat(64) })?.rank).toBe(81);
    expect(parseNip85RankAssertion(event, provider, { kind: 30382, identifier: 'e'.repeat(64) })).toBeNull();
    expect(parseNip85RankAssertion({ ...event, pubkey: 'f'.repeat(64) }, provider, { kind: 30382, identifier: 'b'.repeat(64) })).toBeNull();
    expect(parseNip85RankAssertion({ ...event, tags: [['d', 'b'.repeat(64)], ['rank', '101']] }, provider, { kind: 30382, identifier: 'b'.repeat(64) })).toBeNull();
  });
});

describe('NIP-85 subject selection', () => {
  it('uses the external URL rather than the bookmarker author for web results', () => {
    const target = nip85TargetForSearchResult({
      source: 'web',
      url: 'https://example.com/page',
      nostrEvent: { id: 'a'.repeat(64), kind: 39701, pubkey: 'b'.repeat(64), tags: [['d', 'example.com/page']] },
    });
    expect(target).toEqual({
      kind: 30385,
      identifier: 'https://example.com/page',
      externalKind: 'web',
    });
  });

  it('uses the address coordinate for Nostr addressable results', () => {
    const target = nip85TargetForSearchResult({
      source: 'nostr',
      url: 'https://example.com/article',
      nostrEvent: { id: 'a'.repeat(64), kind: 30023, pubkey: 'b'.repeat(64), tags: [['d', 'post-1']] },
    });
    expect(target).toEqual({
      kind: 30384,
      identifier: '30023:' + 'b'.repeat(64) + ':post-1',
    });
  });
});

describe('administrator and personal Web-of-Trust policy', () => {
  it('blocks personal override when administrators allow augmentation only', () => {
    const policy = resolveEffectiveWebOfTrustPolicy(
      { ...admin, personalPermission: 'augment-only' },
      { enabled: true, mode: 'override', minimumRank: 20 },
    );
    expect(policy.mode).toBe('combined');
  });

  it('does not let augment-only become personal-only when platform trust is disabled', () => {
    const policy = resolveEffectiveWebOfTrustPolicy(
      { ...admin, enabled: false, personalPermission: 'augment-only' },
      { enabled: true },
    );
    expect(policy.mode).toBe('off');
  });

  it('allows personal override only when administrators explicitly allow user choice', () => {
    const policy = resolveEffectiveWebOfTrustPolicy(
      admin,
      { enabled: true, mode: 'override', minimumRank: 20 },
    );
    expect(policy.mode).toBe('personal');
  });

  it('does not average provider-relative rank values', () => {
    const policy = resolveEffectiveWebOfTrustPolicy(
      admin,
      { enabled: true, mode: 'augment', minimumRank: 20, strategy: 'both-first' },
    );
    const decision = evaluateWebOfTrust(policy, {
      platformRank: 80,
      personalRank: 10,
      platformReady: true,
      personalReady: true,
    });
    expect(decision.included).toBe(true);
    expect(decision.trustTier).toBe(1);
    expect(webOfTrustVoteWeight(decision)).toBe(1);
  });

  it('supports intersection and union membership strategies', () => {
    const evidence = {
      platformRank: 80,
      personalRank: null,
      platformReady: true,
      personalReady: true,
    };
    const base = resolveEffectiveWebOfTrustPolicy(admin, { enabled: true });
    const intersection = evaluateWebOfTrust({ ...base, strategy: 'intersection' }, evidence);
    const union = evaluateWebOfTrust({ ...base, strategy: 'union' }, evidence);
    expect(intersection.included).toBe(false);
    expect(union.included).toBe(true);
    expect(union.trustTier).toBe(1);
  });

  it('keeps platform hard blocks above personal override', () => {
    const policy = resolveEffectiveWebOfTrustPolicy(admin, { enabled: true, mode: 'override' });
    const decision = evaluateWebOfTrust(policy, {
      personalRank: 100,
      personalReady: true,
      platformReady: false,
    }, true);
    expect(decision.included).toBe(false);
    expect(decision.reason).toBe('blocked');
  });

  it('preserves search when configured to allow unknown trust state during sync', () => {
    const policy = resolveEffectiveWebOfTrustPolicy(admin, { enabled: true });
    const decision = evaluateWebOfTrust(policy, {
      platformReady: false,
      personalReady: false,
    });
    expect(decision.included).toBe(true);
    expect(decision.pending).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_REACTION_KIND,
  VOTE_KIND,
  buildVoteEvent,
  tallyVotes,
  voteTargetFor,
} from './votes';

const eventId = 'a'.repeat(64);
const author = 'b'.repeat(64);
const otherAuthor = 'c'.repeat(64);
const eventBase = {
  id: 'd'.repeat(64),
  pubkey: author,
  created_at: 10,
  tags: [] as string[][],
  content: '',
  sig: 'e'.repeat(128),
};

describe('NIP-25 target selection', () => {
  it('uses kind 7 and event tags for native Nostr results', () => {
    const target = voteTargetFor({
      source: 'nostr',
      url: 'https://nostr.example/note',
      nostrEvent: { id: eventId, pubkey: author, kind: 1, tags: [] },
    });
    expect(target?.kind).toBe(VOTE_KIND);
    expect(target?.tags).toContainEqual(['e', eventId]);
    expect(target?.tags).toContainEqual(['p', author]);
    expect(target?.tags).toContainEqual(['k', '1']);
  });

  it('uses kind 17 and NIP-73 k/i tags for web results', () => {
    const target = voteTargetFor({
      source: 'web',
      url: 'https://example.com/article#part',
      nostrEvent: { id: eventId, pubkey: author, kind: 39701, tags: [['d', 'example.com/article']] },
    });
    expect(target?.kind).toBe(EXTERNAL_REACTION_KIND);
    expect(target?.tags).toContainEqual(['k', 'web']);
    expect(target?.tags).toContainEqual(['i', 'https://example.com/article']);
    const template = target ? buildVoteEvent(target, 1) : null;
    expect(template?.kind).toBe(17);
    expect(template?.content).toBe('+');
  });

  it('includes the address coordinate when reacting to an addressable Nostr event', () => {
    const target = voteTargetFor({
      source: 'nostr',
      url: 'https://nostr.example/article',
      nostrEvent: {
        id: eventId,
        pubkey: author,
        kind: 30023,
        tags: [['d', 'article-1']],
      },
    });
    expect(target?.tags).toContainEqual(['a', '30023:' + author + ':article-1']);
  });
});

describe('NIP-25 vote tallies', () => {
  it('counts kind-17 external reactions and preserves raw and weighted scores', () => {
    const up = {
      ...eventBase,
      id: '1'.repeat(64),
      pubkey: author,
      kind: 17,
      tags: [['k', 'web'], ['i', 'https://example.com/page']],
      content: '+',
    };
    const down = {
      ...eventBase,
      id: '2'.repeat(64),
      pubkey: otherAuthor,
      kind: 17,
      tags: [['k', 'web'], ['i', 'https://example.com/page']],
      content: '-',
    };
    const result = tallyVotes([up, down], {
      authorWeights: new Map([[author, 2], [otherAuthor, 1]]),
    }).get('u:https://example.com/page');
    expect(result?.up).toBe(1);
    expect(result?.down).toBe(1);
    expect(result?.score).toBe(0);
    expect(result?.weightedScore).toBe(1);
  });

  it('reads legacy kind-7/r URL reactions but ignores emoji reactions as numeric votes', () => {
    const legacy = {
      ...eventBase,
      kind: 7,
      tags: [['r', 'https://example.com/page']],
      content: '+',
    };
    const emoji = {
      ...eventBase,
      id: 'f'.repeat(64),
      kind: 17,
      tags: [['k', 'web'], ['i', 'https://example.com/page']],
      content: '👍',
    };
    const result = tallyVotes([legacy, emoji]).get('u:https://example.com/page');
    expect(result?.up).toBe(1);
    expect(result?.down).toBe(0);
  });

  it('uses the latest reaction per author rather than double-counting flips', () => {
    const earlier = {
      ...eventBase,
      id: '1'.repeat(64),
      kind: 7,
      tags: [['e', eventId]],
      content: '+',
      created_at: 10,
    };
    const later = {
      ...eventBase,
      id: '2'.repeat(64),
      kind: 7,
      tags: [['e', eventId]],
      content: '-',
      created_at: 20,
    };
    const result = tallyVotes([earlier, later]).get('e:' + eventId);
    expect(result?.up).toBe(0);
    expect(result?.down).toBe(1);
    expect(result?.score).toBe(-1);
  });
});

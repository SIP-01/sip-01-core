/**
 * NIP-85 assertion lookup for search engines.
 *
 * Only the selected provider keys are queried. A rank is exposed only after
 * NIP-01 signature verification and an exact provider/service/subject match.
 * Provider relay hints are honored; private 10040 rows are host-decrypted
 * before they are injected through EngineRuntime.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { verifyEvent } from 'nostr-tools/pure';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { getSearchRelay } from '@/lib/searchRelays';
import { useEngineRuntime } from '@/engine/runtime';
import {
  parseNip85RankAssertion,
  resolveEffectiveWebOfTrustPolicy,
  type Nip85RankTarget,
  type Nip85ProviderReference,
} from '@/engine/webOfTrust';

export interface WebOfTrustLookupTarget extends Nip85RankTarget {
  key: string;
}

export interface WebOfTrustLookupValue {
  platformRank?: number;
  personalRank?: number;
}

export interface WebOfTrustLookupResult {
  ranks: Map<string, WebOfTrustLookupValue>;
  platformReady: Set<number>;
  personalReady: Set<number>;
}

interface ProviderTask {
  source: 'platform' | 'personal';
  provider: Nip85ProviderReference;
}

function serviceKind(service: string): number {
  return Number(service.split(':', 1)[0]);
}

function targetMapKey(target: Nip85RankTarget): string {
  return String(target.kind) + ':' + target.identifier;
}

function uniqueTargets(targets: WebOfTrustLookupTarget[]): WebOfTrustLookupTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = targetMapKey(target) + ':' + (target.externalKind ?? '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function queryProvider(
  provider: Nip85ProviderReference,
  targets: WebOfTrustLookupTarget[],
  signal: AbortSignal,
): Promise<NostrEvent[]> {
  const kind = serviceKind(provider.service);
  const matching = targets.filter((target) => target.kind === kind);
  if (matching.length === 0) return [];

  const events: NostrEvent[] = [];
  for (let offset = 0; offset < matching.length; offset += 100) {
    const batch = matching.slice(offset, offset + 100);
    const filter: NostrFilter = {
      kinds: [kind],
      authors: [provider.pubkey],
      '#d': batch.map((target) => target.identifier),
      limit: batch.length,
    };
    const externalKinds = [...new Set(
      batch.map((target) => target.externalKind).filter((value): value is string => !!value),
    )];
    if (externalKinds.length === 1) filter['#k'] = externalKinds;
    events.push(...await getSearchRelay(provider.relay).query([filter], { signal }));
  }
  return events;
}

/** Return provider-signed assertions for the requested subjects. */
export function useWebOfTrustAssertions(targets: WebOfTrustLookupTarget[]) {
  const runtime = useEngineRuntime();
  const config = runtime.webOfTrust;
  const effective = config
    ? resolveEffectiveWebOfTrustPolicy(config.adminPolicy, config.personalPreference)
    : null;

  const tasks = useMemo<ProviderTask[]>(() => {
    if (!config || !effective || effective.mode === 'off') return [];
    const output: ProviderTask[] = [];
    if (effective.mode !== 'personal') {
      for (const provider of config.platformProviders) output.push({ source: 'platform', provider });
    }
    if (effective.mode !== 'platform') {
      for (const provider of config.personalProviders ?? []) output.push({ source: 'personal', provider });
    }
    return output;
  }, [config, effective]);

  const targetList = useMemo(() => uniqueTargets(targets), [targets]);
  const targetKey = targetList
    .map((target) => targetMapKey(target) + ':' + (target.externalKind ?? ''))
    .sort()
    .join('|');
  const providerKey = tasks
    .map((task) => task.source + ':' + task.provider.service + ':' + task.provider.pubkey + ':' + task.provider.relay)
    .sort()
    .join('|');

  return useQuery({
    queryKey: ['nip85-assertions', targetKey, providerKey],
    queryFn: async ({ signal }) => {
      const ranks = new Map<string, WebOfTrustLookupValue>();
      const platformReady = new Set<number>();
      const personalReady = new Set<number>();

      const settled = await Promise.allSettled(tasks.map(async (task) => {
        const providerKind = serviceKind(task.provider.service);
        const events = await queryProvider(task.provider, targetList, signal);
        (task.source === 'platform' ? platformReady : personalReady).add(providerKind);

        for (const event of events) {
          if (!verifyEvent(event)) continue;
          const target = targetList.find((candidate) =>
            candidate.kind === event.kind &&
            candidate.identifier === event.tags.find(([name]) => name === 'd')?.[1] &&
            (!candidate.externalKind ||
              event.tags.some(([name, value]) => name === 'k' && value === candidate.externalKind)),
          );
          if (!target) continue;

          const assertion = parseNip85RankAssertion(event, task.provider, target);
          if (!assertion) continue;

          const key = targetMapKey(target);
          const value = ranks.get(key) ?? {};
          if (task.source === 'platform') value.platformRank = assertion.rank;
          else value.personalRank = assertion.rank;
          ranks.set(key, value);
        }
      }));

      for (let index = 0; index < settled.length; index++) {
        if (settled[index].status === 'rejected') {
          const task = tasks[index];
          const kind = serviceKind(task.provider.service);
          (task.source === 'platform' ? platformReady : personalReady).delete(kind);
        }
      }

      return { ranks, platformReady, personalReady } satisfies WebOfTrustLookupResult;
    },
    enabled: tasks.length > 0 && targetList.length > 0,
    staleTime: 5 * 60_000,
    retry: 0,
  });
}

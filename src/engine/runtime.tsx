/**
 * Engine runtime — host-injected identity, relay and trust policy.
 *
 * The core supplies standards mechanics; each host chooses its own provider
 * allowlist, moderation policy, relay routing and product defaults.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import type { ModerationSet } from './moderation';
import type {
  Nip85ProviderReference,
  PersonalWebOfTrustPreference,
  PlatformWebOfTrustPolicy,
} from './webOfTrust';

export interface EngineNip44Signer {
  encrypt(peerPubkey: string, plaintext: string): Promise<string>;
  decrypt(peerPubkey: string, ciphertext: string): Promise<string>;
}

export interface EngineNip04LegacySigner {
  /** Read-only NIP-51 compatibility for historical ?iv= list content. */
  decrypt(peerPubkey: string, ciphertext: string): Promise<string>;
}

/** NIP-07/NIP-46-style signer capability injected by the host. */
export interface EngineSigner {
  signEvent(t: { kind: number; content: string; tags: string[][]; created_at: number }): Promise<NostrEvent>;
  /** Required for new private NIP-51 writes and private kind-10040 writes. */
  nip44?: EngineNip44Signer;
  /** Optional legacy NIP-04 decrypt-only compatibility; never used for new writes. */
  nip04?: EngineNip04LegacySigner;
}

export interface EngineWebOfTrustConfig {
  /** Platform-selected NIP-85 providers, normally from an admin-owned kind-10040 list. */
  platformProviders: Nip85ProviderReference[];
  /** User-selected NIP-85 providers from the logged-in account's kind-10040 list. */
  personalProviders?: Nip85ProviderReference[];
  /** Admin-controlled permission and combination policy. */
  adminPolicy: PlatformWebOfTrustPolicy;
  /** User's own personal WoT preference. */
  personalPreference?: PersonalWebOfTrustPreference;
}

export interface EngineCommunityRankingConfig {
  enabled: boolean;
  minVotes?: number;
  maxBoost?: number;
  maxPenalty?: number;
}

export interface EngineRuntime {
  privacyMode: boolean;
  autoIndex: boolean;
  disabledProviders: string[];
  languageFilter: string[];
  voteWithIdentity: boolean;
  /** Bounded, NIP-25 community signal applied after moderation and relevance ranking. */
  communityRanking?: EngineCommunityRankingConfig;
  userSigner?: EngineSigner;
  userPubkey?: string;
  /** Host supplies these from NIP-65 and its private relay policy. */
  userReadRelays?: string[];
  userWriteRelays?: string[];
  webOfTrust?: EngineWebOfTrustConfig;
  /** Optional author weights resolved by the host from the active WoT policy. */
  voteAuthorWeights?: ReadonlyMap<string, number>;
  /** Hard platform moderation; this always outranks personal WoT. */
  moderation?: ModerationSet;
}

export const DEFAULT_ENGINE_RUNTIME: EngineRuntime = {
  privacyMode: false,
  autoIndex: false,
  disabledProviders: [],
  languageFilter: [],
  voteWithIdentity: false,
  communityRanking: { enabled: true, minVotes: 3, maxBoost: 6, maxPenalty: 9 },
};

const EngineRuntimeContext = createContext<EngineRuntime>(DEFAULT_ENGINE_RUNTIME);

export interface EngineRuntimeProviderProps {
  runtime?: Partial<EngineRuntime>;
  children: ReactNode;
}

export function EngineRuntimeProvider({ runtime, children }: EngineRuntimeProviderProps) {
  const parent = useContext(EngineRuntimeContext);
  const value = useMemo<EngineRuntime>(() => ({ ...parent, ...runtime }), [parent, runtime]);
  return (
    <EngineRuntimeContext.Provider value={value}>
      {children}
    </EngineRuntimeContext.Provider>
  );
}

export function useEngineRuntime(): EngineRuntime {
  return useContext(EngineRuntimeContext);
}

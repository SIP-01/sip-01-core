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

/** NIP-07/NIP-46-style signer capability injected by the host. */
export interface EngineSigner {
  signEvent(t: { kind: number; content: string; tags: string[][]; created_at: number }): Promise<NostrEvent>;
  /** Required for private NIP-51 lists and private kind-10040 rows. */
  nip44?: EngineNip44Signer;
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

export interface EngineRuntime {
  privacyMode: boolean;
  autoIndex: boolean;
  disabledProviders: string[];
  languageFilter: string[];
  voteWithIdentity: boolean;
  userSigner?: EngineSigner;
  userPubkey?: string;
  /** Host supplies these from NIP-65 and its private relay policy. */
  userReadRelays?: string[];
  userWriteRelays?: string[];
  webOfTrust?: EngineWebOfTrustConfig;
  /** Hard platform moderation; this always outranks personal WoT. */
  moderation?: ModerationSet;
}

export const DEFAULT_ENGINE_RUNTIME: EngineRuntime = {
  privacyMode: false,
  autoIndex: false,
  disabledProviders: [],
  languageFilter: [],
  voteWithIdentity: false,
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

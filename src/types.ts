export type Status = 'idle' | 'running' | 'success' | 'error' | 'unsupported'

export interface AccountResult {
  accounts: unknown[]
  context?: Record<string, unknown>
  raw?: unknown
}

export interface DisconnectResult {
  disconnected: boolean
  method?: string
  context?: Record<string, unknown>
  raw?: unknown
}

export interface AdapterContext {
  cosmosChainIds: string[]
  eosChainId: string
  emit: (ecosystem: string, event: string, payload: unknown) => void
}

export interface WalletAdapter {
  id: string
  label: string
  eyebrow: string
  standard: string
  privacy: string
  method: string
  disconnectMethod?: string
  connect: (context: AdapterContext) => Promise<AccountResult>
  disconnect?: (context: AdapterContext) => Promise<DisconnectResult>
  detect: () => boolean
}

export interface Eip1193Provider {
  request(args: {
    method: string
    params?: unknown[] | object
  }): Promise<unknown>
  on?(event: string, listener: (...args: unknown[]) => void): void
}

export interface EventProvider extends Eip1193Provider {
  tronWeb?:
    | {
        ready?: boolean
        defaultAddress?: { base58?: string; hex?: string }
      }
    | false
}

export interface ImTokenBridge {
  callPromisifyAPI(apiName: string, payload?: unknown): Promise<unknown>
  tonconnect?: TonInjectedWallet
}

export interface TonInjectedWallet {
  connect(protocolVersion: number, message: unknown): Promise<unknown>
  restoreConnection(...params: unknown[]): Promise<unknown>
  disconnect?(...params: unknown[]): Promise<unknown>
  listen(callback: (event: unknown) => void): () => void
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider
    tron?: EventProvider
    tronLink?: EventProvider
    tronWeb?: {
      ready?: boolean
      defaultAddress?: { base58?: string; hex?: string }
    }
    bitcoin?: Eip1193Provider
    unisat?: {
      requestAccounts(): Promise<string[]>
      getAccounts(): Promise<string[]>
      on?(event: string, listener: (...args: unknown[]) => void): void
    }
    keplr?: CosmosProvider
    leap?: CosmosProvider
    cosmos?: CosmosProvider
    scatter?: ScatterProvider
    imToken?: ImTokenBridge
    injectedWeb3?: Record<string, unknown>
    tonkeeper?: { tonconnect?: TonInjectedWallet }
  }
}

export interface CosmosKey {
  name?: string
  algo?: string
  bech32Address: string
  pubKey?: Uint8Array
  address?: Uint8Array
  [key: string]: unknown
}

export interface CosmosProvider {
  enable(chainIds: string | string[]): Promise<void>
  getKey(chainId: string): Promise<CosmosKey>
  disable?(chainIds?: string | string[]): Promise<void>
  disconnect?(chainIds?: string | string[]): Promise<unknown>
}

export interface ScatterProvider {
  connect(appName: string): Promise<boolean>
  getIdentity(requiredFields: {
    accounts: Array<{ blockchain: 'eos'; chainId: string }>
  }): Promise<{ accounts?: unknown[]; [key: string]: unknown }>
  forgetIdentity?(requiredFields?: unknown): Promise<unknown>
}

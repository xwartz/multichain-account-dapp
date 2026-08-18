import type {
  AccountResult,
  AdapterContext,
  CosmosProvider,
  DisconnectResult,
  WalletAdapter,
} from './types'

const APP_NAME = 'Wallet account lab'

let tezosClient: import('@airgap/beacon-sdk').DAppClient | undefined
let tonConnect: import('@tonconnect/ui').TonConnectUI | undefined

function listen(
  provider: {
    on?: (event: string, listener: (...args: unknown[]) => void) => void
  },
  ecosystem: string,
  event: string,
  context: AdapterContext
) {
  provider.on?.(event, (...payload) =>
    context.emit(ecosystem, event, payload.length === 1 ? payload[0] : payload)
  )
}

async function connectEvm(context: AdapterContext): Promise<AccountResult> {
  const provider = window.ethereum
  if (!provider) throw new Error('未检测到 EIP-1193 provider')

  listen(provider, 'evm', 'accountsChanged', context)
  listen(provider, 'evm', 'chainChanged', context)
  const accounts = await provider.request({ method: 'eth_requestAccounts' })
  const chainId = await provider.request({ method: 'eth_chainId' })
  return {
    accounts: Array.isArray(accounts) ? accounts : [],
    context: { chainId },
    raw: accounts,
  }
}

async function connectTron(context: AdapterContext): Promise<AccountResult> {
  const provider = window.tron ?? window.tronLink

  if (provider) {
    listen(provider, 'tron', 'accountsChanged', context)
    listen(provider, 'tron', 'chainChanged', context)

    let accounts: unknown
    let method = 'eth_requestAccounts'
    try {
      accounts = await provider.request({ method: 'eth_requestAccounts' })
    } catch {
      method = 'tron_requestAccounts'
      accounts = await provider.request({ method: 'tron_requestAccounts' })
    }

    const address = provider.tronWeb && provider.tronWeb.defaultAddress?.base58
    return {
      accounts: Array.isArray(accounts) ? accounts : address ? [address] : [],
      context: {
        provider: window.tron ? 'window.tron' : 'window.tronLink',
        method,
      },
      raw: accounts,
    }
  }

  const legacyAddress = window.tronWeb?.defaultAddress?.base58
  if (legacyAddress) {
    return {
      accounts: [legacyAddress],
      context: {
        provider: 'window.tronWeb',
        warning: 'Legacy fallback: 地址可能在显式授权前已注入',
      },
    }
  }

  throw new Error('未检测到 TRON provider')
}

async function connectBitcoin(context: AdapterContext): Promise<AccountResult> {
  if (window.bitcoin) {
    listen(window.bitcoin, 'bitcoin', 'accountsChanged', context)
    const raw = await window.bitcoin.request({ method: 'btc_requestAccounts' })
    return {
      accounts: Array.isArray(raw) ? raw : [],
      context: { provider: 'window.bitcoin', method: 'btc_requestAccounts' },
      raw,
    }
  }

  if (window.unisat) {
    listen(
      window.unisat as {
        on?: (event: string, listener: (...args: unknown[]) => void) => void
      },
      'bitcoin',
      'accountsChanged',
      context
    )
    const accounts = await window.unisat.requestAccounts()
    return { accounts, context: { provider: 'window.unisat' }, raw: accounts }
  }

  const { default: Wallet, AddressPurpose } = await import('sats-connect')
  const response = await Wallet.request('getAccounts', {
    purposes: [AddressPurpose.Payment, AddressPurpose.Ordinals],
    message: 'Wallet account lab requests the selected Bitcoin addresses.',
  })
  if (response.status === 'error') throw new Error(response.error.message)
  const addresses = response.result ?? []
  return {
    accounts: Array.isArray(addresses) ? addresses : [],
    context: { provider: 'Sats Connect' },
    raw: response,
  }
}

function getCosmosProvider(): { name: string; provider: CosmosProvider } {
  if (window.keplr) return { name: 'Keplr', provider: window.keplr }
  if (window.leap) return { name: 'Leap', provider: window.leap }
  if (window.cosmos)
    return { name: 'imToken CosmosKit provider', provider: window.cosmos }
  throw new Error('未检测到 Keplr、Leap 或 imToken Cosmos provider')
}

async function connectCosmos(context: AdapterContext): Promise<AccountResult> {
  if (context.cosmosChainIds.length === 0)
    throw new Error('至少填写一个 Cosmos chain ID')
  const { name, provider } = getCosmosProvider()
  await provider.enable(context.cosmosChainIds)

  // All-of assertion: enable resolved means getKey must succeed for every requested chain.
  const keys = await Promise.all(
    context.cosmosChainIds.map(async (chainId) => ({
      chainId,
      key: await provider.getKey(chainId),
    }))
  )
  return {
    accounts: keys.map(({ chainId, key }) => ({ chainId, ...key })),
    context: { provider: name, allRequestedChainsSatisfied: true },
    raw: keys,
  }
}

async function connectEos(context: AdapterContext): Promise<AccountResult> {
  if (!window.scatter) throw new Error('未检测到 Scatter-compatible provider')
  const connected = await window.scatter.connect(APP_NAME)
  if (!connected) throw new Error('Scatter connect 未建立连接')
  const identity = await window.scatter.getIdentity({
    accounts: [{ blockchain: 'eos', chainId: context.eosChainId }],
  })
  const accounts = (identity.accounts ?? []).filter(
    (account) =>
      typeof account === 'object' &&
      account !== null &&
      (account as { blockchain?: string }).blockchain === 'eos'
  )
  return {
    accounts,
    context: { provider: 'Scatter identity', chainId: context.eosChainId },
    raw: identity,
  }
}

async function connectTezos(context: AdapterContext): Promise<AccountResult> {
  if (window.imToken) {
    const accounts = await window.imToken.callPromisifyAPI('tezos.getAccounts')
    return {
      accounts: Array.isArray(accounts) ? accounts : [],
      context: {
        provider: 'imToken tezos.getAccounts',
        standard: 'provider-specific',
        note: 'imToken 当前走链上下文专有 API；Beacon 仅在独立浏览器钱包环境可用',
      },
      raw: accounts,
    }
  }

  const { BeaconEvent, DAppClient, NetworkType } = await import(
    '@airgap/beacon-sdk'
  )
  tezosClient ??= new DAppClient({
    name: APP_NAME,
    network: { type: NetworkType.MAINNET },
  })
  tezosClient.subscribeToEvent(
    BeaconEvent.ACTIVE_ACCOUNT_SET,
    (account: unknown) => {
      context.emit('tezos', 'ACTIVE_ACCOUNT_SET', account)
    }
  )

  const active = await tezosClient.getActiveAccount()
  const permission = active ?? (await tezosClient.requestPermissions())
  const account = await tezosClient.getActiveAccount()
  return {
    accounts: account
      ? [account]
      : 'address' in permission
      ? [{ address: permission.address }]
      : [],
    context: { provider: 'Beacon DAppClient', network: 'mainnet' },
    raw: permission,
  }
}

async function connectNervos(): Promise<AccountResult> {
  if (!window.imToken) {
    throw new Error(
      'Nervos 没有通用注入标准，本项仅在 imToken DApp Browser 中提供最小暴露验证'
    )
  }
  const raw = await window.imToken.callPromisifyAPI('nervos.getAccounts')
  return {
    accounts: Array.isArray(raw) ? raw : [],
    context: {
      provider: 'imToken proprietary API',
      caveat: '非社区标准，只应返回当前或已授权 CKB 地址',
    },
    raw,
  }
}

async function connectSubstrate(
  context: AdapterContext
): Promise<AccountResult> {
  const { web3Accounts, web3Enable } = await import('@polkadot/extension-dapp')
  const extensions = await web3Enable(APP_NAME)
  if (extensions.length === 0)
    throw new Error('没有已授权的 Substrate extension')

  const accounts = await web3Accounts()
  context.emit('substrate', 'visibleAccounts', accounts)
  return {
    accounts,
    context: {
      providers: extensions.map((extension) => extension.name),
      semantics: 'user-visible multi-account set',
    },
    raw: accounts,
  }
}

async function connectTon(context: AdapterContext): Promise<AccountResult> {
  const { toUserFriendlyAddress } = await import('@tonconnect/ui')
  const injected = window.tonkeeper?.tonconnect ?? window.imToken?.tonconnect

  if (injected) {
    injected.listen((event) => context.emit('ton', 'injectedEvent', event))
    const restored = (await injected.restoreConnection()) as {
      account?: {
        address?: string
        chain?: string
        publicKey?: string
        walletStateInit?: string
      }
    } | null

    if (restored?.account?.address) {
      return {
        accounts: [{
          address: toUserFriendlyAddress(restored.account.address),
          rawAddress: restored.account.address,
          chain: restored.account.chain,
          publicKey: restored.account.publicKey,
          walletStateInit: restored.account.walletStateInit,
        }],
        context: {
          provider: 'imToken injected TonConnect bridge',
          path: 'restoreConnection',
        },
        raw: restored,
      }
    }

    const connected = (await injected.connect(2, {
      manifestUrl: new URL('/tonconnect-manifest.json', window.location.origin).toString(),
      items: [{ name: 'ton_addr' }],
    })) as {
      account?: {
        address?: string
        chain?: string
        publicKey?: string
        walletStateInit?: string
      }
    }

    if (!connected?.account?.address) {
      throw new Error('TON Connect 注入桥未返回已连接账户')
    }

    return {
      accounts: [{
        address: toUserFriendlyAddress(connected.account.address),
        rawAddress: connected.account.address,
        chain: connected.account.chain,
        publicKey: connected.account.publicKey,
        walletStateInit: connected.account.walletStateInit,
      }],
      context: {
        provider: 'imToken injected TonConnect bridge',
        path: 'connect',
      },
      raw: connected,
    }
  }

  const { TonConnectUI } = await import('@tonconnect/ui')
  tonConnect ??= new TonConnectUI({
    manifestUrl: new URL(
      '/tonconnect-manifest.json',
      window.location.origin
    ).toString(),
  })
  tonConnect.onStatusChange((wallet) =>
    context.emit('ton', 'statusChange', wallet)
  )
  await tonConnect.connectionRestored
  if (!tonConnect.connected) {
    await new Promise<void>((resolve, reject) => {
      const unsubscribeStatus = tonConnect?.onStatusChange(
        (wallet) => {
          if (!wallet) return
          unsubscribeStatus?.()
          unsubscribeModal?.()
          resolve()
        },
        (error) => {
          unsubscribeStatus?.()
          unsubscribeModal?.()
          reject(error)
        }
      )
      const unsubscribeModal = tonConnect?.onModalStateChange((modal) => {
        if (
          modal.status === 'closed' &&
          modal.closeReason === 'action-cancelled'
        ) {
          unsubscribeStatus?.()
          unsubscribeModal?.()
          reject(new Error('用户关闭了 TON 钱包选择器'))
        }
      })
      tonConnect?.openModal().catch(reject)
    })
  }
  if (!tonConnect.account)
    throw new Error(
      'TON Connect 尚未返回已连接账户，请在钱包选择器中完成连接后重试'
    )
  return {
    accounts: [
      {
        address: toUserFriendlyAddress(tonConnect.account.address),
        rawAddress: tonConnect.account.address,
        chain: tonConnect.account.chain,
        walletStateInit: tonConnect.account.walletStateInit,
        publicKey: tonConnect.account.publicKey,
      },
    ],
    context: {
      provider: 'TON Connect session',
      wallet: tonConnect.wallet?.device.appName,
    },
    raw: tonConnect.wallet,
  }
}

async function disconnectEvm(): Promise<DisconnectResult> {
  const provider = window.ethereum
  if (!provider) throw new Error('未检测到 EIP-1193 provider')

  const raw = await provider.request({
    method: 'wallet_revokePermissions',
    params: [{ eth_accounts: {} }],
  })
  return {
    disconnected: true,
    method: 'wallet_revokePermissions',
    context: { standard: 'EIP-2255' },
    raw,
  }
}

async function disconnectTron(): Promise<DisconnectResult> {
  const provider = window.tron ?? window.tronLink
  if (!provider) {
    throw new Error('Legacy tronWeb 无标准 disconnect API，需在钱包内撤销站点授权')
  }

  for (const method of ['tron_disconnect', 'wallet_revokePermissions'] as const) {
    try {
      const raw = await provider.request({
        method,
        params: method === 'wallet_revokePermissions' ? [{ eth_accounts: {} }] : [],
      })
      return { disconnected: true, method, raw }
    } catch {
      // try next method
    }
  }

  throw new Error('TRON provider 未实现 tron_disconnect / wallet_revokePermissions')
}

async function disconnectBitcoin(): Promise<DisconnectResult> {
  throw new Error('Bitcoin 生态无统一 disconnect 标准，需在钱包内撤销站点授权')
}

async function disconnectCosmos(context: AdapterContext): Promise<DisconnectResult> {
  const { name, provider } = getCosmosProvider()

  if (provider.disable) {
    await provider.disable(context.cosmosChainIds)
    return {
      disconnected: true,
      method: 'disable(chainIds)',
      context: { provider: name },
    }
  }

  if (provider.disconnect) {
    const raw = await provider.disconnect(context.cosmosChainIds)
    return {
      disconnected: true,
      method: 'disconnect(chainIds)',
      context: {
        provider: name,
        note: name.includes('imToken') ? 'imToken 当前 disconnect 可能为 noop' : undefined,
      },
      raw,
    }
  }

  throw new Error('Cosmos provider 未暴露 disable / disconnect')
}

async function disconnectEos(): Promise<DisconnectResult> {
  if (!window.scatter?.forgetIdentity) {
    throw new Error('未检测到 Scatter forgetIdentity')
  }
  const raw = await window.scatter.forgetIdentity()
  return {
    disconnected: true,
    method: 'scatter.forgetIdentity',
    raw,
  }
}

async function disconnectTezos(): Promise<DisconnectResult> {
  if (window.imToken) {
    throw new Error('imToken tezos.getAccounts 无对应 disconnect API')
  }

  if (!tezosClient) {
    throw new Error('尚未建立 Beacon 连接')
  }

  await tezosClient.clearActiveAccount()
  tezosClient = undefined
  return {
    disconnected: true,
    method: 'DAppClient.clearActiveAccount',
    context: { provider: 'Beacon DAppClient' },
  }
}

async function disconnectNervos(): Promise<DisconnectResult> {
  throw new Error('Nervos 无 disconnect 标准，需在钱包内撤销站点授权')
}

async function disconnectSubstrate(): Promise<DisconnectResult> {
  throw new Error('polkadot.js extension 无 DApp 侧 revoke API，需在扩展管理页撤销')
}

async function disconnectTon(): Promise<DisconnectResult> {
  const injected = window.tonkeeper?.tonconnect ?? window.imToken?.tonconnect

  if (injected?.disconnect) {
    const raw = await injected.disconnect()
    return {
      disconnected: true,
      method: 'injected.disconnect',
      context: { provider: 'imToken injected TonConnect bridge' },
      raw,
    }
  }

  if (tonConnect?.connected) {
    await tonConnect.disconnect()
    return {
      disconnected: true,
      method: 'TonConnectUI.disconnect',
      context: { provider: 'TON Connect session' },
    }
  }

  throw new Error('无活跃 TON Connect session')
}

export const adapters: WalletAdapter[] = [
  {
    id: 'evm',
    label: 'EVM',
    eyebrow: 'EIP-1102 / EIP-1193',
    standard: 'eth_requestAccounts',
    privacy:
      '只读取站点已获授权的账户，并监听 accountsChanged 与 chainChanged。',
    method: 'window.ethereum.request',
    detect: () => Boolean(window.ethereum),
    connect: connectEvm,
    disconnectMethod: 'wallet_revokePermissions',
    disconnect: disconnectEvm,
  },
  {
    id: 'tron',
    label: 'TRON',
    eyebrow: 'TIP-1102 / TronLink',
    standard: 'eth_requestAccounts',
    privacy:
      '优先使用新 window.tron provider。tronWeb.defaultAddress 仅作为 legacy 兼容探针。',
    method: 'window.tron.request',
    detect: () => Boolean(window.tron || window.tronLink || window.tronWeb),
    connect: connectTron,
    disconnectMethod: 'tron_disconnect / wallet_revokePermissions',
    disconnect: disconnectTron,
  },
  {
    id: 'bitcoin',
    label: 'Bitcoin',
    eyebrow: 'WBIP / UniSat',
    standard: 'selected addresses',
    privacy: '返回当前或用户按 purpose 分享的地址，不枚举钱包内全部 BTC 账户。',
    method: 'btc_requestAccounts / getAccounts',
    detect: () => true,
    connect: connectBitcoin,
    disconnectMethod: '无统一标准',
    disconnect: disconnectBitcoin,
  },
  {
    id: 'cosmos',
    label: 'Cosmos',
    eyebrow: 'Keplr / Leap',
    standard: 'enable → getKey',
    privacy:
      '一次请求所有 chain IDs；enable 成功后逐链 getKey，任何一链失败即整体失败。',
    method: 'enable(chainIds) + getKey(chainId)',
    detect: () => Boolean(window.keplr || window.leap || window.cosmos),
    connect: connectCosmos,
    disconnectMethod: 'disable / disconnect(chainIds)',
    disconnect: disconnectCosmos,
  },
  {
    id: 'eos',
    label: 'EOS',
    eyebrow: 'Scatter identity',
    standard: 'requiredFields.accounts',
    privacy: '身份请求只携带 DApp 明确需要的 blockchain 与 chainId。',
    method: 'scatter.getIdentity',
    detect: () => Boolean(window.scatter),
    connect: connectEos,
    disconnectMethod: 'scatter.forgetIdentity',
    disconnect: disconnectEos,
  },
  {
    id: 'tezos',
    label: 'Tezos',
    eyebrow: 'Beacon',
    standard: 'active account permission',
    privacy:
      'imToken 内走 tezos.getAccounts；独立浏览器环境走 Beacon requestPermissions。',
    method: 'tezos.getAccounts / DAppClient.requestPermissions',
    detect: () => Boolean(window.imToken || true),
    connect: connectTezos,
    disconnectMethod: 'DAppClient.clearActiveAccount',
    disconnect: disconnectTezos,
  },
  {
    id: 'nervos',
    label: 'Nervos',
    eyebrow: 'Provider-specific',
    standard: 'minimum exposure',
    privacy: '当前无成熟跨钱包账户标准，仅验证 imToken 当前/授权账户最小暴露。',
    method: 'imToken nervos.getAccounts',
    detect: () => Boolean(window.imToken),
    connect: connectNervos,
    disconnectMethod: '无统一标准',
    disconnect: disconnectNervos,
  },
  {
    id: 'substrate',
    label: 'Polkadot / Kusama',
    eyebrow: 'polkadot.js extension',
    standard: 'visible accounts',
    privacy: '多账户是生态常态，但返回的是用户明确授权为 visible 的集合。',
    method: 'web3Enable → web3Accounts',
    detect: () => Boolean(window.injectedWeb3),
    connect: connectSubstrate,
    disconnectMethod: '无 DApp 侧 API',
    disconnect: disconnectSubstrate,
  },
  {
    id: 'ton',
    label: 'TON',
    eyebrow: 'TON Connect',
    standard: 'session account',
    privacy:
      '账户来自已恢复或新建立的 TON Connect session，不读取钱包内部账户列表。',
    method: 'TonConnect injected bridge / TonConnectUI session',
    detect: () => Boolean(window.tonkeeper?.tonconnect || window.imToken?.tonconnect || true),
    connect: connectTon,
    disconnectMethod: 'TonConnect.disconnect',
    disconnect: disconnectTon,
  },
]

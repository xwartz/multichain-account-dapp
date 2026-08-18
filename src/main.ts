import './styles.css'
import { adapters } from './adapters'
import { errorDetails, toDisplayValue } from './serialize'
import { withTimeout } from './timeout'
import type { AdapterContext, Status, WalletAdapter } from './types'

const REQUEST_TIMEOUT_MS = 60_000

interface CardState {
  status: Status
  output?: unknown
  pendingAction?: 'connect' | 'disconnect'
}

const state = new Map<string, CardState>(
  adapters.map((adapter) => [adapter.id, { status: 'idle' }])
)
const events: Array<{
  time: string
  ecosystem: string
  event: string
  payload: unknown
}> = []

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('App root not found')

app.innerHTML = `
  <header class="masthead">
    <div class="brand-mark" aria-hidden="true">WA</div>
    <div>
      <p class="kicker">Cross-chain provider research</p>
      <h1>Wallet account lab</h1>
      <p class="lede">同一页面验证各链的账户授权入口、返回集合与变更事件。所有连接都由按钮触发，不在首屏静默读取账户。</p>
    </div>
    <div class="environment" aria-label="运行环境">
      <span class="live-dot"></span>
      <span>${
        navigator.userAgent.includes('Token')
          ? 'imToken WebView'
          : 'Browser runtime'
      }</span>
      <code>${location.host || 'local file'}</code>
    </div>
  </header>

  <main id="main-content">
    <section class="controls" aria-labelledby="request-settings-title">
      <div>
        <p class="section-index">00 / Request scope</p>
        <h2 id="request-settings-title">请求范围</h2>
      </div>
      <label>
        <span>Cosmos chain IDs</span>
        <input id="cosmos-chain-ids" value="cosmoshub-4, osmosis-1" autocomplete="off" spellcheck="false" />
      </label>
      <label>
        <span>EOS chain ID</span>
        <input id="eos-chain-id" value="aca376f206b8fc25a6ed44dbdc66547c36c6c33e3a119ffbeaef943642f0e906" autocomplete="off" spellcheck="false" />
      </label>
      <button class="secondary-button" id="clear-log" type="button">清空事件</button>
    </section>

    <section class="matrix" aria-labelledby="matrix-title">
      <div class="section-heading">
        <div>
          <p class="section-index">01 / Connectors</p>
          <h2 id="matrix-title">逐链账户连接</h2>
        </div>
        <p>Ready 表示当前运行时具备调用入口，不代表站点已获账户授权。</p>
      </div>
      <div class="adapter-list" id="adapter-list"></div>
    </section>

    <section class="event-panel" aria-labelledby="event-title">
      <div class="section-heading">
        <div>
          <p class="section-index">02 / Runtime trace</p>
          <h2 id="event-title">账户与网络事件</h2>
        </div>
        <span class="event-count" id="event-count">0 events</span>
      </div>
      <ol id="event-log" class="event-log"><li class="empty-log">连接后，accountsChanged、chainChanged 与 session 状态会出现在这里。</li></ol>
    </section>
  </main>

  <footer>
    <span>Research fixture · no signing or transaction requests</span>
  </footer>
`

const listElement = document.querySelector<HTMLDivElement>('#adapter-list')
if (!listElement) throw new Error('Adapter list not found')
const list = listElement

function renderCard(adapter: WalletAdapter): string {
  const cardState = state.get(adapter.id) ?? { status: 'idle' }
  const detected = adapter.detect()
  const status =
    cardState.status === 'idle' && !detected ? 'unsupported' : cardState.status
  const isRunning = cardState.status === 'running'
  const canDisconnect =
    Boolean(adapter.disconnect) && status === 'success' && !isRunning
  const statusLabel: Record<Status, string> = {
    idle: 'Ready',
    running: 'Waiting',
    success: 'Connected',
    error: 'Rejected',
    unsupported: 'Provider not detected',
  }
  const output =
    cardState.output === undefined
      ? '<p class="output-placeholder">等待用户发起连接</p>'
      : `<pre>${escapeHtml(
          JSON.stringify(toDisplayValue(cardState.output), null, 2)
        )}</pre>`
  const disconnectHint = adapter.disconnectMethod
    ? `<code>${adapter.disconnectMethod}</code>`
    : ''

  return `
    <article class="adapter-card" data-adapter="${
      adapter.id
    }" data-status="${status}">
      <div class="adapter-number">${String(
        adapters.indexOf(adapter) + 1
      ).padStart(2, '0')}</div>
      <div class="adapter-summary">
        <p class="eyebrow">${adapter.eyebrow}</p>
        <h3>${adapter.label}</h3>
        <p class="privacy">${adapter.privacy}</p>
        <div class="method"><span>${adapter.standard}</span><code>${
    adapter.method
  }</code></div>
        ${
          adapter.disconnectMethod
            ? `<div class="method disconnect-method"><span>disconnect</span>${disconnectHint}</div>`
            : ''
        }
      </div>
      <div class="adapter-action">
        <span class="status"><i></i>${statusLabel[status]}</span>
        <div class="adapter-buttons">
          <button type="button" data-connect="${adapter.id}" ${
    isRunning ? 'disabled' : ''
  }>
            ${
              isRunning && cardState.pendingAction === 'connect'
                ? '等待钱包…'
                : '连接并获取'
            }
          </button>
          <button
            type="button"
            class="secondary-button disconnect-button"
            data-disconnect="${adapter.id}"
            ${canDisconnect ? '' : 'disabled'}
          >
            ${
              isRunning && cardState.pendingAction === 'disconnect'
                ? '断开中…'
                : '断开连接'
            }
          </button>
        </div>
      </div>
      <div class="adapter-output" aria-live="polite">${output}</div>
    </article>
  `
}

function renderCards(): void {
  list.innerHTML = adapters.map(renderCard).join('')
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      }[character] ?? character)
  )
}

function context(): AdapterContext {
  const cosmosInput =
    document.querySelector<HTMLInputElement>('#cosmos-chain-ids')
  const eosInput = document.querySelector<HTMLInputElement>('#eos-chain-id')
  return {
    cosmosChainIds: (cosmosInput?.value ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    eosChainId: eosInput?.value.trim() ?? '',
    emit,
  }
}

function emit(ecosystem: string, event: string, payload: unknown): void {
  events.unshift({
    time: new Date().toISOString(),
    ecosystem,
    event,
    payload: toDisplayValue(payload),
  })
  if (events.length > 100) events.length = 100
  renderEvents()
}

function renderEvents(): void {
  const log = document.querySelector<HTMLOListElement>('#event-log')
  const count = document.querySelector<HTMLSpanElement>('#event-count')
  if (!log || !count) return
  count.textContent = `${events.length} event${events.length === 1 ? '' : 's'}`
  log.innerHTML =
    events.length === 0
      ? '<li class="empty-log">连接后，accountsChanged、chainChanged 与 session 状态会出现在这里。</li>'
      : events
          .map(
            (entry) => `
        <li>
          <time>${entry.time.slice(11, 23)}</time>
          <strong>${escapeHtml(entry.ecosystem)} · ${escapeHtml(
              entry.event
            )}</strong>
          <code>${escapeHtml(JSON.stringify(entry.payload))}</code>
        </li>
      `
          )
          .join('')
}

async function run(adapter: WalletAdapter): Promise<void> {
  state.set(adapter.id, { status: 'running', pendingAction: 'connect' })
  renderCards()
  emit(adapter.id, 'requestStarted', { method: adapter.method })
  try {
    const result = await withTimeout(
      adapter.connect(context()),
      REQUEST_TIMEOUT_MS,
      adapter.label,
    )
    state.set(adapter.id, { status: 'success', output: result })
    emit(adapter.id, 'requestResolved', result)
  } catch (error) {
    const details = errorDetails(error)
    state.set(adapter.id, { status: 'error', output: details })
    emit(adapter.id, 'requestRejected', details)
  }
  renderCards()
}

async function runDisconnect(adapter: WalletAdapter): Promise<void> {
  if (!adapter.disconnect) return

  state.set(adapter.id, {
    status: 'running',
    pendingAction: 'disconnect',
    output: state.get(adapter.id)?.output,
  })
  renderCards()
  emit(adapter.id, 'disconnectStarted', { method: adapter.disconnectMethod })
  try {
    const result = await withTimeout(
      adapter.disconnect(context()),
      REQUEST_TIMEOUT_MS,
      adapter.label,
    )
    state.set(adapter.id, { status: 'idle', output: result })
    emit(adapter.id, 'disconnectResolved', result)
  } catch (error) {
    const details = errorDetails(error)
    state.set(adapter.id, {
      status: 'error',
      output: details,
    })
    emit(adapter.id, 'disconnectRejected', details)
  }
  renderCards()
}

list.addEventListener('click', (event) => {
  const connectTarget = (event.target as HTMLElement).closest<HTMLButtonElement>(
    '[data-connect]'
  )
  if (connectTarget) {
    const adapter = adapters.find(
      (candidate) => candidate.id === connectTarget.dataset.connect
    )
    if (adapter) void run(adapter)
    return
  }

  const disconnectTarget = (event.target as HTMLElement).closest<HTMLButtonElement>(
    '[data-disconnect]'
  )
  if (!disconnectTarget) return
  const adapter = adapters.find(
    (candidate) => candidate.id === disconnectTarget.dataset.disconnect
  )
  if (adapter) void runDisconnect(adapter)
})

document.querySelector('#clear-log')?.addEventListener('click', () => {
  events.length = 0
  renderEvents()
})

renderCards()

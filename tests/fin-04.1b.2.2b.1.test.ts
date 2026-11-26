import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Store } from '../src/lib/store'

try {
  GlobalRegistrator.register()
} catch {
  // já registrado
}

const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { StoreProvider, useStore } = await import('../src/lib/store')
const { setNetwork } = await import('../src/lib/network')
const { gatewayConfigFor, resolveInstitutionalGatewayContext, settingsIdentityRepository } = await import('../src/lib/gateway-config')
const { createCheckoutToken, isCheckoutTokenValid, hashCheckoutToken, requiresGatewayVerification } = await import('../src/lib/gateway-charge')

let captured: Store | null = null
function Capture(): null {
  const store = useStore()
  React.useEffect(() => {
    captured = store
  })
  return null
}
function renderStore(): { store: () => Store; unmount: () => void } {
  captured = null
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  React.act(() => root.render(React.createElement(StoreProvider, null, React.createElement(Capture))))
  return {
    store: () => captured!,
    unmount: () => {
      React.act(() => root.unmount())
      container.remove()
      captured = null
    },
  }
}
function commit<T>(store: () => Store, op: (s: Store) => T): T {
  let out: T = undefined as unknown as T
  React.act(() => {
    out = op(store())
  })
  return out
}

const BENEFICIARY = '0x000000000000000000000000000000000000000a'
const HASH = '0x' + 'ab'.repeat(32)
const PAYER = '0x' + 'cd'.repeat(20)

let skuSeq = 0
function saleAccount(store: () => Store): { accountId: string; saleId: string } {
  const sku = `P${++skuSeq}`
  const pid = commit(store, (s) => s.addProduct({ sku, name: sku, category: 'G', unit: 'un', cost: 1, price: 4, stock: 100, minStock: 0 }))
  const sale = commit(store, (s) => s.recordSale({ method: 'usdc', items: [{ productId: pid, qty: 10, price: 4 }] }))
  if (!sale.ok || !sale.accountId) throw new Error('sale')
  return { accountId: sale.accountId, saleId: sale.saleId }
}

beforeEach(() => {
  localStorage.clear()
  setNetwork('mainnet')
})
afterEach(() => {
  localStorage.clear()
})

describe('FIN-04.1B.2.2B.1 — Treasury identity resolution', () => {
  test('resolveInstitutionalGatewayContext usa identidade autorizada (treasuryDepositors)', () => {
    const repo = settingsIdentityRepository({ treasuryDepositors: { testnet: BENEFICIARY }, treasuryRecipients: { testnet: gatewayConfigFor('testnet').gatewayWallet } })
    const res = resolveInstitutionalGatewayContext('local', 'testnet', repo)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.context.depositor).toBe(BENEFICIARY)
    expect(res.context.gatewayWallet.toLowerCase()).toBe(gatewayConfigFor('testnet').gatewayWallet.toLowerCase())
    expect(res.context.authorizationId).toBe('settings:testnet')
  })

  test('sem identidade autorizada → treasury_identity_unresolved (nunca GatewayWallet como depositor)', () => {
    const repo = settingsIdentityRepository({ treasuryRecipients: { testnet: gatewayConfigFor('testnet').gatewayWallet } })
    const res = resolveInstitutionalGatewayContext('local', 'testnet', repo)
    expect(res).toEqual({ ok: false, reason: 'treasury_identity_unresolved' })
  })
})

describe('FIN-04.1B.2.2B.1 — createGatewayCharge atômico', () => {
  test('cria intenção + reserva para obrigação existente (parcial: 15 de 40)', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const { accountId } = saleAccount(store)
    const r = commit(store, (s) => s.createGatewayCharge({ accountId, amount: 15, amountDecimal: '15', usdcMinor: '15000000', currency: 'USDC', expiresAt: '2099-01-01T00:00:00.000Z', idempotencyKey: 'k1', checkoutToken: 'tok' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(store().data.paymentIntents.find((i) => i.intentId === r.intentId)!.usdcMinor).toBe('15000000')
    expect(store().data.paymentReservations.find((x) => x.intentId === r.intentId)!.amountMinor).toBe('15000000')
    unmount()
  })

  test('criação avulsa é atômica (obrigação + intenção + reserva, sem órfãos)', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const r = commit(store, (s) => s.createGatewayCharge({ description: 'Cobrança avulsa', amount: 15, amountDecimal: '15', usdcMinor: '15000000', currency: 'USDC', expiresAt: '2099-01-01T00:00:00.000Z' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const intent = store().data.paymentIntents.find((i) => i.intentId === r.intentId)!
    const account = store().data.accounts.find((a) => a.id === intent.accountId)!
    expect(account.description).toBe('Cobrança avulsa')
    expect(account.currency).toBe('USDC')
    expect(store().data.paymentReservations.find((x) => x.intentId === r.intentId)).toBeTruthy()
    unmount()
  })

  test('rejeita cobrança acima do saldo disponível (sem conta órfã)', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const { accountId } = saleAccount(store) // 40 USDC
    const before = store().data.accounts.length
    const r = commit(store, (s) => s.createGatewayCharge({ accountId, amount: 50, amountDecimal: '50', usdcMinor: '50000000', currency: 'USDC', expiresAt: '2099-01-01T00:00:00.000Z' }))
    expect(r.ok).toBe(false)
    expect(store().data.accounts).toHaveLength(before) // nenhuma conta órfã
    unmount()
  })

  test('idempotência: mesma chave retorna a intenção existente (sem duplicar)', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const { accountId } = saleAccount(store)
    const a = commit(store, (s) => s.createGatewayCharge({ accountId, amount: 15, amountDecimal: '15', usdcMinor: '15000000', currency: 'USDC', expiresAt: '2099-01-01T00:00:00.000Z', idempotencyKey: 'k1' }))
    const b = commit(store, (s) => s.createGatewayCharge({ accountId, amount: 15, amountDecimal: '15', usdcMinor: '15000000', currency: 'USDC', expiresAt: '2099-01-01T00:00:00.000Z', idempotencyKey: 'k1' }))
    if (!a.ok || !b.ok) throw new Error('expected ok')
    expect(b.intentId).toBe(a.intentId)
    expect(store().data.paymentIntents).toHaveLength(1)
    unmount()
  })
})

describe('FIN-04.1B.2.2B.1 — token criptográfico e proteção do watcher', () => {
  test('createCheckoutToken (frontend) gera token CSPRNG válido com hash SHA-256', () => {
    const a = createCheckoutToken()
    const b = createCheckoutToken()
    expect(isCheckoutTokenValid(a.token)).toBe(true)
    expect(a.token).not.toBe(b.token)
    expect(a.tokenHash).toHaveLength(64)
    expect(hashCheckoutToken(a.token)).toBe(a.tokenHash)
    expect(hashCheckoutToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  test('requiresGatewayVerification detecta cobranças antigas para GatewayWallet sem paymentRail', () => {
    const gw = gatewayConfigFor('testnet').gatewayWallet
    expect(requiresGatewayVerification({ paymentRail: 'circle_gateway', recipient: BENEFICIARY } as never)).toBe(true)
    expect(requiresGatewayVerification({ recipient: gw } as never)).toBe(true) // antiga, sem paymentRail
    expect(requiresGatewayVerification({ paymentRail: 'legacy_transfer', recipient: BENEFICIARY } as never)).toBe(false)
  })

  test('receiveRequest não liquida cobrança antiga apontando para GatewayWallet', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const { accountId } = saleAccount(store)
    const gw = gatewayConfigFor('mainnet').gatewayWallet
    // Cobrança antiga sem paymentRail, apontando para o GatewayWallet.
    const reqId = commit(store, (s) => s.addRequest({ accountId, description: 'x', fiatAmount: 25, amount: '25000000', chainKey: 'Arc', chainId: 5042, recipient: gw, fromBlock: '0' }))
    commit(store, (s) => s.receiveRequest(reqId, HASH, PAYER, 'https://x'))
    expect(store().data.requests.find((r) => r.id === reqId)!.status).toBe('open')
    expect(store().data.accounts.find((a) => a.id === accountId)!.status).toBe('open')
    unmount()
  })
})

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { decodeFunctionData } from 'viem'
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
const {
  gatewayConfigFor,
  resolveGatewayReceivingContext,
  prepareGatewayDeposit,
  readPaymentRequirements,
  DEPOSIT_FOR_ABI,
} = await import('../src/lib/gateway-config')
const { getChargeAvailability, createCheckoutToken, checkoutUrlFor } = await import('../src/lib/gateway-charge')

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

describe('FIN-04.1B.2.2B — Gateway context resolution', () => {
  test('resolveGatewayReceivingContext separa GatewayWallet (destino) de depositor (conta creditada)', () => {
    const gw = gatewayConfigFor('testnet').gatewayWallet
    // Configuração convencional → depositor presente (nunca o GatewayWallet).
    const withDepositor = resolveGatewayReceivingContext({ treasuryRecipients: { testnet: BENEFICIARY } }, 'testnet')
    expect(withDepositor.gatewayWallet.toLowerCase()).toBe(gw.toLowerCase())
    expect(withDepositor.depositor).toBe(BENEFICIARY)
    // Configuração com GatewayWallet → depositor null (configuração pendente), nunca o contrato.
    const pending = resolveGatewayReceivingContext({ treasuryRecipients: { testnet: gw } }, 'testnet')
    expect(pending.gatewayWallet.toLowerCase()).toBe(gw.toLowerCase())
    expect(pending.depositor).toBeNull()
  })

  test('prepareGatewayDeposit codifica depositFor(token, depositor, value) para o GatewayWallet', () => {
    const cfg = gatewayConfigFor('testnet')
    const context = resolveGatewayReceivingContext({ treasuryRecipients: { testnet: BENEFICIARY } }, 'testnet')
    const deposit = prepareGatewayDeposit(context, '25000000')
    expect(deposit.to.toLowerCase()).toBe(cfg.gatewayWallet.toLowerCase())
    expect(deposit.value).toBe(0n)
    const decoded = decodeFunctionData({ abi: DEPOSIT_FOR_ABI, data: deposit.data })
    expect(decoded.functionName).toBe('depositFor')
    const args = decoded.args as [string, string, bigint]
    expect(args[0].toLowerCase()).toBe(cfg.usdcToken.toLowerCase())
    expect(args[1].toLowerCase()).toBe(BENEFICIARY.toLowerCase())
    expect(args[2]).toBe(25_000_000n)
  })

  test('prepareGatewayDeposit rejeita depositor não resolvido e configuração divergente', () => {
    const gw = gatewayConfigFor('testnet').gatewayWallet
    // depositor null (config = GatewayWallet) → rejeitado.
    const pending = resolveGatewayReceivingContext({ treasuryRecipients: { testnet: gw } }, 'testnet')
    expect(() => prepareGatewayDeposit(pending, '25000000')).toThrow('depositor_unresolved')
    // configuração divergente (chainId errado) → rejeitado.
    const mismatch = { ...resolveGatewayReceivingContext({ treasuryRecipients: { testnet: BENEFICIARY } }, 'testnet'), chainId: 1 }
    expect(() => prepareGatewayDeposit(mismatch, '25000000')).toThrow('gateway_config_mismatch')
  })

  test('readPaymentRequirements consulta saldo/allowance e rejeita chain divergente', async () => {
    const context = resolveGatewayReceivingContext({ treasuryRecipients: { testnet: BENEFICIARY } }, 'testnet')
    const client = {
      getChainId: async () => context.chainId,
      readContract: async ({ functionName }: { functionName: string }) => (functionName === 'balanceOf' ? 100_000_000n : 0n),
    }
    const req = await readPaymentRequirements(client as never, PAYER as `0x${string}`, context, 25_000_000n)
    expect(req.balance).toBe(100_000_000n)
    expect(req.allowance).toBe(0n)
    expect(req.sufficientBalance).toBe(true)
    expect(req.needsApproval).toBe(true)
    // chain errada → throw.
    const wrong = { ...client, getChainId: async () => 1 }
    await expect(readPaymentRequirements(wrong as never, PAYER as `0x${string}`, context, 25_000_000n)).rejects.toThrow('wrong_chain')
  })
})

describe('FIN-04.1B.2.2B — Charge availability, checkout token', () => {
  test('getChargeAvailability subtrai reservas do saldo em aberto (40 − 15 = 25)', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const { accountId } = saleAccount(store) // 40 USDC
    const r = commit(store, (s) => s.createPaymentIntent({ accountId, amount: 15, amountDecimal: '15', usdcMinor: '15000000', currency: 'USDC', expiresAt: '2099-01-01T00:00:00.000Z' }))
    if (!r.ok) throw new Error('intent')
    const account = store().data.accounts.find((a) => a.id === accountId)!
    const available = getChargeAvailability(account, store().data.paymentReservations, { organizationId: store().data.ledger.orgId, environment: 'mainnet' })
    expect(available).toBe(25_000_000n) // 40 − 15 reservado
    unmount()
  })

  test('createCheckoutToken gera referência opaca única e link sem valores financeiros', () => {
    const a = createCheckoutToken()
    const b = createCheckoutToken()
    expect(a.token).toBeTruthy()
    expect(a.tokenHash).toBeTruthy()
    expect(a.token).not.toBe(b.token)
    expect(checkoutUrlFor('https://app.example.com/', a.token)).toBe(`https://app.example.com/checkout/${a.token}`)
  })
})

describe('FIN-04.1B.2.2B — Store: gateway destination and PaymentRail', () => {
  test('createPaymentIntent aceita o GatewayWallet como destino (depositor pendente)', () => {
    const { store, unmount } = renderStore()
    setNetwork('testnet')
    const gw = gatewayConfigFor('testnet').gatewayWallet
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { testnet: gw } }))
    const { accountId } = saleAccount(store)
    const r = commit(store, (s) => s.createPaymentIntent({ accountId, amount: 25, amountDecimal: '25', usdcMinor: '25000000', currency: 'USDC', checkoutToken: 'tok-123', expiresAt: '2099-01-01T00:00:00.000Z' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const intent = store().data.paymentIntents.find((i) => i.intentId === r.intentId)!
    expect(intent.gatewayWallet.toLowerCase()).toBe(gw.toLowerCase())
    expect(intent.beneficiary).toBe('') // depositor pendente (nunca o GatewayWallet)
    expect(intent.checkoutToken).toBe('tok-123')
    unmount()
  })

  test('receiveRequest NÃO liquida cobrança circle_gateway (exige verificação independente)', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const { accountId } = saleAccount(store)
    const reqId = commit(store, (s) => s.addRequest({ accountId, description: 'x', fiatAmount: 25, amount: '25000000', chainKey: 'Arc', chainId: 5042, recipient: BENEFICIARY, fromBlock: '0', paymentRail: 'circle_gateway' }))
    commit(store, (s) => s.receiveRequest(reqId, HASH, PAYER, 'https://x/0x'))
    const request = store().data.requests.find((r) => r.id === reqId)!
    expect(request.status).toBe('open') // não paga
    expect(store().data.accounts.find((a) => a.id === accountId)!.status).toBe('open') // não liquidada
    unmount()
  })

  test('receiveRequest ainda liquida cobrança legada (transferência simples)', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const { accountId } = saleAccount(store)
    const reqId = commit(store, (s) => s.addRequest({ accountId, description: 'x', fiatAmount: 25, amount: '25000000', chainKey: 'Arc', chainId: 5042, recipient: BENEFICIARY, fromBlock: '0', paymentRail: 'legacy_transfer' }))
    commit(store, (s) => s.receiveRequest(reqId, HASH, PAYER, 'https://x/0x'))
    expect(store().data.requests.find((r) => r.id === reqId)!.status).toBe('paid')
    unmount()
  })
})

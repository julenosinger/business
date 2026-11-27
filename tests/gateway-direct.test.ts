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
const { gatewayDirectDepositor, gatewayDirectReceiving } = await import('../src/lib/gateway-direct')
const { gatewayConfigFor } = await import('../src/lib/gateway-config')
const { requestToInvoice, decodeInvoice, encodeInvoice } = await import('../src/lib/invoice')

const DEPOSITOR = '0x000000000000000000000000000000000000dEaD'
const HASH = '0x' + 'ab'.repeat(32)
const PAYER = '0x' + 'cd'.repeat(20)

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

beforeEach(() => {
  localStorage.clear()
  setNetwork('mainnet')
})
afterEach(() => {
  localStorage.clear()
})

describe('Gateway direto (sem backend) — resolução do depositor', () => {
  test('resolve o depositor a partir de treasuryDepositors', () => {
    expect(gatewayDirectDepositor({ treasuryDepositors: { mainnet: DEPOSITOR } }, 'mainnet')).toBe(DEPOSITOR)
  })

  test('usa treasuryRecipients como fallback', () => {
    expect(gatewayDirectDepositor({ treasuryRecipients: { mainnet: DEPOSITOR } }, 'mainnet')).toBe(DEPOSITOR)
  })

  test('sem configuração retorna null (configuração pendente)', () => {
    expect(gatewayDirectDepositor({}, 'mainnet')).toBeNull()
  })

  test('rejeita contratos do Gateway como depositor', () => {
    const cfg = gatewayConfigFor('mainnet')
    expect(gatewayDirectDepositor({ treasuryDepositors: { mainnet: cfg.gatewayWallet } }, 'mainnet')).toBeNull()
    expect(gatewayDirectDepositor({ treasuryDepositors: { mainnet: cfg.gatewayMinter } }, 'mainnet')).toBeNull()
    expect(gatewayDirectDepositor({ treasuryDepositors: { mainnet: cfg.usdcToken } }, 'mainnet')).toBeNull()
  })

  test('gatewayDirectReceiving retorna contexto Arc Mainnet com depositor', () => {
    const cfg = gatewayConfigFor('mainnet')
    const ctx = gatewayDirectReceiving({ treasuryDepositors: { mainnet: DEPOSITOR } }, 'mainnet')
    expect(ctx).not.toBeNull()
    expect(ctx!.chainId).toBe(5042)
    expect(ctx!.gatewayWallet.toLowerCase()).toBe(cfg.gatewayWallet.toLowerCase())
    expect(ctx!.token.toLowerCase()).toBe(cfg.usdcToken.toLowerCase())
    expect(ctx!.depositor).toBe(DEPOSITOR)
  })

  test('gatewayDirectReceiving retorna null sem depositor', () => {
    expect(gatewayDirectReceiving({}, 'mainnet')).toBeNull()
  })
})

describe('Gateway direto — baixa automática (receiveGatewayDirect)', () => {
  test('liquida a obrigação exatamente pelo valor recebido e marca a cobrança como paga', () => {
    const { store, unmount } = renderStore()
    const accId = commit(store, (s) => s.addAccount({ kind: 'receivable', description: 'Venda', contactName: 'Cliente', amount: 40, dueDate: '2026-12-31', category: 'Vendas' }))
    const reqId = commit(store, (s) =>
      s.addRequest({
        accountId: accId,
        description: 'Venda',
        fiatAmount: 15,
        amount: '15.000308',
        chainKey: 'Arc',
        chainId: 5042,
        recipient: gatewayConfigFor('mainnet').gatewayWallet,
        depositor: DEPOSITOR,
        fromBlock: '1',
        paymentRail: 'gateway_direct',
      }),
    )
    commit(store, (s) => s.receiveGatewayDirect(reqId, HASH, PAYER, 'https://x/0x'))
    const acc = store().data.accounts.find((a) => a.id === accId)!
    expect((acc.settlements ?? []).reduce((s, x) => s + x.amount, 0)).toBe(15)
    expect(acc.status).toBe('open') // 15 < 40, permanece aberta
    expect(store().data.requests.find((r) => r.id === reqId)?.status).toBe('paid')
    expect(store().data.requests.find((r) => r.id === reqId)?.txHash).toBe(HASH)
    unmount()
  })

  test('não baixa cobrança legada nem circle_gateway', () => {
    const { store, unmount } = renderStore()
    const accId = commit(store, (s) => s.addAccount({ kind: 'receivable', description: 'Venda', contactName: 'Cliente', amount: 40, dueDate: '2026-12-31', category: 'Vendas' }))
    const legacy = commit(store, (s) => s.addRequest({ accountId: accId, description: 'x', fiatAmount: 10, amount: '10.000308', chainKey: 'Arc', chainId: 5042, recipient: '0x000000000000000000000000000000000000000a', fromBlock: '1', paymentRail: 'legacy_transfer' }))
    const gateway = commit(store, (s) => s.addRequest({ accountId: accId, description: 'x', fiatAmount: 10, amount: '10.000309', chainKey: 'Arc', chainId: 5042, recipient: '0x000000000000000000000000000000000000000a', fromBlock: '1', paymentRail: 'circle_gateway' }))
    commit(store, (s) => s.receiveGatewayDirect(legacy, HASH, PAYER, 'https://x'))
    commit(store, (s) => s.receiveGatewayDirect(gateway, HASH, PAYER, 'https://x'))
    expect(store().data.requests.find((r) => r.id === legacy)?.status).toBe('open')
    expect(store().data.requests.find((r) => r.id === gateway)?.status).toBe('open')
    unmount()
  })
})

describe('Gateway direto — fatura pública (invoice)', () => {
  test('requestToInvoice inclui rail e dp apenas para gateway_direct', () => {
    const base = { id: 'r1', accountId: 'a1', description: 'Venda', fiatAmount: 10, amount: '10.000308', chainKey: 'Arc' as const, chainId: 5042, recipient: gatewayConfigFor('mainnet').gatewayWallet, createdAt: '', fromBlock: '1', status: 'open' as const }
    const direct = requestToInvoice({ ...base, paymentRail: 'gateway_direct', depositor: DEPOSITOR }, 'Merchant')
    expect(direct.rail).toBe('gateway_direct')
    expect(direct.dp).toBe(DEPOSITOR)

    const legacy = requestToInvoice({ ...base, paymentRail: 'legacy_transfer' }, 'Merchant')
    expect(legacy.rail).toBeUndefined()
    expect(legacy.dp).toBeUndefined()
  })

  test('decodeInvoice preserva rail e dp (round-trip)', () => {
    const inv = { v: 1 as const, to: gatewayConfigFor('mainnet').gatewayWallet, ch: 'Arc' as const, amt: '10.000308', ref: 'r1', desc: 'Venda', who: 'Merchant', rail: 'gateway_direct' as const, dp: DEPOSITOR }
    const decoded = decodeInvoice(encodeInvoice(inv))
    expect(decoded).not.toBeNull()
    expect(decoded!.rail).toBe('gateway_direct')
    expect(decoded!.dp).toBe(DEPOSITOR)
  })

  test('decodeInvoice ignora dp inválido', () => {
    const inv = { v: 1 as const, to: gatewayConfigFor('mainnet').gatewayWallet, ch: 'Arc' as const, amt: '10.000308', ref: 'r1', desc: 'Venda', who: 'Merchant', rail: 'gateway_direct' as const, dp: 'not-an-address' }
    const decoded = decodeInvoice(encodeInvoice(inv))
    expect(decoded).not.toBeNull()
    expect(decoded!.dp).toBeUndefined()
  })
})

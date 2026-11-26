import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { SessionStore } from '../server/session'
import { readCheckoutFromLocation, PaymentApiError } from '../src/lib/payment-api'
import { resolveGatewayTreasury, validateGatewayTreasury, gatewayConfigFor } from '../src/lib/gateway-config'

try {
  GlobalRegistrator.register()
} catch {
  // já registrado
}

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState({}, '', '/')
})
afterEach(() => {
  localStorage.clear()
})

describe('FIN-04.1B.2.2B.3 — autenticação comercial (sessão)', () => {
  test('sessão carrega organização e permissões; valida e expira', () => {
    const store = new SessionStore(1000)
    const rec = store.create('org-1', ['payments:write', 'chat:write'])
    expect(rec.organizationId).toBe('org-1')
    expect(rec.permissions).toContain('payments:write')
    const validated = store.validate(rec.id)
    expect(validated?.organizationId).toBe('org-1')
    // revogação
    store.revoke(rec.id)
    expect(store.validate(rec.id)).toBeNull()
  })

  test('sessão expirada é invalidada', () => {
    const store = new SessionStore(-1) // expira imediatamente
    const rec = store.create('org-1', ['payments:write'])
    expect(store.validate(rec.id)).toBeNull()
  })
})

describe('FIN-04.1B.2.2B.3 — detecção do token de checkout', () => {
  const TOKEN = 'A'.repeat(43)
  test('detecta token por query param', () => {
    expect(readCheckoutFromLocation({ search: `?checkout=${TOKEN}` })).toBe(TOKEN)
  })
  test('detecta token por path /checkout/:token', () => {
    expect(readCheckoutFromLocation({ pathname: `/checkout/${TOKEN}` })).toBe(TOKEN)
  })
  test('retorna null sem token', () => {
    expect(readCheckoutFromLocation({})).toBeNull()
  })
})

describe('FIN-04.1B.2.2B.3 — erro de pagamento', () => {
  test('PaymentApiError expõe code e status', () => {
    const err = new PaymentApiError('insufficient_balance', 409)
    expect(err.code).toBe('insufficient_balance')
    expect(err.status).toBe(409)
    expect(err).toBeInstanceOf(Error)
  })
})

describe('FIN-04.1B.2.2B.3 — destino Circle Gateway (auto-resolvido)', () => {
  test('resolveGatewayTreasury resolve o GatewayWallet oficial por ambiente', () => {
    expect(resolveGatewayTreasury('testnet').recipient.toLowerCase()).toBe('0x0077777d7eba4688bdef3e311b846f25870a19b9')
    expect(resolveGatewayTreasury('mainnet').recipient.toLowerCase()).toBe('0x77777777dcc4d5a8b6e418fd04d8997ef11000ee')
    expect(resolveGatewayTreasury('testnet').chainId).toBe(5042002)
    expect(resolveGatewayTreasury('mainnet').chainId).toBe(5042)
  })

  test('validateGatewayTreasury aceita o GatewayWallet do ambiente e rejeita o de outro ambiente', () => {
    const testnet = gatewayConfigFor('testnet')
    const mainnet = gatewayConfigFor('mainnet')
    expect(validateGatewayTreasury(testnet.gatewayWallet, 'testnet', 5042002)).toBe(true)
    expect(validateGatewayTreasury(mainnet.gatewayWallet, 'mainnet', 5042)).toBe(true)
    // GatewayWallet Testnet em Mainnet → rejeitado (isolamento).
    expect(validateGatewayTreasury(testnet.gatewayWallet, 'mainnet', 5042)).toBe(false)
    // Endereço convencional não é o GatewayWallet.
    expect(validateGatewayTreasury('0x000000000000000000000000000000000000000a', 'testnet', 5042002)).toBe(false)
  })
})

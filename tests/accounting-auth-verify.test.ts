import { describe, expect, test } from 'bun:test'
import { authorize, can, permissionsFor, ROLES } from '../src/lib/accounting/auth'
import { decodeUsdcTransfers, isHexHash, isKnownChain, matchTransfer, type UsdcTransfer } from '../src/lib/accounting/verify'
import type { Hex } from 'viem'

describe('autorização (papéis e permissões)', () => {
  test('owner tem todas as permissões; auditor é somente leitura', () => {
    expect(can('owner', 'period.close')).toBe(true)
    expect(can('owner', 'chart.manage')).toBe(true)
    expect(can('auditor', 'ledger.read')).toBe(true)
    expect(can('auditor', 'entry.post')).toBe(false)
    expect(can('auditor', 'period.reopen')).toBe(false)
  })

  test('contador e gerente financeiro têm permissões distintas', () => {
    expect(can('accountant', 'chart.manage')).toBe(true)
    expect(can('accountant', 'account.settle')).toBe(false)
    expect(can('financial_manager', 'account.settle')).toBe(true)
    expect(can('financial_manager', 'chart.manage')).toBe(false)
  })

  test('operador é restrito a lançar e baixar', () => {
    expect(can('operator', 'entry.post')).toBe(true)
    expect(can('operator', 'account.settle')).toBe(true)
    expect(can('operator', 'period.close')).toBe(false)
    expect(can('operator', 'posting.approve')).toBe(false)
  })

  test('sem papel = owner (usuário único legado)', () => {
    expect(can(undefined, 'period.reopen')).toBe(true)
    expect(authorize(undefined, 'entry.post')).toMatchObject({ ok: true, role: 'owner' })
  })

  test('todos os papéis têm pelo menos leitura', () => {
    for (const r of ROLES) expect(permissionsFor(r)).toContain('ledger.read')
  })
})

describe('verificação on-chain (primitivas puras)', () => {
  const USDC = '0x3600000000000000000000000000000000000000'
  const TRANSFER_SIG = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  const pad = (hex40: string): Hex => (`0x${'0'.repeat(24)}${hex40.slice(2)}`) as Hex
  const from = '0x1111111111111111111111111111111111111111'
  const to = '0x2222222222222222222222222222222222222222'
  const log = (addr: string, f: string, t: string, value: bigint): { address: string; data: Hex; topics: readonly Hex[] } => ({
    address: addr,
    data: (`0x${value.toString(16).padStart(64, '0')}`) as Hex,
    topics: [TRANSFER_SIG as Hex, pad(f), pad(t)],
  })

  test('isHexHash valida formato de hash', () => {
    expect(isHexHash('0x' + 'a'.repeat(64))).toBe(true)
    expect(isHexHash('0x' + 'g'.repeat(64))).toBe(false)
    expect(isHexHash('0xabc')).toBe(false)
    expect(isHexHash('not-a-hash')).toBe(false)
  })

  test('isKnownChain reconhece cadeias registradas', () => {
    expect(isKnownChain(5042002)).toBe(true) // Arc Testnet
    expect(isKnownChain(99999999)).toBe(false)
  })

  test('decodeUsdcTransfers decodifica Transfer e ignora endereço que não é USDC', () => {
    const transfers = decodeUsdcTransfers([log(USDC, from, to, 1_000_000n), log('0x9999999999999999999999999999999999999999', from, to, 5n)], USDC)
    expect(transfers).toHaveLength(1)
    expect(transfers[0]).toEqual({ from, to, amountMinor: 1_000_000n })
  })

  test('matchTransfer confere destinatário e valor', () => {
    const t: UsdcTransfer[] = [{ from, to, amountMinor: 1_000_000n }]
    expect(matchTransfer(t, to, 1_000_000n)).toBeDefined()
    expect(matchTransfer(t, to, 2_000_000n)).toBeUndefined()
    expect(matchTransfer(t, '0x3333333333333333333333333333333333333333', 1_000_000n)).toBeUndefined()
    expect(matchTransfer(t)).toBeDefined() // sem filtros, confirma
  })
})

import { describe, expect, test } from 'bun:test'

// O store importa módulos que tocam o DOM/localStorage no carregamento; stubs vêm antes dos imports dinâmicos.
const g = globalThis as unknown as Record<string, unknown>
const store: Record<string, string> = {}
g.localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v), removeItem: (k: string) => void delete store[k] }
g.navigator = { language: 'pt-BR' }
const el = () => ({ style: {}, appendChild() {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, dataset: {}, classList: { add() {}, remove() {} } })
g.document = { documentElement: el(), head: el(), body: el(), createElement: el, createTextNode: () => ({}), getElementsByTagName: () => [el()], querySelector: () => null, addEventListener() {}, removeEventListener() {} }
g.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {}, localStorage: g.localStorage }

const { emptyData, migrateAccountEnvironments } = await import('../src/lib/store')
const { accountsForEnvironment, accountTotalsForEnvironment, upcomingForEnvironment, dueSoonForEnvironment } = await import('../src/lib/selectors')
import type { Account, AppData, TreasuryOp } from '../src/lib/types'

const acc = (over: Partial<Account> = {}): Account => ({
  id: 'a',
  kind: 'payable',
  description: 'd',
  contactName: 'c',
  amount: 100,
  dueDate: '2026-12-01',
  category: 'Aluguel',
  status: 'open',
  source: 'manual',
  ...over,
})

const op = (accountId: string, chain: string): TreasuryOp => ({ id: 'op', date: '2026-11-22', kind: 'spend', chain, amount: '1', note: '', accountId })

const data = (accounts: Account[], treasuryOps: TreasuryOp[] = []): AppData => ({ ...emptyData(), accounts, treasuryOps })

describe('isolamento financeiro por ambiente (seletores)', () => {
  test('accountsForEnvironment separa Mainnet/Testnet e exclui unassigned', () => {
    const list = [acc({ id: 'm', environment: 'mainnet' }), acc({ id: 't', environment: 'testnet' }), acc({ id: 'u', environment: 'unassigned' })]
    expect(accountsForEnvironment(list, 'mainnet').map((a) => a.id)).toEqual(['m'])
    expect(accountsForEnvironment(list, 'testnet').map((a) => a.id)).toEqual(['t'])
  })

  test('accountTotalsForEnvironment: A pagar/A receber separados e canceladas excluídas', () => {
    const d = data([
      acc({ id: 'm-pay', environment: 'mainnet', kind: 'payable', amount: 300 }),
      acc({ id: 'm-rec', environment: 'mainnet', kind: 'receivable', amount: 150 }),
      acc({ id: 't-pay', environment: 'testnet', kind: 'payable', amount: 999 }),
      acc({ id: 'm-cancel', environment: 'mainnet', kind: 'payable', amount: 500, canceledAt: '2026-11-20' }),
      acc({ id: 'u-pay', environment: 'unassigned', kind: 'payable', amount: 777 }),
    ])
    const main = accountTotalsForEnvironment(d, 'mainnet')
    const test = accountTotalsForEnvironment(d, 'testnet')
    expect(main.payable).toBe(300)
    expect(main.receivable).toBe(150)
    expect(test.payable).toBe(999)
    expect(test.receivable).toBe(0)
  })

  test('upcomingForEnvironment: filtrada por ambiente, sem canceladas e ordenada por vencimento', () => {
    const d = data([
      acc({ id: 'm1', environment: 'mainnet', dueDate: '2026-12-05' }),
      acc({ id: 't1', environment: 'testnet', dueDate: '2026-12-01' }),
      acc({ id: 'm2', environment: 'mainnet', dueDate: '2026-12-02' }),
      acc({ id: 'm-cancel', environment: 'mainnet', dueDate: '2026-11-30', canceledAt: '2026-11-20' }),
    ])
    expect(upcomingForEnvironment(d, 'mainnet', 10).map((a) => a.id)).toEqual(['m2', 'm1'])
    expect(upcomingForEnvironment(d, 'testnet', 10).map((a) => a.id)).toEqual(['t1'])
  })

  test('dueSoonForEnvironment respeita o ambiente', () => {
    const d = data([
      acc({ id: 'm', environment: 'mainnet', kind: 'payable', dueDate: '2026-11-25' }),
      acc({ id: 't', environment: 'testnet', kind: 'payable', dueDate: '2026-11-25' }),
    ])
    expect(dueSoonForEnvironment(d, 'mainnet', 'payable', 7).map((a) => a.id)).toEqual(['m'])
  })
})

describe('migração do ambiente financeiro (legado)', () => {
  test('classifica pelo paymentNetwork persistido (sem usar a rede selecionada)', () => {
    const d = data([acc({ id: 'a1', paymentNetwork: 'mainnet' }), acc({ id: 'a2', paymentNetwork: 'testnet' })])
    const out = migrateAccountEnvironments(d)
    expect(out.accounts.find((a) => a.id === 'a1')!.environment).toBe('mainnet')
    expect(out.accounts.find((a) => a.id === 'a2')!.environment).toBe('testnet')
  })

  test('classifica pela rede de uma operação vinculada', () => {
    const d = data([acc({ id: 'a1' })], [op('a1', 'Arc_Testnet')])
    const out = migrateAccountEnvironments(d)
    expect(out.accounts.find((a) => a.id === 'a1')!.environment).toBe('testnet')
  })

  test('sem evidência → unassigned (nunca Mainnet por padrão)', () => {
    const d = data([acc({ id: 'a1' })])
    const out = migrateAccountEnvironments(d)
    expect(out.accounts.find((a) => a.id === 'a1')!.environment).toBe('unassigned')
  })

  test('registro já classificado é preservado (idempotente)', () => {
    const d = data([acc({ id: 'a1', environment: 'testnet', paymentNetwork: 'mainnet' })])
    const out = migrateAccountEnvironments(d)
    expect(out.accounts.find((a) => a.id === 'a1')!.environment).toBe('testnet')
  })

  test('migração executada duas vezes não altera nada e não duplica obrigações', () => {
    const d = data([acc({ id: 'a1' }), acc({ id: 'a2', paymentNetwork: 'testnet' })], [op('a1', 'Arc')])
    const once = migrateAccountEnvironments(d)
    const twice = migrateAccountEnvironments(once)
    expect(twice.accounts).toHaveLength(2)
    expect(twice.accounts).toEqual(once.accounts)
    expect(twice.accounts.find((a) => a.id === 'a1')!.environment).toBe('mainnet')
    expect(twice.accounts.find((a) => a.id === 'a2')!.environment).toBe('testnet')
  })
})

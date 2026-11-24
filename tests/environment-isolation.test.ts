import { describe, expect, test } from 'bun:test'

// O store importa módulos que tocam o DOM/localStorage no carregamento; stubs vêm antes dos imports dinâmicos.
const g = globalThis as unknown as Record<string, unknown>
const store: Record<string, string> = {}
g.localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v), removeItem: (k: string) => void delete store[k] }
g.navigator = { language: 'pt-BR' }
const el = () => ({ style: {}, appendChild() {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, dataset: {}, classList: { add() {}, remove() {} } })
g.document = { documentElement: el(), head: el(), body: el(), createElement: el, createTextNode: () => ({}), getElementsByTagName: () => [el()], querySelector: () => null, addEventListener() {}, removeEventListener() {} }
g.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {}, localStorage: g.localStorage }

const { emptyData, migrateAccountEnvironments, migrateEntryEnvironments, migrateErpEnvironments } = await import('../src/lib/store')
const { accountsForEnvironment, accountTotalsForEnvironment, cashBalanceForEnvironment, contactsForEnvironment, employeesForEnvironment, entriesForEnvironment, expensesByCategoryForEnvironment, kpisForEnvironment, monthPeriod, productsForEnvironment, purchasesForEnvironment, salesForEnvironment, scopedByEnvironment, shipmentsForEnvironment, upcomingForEnvironment, dueSoonForEnvironment } = await import('../src/lib/selectors')
import type { Account, AppData, Contact, Employee, Entry, Product, PurchaseRef, Sale, Shipment, TreasuryOp } from '../src/lib/types'
import { CAT_SALES } from '../src/lib/types'

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

  test('alternância repetida Mainnet↔Testnet não contamina os totais (seletores puros)', () => {
    const d = data([
      acc({ id: 'm', environment: 'mainnet', kind: 'payable', amount: 100 }),
      acc({ id: 't', environment: 'testnet', kind: 'payable', amount: 200 }),
    ])
    for (let i = 0; i < 5; i++) {
      expect(accountTotalsForEnvironment(d, 'mainnet').payable).toBe(100)
      expect(accountTotalsForEnvironment(d, 'testnet').payable).toBe(200)
    }
    // Os dados de entrada não são mutados pelos seletores.
    expect(d.accounts).toHaveLength(2)
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

describe('isolamento operacional do ERP (fase 3.3)', () => {
  const product = (id: string, env?: Product['environment']): Product => ({ id, sku: id, name: id, category: 'Geral', unit: 'un', cost: 10, price: 20, stock: 5, minStock: 1, environment: env })
  const contact = (id: string, env?: Contact['environment']): Contact => ({ id, kind: 'customer', name: id, doc: '', email: '', phone: '', wallet: '', environment: env })
  const employee = (id: string, env?: Employee['environment']): Employee => ({ id, name: id, role: 'r', salary: 1000, wallet: '', admission: '2026-01-01', active: true, environment: env })
  const sale = (id: string, env?: Sale['environment'], accountId?: string): Sale => ({ id, date: '2026-11-20', customerName: 'c', items: [], total: 100, cogs: 50, method: 'pix', accountId, environment: env })
  const purchase = (id: string, env?: PurchaseRef['environment']): PurchaseRef => ({ id, date: '2026-11-20', supplierName: 's', items: [], total: 100, stockPosted: true, createdAt: '2026-11-20', environment: env })
  const shipment = (id: string, env?: Shipment['environment']): Shipment => ({ id, orgId: 'local', direction: 'outbound', status: 'draft', origin: { name: 'a', city: 'b', country: 'c' }, destination: { name: 'a', city: 'b', country: 'c' }, senderName: 's', recipientName: 'r', carrier: '', trackingNumber: '', method: '', packages: [], items: [], declaredValue: 0, currency: 'USDC', freightCost: 0, documents: [], events: [], createdAt: '2026-11-20', updatedAt: '2026-11-20', environment: env })

  test('scopedByEnvironment separa por ambiente e exclui unassigned', () => {
    const list = [product('m', 'mainnet'), product('t', 'testnet'), product('u', 'unassigned')]
    expect(scopedByEnvironment(list, 'mainnet').map((p) => p.id)).toEqual(['m'])
    expect(scopedByEnvironment(list, 'testnet').map((p) => p.id)).toEqual(['t'])
  })

  test('seletores por entidade respeitam o ambiente', () => {
    const d: AppData = {
      ...emptyData(),
      products: [product('m', 'mainnet'), product('t', 'testnet')],
      contacts: [contact('m', 'mainnet'), contact('t', 'testnet')],
      employees: [employee('m', 'mainnet'), employee('t', 'testnet')],
      sales: [sale('m', 'mainnet'), sale('t', 'testnet')],
      purchases: [purchase('m', 'mainnet'), purchase('t', 'testnet')],
      shipments: [shipment('m', 'mainnet'), shipment('t', 'testnet')],
    }
    expect(productsForEnvironment(d, 'mainnet').map((p) => p.id)).toEqual(['m'])
    expect(contactsForEnvironment(d, 'testnet').map((c) => c.id)).toEqual(['t'])
    expect(employeesForEnvironment(d, 'mainnet').map((e) => e.id)).toEqual(['m'])
    expect(salesForEnvironment(d, 'testnet').map((s) => s.id)).toEqual(['t'])
    expect(purchasesForEnvironment(d, 'mainnet').map((p) => p.id)).toEqual(['m'])
    expect(shipmentsForEnvironment(d, 'testnet').map((s) => s.id)).toEqual(['t'])
  })

  test('migração ERP: venda herda ambiente da conta vinculada; demais ficam unassigned', () => {
    const d: AppData = {
      ...emptyData(),
      accounts: [acc({ id: 'acc-m', environment: 'mainnet' }), acc({ id: 'acc-t', environment: 'testnet' })],
      sales: [sale('s1', undefined, 'acc-m'), sale('s2', undefined, 'acc-t'), sale('s3', undefined, undefined)],
      products: [product('p1', undefined)],
      contacts: [contact('c1', undefined)],
      employees: [employee('e1', undefined)],
    }
    const out = migrateErpEnvironments(d)
    expect(out.sales.find((s) => s.id === 's1')!.environment).toBe('mainnet')
    expect(out.sales.find((s) => s.id === 's2')!.environment).toBe('testnet')
    expect(out.sales.find((s) => s.id === 's3')!.environment).toBe('unassigned')
    expect(out.products.find((p) => p.id === 'p1')!.environment).toBe('unassigned')
    expect(out.contacts.find((c) => c.id === 'c1')!.environment).toBe('unassigned')
    expect(out.employees.find((e) => e.id === 'e1')!.environment).toBe('unassigned')
  })

  test('migração ERP é idempotente e não perde registros', () => {
    const d: AppData = {
      ...emptyData(),
      sales: [sale('s1', undefined)],
      products: [product('p1', undefined)],
      contacts: [contact('c1', undefined)],
    }
    const once = migrateErpEnvironments(d)
    const twice = migrateErpEnvironments(once)
    expect(twice).toEqual(once)
    expect(twice.sales).toHaveLength(1)
    expect(twice.products).toHaveLength(1)
    expect(twice.contacts).toHaveLength(1)
    expect(twice.products[0]!.environment).toBe('unassigned')
  })

  test('registros já classificados são preservados pela migração', () => {
    const d: AppData = { ...emptyData(), products: [product('p1', 'testnet')] }
    const out = migrateErpEnvironments(d)
    expect(out.products[0]!.environment).toBe('testnet')
  })
})

describe('isolamento financeiro de lançamentos (entries) por ambiente', () => {
  const entry = (id: string, env: Entry['environment'], over: Partial<Entry> = {}): Entry => ({
    id,
    date: monthPeriod(0).from,
    type: 'in',
    category: 'Vendas',
    description: 'd',
    amount: 100,
    environment: env,
    ...over,
  })

  test('entriesForEnvironment separa por ambiente e exclui unassigned', () => {
    const d: AppData = { ...emptyData(), entries: [entry('m', 'mainnet'), entry('t', 'testnet'), entry('u', 'unassigned'), entry('x', undefined)] }
    expect(entriesForEnvironment(d, 'mainnet').map((e) => e.id)).toEqual(['m'])
    expect(entriesForEnvironment(d, 'testnet').map((e) => e.id)).toEqual(['t'])
  })

  test('cashBalanceForEnvironment só soma lançamentos do ambiente (saldo acumulado)', () => {
    const d: AppData = {
      ...emptyData(),
      entries: [
        entry('m-in', 'mainnet', { type: 'in', amount: 2400 }),
        entry('m-out', 'mainnet', { type: 'out', amount: 1760 }),
        entry('t-in', 'testnet', { type: 'in', amount: 999 }),
      ],
    }
    expect(cashBalanceForEnvironment(d, 'mainnet')).toBe(640)
    expect(cashBalanceForEnvironment(d, 'testnet')).toBe(999)
  })

  test('kpisForEnvironment: receita/CMV/lucro/fluxo isolados por ambiente (Cenário A)', () => {
    const p = monthPeriod(0)
    const sale = (id: string, env: Sale['environment'], total: number, cogs: number): Sale => ({
      id,
      date: p.from,
      customerName: 'c',
      items: [],
      total,
      cogs,
      method: 'pix',
      environment: env,
    })
    const d: AppData = {
      ...emptyData(),
      sales: [sale('s1', 'mainnet', 2400, 1760)],
      entries: [entry('e1', 'mainnet', { type: 'in', category: CAT_SALES, amount: 2400 })],
    }
    const main = kpisForEnvironment(d, 'mainnet', p)
    expect(main.revenue).toBe(2400)
    expect(main.cogs).toBe(1760)
    expect(main.profit).toBe(640)
    expect(main.inflow).toBe(2400)

    // Testnet sem operações: tudo zero.
    const test = kpisForEnvironment(d, 'testnet', p)
    expect(test.revenue).toBe(0)
    expect(test.cogs).toBe(0)
    expect(test.profit).toBe(0)
    expect(test.inflow).toBe(0)
    expect(test.outflow).toBe(0)
  })

  test('Cenário B: Mainnet e Testnet com operações próprias apresentam somente seus dados', () => {
    const p = monthPeriod(0)
    const sale = (id: string, env: Sale['environment'], total: number, cogs: number): Sale => ({
      id,
      date: p.from,
      customerName: 'c',
      items: [],
      total,
      cogs,
      method: 'pix',
      environment: env,
    })
    const d: AppData = {
      ...emptyData(),
      sales: [sale('sm', 'mainnet', 2400, 1760), sale('st', 'testnet', 1000, 500)],
      entries: [
        entry('em', 'mainnet', { type: 'in', category: CAT_SALES, amount: 2400 }),
        entry('et', 'testnet', { type: 'in', category: CAT_SALES, amount: 1000 }),
      ],
    }
    const main = kpisForEnvironment(d, 'mainnet', p)
    const test = kpisForEnvironment(d, 'testnet', p)
    expect(main.revenue).toBe(2400)
    expect(main.inflow).toBe(2400)
    expect(test.revenue).toBe(1000)
    expect(test.inflow).toBe(1000)
    expect(test.cogs).toBe(500)
    expect(test.profit).toBe(500)
  })

  test('expensesByCategoryForEnvironment só considera o ambiente', () => {
    const p = monthPeriod(0)
    const d: AppData = {
      ...emptyData(),
      entries: [
        entry('m', 'mainnet', { type: 'out', category: 'Aluguel', amount: 500 }),
        entry('t', 'testnet', { type: 'out', category: 'Aluguel', amount: 900 }),
      ],
    }
    expect(expensesByCategoryForEnvironment(d, 'mainnet', p).map((c) => c.total)).toEqual([500])
    expect(expensesByCategoryForEnvironment(d, 'testnet', p).map((c) => c.total)).toEqual([900])
  })

  test('migração ERP: entries legadas ficam unassigned (não contaminam totais isolados)', () => {
    const d: AppData = { ...emptyData(), entries: [entry('e1', undefined)] }
    const out = migrateErpEnvironments(d)
    expect(out.entries[0]!.environment).toBe('unassigned')
    expect(entriesForEnvironment(out, 'mainnet')).toHaveLength(0)
    expect(entriesForEnvironment(out, 'testnet')).toHaveLength(0)
    expect(cashBalanceForEnvironment(out, 'mainnet')).toBe(0)
    expect(cashBalanceForEnvironment(out, 'testnet')).toBe(0)
  })

  test('migração ERP é idempotente para entries (não altera registros classificados)', () => {
    const d: AppData = { ...emptyData(), entries: [entry('m', 'mainnet'), entry('u', undefined)] }
    const once = migrateErpEnvironments(d)
    const twice = migrateErpEnvironments(once)
    expect(twice.entries).toEqual(once.entries)
    expect(twice.entries.find((e) => e.id === 'm')!.environment).toBe('mainnet')
    expect(twice.entries.find((e) => e.id === 'u')!.environment).toBe('unassigned')
  })

  test('migrateEntryEnvironments: recupera ambiente pelo vínculo inequívoco sourceId (venda)', () => {
    const d: AppData = {
      ...emptyData(),
      sales: [{ id: 's1', date: '2026-11-20', customerName: 'c', items: [], total: 100, cogs: 50, method: 'pix', environment: 'mainnet' }],
      entries: [entry('e1', undefined, { sourceKind: 'sale', sourceId: 's1' })],
    }
    const out = migrateEntryEnvironments(d)
    expect(out.entries[0]!.environment).toBe('mainnet')
  })

  test('migrateEntryEnvironments: recupera ambiente pelo vínculo com conta (liquidação)', () => {
    const d: AppData = {
      ...emptyData(),
      accounts: [acc({ id: 'a1', environment: 'testnet' })],
      entries: [entry('e1', undefined, { sourceKind: 'account', sourceId: 'a1' })],
    }
    const out = migrateEntryEnvironments(d)
    expect(out.entries[0]!.environment).toBe('testnet')
  })

  test('migrateEntryEnvironments: sem vínculo ou origem inexistente/unassigned → permanece sem ambiente', () => {
    const d: AppData = {
      ...emptyData(),
      sales: [{ id: 's1', date: '2026-11-20', customerName: 'c', items: [], total: 100, cogs: 50, method: 'pix', environment: 'unassigned' }],
      entries: [entry('e1', undefined), entry('e2', undefined, { sourceKind: 'sale', sourceId: 'ghost' }), entry('e3', undefined, { sourceKind: 'sale', sourceId: 's1' })],
    }
    const out = migrateEntryEnvironments(d)
    expect(out.entries.find((e) => e.id === 'e1')!.environment).toBeUndefined()
    expect(out.entries.find((e) => e.id === 'e2')!.environment).toBeUndefined()
    expect(out.entries.find((e) => e.id === 'e3')!.environment).toBeUndefined() // origem unassigned
  })

  test('migrateEntryEnvironments é idempotente e não altera registros já classificados', () => {
    const d: AppData = {
      ...emptyData(),
      sales: [{ id: 's1', date: '2026-11-20', customerName: 'c', items: [], total: 100, cogs: 50, method: 'pix', environment: 'mainnet' }],
      entries: [entry('m', 'testnet'), entry('e1', undefined, { sourceKind: 'sale', sourceId: 's1' })],
    }
    const once = migrateEntryEnvironments(d)
    const twice = migrateEntryEnvironments(once)
    expect(twice.entries).toEqual(once.entries)
    expect(twice.entries.find((e) => e.id === 'm')!.environment).toBe('testnet') // preservado
    expect(twice.entries.find((e) => e.id === 'e1')!.environment).toBe('mainnet')
  })
})

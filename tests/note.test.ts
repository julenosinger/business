import { describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

try {
  GlobalRegistrator.register()
} catch {
  // já registrado
}

const { accountDisplayAmount, accountOutstanding } = await import('../src/lib/selectors')
const { saleNote, purchaseNote, accountNote } = await import('../src/lib/note')
const { setLang } = await import('../src/lib/i18n')
import type { Account, PurchaseRef, Sale, Settings } from '../src/lib/types'

setLang('pt')

const settings: Settings = { company: 'Minha Empresa', branch: 'Matriz', owner: 'Dono', currency: 'BRL', usdcRate: null, approvalLimit: null }

describe('accountDisplayAmount (aba Liquidadas)', () => {
  test('conta paga mostra o valor original, nunca o saldo em aberto (zero)', () => {
    const a: Account = {
      id: 'a1',
      kind: 'payable',
      description: 'Aluguel',
      contactName: 'Credor',
      amount: 100,
      dueDate: '2026-12-01',
      category: 'Aluguel',
      status: 'paid',
      source: 'manual',
      settlements: [{ id: 's1', sequence: 1, amount: 100, date: '2026-12-01' }],
    }
    expect(accountOutstanding(a)).toBe(0)
    expect(accountDisplayAmount(a)).toBe(100)
  })

  test('conta aberta mantém o saldo em aberto', () => {
    const a: Account = { id: 'a1', kind: 'payable', description: 'x', contactName: 'c', amount: 100, dueDate: '2026-12-01', category: 'Aluguel', status: 'open', source: 'manual' }
    expect(accountDisplayAmount(a)).toBe(100)
  })

  test('conta parcial mostra o saldo em aberto (não o valor original)', () => {
    const a: Account = {
      id: 'a1',
      kind: 'payable',
      description: 'x',
      contactName: 'c',
      amount: 100,
      dueDate: '2026-12-01',
      category: 'Aluguel',
      status: 'open',
      source: 'manual',
      settlements: [{ id: 's1', sequence: 1, amount: 30, date: '2026-12-01' }],
    }
    expect(accountDisplayAmount(a)).toBe(70)
  })
})

describe('notas / comprovantes (HTML imprimível)', () => {
  test('saleNote contém empresa, número, cliente e itens', () => {
    const s: Sale = { id: 'SALE-1', date: '2026-11-20', customerName: 'Cliente A', items: [{ productId: 'p1', name: 'Produto X', qty: 2, price: 10, cost: 6 }], total: 20, cogs: 12, method: 'pix' }
    const html = saleNote(s, settings)
    expect(html).toContain('Minha Empresa')
    expect(html).toContain('SALE-1')
    expect(html).toContain('Cliente A')
    expect(html).toContain('Produto X')
  })

  test('purchaseNote contém fornecedor e itens', () => {
    const p: PurchaseRef = { id: 'PUR-0001', date: '2026-11-20', supplierName: 'Forn A', items: [{ productId: 'p1', name: 'Café', sku: 'CAF', qty: 10, cost: 5 }], total: 50, stockPosted: false, createdAt: '2026-11-20T00:00:00.000Z' }
    const html = purchaseNote(p, settings)
    expect(html).toContain('PUR-0001')
    expect(html).toContain('Forn A')
    expect(html).toContain('Café')
  })

  test('accountNote contém descrição, contato e status', () => {
    const a: Account = { id: 'a1', kind: 'receivable', description: 'Venda a prazo', contactName: 'Cliente B', amount: 120, dueDate: '2026-12-10', category: 'Vendas', status: 'open', source: 'sale' }
    const html = accountNote(a, settings)
    expect(html).toContain('Venda a prazo')
    expect(html).toContain('Cliente B')
  })

  test('accountNote paga exibe status Paga/Recebida (não vazio)', () => {
    const a: Account = { id: 'a2', kind: 'payable', description: 'Aluguel', contactName: 'Credor', amount: 80, dueDate: '2026-12-01', category: 'Aluguel', status: 'paid', source: 'manual' }
    const html = accountNote(a, settings)
    expect(html).toContain('Paga')
  })
})

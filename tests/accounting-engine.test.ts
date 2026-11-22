import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { accountBalance, computeTax, confirmFee, decideApproval, emptyLedger, normalizeLedger, postEvent, prepareEntry, registerFee, requestApproval, reverseEntry, settlePendingEvent, trialBalance, validateEntry, isReversed, type Ctx } from '../src/lib/accounting/engine'
import { EXPONENT, formatDecimal, fromNumber, fxConvert, mulRate, parseMinor } from '../src/lib/accounting/money'
import { RULES } from '../src/lib/accounting/rules'
import { freightEvent, payrollEvent, purchaseEvent, saleEvent, settlementEvent, treasuryEvent } from '../src/lib/accounting/adapters'
import { applyHistoricalImport, planHistoricalImport, reconcileCashBook } from '../src/lib/accounting/reconcile'
import { createReadApi, proposalApi } from '../src/lib/accounting/service'
import type { EventDraft, EventType, LedgerState } from '../src/lib/accounting/types'
import type { CurrencyCode } from '../src/lib/types'

const NOW = '2026-11-22T10:00:00.000Z'
const user = { id: 'u1', kind: 'user' as const }
const ctx: Ctx = { now: NOW, actor: user }

function draft(over: Partial<EventDraft> = {}): EventDraft {
  return {
    orgId: 'local',
    idempotencyKey: 'k1',
    type: 'cashbook.income',
    source: { module: 'cashbook', recordId: 'c1' },
    occurredAt: NOW,
    accountingDate: '2026-11-22',
    currency: 'BRL',
    amountMinor: '10050',
    payload: { category: 'Outras receitas', description: 'x', cashEntryId: 'c1' },
    confirmation: 'confirmed',
    ...over,
  }
}
const post = (l: LedgerState, d: EventDraft, c: Ctx = ctx) => postEvent(l, d, c)
const must = (r: ReturnType<typeof postEvent>): LedgerState => {
  if (!r.ok) throw new Error('post failed: ' + r.errors.join(','))
  return r.ledger
}

describe('money (decimal-safe)', () => {
  test('parse estrito, sem arredondamento destrutivo', () => {
    expect(parseMinor('12.34', 'BRL')).toBe(1234n)
    expect(parseMinor('12.345', 'BRL')).toBeNull() // casas demais: rejeita
    expect(parseMinor('1.234567', 'USDC')).toBe(1_234_567n)
    expect(parseMinor('abc', 'USD')).toBeNull()
    expect(EXPONENT.USDC).toBe(6)
  })
  test('0.1 + 0.2 é exato em unidades menores', () => {
    const a = fromNumber(0.1, 'USDC')!
    const b = fromNumber(0.2, 'USDC')!
    expect(formatDecimal(a + b, 'USDC')).toBe('0.300000')
    expect(0.1 + 0.2 === 0.3).toBe(false) // o float falharia
  })
  test('valores grandes e USDC com 6 casas preservados', () => {
    const big = parseMinor('123456789012345.123456', 'USDC')!
    expect(formatDecimal(big, 'USDC')).toBe('123456789012345.123456')
    expect(fromNumber(Number.NaN, 'BRL')).toBeNull()
  })
  test('mulRate arredonda metade para cima com taxa exata', () => {
    expect(mulRate(1000n, '0.0125')).toBe(13n) // 12,5 -> 13
    expect(mulRate(1000n, '0.0124')).toBe(12n)
    expect(mulRate(1000n, 'abc')).toBeNull()
  })
  test('conversão FX só com taxa, origem e horário; nunca implícita', () => {
    const fx = { from: 'USD' as CurrencyCode, to: 'BRL' as CurrencyCode, rate: '5.25', source: 'manual', at: NOW }
    const r = fxConvert(10_000n, 'USD', fx)
    expect('amountMinor' in r && r.amountMinor).toBe(52_500n)
    expect(fxConvert(10_000n, 'USDC', fx)).toEqual({ error: 'fx_mismatch' })
    expect(fxConvert(10_000n, 'USD', { ...fx, source: '' })).toEqual({ error: 'fx_invalid' })
    expect(fxConvert(10_000n, 'USD', { ...fx, rate: '0' })).toEqual({ error: 'fx_invalid' })
  })
})

describe('partida dobrada e regras', () => {
  const samples: Record<EventType, Partial<EventDraft>> = {
    'cashbook.income': { payload: { category: 'Serviços prestados' } },
    'cashbook.expense': { payload: { category: 'Aluguel' } },
    'sale.recorded': { payload: { paidNow: false, cogsMinor: '3000' } },
    'receivable.settled': { payload: { settleIn: 'cash' } },
    'purchase.recorded': { payload: { paidNow: false } },
    'payable.settled': { payload: { settleIn: 'cash' } },
    'payroll.accrued': { payload: {} },
    'payroll.paid': { payload: { settleIn: 'cash' } },
    'freight.posted': { payload: {} },
    'treasury.deposit': { currency: 'USDC', payload: {} },
    'treasury.transfer_internal': { currency: 'USDC', payload: { from: 'usdc_gateway', to: 'usdc_wallet' } },
    'treasury.payment': { currency: 'USDC', payload: {} },
    'fee.confirmed': { currency: 'USDC', payload: { feeKind: 'network', paidFrom: 'usdc_wallet' } },
    adjustment: { payload: { debit: 'expense_operating', credit: 'cash', reason: 'ajuste' } },
  }
  for (const type of Object.keys(RULES) as EventType[]) {
    test(`regra ${type} gera lançamento balanceado`, () => {
      const l = must(post(emptyLedger(), draft({ type, idempotencyKey: `k:${type}`, ...samples[type] })))
      expect(l.journal).toHaveLength(1)
      const je = l.journal[0]!
      expect(validateEntry(l, je)).toEqual([])
      const tb = trialBalance(l)[0]!
      expect(tb.totalDebit).toBe(tb.totalCredit)
      expect(tb.balanced).toBe(true)
    })
  }
  test('venda a prazo: receita no registro; recebimento não reconhece receita de novo', () => {
    let l = must(post(emptyLedger(), draft({ type: 'sale.recorded', idempotencyKey: 's1', amountMinor: '10000', payload: { paidNow: false, cogsMinor: '4000' } })))
    l = must(post(l, draft({ type: 'receivable.settled', idempotencyKey: 'account:a1:settle:1', amountMinor: '10000', payload: { settleIn: 'cash' } })))
    const tb = trialBalance(l, { currency: 'BRL' })[0]!
    const revenue = tb.rows.find((r) => r.code === '4000')!
    expect(revenue.balance).toBe(10000n) // uma única vez
    expect(tb.rows.find((r) => r.code === '1100')!.balance).toBe(0n) // AR zerado
    expect(tb.rows.find((r) => r.code === '1000')!.balance).toBe(10000n)
    expect(tb.rows.find((r) => r.code === '5000')!.balance).toBe(4000n)
  })
  test('categoria mapeada para conta de ativo não vira receita', () => {
    const l = emptyLedger()
    const bad = { ...l, categoryMap: { ...l.categoryMap, 'Outras receitas': 'inventory' as const } }
    const r = must(post(bad, draft()))
    expect(r.journal[0]!.lines.find((x) => x.side === 'credit')!.accountCode).toBe('4900')
  })
})

describe('rejeição de lançamentos inválidos', () => {
  test('valor zero, negativo, decimal e data inválida', () => {
    for (const amountMinor of ['0', '-5', '1.5', 'abc', '']) {
      const r = post(emptyLedger(), draft({ amountMinor }))
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors).toContain('invalid_amount')
    }
    const d = post(emptyLedger(), draft({ accountingDate: '2026-02-31' }))
    expect(d.ok).toBe(false)
  })
  test('tipo desconhecido, moeda inválida e chave ausente', () => {
    const t = post(emptyLedger(), draft({ type: 'nope' as EventType }))
    expect(t.ok).toBe(false)
    const c = post(emptyLedger(), draft({ currency: 'XYZ' as CurrencyCode }))
    expect(c.ok).toBe(false)
    const k = post(emptyLedger(), draft({ idempotencyKey: '  ' }))
    expect(k.ok).toBe(false)
    if (!k.ok) expect(k.ledger.events).toHaveLength(0) // sem chave confiável: só auditoria
  })
  test('evento rejeitado fica registrado e auditado, sem lançamento', () => {
    const r = post(emptyLedger(), draft({ amountMinor: '0' }))
    expect(r.ok).toBe(false)
    expect(r.ledger.journal).toHaveLength(0)
    expect(r.ledger.events[0]!.status).toBe('rejected')
    expect(r.ledger.audit.some((a) => a.action === 'event.rejected')).toBe(true)
  })
  test('lançamento desbalanceado, conta inexistente e conta inativa são recusados', () => {
    const l = emptyLedger()
    expect(validateEntry(l, { currency: 'BRL', lines: [{ accountCode: '1000', side: 'debit', amountMinor: '100' }, { accountCode: '4000', side: 'credit', amountMinor: '90' }] })).toContain('unbalanced')
    expect(validateEntry(l, { currency: 'BRL', lines: [{ accountCode: '9999', side: 'debit', amountMinor: '100' }, { accountCode: '4000', side: 'credit', amountMinor: '100' }] })).toContain('unknown_account')
    expect(validateEntry(l, { currency: 'BRL', lines: [{ accountCode: '1000', side: 'debit', amountMinor: '100' }] })).toContain('too_few_lines')
    const off = { ...l, chart: l.chart.map((c) => (c.code === '4900' ? { ...c, active: false } : c)) }
    const r = post(off, draft())
    expect(r.ok).toBe(false)
  })
  test('USD e USDC são distintos: conta USDC não aceita USD', () => {
    const r = post(emptyLedger(), draft({ type: 'treasury.deposit', currency: 'USD', idempotencyKey: 't-usd', payload: {} }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toContain('currency_account_mismatch')
  })
  test('prepareEntry não grava nada', () => {
    const l = emptyLedger()
    const before = JSON.stringify(l)
    const p = prepareEntry(l, draft())
    expect(p.ok).toBe(true)
    expect(p.lines).toHaveLength(2)
    expect(JSON.stringify(l)).toBe(before)
  })
})

describe('idempotência e concorrência', () => {
  test('mesma chave não gera segundo lançamento', () => {
    let l = must(post(emptyLedger(), draft()))
    const r = post(l, draft())
    expect(r.ok && r.duplicate).toBe(true)
    l = r.ledger
    expect(l.journal).toHaveLength(1)
    expect(l.events).toHaveLength(1)
    expect(l.audit.some((a) => a.action === 'event.duplicate')).toBe(true)
  })
  test('evento rejeitado pode ser reenviado depois de corrigido (mesma chave)', () => {
    const bad = post(emptyLedger(), draft({ amountMinor: '0' }))
    const fixed = post(bad.ledger, draft({ amountMinor: '500' }))
    expect(fixed.ok).toBe(true)
    expect(fixed.ledger.events).toHaveLength(1)
    expect(fixed.ledger.events[0]!.attempts).toBe(2)
    expect(fixed.ledger.journal).toHaveLength(1)
  })
  test('50 envios concorrentes da mesma chave resultam em 1 lançamento', async () => {
    let state = emptyLedger()
    // Cada "worker" aplica a operação sobre o estado MAIS RECENTE (como o updater funcional do store).
    const worker = async () => {
      await Promise.resolve()
      const r = postEvent(state, draft(), ctx)
      state = r.ledger
    }
    await Promise.all(Array.from({ length: 50 }, worker))
    expect(state.journal).toHaveLength(1)
    expect(state.events).toHaveLength(1)
  })
  test('chaves diferentes concorrentes: todos os lançamentos, numeração única', async () => {
    let state = emptyLedger()
    await Promise.all(
      Array.from({ length: 30 }, async (_, i) => {
        await Promise.resolve()
        state = postEvent(state, draft({ idempotencyKey: `k${i}`, source: { module: 'cashbook', recordId: `c${i}` } }), ctx).ledger
      }),
    )
    expect(state.journal).toHaveLength(30)
    expect(new Set(state.journal.map((j) => j.id)).size).toBe(30)
    expect(trialBalance(state)[0]!.balanced).toBe(true)
  })
  test('resultado calculado sobre base antiga é neutralizado ao reaplicar no estado atual', () => {
    const base = emptyLedger()
    const a = postEvent(base, draft(), ctx) // duas abas partindo da mesma base
    const b = postEvent(base, draft(), ctx)
    expect(a.ok && b.ok).toBe(true)
    const merged = postEvent(a.ledger, draft(), ctx) // reaplicado sobre o mais recente
    expect(merged.ok && merged.duplicate).toBe(true)
    expect(merged.ledger.journal).toHaveLength(1)
  })
})

describe('pendente, falho e confirmado', () => {
  test('pendente não lança; confirmar lança uma única vez', () => {
    let l = must(post(emptyLedger(), draft({ type: 'treasury.deposit', currency: 'USDC', idempotencyKey: 'tx1', amountMinor: '5000000', payload: {}, confirmation: 'pending' })))
    expect(l.journal).toHaveLength(0)
    expect(l.events[0]!.status).toBe('pending')
    const done = settlePendingEvent(l, 'tx1', 'confirmed', ctx)
    expect(done.ok).toBe(true)
    l = done.ledger
    expect(l.journal).toHaveLength(1)
    const again = settlePendingEvent(l, 'tx1', 'confirmed', ctx)
    expect(again.ok && again.duplicate).toBe(true)
    expect(again.ledger.journal).toHaveLength(1)
  })
  test('falha não lança nada e não pode ser confirmada depois', () => {
    let l = must(post(emptyLedger(), draft({ type: 'treasury.deposit', currency: 'USDC', idempotencyKey: 'tx2', payload: {}, confirmation: 'pending' })))
    const failed = settlePendingEvent(l, 'tx2', 'failed', ctx)
    l = failed.ledger
    expect(l.events[0]!.status).toBe('failed')
    expect(l.journal).toHaveLength(0)
    const late = settlePendingEvent(l, 'tx2', 'confirmed', ctx)
    expect(late.ok).toBe(false)
  })
  test('adaptador de tesouraria exige hash e respeita estado; transferência interna não é receita', () => {
    const l = { ...emptyLedger(), flags: { adapters: { ...emptyLedger().flags.adapters, treasury: true } } }
    expect(treasuryEvent(l, { id: 'o1', kind: 'deposit', amount: '10.5', date: '2026-11-22', txHash: null, state: 'confirmed' })).toEqual({ ok: false, reason: 'unverified_settlement' })
    const pending = treasuryEvent(l, { id: 'o1', kind: 'deposit', amount: '10.5', date: '2026-11-22', txHash: '0xabc', state: 'pending' })
    expect(pending.ok && pending.draft.confirmation).toBe('pending')
    const confirmed = treasuryEvent(l, { id: 'o2', kind: 'deposit', amount: '10.5', date: '2026-11-22', txHash: '0xdef', state: 'confirmed' })
    expect(confirmed.ok).toBe(true)
    if (confirmed.ok) {
      const after = must(post(l, confirmed.draft))
      const tb = trialBalance(after)[0]!
      expect(tb.rows.some((r) => r.class === 'revenue' || r.class === 'expense')).toBe(false)
      expect(tb.rows.find((r) => r.code === '1020')!.balance).toBe(10_500_000n)
      expect(tb.rows.find((r) => r.code === '1010')!.balance).toBe(-10_500_000n)
    }
    expect(treasuryEvent(l, { id: 'o3', kind: 'payment', amount: '5', date: '2026-11-22', txHash: '0x1', state: 'confirmed', ownedDestination: true })).toEqual({ ok: false, reason: 'insufficient_data' })
  })
  test('adaptador de tesouraria não usa a camada do Circle Gateway', () => {
    const src = readFileSync(new URL('../src/lib/accounting/adapters.ts', import.meta.url), 'utf8')
    expect(/from ['"][^'"]*gateway/i.test(src)).toBe(false) // nenhum import da camada do Gateway
    expect(src.includes('@circle-fin')).toBe(false)
  })
})

describe('adaptadores preparados ficam desligados por padrão', () => {
  const l = emptyLedger()
  test('somente o Livro-Caixa vem ligado', () => {
    expect(l.flags.adapters).toEqual({ cashBook: true, sales: false, purchases: false, payables: false, payroll: false, logistics: false, treasury: false })
    expect(saleEvent(l, { id: 's1', date: '2026-11-22', total: 10, cogs: 4, method: 'prazo' }, 'BRL')).toEqual({ ok: false, reason: 'adapter_disabled' })
    expect(purchaseEvent(l, { id: 'p1', date: '2026-11-22', total: 10, paidNow: true, stockPosted: true }, 'BRL')).toEqual({ ok: false, reason: 'adapter_disabled' })
    expect(settlementEvent(l, { accountId: 'a', kind: 'payable', amount: 1, date: '2026-11-22', sequence: 1, settleIn: 'cash' }, 'BRL')).toEqual({ ok: false, reason: 'adapter_disabled' })
    expect(payrollEvent(l, { accountId: 'a', month: '2026-11', amount: 1, date: '2026-11-22' }, 'BRL')).toEqual({ ok: false, reason: 'adapter_disabled' })
    expect(freightEvent(l, { shipmentId: 's', total: 1, date: '2026-11-22', currency: 'BRL' })).toEqual({ ok: false, reason: 'adapter_disabled' })
  })
  test('quando ligados, exigem dados suficientes', () => {
    const on = { ...l, flags: { adapters: { cashBook: true, sales: true, purchases: true, payables: true, payroll: true, logistics: true, treasury: true } } }
    expect(saleEvent(on, { id: 's1', date: '2026-11-22', total: 10, cogs: 4, method: 'prazo' }, 'BRL').ok).toBe(true)
    expect(saleEvent(on, { id: 's1', date: '2026-11-22', total: 10, cogs: 4, method: 'prazo', canceled: true }, 'BRL').ok).toBe(false)
    expect(purchaseEvent(on, { id: 'p1', date: '2026-11-22', total: 10, paidNow: true, stockPosted: false }, 'BRL').ok).toBe(false) // estoque ainda não entrou
    expect(settlementEvent(on, { accountId: 'a', kind: 'receivable', amount: 5, date: '2026-11-22', sequence: 2, settleIn: 'cash' }, 'BRL')).toMatchObject({ ok: true, draft: { idempotencyKey: 'account:a:settle:2' } })
  })
})

describe('taxas e tributos', () => {
  const feeBase = { source: { module: 'treasury' as const, recordId: 'op1' }, kind: 'gateway' as const, amountMinor: '250000', currency: 'USDC' as CurrencyCode, paidFrom: 'usdc_gateway' as const, accountingDate: '2026-11-22' }
  test('taxa estimada não lança; confirmar lança uma vez; reconfirmar é recusado', () => {
    let l = emptyLedger()
    const reg = registerFee(l, { ...feeBase, status: 'estimated', rate: '0.0050', relatedRef: '0xaa' }, ctx)
    expect(reg.ok).toBe(true)
    l = reg.ledger
    expect(l.journal).toHaveLength(0)
    const key = l.fees[0]!.dedupeKey
    const conf = confirmFee(l, key, { accountingDate: '2026-11-22', amountMinor: '260000' }, ctx)
    expect(conf.ok).toBe(true)
    l = conf.ledger
    expect(l.journal).toHaveLength(1)
    expect(l.journal[0]!.lines.find((x) => x.side === 'debit')!.amountMinor).toBe('260000')
    const again = confirmFee(l, key, { accountingDate: '2026-11-22' }, ctx)
    expect(again.ok).toBe(false)
    expect(l.journal).toHaveLength(1)
  })
  test('mesma taxa registrada duas vezes não duplica', () => {
    let l = emptyLedger()
    l = registerFee(l, { ...feeBase, status: 'confirmed', relatedRef: '0xaa' }, ctx).ledger
    const dup = registerFee(l, { ...feeBase, status: 'confirmed', relatedRef: '0xaa' }, ctx)
    expect(dup.ok && dup.value.duplicate).toBe(true)
    expect(dup.ledger.fees).toHaveLength(1)
    expect(dup.ledger.journal).toHaveLength(1)
    const other = registerFee(dup.ledger, { ...feeBase, status: 'confirmed', relatedRef: '0xbb' }, ctx)
    expect(other.ledger.fees).toHaveLength(2)
  })
  test('taxa preserva origem, moeda, taxa e classificação; taxa inválida é recusada', () => {
    const r = registerFee(emptyLedger(), { ...feeBase, kind: 'network', status: 'confirmed', rate: '0.001', paidFrom: 'usdc_wallet' }, ctx)
    expect(r.ok).toBe(true)
    const fee = r.ledger.fees[0]!
    expect(fee).toMatchObject({ currency: 'USDC', rate: '0.001', source: { module: 'treasury', recordId: 'op1' } })
    expect(r.ledger.journal[0]!.lines.some((l) => l.accountCode === '5140')).toBe(true)
    expect(registerFee(emptyLedger(), { ...feeBase, status: 'confirmed', rate: 'abc' }, ctx).ok).toBe(false)
  })
  test('tributo só com regra validada e vigente; nunca assume alíquota', () => {
    const l = emptyLedger()
    expect(computeTax(l, 'x', 100_000n, '2026-11-22')).toEqual({ ok: false, error: 'not_found' })
    const rule = { id: 'r1', jurisdiction: 'XX', name: 'Teste', rate: '0.0500', accountSubtype: 'expense_tax' as const, validated: false, effectiveFrom: '2026-01-01' }
    expect(computeTax({ ...l, taxRules: [rule] }, 'r1', 100_000n, '2026-11-22')).toEqual({ ok: false, error: 'rule_not_validated' })
    const valid = { ...l, taxRules: [{ ...rule, validated: true, validatedBy: 'u1', validatedAt: NOW }] }
    expect(computeTax(valid, 'r1', 100_000n, '2026-11-22')).toMatchObject({ ok: true, taxMinor: 5000n })
    expect(computeTax(valid, 'r1', 100_000n, '2025-12-31')).toEqual({ ok: false, error: 'rule_not_effective' })
    expect(l.taxRules).toEqual([]) // nenhuma regra padrão
  })
})

describe('estornos e auditoria', () => {
  const base = () => must(post(emptyLedger(), draft()))
  test('estorno cria lançamento vinculado e zera o efeito; original permanece idêntico', () => {
    const l = base()
    const original = JSON.stringify(l.journal[0])
    const r = reverseEntry(l, l.journal[0]!.id, 'Lançamento duplicado', ctx)
    expect(r.ok).toBe(true)
    const next = r.ledger
    expect(JSON.stringify(next.journal[0])).toBe(original) // imutável
    const rev = next.journal[1]!
    expect(rev.reversalOf).toBe(l.journal[0]!.id)
    expect(rev.reason).toBe('Lançamento duplicado')
    expect(rev.postedBy).toEqual(user)
    expect(rev.lines.map((x) => x.side)).toEqual(['credit', 'debit'])
    expect(isReversed(next, l.journal[0]!.id)).toBe(true)
    const tb = trialBalance(next)[0]!
    expect(tb.rows.every((row) => row.balance === 0n)).toBe(true)
    expect(next.audit.some((a) => a.action === 'entry.reversed' && a.actor.id === 'u1')).toBe(true)
  })
  test('não estorna duas vezes, não estorna estorno, exige motivo, ignora agentes', () => {
    const l = base()
    const id = l.journal[0]!.id
    expect((reverseEntry(l, id, 'ab', ctx) as { errors: string[] }).errors).toContain('reason_required')
    const r1 = reverseEntry(l, id, 'motivo válido', ctx)
    const twice = reverseEntry(r1.ledger, id, 'motivo válido', ctx)
    expect(twice.ok).toBe(false)
    const rev = reverseEntry(r1.ledger, r1.ledger.journal[1]!.id, 'motivo válido', ctx)
    expect(rev.ok).toBe(false)
    expect(reverseEntry(l, id, 'motivo válido', { now: NOW, actor: { id: 'ai', kind: 'agent' } }).ok).toBe(false)
    expect(reverseEntry(l, 'JE-999999', 'motivo válido', ctx).ok).toBe(false)
  })
  test('trilha de auditoria registra ator e ação em ordem', () => {
    let l = base()
    l = reverseEntry(l, l.journal[0]!.id, 'correção', ctx).ledger
    const actions = l.audit.map((a) => a.action)
    expect(actions).toEqual(['event.posted', 'entry.reversed'])
    expect(l.audit.every((a) => a.actor.id === 'u1' && a.orgId === 'local')).toBe(true)
  })
})

describe('isolamento por organização', () => {
  test('evento de outra organização é recusado e auditado', () => {
    const r = post(emptyLedger('acme'), draft({ orgId: 'other' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toContain('org_mismatch')
    expect(r.ledger.journal).toHaveLength(0)
    expect(r.ledger.events).toHaveLength(0)
  })
  test('balancete ignora lançamentos de outra organização', () => {
    const l = must(post(emptyLedger('acme'), draft({ orgId: 'acme' })))
    const foreign = { ...l, journal: [...l.journal, { ...l.journal[0]!, id: 'JE-000002', orgId: 'intruder' }] }
    expect(trialBalance(foreign)[0]!.rows.find((r) => r.code === '1000')!.balance).toBe(10050n)
  })
})

describe('moedas e histórico', () => {
  test('moedas ficam em balancetes separados, sem conversão implícita', () => {
    let l = must(post(emptyLedger(), draft({ currency: 'BRL', idempotencyKey: 'a', amountMinor: '10000' })))
    l = must(post(l, draft({ currency: 'USDC', idempotencyKey: 'b', amountMinor: '10000000', source: { module: 'cashbook', recordId: 'c2' } })))
    const tbs = trialBalance(l)
    expect(tbs.map((t) => t.currency)).toEqual(['BRL', 'USDC'])
    expect(accountBalance(l, '1000', 'BRL')).toBe(10000n)
    expect(accountBalance(l, '1000', 'USDC')).toBe(10_000_000n)
    expect(accountBalance(l, '1000', 'USD')).toBe(0n)
  })
  test('lançamentos antigos mantêm a moeda original', () => {
    const l = must(post(emptyLedger(), draft({ currency: 'BRL' })))
    // a moeda do app muda depois; o lançamento histórico continua BRL
    expect(l.journal[0]!.currency).toBe('BRL')
    const after = must(post(l, draft({ currency: 'USDC', idempotencyKey: 'n1', source: { module: 'cashbook', recordId: 'c9' }, amountMinor: '1000000' })))
    expect(after.journal[0]!.currency).toBe('BRL')
    expect(after.journal[1]!.currency).toBe('USDC')
  })
  test('livro-caixa legado sem moeda é sinalizado, nunca convertido; importação exige moeda explícita e dry-run', () => {
    const cash = [
      { id: 'o1', type: 'in' as const, amount: 100, date: '2026-10-01', category: 'Outras receitas' },
      { id: 'o2', type: 'out' as const, amount: 40.5, date: '2026-10-02', category: 'Aluguel' },
    ]
    const l = emptyLedger()
    const report = reconcileCashBook(l, cash)
    expect(report.legacyUnledgered.map((x) => x.reason)).toEqual(['unknown_currency', 'unknown_currency'])
    const before = JSON.stringify(l)
    const plan = planHistoricalImport(l, cash, { currency: 'BRL' })
    expect(plan.candidates).toHaveLength(2)
    expect(JSON.stringify(l)).toBe(before) // dry-run não grava
    const applied = applyHistoricalImport(l, plan, ctx)
    expect(applied.posted).toBe(2)
    const second = planHistoricalImport(applied.ledger, cash, { currency: 'BRL' })
    expect(second.candidates).toHaveLength(0)
    expect(second.alreadyLedgered).toEqual(['o1', 'o2'])
    expect(reconcileCashBook(applied.ledger, cash).clean).toBe(true)
  })
  test('reconciliação detecta divergência, duplicidade e caixa removido sem estorno', () => {
    const cash = [{ id: 'c1', type: 'in' as const, amount: 100.5, date: '2026-11-22', category: 'Outras receitas' }]
    const l = must(post(emptyLedger(), draft({ amountMinor: '10050' })))
    expect(reconcileCashBook(l, cash).clean).toBe(true)
    expect(reconcileCashBook(l, [{ ...cash[0]!, amount: 99 }]).mismatches).toHaveLength(1)
    expect(reconcileCashBook(l, []).missingCash).toEqual(['c1'])
    const dup = { ...l, journal: [...l.journal, { ...l.journal[0]!, id: 'JE-000002' }] }
    expect(reconcileCashBook(dup, cash).duplicates).toEqual(['c1'])
  })
})

describe('agentes de IA nunca escrevem direto', () => {
  test('agente não posta; proposta exige aprovação humana e posta uma única vez', () => {
    const l = emptyLedger()
    const direct = postEvent(l, draft(), { now: NOW, actor: { id: 'ai-1', kind: 'agent' } })
    expect(direct.ok).toBe(false)
    expect(direct.ledger.journal).toHaveLength(0)

    const proposed = proposalApi.propose(l, draft(), 'ai-1', 'sugestão', NOW)
    expect(proposed.ok).toBe(true)
    if (!proposed.ok) return
    expect(proposed.ledger.journal).toHaveLength(0)
    const id = proposed.value.approvalId
    expect(proposed.ledger.approvals[0]!.requestedBy).toEqual({ id: 'ai-1', kind: 'agent' })

    const byAgent = decideApproval(proposed.ledger, id, { id: 'ai-1', kind: 'agent' }, 'approve', NOW)
    expect(byAgent.ok).toBe(false)

    const approved = proposalApi.approve(proposed.ledger, id, 'u1', NOW)
    expect(approved.ok).toBe(true)
    if (!approved.ok) return
    expect(approved.ledger.journal).toHaveLength(1)
    expect(approved.ledger.journal[0]!.postedBy).toEqual({ id: 'u1', kind: 'user' })
    const twice = proposalApi.approve(approved.ledger, id, 'u1', NOW)
    expect(twice.ok).toBe(false)
    expect(approved.ledger.journal).toHaveLength(1)
  })
  test('proposta inválida não entra na fila e rejeição não posta', () => {
    const l = emptyLedger()
    expect(requestApproval(l, draft({ amountMinor: '0' }), { id: 'ai', kind: 'agent' }, '', NOW).ok).toBe(false)
    const req = requestApproval(l, draft(), { id: 'ai', kind: 'agent' }, 'ok', NOW)
    if (!req.ok) throw new Error('expected ok')
    const rej = proposalApi.reject(req.ledger, req.value.approvalId, 'u1', NOW, 'não')
    expect(rej.ok && rej.ledger.journal).toHaveLength(0)
    expect(rej.ok && rej.ledger.approvals[0]!.status).toBe('rejected')
  })
  test('API de leitura devolve cópias: mutar o retorno não afeta o razão', () => {
    const l = must(post(emptyLedger(), draft()))
    const api = createReadApi(l)
    const entries = api.listJournal()
    entries[0]!.lines[0]!.amountMinor = '1'
    expect(l.journal[0]!.lines[0]!.amountMinor).toBe('10050')
    expect(api.accountBalance('1000', 'BRL')).toBe(10050n)
    expect(api.auditTrail().length).toBeGreaterThan(0)
  })
})

describe('normalização de estado', () => {
  test('estado ausente, parcial ou com plano inválido cai em padrões seguros sem perder dados', () => {
    expect(normalizeLedger(undefined).chart.length).toBeGreaterThan(10)
    const l = must(post(emptyLedger(), draft()))
    const partial = normalizeLedger({ journal: l.journal, events: l.events, chart: [{ code: '1', class: 'asset', subtype: 'cash', name: { pt: '', en: '' }, active: true }] })
    expect(partial.journal).toHaveLength(1)
    expect(partial.chart.length).toBeGreaterThan(10) // plano inválido descartado
    expect(partial.flags.adapters.cashBook).toBe(true)
  })
})

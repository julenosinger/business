import { beforeAll, describe, expect, test } from 'bun:test'

// O módulo de formatação lê o idioma do navegador ao carregar: simulamos o mínimo necessário.
const store: Record<string, string> = {}
const g = globalThis as unknown as Record<string, unknown>
g.document = { documentElement: {}, createElement: () => ({ style: {}, appendChild() {}, setAttribute() {} }), createTextNode: () => ({}), getElementsByTagName: () => [{ appendChild() {} }], head: { appendChild() {} }, querySelector: () => null, addEventListener() {} }
g.localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v } }
g.navigator = { language: 'pt-BR' }

type Format = typeof import('../src/lib/format')
type I18n = typeof import('../src/lib/i18n')
let fmt: Format
let i18n: I18n

beforeAll(async () => {
  i18n = await import('../src/lib/i18n')
  fmt = await import('../src/lib/format')
})

describe('USDC formatting and defaults', () => {
  test('USDC is shown as a number followed by USDC, with 2 to 6 decimals and no destructive rounding', () => {
    i18n.setLang('pt')
    expect(fmt.formatCurrency(1234.5, 'USDC')).toBe('1.234,50 USDC')
    expect(fmt.formatCurrency(12, 'USDC')).toBe('12,00 USDC')
    expect(fmt.formatCurrency(0.000123, 'USDC')).toBe('0,000123 USDC')
    expect(fmt.formatCurrency(1.234567, 'USDC')).toBe('1,234567 USDC')
    expect(fmt.formatCurrency(0.1 + 0.2, 'USDC')).toBe('0,30 USDC') // ruído de ponto flutuante não aparece
    expect(fmt.formatCurrency(-5, 'USDC')).toBe('-5,00 USDC')
    expect(fmt.formatCurrency(Number.NaN, 'USDC')).toBe('0,00 USDC')
    i18n.setLang('en')
    expect(fmt.formatCurrency(1234.5, 'USDC')).toBe('1,234.50 USDC')
    expect(fmt.formatCurrency(0.000123, 'USDC')).toBe('0.000123 USDC')
  })

  test('other currencies keep their usual formatting', () => {
    i18n.setLang('pt')
    expect(fmt.formatCurrency(10, 'BRL')).toContain('R$')
    expect(fmt.formatCurrency(10, 'EUR')).toContain('€')
    i18n.setLang('en')
    expect(fmt.formatCurrency(1234.5, 'USD')).toBe('$1,234.50')
    // Unknown codes never throw.
    expect(fmt.formatCurrency(10, 'XXXXX' as never)).toContain('10')
  })

  test('the app starts in USDC and money() follows the active currency', () => {
    i18n.setLang('en')
    expect(fmt.currencyCode()).toBe('USDC')
    expect(fmt.money(5)).toBe('5.00 USDC')
    fmt.setCurrency('BRL')
    expect(fmt.money(5)).toContain('R$')
    fmt.setCurrency('USDC')
    expect(fmt.moneyCompact(12_345)).toBe('12.3K USDC')
    expect(fmt.SETTLEMENT_ASSET).toBe('USDC')
  })

  test('the USDC rate is 1 only for the USDC currency; USD is never treated as USDC', () => {
    expect(fmt.usdcRateOf({ currency: 'USDC', usdcRate: null })).toBe(1)
    expect(fmt.usdcRateOf({ currency: 'USDC', usdcRate: 5 })).toBe(1)
    expect(fmt.usdcRateOf({ currency: 'USD', usdcRate: null })).toBeNull() // sem taxa válida: sem conversão
    expect(fmt.usdcRateOf({ currency: 'USD', usdcRate: 1.01 })).toBe(1.01)
    expect(fmt.usdcRateOf({ currency: 'BRL', usdcRate: 5.5 })).toBe(5.5)
  })

  test('toUsdc keeps exact values with rate 1 and rounds up to the cent otherwise', () => {
    for (const v of [12.34, 0.07, 19.99, 1234.56, 0.29, 4.35]) expect(fmt.toUsdc(v, 1)).toBe(v) // 12.34*100 não vira 12.35
    expect(fmt.toUsdc(11, 5.5)).toBe(2)
    expect(fmt.toUsdc(10, 3)).toBe(3.34)
    expect(fmt.toUsdc(100, 5)).toBe(20)
  })
})

describe('currency in the data model', () => {
  test('new installs start in USDC and existing preferences are kept', async () => {
    const { emptyData } = await import('../src/lib/store')
    expect(emptyData().settings.currency).toBe('USDC')
    const { parseBackup } = await import('../src/lib/backup')
    const old = { app: 'global-business-os', version: 1, exportedAt: '2026-01-01T00:00:00Z', data: { ...emptyData(), settings: { ...emptyData().settings, currency: 'BRL', usdcRate: 5.3 } } }
    const r = parseBackup(JSON.stringify(old))
    if (!r.ok) throw new Error(r.error)
    expect(r.data.settings.currency).toBe('BRL')
    expect(r.data.settings.usdcRate).toBe(5.3)
    // Backup antigo sem alguns campos: o que existe prevalece, o que falta usa o padrão novo.
    const partial = { app: 'global-business-os', version: 1, exportedAt: '2026-01-01T00:00:00Z', data: { products: [], settings: { company: 'Minha Loja' } } }
    const p = parseBackup(JSON.stringify(partial))
    if (!p.ok) throw new Error(p.error)
    expect(p.data.settings.company).toBe('Minha Loja')
    expect(p.data.settings.currency).toBe('USDC')
  })

  test('shipments accept USDC and keep the currency they were created with', async () => {
    const { CURRENCIES, createShipment } = await import('../src/lib/logistics')
    expect(CURRENCIES[0]).toBe('USDC')
    expect(CURRENCIES).toEqual(['USDC', 'BRL', 'USD', 'EUR'])
    const { emptyData } = await import('../src/lib/store')
    const d = emptyData()
    const mk = (currency: string) =>
      createShipment(
        d,
        { direction: 'transfer', origin: { name: '', city: 'A', country: 'BR' }, destination: { name: '', city: 'B', country: 'BR' }, senderName: '', recipientName: 'X', carrier: '', trackingNumber: '', method: '', packages: [], items: [{ name: 'i', sku: '', qty: 1 }], declaredValue: 123.456789, currency: currency as never, freightCost: 10.5 },
        '2026-11-21T12:00:00.000Z',
        't',
      )
    const usdc = mk('USDC')
    expect(usdc.ok && usdc.data.shipments[0]).toMatchObject({ currency: 'USDC', freightCost: 10.5 })
    const brl = mk('BRL')
    expect(brl.ok && brl.data.shipments[0]?.currency).toBe('BRL') // a moeda de cada registro não depende da moeda do app
    expect(mk('USDT').ok).toBe(false)
    // O valor declarado é guardado em 2 casas como antes; nada é reinterpretado ao trocar a moeda.
    expect(brl.ok && brl.data.shipments[0]?.declaredValue).toBe(123.46)
  })

  test('demo data follows the app currency for shipments and carriers (and keeps explicit foreign-currency examples)', async () => {
    const { buildDemoData } = await import('../src/lib/demo')
    const brl = buildDemoData('BRL')
    expect(brl.settings.currency).toBe('BRL')
    expect(brl.carriers.every((c) => !c.cost || c.cost.currency === 'BRL')).toBe(true)
    expect(brl.shipments.filter((s) => s.currency === 'BRL').length).toBeGreaterThan(5)
    const usdc = buildDemoData()
    expect(usdc.settings.currency).toBe('USDC')
    expect(usdc.shipments.filter((s) => s.currency === 'USDC').length).toBeGreaterThan(5)
    expect(usdc.shipments.some((s) => s.currency === 'USD')).toBe(true) // exemplo multimoeda mantido
  })
})

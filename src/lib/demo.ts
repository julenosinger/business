import {
  CAT_PAYROLL,
  CAT_PURCHASE,
  CAT_SALES,
  type Account,
  type AppData,
  type Contact,
  type CurrencyCode,
  type Employee,
  type Entry,
  type Product,
  type PurchaseRef,
  type Sale,
} from './types'
import { addDays, iso, round2, today } from './format'
import { t } from './i18n'
import * as logistics from './logistics'
import * as fulfillment from './fulfillment'
import * as receiving from './receiving'
import * as carriers from './carriers'
import * as freight from './freight'
import * as international from './international'
import * as returns from './returns'

/** Dados de demonstração gerados localmente. Não representam um negócio real. */
/** Dados de demonstração. As moedas das remessas e das transportadoras seguem a moeda do app (`currency`). */
export function buildDemoData(currency: CurrencyCode = 'USDC'): AppData {
  let seed = 7
  const rnd = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  let n = 0
  const id = (p: string) => `${p}${++n}`

  const prod = (sku: string, name: string, category: string, cost: number, price: number, stock: number, minStock: number): Product => ({
    id: id('p'),
    sku,
    name,
    category,
    unit: 'un',
    cost,
    price,
    stock,
    minStock,
  })
  const products = [
    prod('CAF-001', t('Café especial 500g', 'Specialty coffee 500g'), t('Mercearia', 'Grocery'), 18, 32, 64, 20),
    prod('CHA-002', t('Chá artesanal 100g', 'Artisan tea 100g'), t('Mercearia', 'Grocery'), 9, 19.9, 18, 20),
    prod('CAN-003', t('Caneca térmica', 'Thermal mug'), t('Utilidades', 'Housewares'), 22, 49.9, 35, 10),
    prod('GAR-004', t('Garrafa inox 750ml', 'Steel bottle 750ml'), t('Utilidades', 'Housewares'), 28, 69.9, 8, 10),
    prod('CAD-005', t('Caderno premium', 'Premium notebook'), t('Papelaria', 'Stationery'), 12, 29.9, 90, 25),
    prod('CAN-006', t('Kit canetas (6)', 'Pen set (6)'), t('Papelaria', 'Stationery'), 8, 21.5, 120, 30),
    prod('MOC-007', t('Mochila urbana', 'Urban backpack'), t('Acessórios', 'Accessories'), 70, 159, 14, 6),
    prod('FON-008', t('Fone Bluetooth', 'Bluetooth headphones'), t('Eletrônicos', 'Electronics'), 55, 129, 5, 8),
    prod('CAR-009', t('Carregador USB-C', 'USB-C charger'), t('Eletrônicos', 'Electronics'), 15, 39.9, 42, 15),
    prod('VEL-010', t('Vela aromática', 'Scented candle'), t('Casa', 'Home'), 10, 34, 27, 12),
  ]

  const contact = (kind: Contact['kind'], name: string, doc: string, email: string, phone: string): Contact => ({
    id: id('c'),
    kind,
    name,
    doc,
    email,
    phone,
    wallet: '',
  })
  const contacts = [
    contact('customer', 'Mariana Souza', '', 'mariana@exemplo.com', '(11) 90000-0001'),
    contact('customer', t('Padaria Bom Dia Ltda', 'Good Morning Bakery Ltd'), '', 'contato@exemplo.com', '(11) 90000-0002'),
    contact('customer', t('Estúdio Aurora', 'Aurora Studio'), '', 'aurora@exemplo.com', '(21) 90000-0003'),
    contact('supplier', t('Distribuidora Central', 'Central Distributor'), '', 'vendas@exemplo.com', '(11) 4000-0001'),
    contact('supplier', t('Importadora Norte', 'North Importer'), '', 'compras@exemplo.com', '(11) 4000-0002'),
    contact('supplier', t('Papelaria Atacado SP', 'Wholesale Stationery Co'), '', 'atacado@exemplo.com', '(11) 4000-0003'),
  ]
  const customers = contacts.filter((c) => c.kind === 'customer')
  const suppliers = contacts.filter((c) => c.kind === 'supplier')

  const employees: Employee[] = [
    { id: id('e'), name: 'Ana Ribeiro', role: t('Gerente', 'Manager'), salary: 5200, wallet: '', admission: '2023-03-01', active: true },
    { id: id('e'), name: 'Carlos Lima', role: t('Vendedor', 'Salesperson'), salary: 2800, wallet: '', admission: '2024-01-15', active: true },
    { id: id('e'), name: 'Julia Prado', role: t('Estoquista', 'Stock clerk'), salary: 2500, wallet: '', admission: '2024-06-10', active: true },
    { id: id('e'), name: 'Rafael Gomes', role: t('Atendimento', 'Customer support'), salary: 2300, wallet: '', admission: '2025-02-03', active: true },
  ]

  const sales: Sale[] = []
  const entries: Entry[] = []
  const accounts: Account[] = []
  const now = new Date()
  const methods = ['pix', 'cartao', 'dinheiro', 'usdc', 'prazo'] as const

  for (let back = 150; back >= 0; back -= 2) {
    const d = new Date(now)
    d.setDate(d.getDate() - back)
    const date = iso(d)
    const count = 1 + Math.floor(rnd() * 3)
    for (let s = 0; s < count; s++) {
      const items = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => {
        const p = products[Math.floor(rnd() * products.length)]
        return { productId: p.id, name: p.name, qty: 1 + Math.floor(rnd() * 4), price: p.price, cost: p.cost }
      })
      const total = round2(items.reduce((a, i) => a + i.qty * i.price, 0))
      const cogs = round2(items.reduce((a, i) => a + i.qty * i.cost, 0))
      const method = methods[Math.floor(rnd() * methods.length)]
      const cust = rnd() > 0.5 ? (customers[Math.floor(rnd() * customers.length)]) : undefined
      const customerName = cust?.name ?? t('Consumidor final', 'Walk-in customer')
      let accountId: string | undefined
      if (method === 'prazo') {
        accountId = id('a')
        const due = addDays(date, 30)
        const paid = due < today()
        accounts.push({
          id: accountId,
          kind: 'receivable',
          description: t('Venda a prazo', 'Credit sale'),
          contactId: cust?.id,
          contactName: customerName,
          amount: total,
          dueDate: due,
          category: CAT_SALES,
          status: paid ? 'paid' : 'open',
          paidAt: paid ? due : undefined,
          source: 'sale',
        })
        if (paid) entries.push({ id: id('l'), date: due, type: 'in', category: CAT_SALES, description: t(`Venda a prazo - ${customerName}`, `Credit sale - ${customerName}`), amount: total })
      } else {
        entries.push({ id: id('l'), date, type: 'in', category: CAT_SALES, description: t(`Venda para ${customerName} (${method})`, `Sale to ${customerName} (${method})`), amount: total })
      }
      sales.push({ id: id('s'), date, customerId: cust?.id, customerName, items, total, cogs, method, accountId })
    }
  }

  // Despesas mensais dos últimos 6 meses
  for (let m = 5; m >= 0; m--) {
    const base = new Date(now.getFullYear(), now.getMonth() - m, 5)
    const day = iso(base)
    if (day > today()) continue
    const put = (category: string, description: string, amount: number) =>
      entries.push({ id: id('l'), date: day, type: 'out', category, description, amount })
    put('Aluguel', t('Aluguel da loja', 'Store rent'), 3800)
    put(CAT_PAYROLL, t('Folha de pagamento', 'Payroll'), employees.reduce((s, e) => s + e.salary, 0))
    put('Serviços e utilidades', t('Energia, água e internet', 'Power, water and internet'), 780)
    put('Marketing', t('Anúncios e redes sociais', 'Ads and social media'), 600 + Math.round(rnd() * 400))
    put('Impostos', t('Impostos do mês', 'Monthly taxes'), 1500 + Math.round(rnd() * 600))
    put(CAT_PURCHASE, t('Reposição de mercadorias', 'Merchandise restocking'), 6500 + Math.round(rnd() * 2500))
  }

  // Contas em aberto
  const open = (kind: Account['kind'], description: string, who: string, amount: number, inDays: number, category: string, source: Account['source']) =>
    accounts.push({
      id: id('a'),
      kind,
      description,
      contactName: who,
      amount,
      dueDate: addDays(today(), inDays),
      category,
      status: 'open',
      source,
    })
  open('payable', t('Compra de mercadorias', 'Merchandise purchase'), suppliers[0]?.name ?? '', 4850, 6, CAT_PURCHASE, 'purchase')
  open('payable', t('Compra de mercadorias', 'Merchandise purchase'), suppliers[1]?.name ?? '', 3120, 11, CAT_PURCHASE, 'purchase')
  open('payable', t('Compra de papelaria', 'Stationery purchase'), suppliers[2]?.name ?? '', 1480, 16, CAT_PURCHASE, 'purchase')
  open('payable', t('Impostos do mês', 'Monthly taxes'), t('Receita', 'Tax authority'), 1900, 9, 'Impostos', 'manual')
  open('payable', t('Aluguel da loja', 'Store rent'), t('Imobiliária', 'Landlord'), 3800, 14, 'Aluguel', 'manual')
  open('receivable', t('Venda corporativa', 'Corporate sale'), customers[1]?.name ?? '', 2650, 4, CAT_SALES, 'manual')
  open('receivable', t('Prestação de serviço', 'Service rendered'), customers[2]?.name ?? '', 1800, 12, 'Serviços prestados', 'manual')

  const base: AppData = {
    products,
    moves: [],
    contacts,
    entries: entries.sort((a, b) => b.date.localeCompare(a.date)),
    accounts: accounts.sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    sales: sales.sort((a, b) => b.date.localeCompare(a.date)),
    employees,
    treasuryOps: [],
    requests: [],
    shipments: [],
    carriers: [],
    returns: [],
    purchases: [],
    receipts: [],
    settings: { company: t('Comércio Demonstração', 'Demo Store'), branch: 'Matriz', owner: 'Empreendedor', currency, usdcRate: null, approvalLimit: null },
  }
  return { ...base, ...demoShipments(base, now) }
}

/**
 * Remessas de demonstração. Passam pelas mesmas regras do módulo (transições, auditoria), com datas no passado.
 * Transportadoras e códigos são fictícios; nenhuma integração real existe.
 */
function demoShipments(start: AppData, now: Date): Pick<AppData, 'shipments' | 'purchases' | 'receipts' | 'carriers' | 'returns'> {
  let d = start
  const stamp = (daysAgo: number, hour: number): string => {
    const x = new Date(now)
    x.setDate(x.getDate() - daysAgo)
    x.setHours(hour, 0, 0, 0)
    return x.toISOString()
  }
  const day = (daysAgo: number): string => iso(new Date(stamp(daysAgo, 12)))
  const ok = <T,>(r: logistics.Outcome<T>): T => {
    if (!r.ok) throw new Error(`demo shipment: ${r.errors.join(',')}`)
    d = r.data
    return r.value
  }
  const carrier = t('Transportadora Exemplo', 'Example Carrier')
  // Transportadoras fictícias: o link usa example.com e nenhuma integração real existe.
  const c1 = ok(
    carriers.createCarrier(
      d,
      {
        name: carrier,
        countries: ['BR'],
        methods: [t('Padrão', 'Standard'), t('Expresso', 'Express')],
        contactName: '',
        email: '',
        phone: '',
        trackingUrlTemplate: 'https://example.com/track?code={tracking}',
        serviceLevels: [
          { name: t('Padrão', 'Standard'), minDays: 3, maxDays: 5 },
          { name: t('Expresso', 'Express'), minDays: 1, maxDays: 2 },
        ],
        cost: { currency: start.settings.currency, baseFee: 20, perKg: 6 },
        active: true,
      },
      stamp(30, 9),
    ),
  ).id
  const c2 = ok(
    carriers.createCarrier(
      d,
      { name: 'Expresso Demo', countries: ['BR', 'CN', 'PT'], methods: [t('Aéreo', 'Air freight'), t('Marítimo', 'Sea freight')], contactName: '', email: '', phone: '', trackingUrlTemplate: '', serviceLevels: [], active: true },
      stamp(30, 10),
    ),
  ).id
  const customers = d.contacts.filter((c) => c.kind === 'customer')
  const suppliers = d.contacts.filter((c) => c.kind === 'supplier')
  const sale = d.sales.find((s) => !s.canceledAt && s.items.length > 0)
  const p = d.products
  /** Item de saída: escolhe um produto com saldo e limita a quantidade ao estoque (a expedição confere o saldo). */
  const line = (i: number, qty: number) => {
    const x = Array.from({ length: p.length }, (_, k) => p[(i + k) % p.length]).find((y) => !!y && y.stock >= 1)
    return x ? [{ productId: x.id, name: x.name, sku: x.sku, qty: Math.max(1, Math.min(qty, Math.floor(x.stock))) }] : []
  }
  /** Item de entrada: não depende do saldo atual. */
  const inLine = (i: number, qty: number) => {
    const x = p[i % Math.max(p.length, 1)]
    return x ? [{ productId: x.id, name: x.name, sku: x.sku, qty }] : []
  }
  const hub = { name: t('Armazém central', 'Central warehouse'), city: 'São Paulo', country: 'BR' }
  const box = [{ weightKg: 3.2, lengthCm: 40, widthCm: 30, heightCm: 20 }]
  const make = (over: Partial<logistics.ShipmentInput>, createdAgo: number) =>
    ok(
      logistics.createShipment(
        d,
        {
          direction: 'outbound',
          origin: hub,
          destination: { name: '', city: 'Rio de Janeiro', country: 'BR' },
          senderName: d.settings.company,
          recipientName: customers[0]?.name ?? 'Cliente',
          carrier,
          carrierId: c1,
          trackingNumber: '',
          method: t('Padrão', 'Standard'),
          packages: box,
          items: line(0, 2),
          declaredValue: 480,
          currency: start.settings.currency,
          freightCost: 42.9,
          ...over,
        },
        stamp(createdAgo, 9),
        d.settings.owner,
      ),
    ).id
  const go = (id: string, to: Parameters<typeof logistics.transitionShipment>[2], ago: number, hour: number, note = '', deliveredAt?: string) =>
    ok(logistics.transitionShipment(d, id, to, { note, deliveredAt }, stamp(ago, hour), day(ago), d.settings.owner))
  const track = (id: string, ago: number, hour: number, location: string, description: string) =>
    ok(logistics.addTrackingEvent(d, id, { occurredAt: stamp(ago, hour), location, description }, stamp(ago, hour + 1), d.settings.owner))

  /** Separa e embala tudo (exigido antes de despachar remessas de saída com itens do estoque). */
  const prep = (id: string, ago: number, hour: number) => {
    const items = d.shipments.find((s) => s.id === id)?.items ?? []
    for (const it of items) if (it.productId) ok(fulfillment.pickItem(d, id, it.id, it.qty, stamp(ago, hour), d.settings.owner))
    ok(fulfillment.packShipment(d, id, stamp(ago, hour + 1), d.settings.owner))
  }

  // 1. Entregue no prazo, ligada a uma venda (a venda já baixou o estoque: a expedição não baixa de novo)
  const saleItems = sale
    ? sale.items.slice(0, 1).map((i) => ({ productId: i.productId, name: i.name, sku: d.products.find((x) => x.id === i.productId)?.sku ?? '', qty: i.qty }))
    : line(0, 2)
  const a = make(
    {
      orderRef: sale ? { kind: 'sale', id: sale.id, label: sale.id } : undefined,
      items: saleItems,
      recipientName: sale?.customerName || customers[0]?.name || 'Cliente',
      trackingNumber: 'DEMO100001',
      estimatedDelivery: day(6),
    },
    9,
  )
  go(a, 'ready', 9, 10)
  prep(a, 9, 11)
  go(a, 'dispatched', 8, 9)
  track(a, 8, 11, hub.name, t('Coletado pela transportadora', 'Picked up by the carrier'))
  go(a, 'in_transit', 7, 9)
  go(a, 'out_for_delivery', 6, 8)
  go(a, 'delivered', 6, 15, '', day(6))
  ok(fulfillment.recordPod(d, a, { receivedBy: customers[0]?.name ?? 'Cliente', reference: 'DEMO-POD-1', note: '' }, stamp(6, 16), d.settings.owner))
  ok(fulfillment.closeFulfillment(d, a, stamp(6, 17), d.settings.owner))

  // 2. Em trânsito
  const b = make({ trackingNumber: 'DEMO100002', destination: { name: '', city: 'Belo Horizonte', country: 'BR' }, recipientName: customers[1]?.name ?? 'Cliente', items: line(1, 4), estimatedDelivery: addDays(today(), 2), freightCost: 58 }, 4)
  go(b, 'ready', 4, 10)
  prep(b, 4, 11)
  go(b, 'dispatched', 3, 9)
  go(b, 'in_transit', 2, 9)
  track(b, 2, 14, 'Campinas, BR', t('Em trânsito para o centro de distribuição', 'In transit to the distribution center'))

  // 3. Atrasada
  const c = make({ trackingNumber: 'DEMO100003', destination: { name: '', city: 'Curitiba', country: 'BR' }, items: line(2, 1), estimatedDelivery: addDays(today(), -1), freightCost: 36.5 }, 7)
  go(c, 'ready', 7, 10)
  prep(c, 7, 11)
  go(c, 'dispatched', 6, 9)
  go(c, 'in_transit', 5, 9)
  go(c, 'delayed', 1, 10, t('Atraso informado pela transportadora por chuvas na rota', 'Delay reported by the carrier due to rain on the route'))

  // 4. Entrada de fornecedor despachada
  const e = make(
    {
      direction: 'inbound',
      orderRef: { kind: 'purchase', label: t('Pedido de compra (referência manual)', 'Purchase order (manual reference)') },
      origin: { name: suppliers[0]?.name ?? 'Fornecedor', city: 'Shenzhen', country: 'CN' },
      destination: { ...hub },
      senderName: suppliers[0]?.name ?? 'Fornecedor',
      recipientName: d.settings.company,
      trackingNumber: 'DEMO100004',
      method: t('Aéreo', 'Air freight'),
      carrierId: c2,
      items: inLine(3, 40),
      declaredValue: 3200,
      currency: 'USD',
      freightCost: 410,
      estimatedDelivery: addDays(today(), 5),
    },
    3,
  )
  go(e, 'ready', 3, 10)
  go(e, 'dispatched', 2, 11)

  // 5. Transferência pronta e 6. rascunho
  const f = make({ direction: 'transfer', destination: { name: t('Loja Centro', 'Downtown store'), city: 'São Paulo', country: 'BR' }, recipientName: t('Loja Centro', 'Downtown store'), items: line(4, 12), freightCost: 0, declaredValue: 900 }, 1)
  go(f, 'ready', 1, 14)
  make({ destination: { name: '', city: 'Porto Alegre', country: 'BR' }, items: line(5, 3), estimatedDelivery: addDays(today(), 8) }, 0)

  // 7. Exceção
  const g = make({ trackingNumber: 'DEMO100005', destination: { name: '', city: 'Salvador', country: 'BR' }, items: line(6, 2), estimatedDelivery: addDays(today(), 1), freightCost: 64 }, 5)
  go(g, 'ready', 5, 10)
  prep(g, 5, 11)
  go(g, 'dispatched', 4, 9)
  go(g, 'in_transit', 3, 9)
  go(g, 'exception', 0, 9, t('Endereço de entrega não localizado', 'Delivery address not found'))


  // 8. Entrada ligada a uma compra que aguardava recebimento: já chegou, falta conferir (gera alerta). O estoque ainda não somou.
  const supplierName = suppliers[0]?.name ?? 'Fornecedor'
  const wait = inLine(2, 30)
  const pur1: PurchaseRef = {
    id: 'PUR-0001',
    date: day(5),
    supplierId: suppliers[0]?.id,
    supplierName,
    items: wait.map((i) => ({ ...i, cost: d.products.find((x) => x.id === i.productId)?.cost ?? 0 })),
    total: wait.reduce((s, i) => s + i.qty * (d.products.find((x) => x.id === i.productId)?.cost ?? 0), 0),
    stockPosted: false,
    createdAt: stamp(5, 9),
  }
  // 9. Entrada de uma compra já lançada pelo fluxo padrão (estoque já somado): recebida com uma falta registrada.
  const done = inLine(1, 20)
  const pur2: PurchaseRef = {
    id: 'PUR-0002',
    date: day(12),
    supplierId: suppliers[1]?.id,
    supplierName: suppliers[1]?.name ?? 'Fornecedor',
    items: done.map((i) => ({ ...i, cost: d.products.find((x) => x.id === i.productId)?.cost ?? 0 })),
    total: done.reduce((s, i) => s + i.qty * (d.products.find((x) => x.id === i.productId)?.cost ?? 0), 0),
    stockPosted: true,
    createdAt: stamp(12, 9),
  }
  d = { ...d, purchases: [pur2, pur1] }
  const inbound = (purchase: PurchaseRef, items: ReturnType<typeof inLine>, ago: number, sender: string, tracking: string) => {
    const id = make(
      {
        direction: 'inbound',
        orderRef: { kind: 'purchase', id: purchase.id, label: purchase.supplierName },
        origin: { name: sender, city: 'Curitiba', country: 'BR' },
        destination: { ...hub },
        senderName: sender,
        recipientName: d.settings.company,
        trackingNumber: tracking,
        items,
        freightCost: 120,
        estimatedDelivery: day(ago - 3),
      },
      ago,
    )
    go(id, 'ready', ago, 10)
    go(id, 'dispatched', ago - 1, 9)
    go(id, 'in_transit', ago - 2, 9)
    go(id, 'delivered', ago - 3, 14, '', day(ago - 3))
    return id
  }
  inbound(pur1, wait, 8, supplierName, 'DEMO100006')
  const rcv = inbound(pur2, done, 14, suppliers[1]?.name ?? 'Fornecedor', 'DEMO100007')
  const rcvItems = d.shipments.find((s) => s.id === rcv)?.items ?? []
  ok(
    receiving.receiveGoods(
      d,
      rcv,
      { lines: rcvItems.map((it) => ({ itemId: it.id, receivedQty: Math.max(1, it.qty - 2), damagedQty: 0 })), notes: t('Faltaram 2 unidades na entrega', '2 units were missing from the delivery') },
      stamp(10, 15),
      day(10),
      d.settings.owner,
    ),
  )

  // Custos de frete, dados internacionais e uma devolução de exemplo.
  ok(freight.setFreight(d, a, { freightCost: 42.9, estimated: 39, insurance: 4.5, fees: [{ label: t('Combustível', 'Fuel'), amount: 3.2 }] }, stamp(6, 18), d.settings.owner))
  const eItem = d.shipments.find((s) => s.id === e)?.items[0]
  if (eItem) ok(international.setInternational(d, e, { incoterm: 'FOB', customsRef: '', importExportRef: '', dutiesAmount: 0, taxesAmount: 0, hsCodes: { [eItem.id]: '09012100' } }, stamp(2, 12), d.settings.owner))
  const aItem = d.shipments.find((s) => s.id === a)?.items[0]
  if (aItem) {
    const rma = ok(returns.requestReturn(d, { shipmentId: a, lines: [{ itemId: aItem.id, qty: 1 }], reason: t('Embalagem veio amassada', 'Packaging arrived dented') }, stamp(4, 10), d.settings.owner)).id
    ok(returns.authorizeReturn(d, rma, '', stamp(4, 11), d.settings.owner))
    ok(returns.createReturnShipment(d, rma, stamp(4, 12), d.settings.owner))
  }

  return { shipments: d.shipments, purchases: d.purchases, receipts: d.receipts, carriers: d.carriers, returns: d.returns }
}

import { useMemo, useState } from 'react'
import { Layout } from '@/components/Layout'
import { NavContext, type Intent, type Nav, type PageId, type ProfileIntent } from '@/lib/nav'
import { StoreProvider } from '@/lib/store'
import { I18nProvider, useLang } from '@/lib/i18n'
import { readInvoiceFromLocation } from '@/lib/invoice'
import { InvalidInvoice, PayPage } from '@/pages/PayPage'
import { PaymentWatcher } from '@/components/PaymentWatcher'
import { ReconciliationCoordinator } from '@/components/ReconciliationCoordinator'
import { Dashboard } from '@/pages/Dashboard'
import { Accounting } from '@/pages/Accounting'
import { Finance } from '@/pages/Finance'
import { Sales } from '@/pages/Sales'
import { Stock } from '@/pages/Stock'
import { Purchases } from '@/pages/Purchases'
import { Logistics } from '@/pages/Logistics'
import { Contacts } from '@/pages/Contacts'
import { Employees } from '@/pages/Employees'
import { Treasury } from '@/pages/Treasury'
import { Reports } from '@/pages/Reports'
import { Agents } from '@/pages/Agents'
import { Chatbot } from '@/pages/Chatbot'
import { SettingsPage } from '@/pages/SettingsPage'

function Router({ page }: { page: PageId }) {
  switch (page) {
    case 'dashboard':
      return <Dashboard />
    case 'accounting':
      return <Accounting />
    case 'finance':
      return <Finance />
    case 'sales':
      return <Sales />
    case 'stock':
      return <Stock />
    case 'purchases':
      return <Purchases />
    case 'logistics':
      return <Logistics />
    case 'customers':
      return <Contacts kind="customer" />
    case 'suppliers':
      return <Contacts kind="supplier" />
    case 'hr':
      return <Employees />
    case 'treasury':
      return <Treasury />
    case 'reports':
      return <Reports />
    case 'agents':
      return <Agents />
    case 'chatbot':
      return <Chatbot />
    case 'settings':
      return <SettingsPage />
  }
}

/** Link público de cobrança: mostra só a página de pagamento do cliente. */
export default function App() {
  // Inscreve o app inteiro no idioma: ao trocar PT/EN, tudo é redesenhado sem remontar (formulários mantêm o que foi digitado).
  useLang()
  const [link] = useState(readInvoiceFromLocation)
  if (link.present) {
    return <I18nProvider>{link.invoice ? <PayPage invoice={link.invoice} /> : <InvalidInvoice />}</I18nProvider>
  }
  return <Workspace />
}

function Workspace() {
  const [page, setPage] = useState<PageId>('dashboard')
  const [payAccountId, setPayAccountId] = useState<string | null>(null)
  const [intent, setIntent] = useState<Intent | null>(null)
  const [ledgerFocus, setLedgerFocus] = useState<string | null>(null)
  const [profileIntent, setProfileIntent] = useState<ProfileIntent | null>(null)

  const pageFor = (i: ProfileIntent): PageId => {
    if (i.kind === 'sale' || i.kind === 'sales') return 'sales'
    if (i.kind === 'purchase' || i.kind === 'purchases') return 'purchases'
    return 'finance'
  }

  const nav = useMemo<Nav>(
    () => ({
      page,
      go: (p) => {
        setPage(p)
        window.scrollTo({ top: 0 })
      },
      payAccountId,
      intent,
      requestIntent: (i) => {
        setIntent(i)
        if (i) {
          setPage('treasury')
          window.scrollTo({ top: 0 })
        }
      },
      requestPay: (id) => {
        setPayAccountId(id)
        if (id) {
          setPage('treasury')
          window.scrollTo({ top: 0 })
        }
      },
      ledgerFocus,
      focusLedger: (query) => {
        setLedgerFocus(query)
        setPage('accounting')
        window.scrollTo({ top: 0 })
      },
      clearLedgerFocus: () => setLedgerFocus(null),
      profileIntent,
      openProfileIntent: (i) => {
        setProfileIntent(i)
        setPage(pageFor(i))
        window.scrollTo({ top: 0 })
      },
      clearProfileIntent: () => setProfileIntent(null),
    }),
    [page, payAccountId, intent, ledgerFocus, profileIntent],
  )

  return (
    <StoreProvider>
      <PaymentWatcher />
      <ReconciliationCoordinator />
      <NavContext.Provider value={nav}>
        <I18nProvider>
          <Layout>
            <Router page={page} />
          </Layout>
        </I18nProvider>
      </NavContext.Provider>
    </StoreProvider>
  )
}

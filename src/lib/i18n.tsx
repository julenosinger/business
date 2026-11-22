import { useSyncExternalStore, type ReactNode } from 'react'

export type Lang = 'pt' | 'en'

const KEY = 'gbos:lang'

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'pt' || saved === 'en') return saved
  } catch {
    // ignore
  }
  return navigator.language.toLowerCase().startsWith('pt') ? 'pt' : 'en'
}

let current: Lang = initial()

const applyLang = (l: Lang) => {
  document.documentElement.lang = l === 'pt' ? 'pt-BR' : 'en'
}
applyLang(current)

export const getLang = (): Lang => current
export const locale = (): string => (current === 'pt' ? 'pt-BR' : 'en-US')

/** Returns the Portuguese or English text depending on the active language. */
export function t(pt: string, en: string): string {
  return current === 'pt' ? pt : en
}

const CATEGORY_EN: Record<string, string> = {
  Vendas: 'Sales',
  'Compra de mercadorias': 'Merchandise purchases',
  'Folha de pagamento': 'Payroll',
  'Serviços prestados': 'Services rendered',
  'Outras receitas': 'Other income',
  Rendimentos: 'Investment income',
  Aluguel: 'Rent',
  Impostos: 'Taxes',
  Marketing: 'Marketing',
  'Serviços e utilidades': 'Services and utilities',
  Logística: 'Logistics',
  'Outras despesas': 'Other expenses',
}

/** Categories are stored in Portuguese; this shows them in the active language. */
export function cat(name: string): string {
  return current === 'pt' ? name : (CATEGORY_EN[name] ?? name)
}

interface LangCtx {
  lang: Lang
  setLang: (l: Lang) => void
}

const listeners = new Set<() => void>()
const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Troca o idioma e avisa quem está inscrito. A tela se redesenha sem remontar: o que foi digitado nos formulários fica. */
export function setLang(l: Lang): void {
  if (l === current) return
  try {
    localStorage.setItem(KEY, l)
  } catch {
    // ignore
  }
  current = l
  applyLang(l)
  listeners.forEach((fn) => fn())
}

/**
 * Inscreve o componente no idioma. Quem chama `useLang` no topo do app (App.tsx) faz toda a árvore ser recalculada
 * quando o idioma muda, sem remontar nada. Os componentes comuns continuam usando `t()` normalmente.
 */
export function useLang(): LangCtx {
  const lang = useSyncExternalStore(subscribe, getLang)
  return { lang, setLang }
}

/** Mantido por compatibilidade: o idioma agora é um estado global simples. */
export function I18nProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}

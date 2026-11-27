import { useEffect, useState } from 'react'
import { isAddress } from 'viem'
import { getShareBase } from './share'
import type { PaymentRequest } from './types'
import { GATEWAY_CHAINS, type GatewayChain } from './gateway'
import { Amount } from '@/onchain-money'
import { USDC_DECIMALS } from '@/onchain-facts'

/** Dados públicos de uma cobrança em USDC. Nada aqui é segredo. */
export interface Invoice {
  v: 1
  /** Carteira que recebe. */
  to: string
  /** Rede (identificador do SDK da Circle). */
  ch: GatewayChain['key']
  /** Valor exato em USDC. */
  amt: string
  /** Identificador da cobrança. */
  ref: string
  desc: string
  /** Nome de quem cobra. */
  who: string
  /** Via de pagamento. `gateway_direct` = depósito Circle Gateway sem backend. */
  rail?: 'gateway_direct'
  /** Conta institucional creditada no depósito direto (`gateway_direct`). */
  dp?: string
}

export const INVOICE_PARAM = 'invoice'

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  bytes.forEach((b) => {
    bin += String.fromCharCode(b)
  })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): string {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

export function encodeInvoice(inv: Invoice): string {
  return toBase64Url(JSON.stringify(inv))
}

/** Caminho relativo com a query; use buildShareLink() para montar o link completo. */
export function invoicePath(inv: Invoice): string {
  return `/?${INVOICE_PARAM}=${encodeInvoice(inv)}`
}

export function decodeInvoice(value: string): Invoice | null {
  try {
    const raw = JSON.parse(fromBase64Url(value)) as Partial<Invoice>
    if (raw.v !== 1) return null
    if (typeof raw.to !== 'string' || !isAddress(raw.to)) return null
    if (!GATEWAY_CHAINS.some((c) => c.key === raw.ch)) return null
    if (typeof raw.amt !== 'string') return null
    const amount = Amount.parse(raw.amt, USDC_DECIMALS)
    if (!amount.isPositive()) return null
    return {
      v: 1,
      to: raw.to,
      ch: raw.ch as GatewayChain['key'],
      amt: amount.toString(),
      ref: String(raw.ref ?? '').slice(0, 32),
      desc: String(raw.desc ?? '').slice(0, 120),
      who: String(raw.who ?? '').slice(0, 60),
      ...(raw.rail === 'gateway_direct' ? { rail: 'gateway_direct' as const } : {}),
      ...(typeof raw.dp === 'string' && isAddress(raw.dp) ? { dp: raw.dp } : {}),
    }
  } catch {
    return null
  }
}

/** Lê o parâmetro da URL atual. `present` é true mesmo quando o link está inválido. */
export function readInvoiceFromLocation(): { present: boolean; invoice: Invoice | null } {
  const value = new URLSearchParams(window.location.search).get(INVOICE_PARAM)
  return value === null ? { present: false, invoice: null } : { present: true, invoice: decodeInvoice(value) }
}

export function requestToInvoice(r: PaymentRequest, merchant: string): Invoice {
  return {
    v: 1,
    to: r.recipient,
    ch: r.chainKey as GatewayChain['key'],
    amt: r.amount,
    ref: r.id,
    desc: r.description,
    who: merchant,
    ...(r.paymentRail === 'gateway_direct' ? { rail: 'gateway_direct' as const } : {}),
    ...(r.depositor ? { dp: r.depositor } : {}),
  }
}

/** Monta o link completo. A base vem de getShareBase(), nunca de window.location. */
export function invoiceLink(base: string, inv: Invoice): string {
  return `${base}${invoicePath(inv)}`
}

/** Resolve a base de compartilhamento uma vez, para os botões de copiar ficarem síncronos. */
export function useShareBase(): string | null {
  const [base, setBase] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void getShareBase().then((b) => {
      if (alive) setBase(b)
    })
    return () => {
      alive = false
    }
  }, [])
  return base
}

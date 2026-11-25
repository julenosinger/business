/**
 * Validação e normalização compartilhadas do cadastro de produtos (fase INV-1.0).
 *
 * Regras comuns a todos os ambientes (integridade de dados):
 * - Nome obrigatório.
 * - Valores monetários e quantidades finitos e não negativos (nunca NaN/Infinity).
 *
 * Política por ambiente (via `environment-policy`):
 * - Mainnet (production): código de barras válido quando informado; SKU único por ambiente.
 * - Testnet (sandbox): SKU/código de barras opcionais e flexíveis (fictícios/incompletos).
 */
import type { Product } from './types'
import type { NetworkId } from './network'
import { isSandbox } from './environment-policy'

export type ProductErrorCode =
  | 'name_required'
  | 'cost_invalid'
  | 'price_invalid'
  | 'stock_invalid'
  | 'minstock_invalid'
  | 'maxstock_invalid'
  | 'reorder_invalid'
  | 'wholesale_invalid'
  | 'reference_cost_invalid'
  | 'purchase_price_invalid'
  | 'non_finite'
  | 'barcode_invalid'
  | 'sku_duplicate'

/** Código de barras GTIN/EAN/UPC válido (8, 12, 13 ou 14 dígitos). */
export function barcodeIsValid(barcode: string): boolean {
  return /^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(barcode.trim())
}

export interface ProductValidation {
  ok: boolean
  errors: ProductErrorCode[]
}

export interface ProductValues {
  name: string
  sku: string
  barcode?: string
  cost: number
  price: number
  stock: number
  minStock: number
  maxStock?: number
  reorderPoint?: number
  wholesalePrice?: number
  referenceCost?: number
  purchasePrice?: number
  leadTimeDays?: number
  minOrderQty?: number
  netWeight?: number
  grossWeight?: number
  height?: number
  width?: number
  depth?: number
  unitsPerPackage?: number
}

/** Valida os valores de um cadastro de produto. `skuTaken` = já existe outro produto com este SKU neste ambiente. */
export function validateProduct(input: ProductValues, network: NetworkId, skuTaken: boolean): ProductValidation {
  const errors: ProductErrorCode[] = []
  if (!input.name.trim()) errors.push('name_required')
  const nonNeg = (v: number | undefined, code: ProductErrorCode) => {
    if (v === undefined) return
    if (!Number.isFinite(v) || v < 0) errors.push(code)
  }
  nonNeg(input.cost, 'cost_invalid')
  nonNeg(input.price, 'price_invalid')
  nonNeg(input.stock, 'stock_invalid')
  nonNeg(input.minStock, 'minstock_invalid')
  nonNeg(input.maxStock, 'maxstock_invalid')
  nonNeg(input.reorderPoint, 'reorder_invalid')
  nonNeg(input.wholesalePrice, 'wholesale_invalid')
  nonNeg(input.referenceCost, 'reference_cost_invalid')
  nonNeg(input.purchasePrice, 'purchase_price_invalid')
  nonNeg(input.leadTimeDays, 'non_finite')
  nonNeg(input.minOrderQty, 'non_finite')
  nonNeg(input.netWeight, 'non_finite')
  nonNeg(input.grossWeight, 'non_finite')
  nonNeg(input.height, 'non_finite')
  nonNeg(input.width, 'non_finite')
  nonNeg(input.depth, 'non_finite')
  nonNeg(input.unitsPerPackage, 'non_finite')
  if (!isSandbox(network)) {
    if (input.barcode && input.barcode.trim() && !barcodeIsValid(input.barcode)) errors.push('barcode_invalid')
    if (input.sku.trim() && skuTaken) errors.push('sku_duplicate')
  }
  return { ok: errors.length === 0, errors }
}

/** Margem bruta (%) sobre o preço de venda. */
export function marginOf(product: Pick<Product, 'price' | 'cost'>): number {
  return product.price > 0 ? ((product.price - product.cost) / product.price) * 100 : 0
}

/** Markup (%) sobre o custo. */
export function markupOf(product: Pick<Product, 'price' | 'cost'>): number {
  return product.cost > 0 ? ((product.price - product.cost) / product.cost) * 100 : 0
}

/** Campos cuja edição NÃO pode alterar custo médio, estoque ou ambiente (integridade patrimonial). */
export const IMMUTABLE_PRODUCT_FIELDS = ['cost', 'stock', 'environment'] as const

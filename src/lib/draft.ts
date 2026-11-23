import { useCallback, useEffect, useMemo, useState } from 'react'
import { getNetwork } from './network'

/**
 * Rascunho seguro de formulário (fase UI 2.1). Persistido em localStorage, separado por
 * tipo de formulário, ambiente e identificação do registro (ou 'new' para criação).
 * - Nunca salva automaticamente no cadastro definitivo.
 * - É descartado ao salvar com sucesso.
 * - Aplicação de usuário único/empresa única: a chave não expõe segredos.
 */

function draftKey(formKey: string, id: string | null, network: string): string {
  return `gbos:draft:${formKey}:${network}:${id ?? 'new'}`
}

export interface DraftApi<T> {
  hasDraft: boolean
  restore: () => T | null
  discard: () => void
  clear: () => void
}

/**
 * Rascunho seguro de formulário. `initial` é o estado "limpo" (formulário recém-aberto): enquanto o
 * formulário é igual ao inicial, nada é salvo — assim o rascunho de uma sessão anterior não é sobrescrito
 * ao abrir o modal. Só passa a gravar quando o usuário altera algo.
 */
export function useDraft<T>(formKey: string, id: string | null, form: T, initial: T): DraftApi<T> {
  const network = getNetwork()
  const key = useMemo(() => draftKey(formKey, id, network), [formKey, id, network])

  const read = useCallback((): T | null => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : null
    } catch {
      return null
    }
  }, [key])

  const [hasDraft, setHasDraft] = useState<boolean>(() => read() !== null)
  const [seenKey, setSeenKey] = useState(key)
  // Ao trocar de formulário/registro, reavalia o rascunho correspondente (padrão "estado derivado" do app).
  if (seenKey !== key) {
    setSeenKey(key)
    setHasDraft(read() !== null)
  }

  // Salva o rascunho (com debounce) apenas quando o formulário difere do estado inicial.
  useEffect(() => {
    if (JSON.stringify(form) === JSON.stringify(initial)) return
    const t = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(form))
        setHasDraft(true)
      } catch {
        // armazenamento indisponível: ignora
      }
    }, 400)
    return () => clearTimeout(t)
  }, [key, form, initial])

  const discard = useCallback(() => {
    try {
      localStorage.removeItem(key)
    } catch {
      // ignore
    }
    setHasDraft(false)
  }, [key])

  const restore = useCallback((): T | null => read(), [read])

  return { hasDraft, restore, discard, clear: discard }
}

import { useEffect, useRef } from 'react'
import { useStore } from '@/lib/store'
import { backoffDelay, isAutoReconcilable } from '@/lib/reconciliation'

const BASE_MS = 30_000
const MAX_MS = 5 * 60_000
const MAX_CONCURRENT = 2

/**
 * Coordenador de reconciliação automática (single-worker, bounded, com backoff).
 *
 * - Retoma operações pendentes após reload.
 * - Reconcilia quando o app volta a ficar visível/online.
 * - Polling limitado com backoff exponencial + jitter (nunca agressivo).
 * - Pausa quando offline e não duplica workers.
 * - Nunca reenvia transações: apenas verifica e baixa (via `verifyAndSettle`, que é single-flight).
 */
export function ReconciliationCoordinator() {
  const { data, verifyAndSettle } = useStore()
  const dataRef = useRef(data)
  const verifyRef = useRef(verifyAndSettle)

  // "Latest ref": mantém referências atualizadas sem reexecutar o coordenador.
  useEffect(() => {
    dataRef.current = data
    verifyRef.current = verifyAndSettle
  })

  useEffect(() => {
    const state = { cancelled: false, timer: undefined as ReturnType<typeof setTimeout> | undefined, attempt: 0, running: false }

    const pendingIds = () => dataRef.current.treasuryOps.filter((o) => isAutoReconcilable(o.status) && o.txHash).map((o) => o.id)

    const pass = async () => {
      if (state.running || state.cancelled) return
      state.running = true
      try {
        const ids = pendingIds()
        for (let i = 0; i < ids.length; i += MAX_CONCURRENT) {
          if (state.cancelled) break
          await Promise.allSettled(ids.slice(i, i + MAX_CONCURRENT).map((id) => verifyRef.current(id)))
        }
      } finally {
        state.running = false
      }
    }

    const schedule = (delay: number) => {
      if (state.cancelled) return
      if (state.timer) clearTimeout(state.timer)
      state.timer = setTimeout(() => {
        void pass()
        state.attempt += 1
        schedule(backoffDelay(state.attempt, BASE_MS, MAX_MS))
      }, delay)
    }

    const kick = () => {
      state.attempt = 0
      schedule(0)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') kick()
    }
    const onOnline = () => kick()
    const onOffline = () => {
      if (state.timer) clearTimeout(state.timer)
    }

    kick()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      state.cancelled = true
      if (state.timer) clearTimeout(state.timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  return null
}

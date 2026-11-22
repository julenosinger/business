import { useSyncExternalStore } from 'react'

export type Theme = 'dark' | 'light'

const KEY = 'gbos:theme'
const listeners = new Set<() => void>()

function read(): Theme {
  try {
    // Light é o padrão para novos usuários. Só fica escuro se o usuário escolheu explicitamente.
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

let current: Theme = read()
document.documentElement.dataset.theme = current

export function setTheme(theme: Theme): void {
  current = theme
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // ignore
  }
  listeners.forEach((l) => l())
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}

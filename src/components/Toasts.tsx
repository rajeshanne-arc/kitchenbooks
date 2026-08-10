'use client'

// The smallest toast system that could work: a window event bus, one
// listener mounted in the root layout, three seconds on screen. Every save
// answers back — no silent buttons.

import { useEffect, useState } from 'react'

type Toast = { id: number; text: string; kind: 'ok' | 'error' }

export function toast(text: string, kind: 'ok' | 'error' = 'ok') {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('kb-toast', { detail: { text, kind } }))
  }
}

let nextId = 1

export default function Toasts() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    function onToast(e: Event) {
      const { text, kind } = (e as CustomEvent<{ text: string; kind: 'ok' | 'error' }>).detail
      const id = nextId++
      setToasts((t) => [...t, { id, text, kind }])
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
    }
    window.addEventListener('kb-toast', onToast)
    return () => window.removeEventListener('kb-toast', onToast)
  }, [])

  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto max-w-md rounded-xl border px-4 py-2.5 text-sm font-medium shadow-lg ${
            t.kind === 'ok'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-red-300 bg-red-50 text-red-900'
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}

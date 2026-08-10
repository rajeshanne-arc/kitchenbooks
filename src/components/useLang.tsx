'use client'

// The language toggle, cookie-backed, as a tiny external store: the server
// snapshot is English, the client snapshot is the cookie, and picking a
// language notifies every mounted form at once — labels flip everywhere
// without a reload.

import { useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { LANG_COOKIE, LANGS, t, type Lang, type LabelKey } from '@/lib/i18n'

const listeners = new Set<() => void>()

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function readLangCookie(): Lang {
  if (typeof document === 'undefined') return 'en'
  const m = document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]*)`))
  return m?.[1] === 'te' ? 'te' : 'en'
}

function writeLangCookie(next: Lang) {
  document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=${365 * 24 * 3600}; samesite=lax`
  for (const cb of listeners) cb()
}

export function useLang(): { lang: Lang; label: (key: LabelKey) => string } {
  const lang = useSyncExternalStore(subscribe, readLangCookie, () => 'en' as Lang)
  return { lang, label: (key) => t(lang, key) }
}

export function LangToggle() {
  const router = useRouter()
  const lang = useSyncExternalStore(subscribe, readLangCookie, () => 'en' as Lang)

  function pick(next: Lang) {
    writeLangCookie(next)
    router.refresh()
  }

  return (
    <span className="flex shrink-0 overflow-hidden rounded-lg border border-stone-200">
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => pick(l.code)}
          className={`px-1.5 py-1 text-[11px] font-semibold ${
            lang === l.code ? 'bg-emerald-700 text-white' : 'text-stone-500 hover:bg-stone-100'
          }`}
        >
          {l.label}
        </button>
      ))}
    </span>
  )
}

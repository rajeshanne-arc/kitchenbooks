'use client'

import { useEffect, useState } from 'react'

/**
 * Debounced GET-and-parse against a search route. Pass null to idle (dropdown
 * closed). `results` is null until the current url has resolved; [] means
 * "searched, nothing found".
 */
export function useSearch<T>(url: string | null) {
  const [state, setState] = useState<{ url: string; results: T[] } | null>(null)

  useEffect(() => {
    if (url === null) return
    const ctl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await fetch(url, { signal: ctl.signal })
        if (!res.ok) throw new Error(`search failed (${res.status})`)
        const data = (await res.json()) as T[]
        if (!ctl.signal.aborted) setState({ url, results: data })
      } catch {
        if (!ctl.signal.aborted) setState({ url, results: [] })
      }
    }, 180)
    return () => {
      clearTimeout(t)
      ctl.abort()
    }
  }, [url])

  const active = url !== null && state !== null && state.url === url
  return { results: active ? state.results : null, loading: url !== null && !active }
}

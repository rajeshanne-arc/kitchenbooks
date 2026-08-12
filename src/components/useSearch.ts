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
    // A STALLED REQUEST IS NOT A SLOW ONE. Without this the fetch stays
    // pending until the browser gives up, and a pending fetch is enough to
    // stop a document reaching idle — which is what a long wait on the
    // issue page looked like from outside.
    const kill = setTimeout(() => ctl.abort(), 10_000)
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
      clearTimeout(kill)
      ctl.abort()
    }
  }, [url])

  const active = url !== null && state !== null && state.url === url
  return { results: active ? state.results : null, loading: url !== null && !active }
}

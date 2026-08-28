'use client'

// THE REVEAL — the third way to reach a closed row.
//
// Browsing hides a merged or discarded row. SEARCHING FINDS IT ANYWAY, because
// a code read off an old bill has to answer. This is for the case neither
// covers: somebody looking for what was closed, without knowing its code.
//
// It says NOTHING while a search is running, because during a search closed
// rows are already included — offering to "show" what is on screen would be a
// control that does nothing, which is worse than no control.

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

export default function ShowClosed({
  on,
  searching,
  noun,
}: {
  on: boolean
  searching: boolean
  noun: string
}) {
  const pathname = usePathname()
  const sp = useSearchParams()
  if (searching) return null

  // PRESERVES THE PARAMS ALREADY ON THE URL. A control that rebuilds the query
  // string from its own value alone works until a second control exists, and
  // then it silently resets it.
  const next = new URLSearchParams(sp.toString())
  if (on) next.delete('closed')
  else next.set('closed', '1')
  const qs = next.toString()

  return (
    <p className="mt-1.5 px-1 text-xs text-stone-500">
      {on ? (
        <>
          Showing merged and discarded {noun} too.{' '}
          <Link href={`${pathname}${qs === '' ? '' : `?${qs}`}`} className="underline underline-offset-2">
            Hide them
          </Link>
        </>
      ) : (
        <>
          Merged and discarded {noun} are hidden — searching a code still finds one.{' '}
          <Link href={`${pathname}?${qs}`} className="underline underline-offset-2">
            Show them
          </Link>
        </>
      )}
    </p>
  )
}

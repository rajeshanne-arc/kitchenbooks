'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { inputCls } from '@/components/ui'

export default function FilterInput({ placeholder }: { placeholder: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [q, setQ] = useState(sp.get('q') ?? '')

  useEffect(() => {
    const t = setTimeout(() => {
      if ((sp.get('q') ?? '') === q.trim()) return
      const target = q.trim() ? `${pathname}?q=${encodeURIComponent(q.trim())}` : pathname
      router.replace(target as Parameters<typeof router.replace>[0], { scroll: false })
    }, 250)
    return () => clearTimeout(t)
  }, [q, pathname, router, sp])

  return (
    <input
      value={q}
      onChange={(e) => setQ(e.target.value)}
      placeholder={placeholder}
      className={`${inputCls} mt-4`}
    />
  )
}

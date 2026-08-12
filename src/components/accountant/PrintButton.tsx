'use client'

// Paper is the point of the statement screen — a vendor asks for their
// account and wants it in hand. The browser already knows how to print; this
// is only a way to reach it that a phone user can find. It prints itself out
// of the page it triggers.

import { btnGhostCls } from '@/components/ui'

export default function PrintButton({ label = 'Print' }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={`${btnGhostCls} print:hidden`}>
      {label}
    </button>
  )
}

import type { ReactNode } from 'react'
import { sectionHeadCls } from '@/components/ui'

/** One band of a long master form.
 *
 * A twenty-field form read as one list is a wall; the same twenty fields in
 * five named bands are five short questions. The heading says what the band
 * is FOR, so the person filling it knows whether they can skip it — banking
 * details are the accountant's, contact details are the buyer's. */
export function FormGroup({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="border-t border-rule-soft pt-4 first:border-t-0 first:pt-0">
      <h4 className={sectionHeadCls}>{title}</h4>
      {hint !== undefined && <p className="mt-0.5 text-xs text-stone-500">{hint}</p>}
      <div className="mt-2.5 grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  )
}

/** A labelled field that spans the whole band rather than half of it. */
export const Wide = ({ children }: { children: ReactNode }) => (
  <div className="sm:col-span-2">{children}</div>
)

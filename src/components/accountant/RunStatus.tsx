// A run's status, in the one place both screens read it from.
//
// The colours are the app's own legend rather than a traffic light: gold is
// doubt, so a DRAFT wears it — nothing on a draft has been agreed yet. Navy
// is a decision recorded, green is money gone, and a cancelled run is muted
// but never hidden, because it is still a thing somebody did.
import type { PayrollStatus } from '@/lib/types'

const TONE: Record<PayrollStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  approved: { label: 'Approved', cls: 'border-sky-300 bg-sky-50 text-sky-800' },
  paid: { label: 'Paid', cls: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  cancelled: { label: 'Cancelled', cls: 'border-stone-300 bg-stone-100 text-stone-500' },
}

export default function RunStatus({ status }: { status: PayrollStatus }) {
  const tone = TONE[status]
  return (
    <span
      className={`inline-block shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tone.cls}`}
    >
      {tone.label}
    </span>
  )
}

import ChipRow from '@/components/ChipRow'
import { chipsOf } from '@/lib/tabs'

export default function StaffMoneyOutLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ChipRow base="/staff/money-out" chips={chipsOf('staff', 'moneyout')} />
      {children}
    </>
  )
}

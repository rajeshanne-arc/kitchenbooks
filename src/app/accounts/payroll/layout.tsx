import ChipRow from '@/components/ChipRow'
import { chipsOf } from '@/lib/tabs'

export default function PayrollLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ChipRow base="/accounts/payroll" chips={chipsOf('accounts', 'payroll')} />
      {children}
    </>
  )
}

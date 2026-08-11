import ChipRow from '@/components/ChipRow'
import { chipsOf } from '@/lib/tabs'

export default function SalesRecordLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ChipRow base="/sales/record" chips={chipsOf('sales', 'record')} />
      {children}
    </>
  )
}

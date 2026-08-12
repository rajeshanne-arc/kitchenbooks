import ChipRow from '@/components/ChipRow'
import { chipsOf } from '@/lib/tabs'

export default function RegistersLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ChipRow base="/accounts/registers" chips={chipsOf('accounts', 'registers')} />
      {children}
    </>
  )
}

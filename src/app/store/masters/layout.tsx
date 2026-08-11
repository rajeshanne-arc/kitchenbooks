import ChipRow from '@/components/ChipRow'
import { chipsOf } from '@/lib/tabs'

export default function StoreMastersLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ChipRow base="/store/masters" chips={chipsOf('store', 'masters')} />
      {children}
    </>
  )
}

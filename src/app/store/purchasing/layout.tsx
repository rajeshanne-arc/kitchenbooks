import ChipRow from '@/components/ChipRow'
import { chipsOf } from '@/lib/tabs'

export default function StorePurchasingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ChipRow base="/store/purchasing" chips={chipsOf('store', 'purchasing')} />
      {children}
    </>
  )
}

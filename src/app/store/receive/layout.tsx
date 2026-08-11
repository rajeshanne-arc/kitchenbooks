import ChipRow from '@/components/ChipRow'
import { chipsOf } from '@/lib/tabs'

export default function StoreReceiveLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ChipRow base="/store/receive" chips={chipsOf('store', 'receive')} />
      {children}
    </>
  )
}

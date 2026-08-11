import ChipRow from '@/components/ChipRow'
import { chipsOf } from '@/lib/tabs'

export default function KitchenShiftLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ChipRow base="/kitchen/shift" chips={chipsOf('kitchen', 'shift')} />
      {children}
    </>
  )
}

import ChipRow from '@/components/ChipRow'
import { chipsOf } from '@/lib/tabs'

export default function StaffPeopleLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ChipRow base="/staff/people" chips={chipsOf('staff', 'people')} />
      {children}
    </>
  )
}

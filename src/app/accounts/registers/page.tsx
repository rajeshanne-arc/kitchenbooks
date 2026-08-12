import { redirect } from 'next/navigation'

// The tab lands on its first chip. Purchase is first because it is the one
// with the most rows and the most questions.
export default function RegistersIndex() {
  redirect('/accounts/registers/purchase')
}

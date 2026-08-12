import { redirect } from 'next/navigation'

// The tab lands on its first chip. Runs is first because a run is what the
// other two chips exist to feed: an advance comes back as a recovery on one,
// and a person's bank details are how one gets paid.
export default function PayrollIndex() {
  redirect('/accounts/payroll/runs')
}

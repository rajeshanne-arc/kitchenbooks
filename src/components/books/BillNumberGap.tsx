// A GAP IN A VENDOR'S BILL NUMBERS — a control, not a payment-time nicety, so
// it is mounted on the vendor's own page as well as on the payment screen.
//
// BOTH READINGS, NEITHER ASSERTED. A missing number is either a bill we never
// entered — in which case the balance is understated and the vendor will ask
// for it — or a number that vendor used for somebody else, in which case there
// is nothing to find. This app cannot tell which, and guessing would turn a
// question worth asking into an accusation.
//
// SILENT WHEN THERE IS NOTHING TO SAY. A vendor who numbers sequentially with
// no gaps and no duplicates gets no strip at all: a permanent all-clear is a
// thing people learn to scroll past, which is this file's own badge law.

import Honesty from '@/components/Honesty'
import type { BillNumbers } from '@/lib/bill-gaps'

export default function BillNumberGap({ g, vendorName }: { g: BillNumbers; vendorName: string }) {
  // NOT SEQUENTIAL IS NOT A FINDING. Seven of thirty-nine vendors carry no
  // bill numbers at all and a gap check over nulls is noise — an alert that
  // fires on normal data teaches the reader to dismiss the one that matters.
  if (!g.sequential) return null
  if (g.missing.length === 0 && g.duplicates.length === 0) return null

  const list = (ns: number[]) => ns.join(', ')
  return (
    <Honesty verdict={g.missing.length > 0 ? 'numbers missing' : 'a number used twice'}>
      {g.missing.length > 0 && (
        <>
          {vendorName} numbers their bills in sequence — {g.from} to {g.to}, and we hold {g.present} of them.{' '}
          <span className="font-semibold">
            {g.missing.length === 1 ? 'Number' : 'Numbers'} {list(g.missing)}{' '}
            {g.missing.length === 1 ? 'is' : 'are'} not here.
          </span>{' '}
          Either {g.missing.length === 1 ? 'that bill' : 'those bills'} never reached us — so what they are
          owed is understated — or {g.missing.length === 1 ? 'the number' : 'the numbers'} went to somebody
          else&rsquo;s bill. Worth asking before the money goes; nothing here can tell the two apart.{' '}
        </>
      )}
      {g.duplicates.length > 0 && (
        <>
          {g.missing.length > 0 && <br />}
          <span className="font-semibold">
            {g.duplicates.length === 1 ? 'Number' : 'Numbers'} {list(g.duplicates)}{' '}
            {g.duplicates.length === 1 ? 'is' : 'are'} on two bills each.
          </span>{' '}
          Either they reused it, or one delivery was entered twice — and the second reading means this
          balance is overstated.{' '}
        </>
      )}
      {g.outliers.length > 0 && (
        <>
          <br />
          <span className="text-stone-500">
            {g.outliers.length} other {g.outliers.length === 1 ? 'number sits' : 'numbers sit'} far outside
            that run and {g.outliers.length === 1 ? 'is' : 'are'} not counted as gaps — a different series,
            not a hole in this one.
          </span>
        </>
      )}
    </Honesty>
  )
}

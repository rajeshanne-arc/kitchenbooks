// A range whose edges are not whole months, said out loud.
//
// THE ONE GENUINELY NEW LIE A CUSTOM RANGE CAN TELL. The monthly views cannot
// answer a half-month question — section_costs is a join of whole-month
// aggregates, and section_food_cost takes its opening from the last closing
// BEFORE the month and its ending from the last closing inside it. So a range
// starting on 15 July makes those cards report the whole of July while the
// event-table cards beside them correctly start on the 15th: two cards, one
// heading, two different questions.
//
// This is NOT new for a whole-month range — "this month" already runs 1st to
// today and reports the whole month's food cost, named on screen. What is new
// is a start that is not a 1st, and an end that is not a month end.
//
// NEVER COMPUTE A FIGURE TO FILL THE GAP. There is no partial-month form of
// these numbers; the honest move is to name which months they actually cover.

import { monthLabel, partialEdges, type Period } from '@/lib/period'
import Honesty from '@/components/Honesty'

export default function PartialMonths({ period }: { period: Period }) {
  // A PARTIAL HEAD ONLY, and the tail deliberately does not count.
  //
  // A start that is not a 1st is the genuinely new thing a custom range can do:
  // the monthly cards silently include the days before it. A partial TAIL is
  // what `this-month` and `last-3-months` have always done — they run to today
  // and report the whole month, named on screen — so firing on it would put a
  // permanent strip on the owner dashboard's default view, and a strip that is
  // always there is one people learn to look past.
  const { head } = partialEdges(period)
  if (!head) return null
  const first = monthLabel(period.months[0])
  const last = monthLabel(period.reportMonth)
  const span = period.months.length === 1 ? first : `${first} to ${last}`
  return (
    <Honesty verdict="whole months only">
      This range starts mid-month, and the monthly figures on this page can only answer in whole
      months — they cover {span} in full, including the days before your start. There is no
      part-month form of them. Everything counted from events uses the range exactly as you set it.
    </Honesty>
  )
}

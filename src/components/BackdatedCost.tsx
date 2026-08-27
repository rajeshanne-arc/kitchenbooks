'use client'

// A DATE ON A DOCUMENT DOES NOT DATE THE STATE IT WAS COMPUTED FROM.
//
// Every frozen cost in this schema is read from a view at WRITE time, and
// none of those views has a date in it. Checked, not reasoned: `item_costs`,
// `recipe_costs`, `dish_costs` and `stock_on_hand` contain no `bill_date`, no
// `created_at`, no `current_date` — nothing. They answer only about now.
//
// So an issue backdated twelve days freezes TODAY's weighted average onto a
// line that claims to be about a day twelve rates ago, and the row looks
// entirely correct afterwards. Nothing on any screen would say so, which is
// exactly why the sentence has to be said here, before the save, to the one
// person who still knows the entry is late.
//
// IT IS A WARNING AND NEVER A REFUSAL. Catching up on a missed day is
// legitimate work — the whole reason a store manager backdates is that the
// books are behind, and refusing the save pushes that day off the books
// altogether rather than onto them slightly mis-costed. A wrong cost on a real
// entry beats a right cost on an entry nobody made.
//
// THE HONEST ALTERNATIVE IS NOT AVAILABLE, and that is a decision rather than
// an omission: as-of-date costing would need a date parameter on every cost
// view and a date passed by every caller, and a weighted average as of a date
// is a materially harder calculation than it looks. That is a different
// product. This sentence is the honest version of it.

import Honesty from '@/components/Honesty'
import { useBusinessDay } from '@/components/BusinessDay'
import { BACKDATE_DAYS, daysBackdated } from '@/lib/backdate'

/**
 * `what` names the figure THIS form actually freezes, because the forms do not
 * all freeze the same thing: an issue takes the item's weighted average, a
 * production takes the recipe's cost, a giveaway takes the dish's. A shared
 * sentence that named the wrong one would be a small lie in the one place the
 * screen is being careful.
 */
export default function BackdatedCost({
  date,
  what = "today's weighted average cost",
}: {
  date: string
  what?: string
}) {
  const { businessDate } = useBusinessDay()
  const days = daysBackdated(date, businessDate)
  if (days <= BACKDATE_DAYS) return null
  return (
    <Honesty verdict="Dated back" compact>
      This is dated {days} days ago. The cost frozen will be {what} — not the one that applied
      then. Save it anyway if that is the day it happened: a late entry is worth more than a
      missing one.
    </Honesty>
  )
}

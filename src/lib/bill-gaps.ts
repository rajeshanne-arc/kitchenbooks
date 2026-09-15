// A GAP IN A VENDOR'S BILL NUMBERS — asked before the money leaves.
//
// Sri Vyshnavi bills daily and numbered 79 81 82 83 84 85 87 89 … 100. Three
// numbers in that run were never entered, and that is invisible from a total:
// either the bills are missing from our books, or the vendor used those
// numbers for somebody else. BOTH READINGS ARE STATED AND NEITHER IS ASSERTED
// — this app cannot know which, and guessing would make a control into an
// accusation.
//
// ONLY FOR VENDORS WHO NUMBER SEQUENTIALLY. Seven of thirty-nine carry no bill
// numbers at all, and a gap check over nulls is noise — an alert that fires on
// normal data teaches the reader to dismiss the one that matters.
//
// THE SPAN IS THE WRONG TEST, and live data is what says so. Sri Vyshnavi's
// numbers run 79–100 and then jump to 3822, 4023, 4050 — so min-to-max is
// 3972 wide, density 0.01, and any span-based rule calls the most obviously
// sequential vendor in the book "not sequential". A vendor numbers
// sequentially over a RUN, not over their whole history: a series gets reset,
// a different book gets used, one bill carries a reference from somewhere
// else. So the numbers are CLUSTERED first and the check runs inside the
// dominant cluster, with everything outside it reported as what it is —
// outliers, not gaps.

/** Numbers further apart than this start a new cluster: a jump of more than a
 *  couple of weeks' billing is a different series, not a gap. */
const CLUSTER_BREAK = 10
/** Below this many numbers in the dominant run there is no pattern to have a
 *  gap in. */
const MIN_RUN = 5
/** How much of the run must actually be present before "they number
 *  sequentially" is a claim worth making. Sri Vyshnavi reads 0.82; a vendor we
 *  see one bill in three from reads ~0.3 and is not sequential from here. */
const MIN_DENSITY = 0.7

export type BillNumbers =
  | { sequential: false; why: string; numbered: number }
  | {
      sequential: true
      from: number
      to: number
      /** distinct numbers present inside the run */
      present: number
      missing: number[]
      /** the same number on two bills — a re-used number or a double entry,
       *  and worth asking about for the same reason a gap is */
      duplicates: number[]
      /** numbers outside the dominant run. Not gaps: a different series. */
      outliers: number[]
    }

export function billNumbers(raw: (string | null)[]): BillNumbers {
  const nums = raw
    .map((b) => (b ?? '').trim())
    .filter((b) => /^\d+$/.test(b))
    .map(Number)
    .sort((a, b) => a - b)
  if (nums.length < MIN_RUN) {
    return {
      sequential: false,
      numbered: nums.length,
      why:
        nums.length === 0
          ? 'no bill from this vendor carries a number'
          : `only ${nums.length} numbered bills — too few to say they number in sequence`,
    }
  }

  // CLUSTER, THEN TAKE THE BIGGEST. Everything else is a different series.
  const clusters: number[][] = [[nums[0]]]
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] - nums[i - 1] > CLUSTER_BREAK) clusters.push([])
    clusters[clusters.length - 1].push(nums[i])
  }
  const run = clusters.reduce((a, b) => (b.length > a.length ? b : a))
  const outliers = nums.filter((n) => n < run[0] || n > run[run.length - 1])

  const distinct = [...new Set(run)]
  const from = distinct[0]
  const to = distinct[distinct.length - 1]
  const span = to - from + 1
  if (run.length < MIN_RUN || distinct.length / span < MIN_DENSITY) {
    return {
      sequential: false,
      numbered: nums.length,
      why: `their numbers are too scattered to read as a sequence — ${distinct.length} of ${span} between ${from} and ${to}`,
    }
  }

  const have = new Set(distinct)
  const missing: number[] = []
  for (let n = from; n <= to; n++) if (!have.has(n)) missing.push(n)

  const seen = new Set<number>()
  const duplicates = [...new Set(run.filter((n) => (seen.has(n) ? true : (seen.add(n), false))))]

  return { sequential: true, from, to, present: distinct.length, missing, duplicates, outliers }
}

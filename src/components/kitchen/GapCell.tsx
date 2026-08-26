// The gap, in WORDS.
//
// It was a signed number, and a signed number asks the reader to hold a
// convention in their head: is −2 two short, or two extra? The view says
// `qty_given − qty_requested`, so negative is short — and that is exactly
// backwards from how a person says it out loud ("we're two short"). A
// convention that has to be remembered is a convention that gets misread at
// eleven at night, and this one had already inverted against the view once.
//
// So: "Short 0.5 kg" in red, "Extra 2 kg" in amber, nothing at all when they
// match. Colour never carries the meaning on its own — the word does, and
// the colour agrees with it.
//
// NULL is CANCELLED, and it is not a dash. The view returns NULL for both
// qty_given and gap on a cancelled indent because a request nobody was ever
// going to fill has no shortage; a dash there would read as zero, which is
// the opposite of true.

const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 })

export default function GapCell({
  gap,
  unit,
  status,
  delivered,
}: {
  /** given − requested, as a numeric string; null when cancelled */
  gap: string | null
  unit: string
  /** the INDENT's status. An OPEN indent is not short — nobody has answered it
   *  yet, and the view cannot say so on its own: it computes
   *  `coalesce(qty_given, 0) − qty_requested`, so an untouched request of 5 kg
   *  arrives here as −5 and read as "Short 5 kg" in red. That is an accusation
   *  against the store for a request they have not been given the chance to
   *  fill. Both readers of this component had that bug; the fix lives here so
   *  neither can have it again. */
  status?: string
  /** A PURCHASE ORDER's delivered quantity. The same fault as an open indent
   *  arrives here by a second route: `po_fulfilment.gap` is
   *  `coalesce(delivered, 0) − ordered`, so an order that has been SENT and
   *  not yet delivered against reads as short by the whole of it — an
   *  accusation against a vendor who has not been given the chance. Once
   *  anything at all has arrived the gap is real and is said. */
  delivered?: string
}) {
  if (status === 'open') {
    return <span className="text-[13px] text-stone-400">not issued yet</span>
  }
  if (status === 'draft') {
    return <span className="text-[13px] text-stone-400">not sent yet</span>
  }
  if (status === 'sent' && delivered !== undefined && Number(delivered) === 0) {
    return <span className="text-[13px] text-stone-400">not delivered yet</span>
  }
  if (gap === null) {
    return <span className="text-[13px] text-stone-400">cancelled</span>
  }
  const n = Number(gap)
  if (!Number.isFinite(n)) return <span className="text-stone-400">—</span>
  if (n === 0) return <span className="text-stone-300">—</span>

  const short = n < 0
  return (
    <span className={`text-[13px] font-semibold ${short ? 'text-red-700' : 'text-amber-800'}`}>
      {short ? 'Short' : 'Extra'} {nf.format(Math.abs(n))} {unit}
    </span>
  )
}

// A NAME MEETING A FIGURE — the one shape, wherever the two sit together.
//
// "SRI VYSHNAVI ₹64,815.00" on one line reads as a single run of characters,
// and against VENKATA NARASIMHA VEGETABLES (28 characters, the longest name on
// this restaurant's books) the figure is lost entirely.
//
// INDIAN GROUPING MAKES IT WORSE THAN IT LOOKS. ₹1,53,329.89 carries more
// separators than $153,329.89 at the same value — twelve characters against
// ten — so it is wider and collides sooner. A negative adds a thirteenth that
// nobody counts when they eyeball a mock-up.
//
// So: the NAME takes the whole left side, the FIGURE is pushed right, tabular,
// and ONE STEP LARGER, because the figure is what a reader scans a queue for.
// Several rows then line up as a COLUMN somebody can compare down, which a run
// of characters can never be.
//
// THE NAME WRAPS; IT DOES NOT TRUNCATE. Measured at 400px in the real
// typefaces: the left column gets 171px, and the three longest names on these
// books — VEARIPILLA BALA SUHBRAMANYAM, VENKATA NARASIMHA VEGETABLES and
// SRIKRISHANAJANEYA GAS AGENCY, all 28 characters — need 235. Truncation cut
// all three mid-word, and two vendors sharing an opening would have rendered as
// the same row. A second line costs one line on three vendors in thirty-nine;
// a clipped name costs the identity of the thing being paid.
//
// `items-baseline` keeps the figure on the FIRST line of a wrapped name, so the
// column holds through the wrap — measured, not assumed.

export default function NameFigure({
  name,
  figure,
  after,
  tone = 'text-stone-900',
}: {
  name: React.ReactNode
  /** already formatted — this component does not know about money */
  figure: React.ReactNode
  /** chips and badges belong beside the NAME, never beside the figure, or the
   *  column stops lining up the moment one row has a badge and the next does
   *  not */
  after?: React.ReactNode
  tone?: string
}) {
  return (
    <div className="flex items-baseline gap-3">
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
        {/* THE SIZE IS SET HERE, NOT INHERITED. "One step larger" is a
            RELATION between two sizes, so a component that sets only one of
            them is one ancestor away from rendering both at 16px and saying
            nothing. 14px name against a 16px bold mono figure is the pair that
            was measured. */}
        <span className="break-words text-sm font-medium text-stone-900">{name}</span>
        {after}
      </div>
      {/* A discard, a merge and a reopen carry no amount at all. Rendering an
          empty span would still reserve the gap and leave the column sitting a
          few pixels off on exactly the rows with nothing to align. */}
      {figure !== null && figure !== '' && (
        <span className={`shrink-0 font-mono text-base font-semibold tabular-nums ${tone}`}>{figure}</span>
      )}
    </div>
  )
}

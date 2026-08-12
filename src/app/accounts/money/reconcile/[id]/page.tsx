// ONE STATEMENT — and the only screen in the app where two independent
// records of the same money are put next to each other.
//
// The left column is the provider's claim, the right is what the books
// hold for that account. A match takes one from each and ties them
// together for good. What is still standing on either side when the work
// stops is not a failure of the screen, it is the finding: money the bank
// saw that was never entered, or money entered that never reached the bank.
//
// Everything stated here is read from a view. The counts, the total and the
// self-check come from reconciliation_status; this page adds no arithmetic
// of its own, and where a figure cannot be had it says so in words rather
// than printing a zero that reads as an answer.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getRestaurant } from '@/server/queries'
import {
  countMovements,
  getStatement,
  listMatchedStatementLines,
  listUnmatchedMovements,
  listUnmatchedStatementLines,
} from '@/server/reconciliation-queries'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { fmtDate, fmtDateTime } from '@/lib/format'
import Honesty from '@/components/Honesty'
import MatchBoard from '@/components/accountant/MatchBoard'
import UnmatchButton from '@/components/accountant/UnmatchButton'
import {
  cardCls,
  dataTableCls,
  docNoCls,
  heroNumCls,
  pageSubCls,
  pageTitleCls,
  sectionHeadCls,
  tdCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const linkCls = 'font-semibold text-emerald-800 underline underline-offset-2 hover:text-emerald-900'

export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()

  const restaurant = await getRestaurant()
  const statement = await getStatement(restaurant.id, id)
  if (!statement) notFound()

  const [lines, matched, movements, counts] = await Promise.all([
    listUnmatchedStatementLines(restaurant.id, statement.id),
    listMatchedStatementLines(restaurant.id, statement.id),
    listUnmatchedMovements(restaurant.id, statement.account_id),
    countMovements(restaurant.id, statement.account_id),
  ])
  // how many are still unplaced, against how many the list could show
  const movementsTotal = counts.unmatched

  const selfCheck = statement.statement_self_check
  // NULL when a balance was not entered, and that is a different sentence
  // from "it balances" — the two states never collapse into one here. The
  // zero test runs at the paise scale the figure is printed at, so the alarm
  // and the number beneath it can never disagree.
  const offBy = selfCheck !== null && decimalStringToPaise(selfCheck) !== 0 ? selfCheck : null
  const allPlaced = statement.statement_lines > 0 && statement.unmatched_lines === 0
  const truncated = movementsTotal > movements.length

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>{statement.account_name}</h1>
        <p className={pageSubCls}>
          {fmtDate(statement.period_start)} – {fmtDate(statement.period_end)} · {statement.statement_lines}{' '}
          line{statement.statement_lines === 1 ? '' : 's'} as the provider states them.
        </p>
        <p className={`mt-1 ${docNoCls}`}>
          imported {fmtDateTime(statement.imported_at)}
          {statement.imported_by !== null && ` by ${statement.imported_by}`}
        </p>
        {statement.note !== null && <p className="mt-1 text-sm text-stone-600">{statement.note}</p>}
        <Link href="/accounts/money/reconcile" className={`${linkCls} mt-1.5 inline-block text-sm`}>
          ← All statements
        </Link>
      </header>

      <div className="space-y-4">
        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>What it says</h2>
            <span className="font-mono text-[10px] text-stone-400">reconciliation_status</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <div>
              <span className="block text-xs text-stone-500">Its lines add to</span>
              <span className={`${heroNumCls} block text-[22px] text-stone-900`}>
                {formatMoneyString(statement.statement_total)}
              </span>
            </div>
            <div>
              <span className="block text-xs text-stone-500">Opening</span>
              <span className="block font-mono text-[15px] tabular-nums text-stone-900">
                {statement.opening_balance === null ? '—' : formatMoneyString(statement.opening_balance)}
              </span>
            </div>
            <div>
              <span className="block text-xs text-stone-500">Closing</span>
              <span className="block font-mono text-[15px] tabular-nums text-stone-900">
                {statement.closing_balance === null ? '—' : formatMoneyString(statement.closing_balance)}
              </span>
            </div>
            <div>
              <span className="block text-xs text-stone-500">Placed</span>
              <span className="block font-mono text-[15px] tabular-nums text-stone-900">
                {statement.matched_lines} of {statement.statement_lines}
              </span>
            </div>
          </div>
        </section>

        {offBy !== null && (
          <Honesty level="alarm" verdict="the statement does not add up">
            Opening plus this statement&apos;s own lines less its closing balance leaves{' '}
            <span className="font-mono tabular-nums">{formatMoneyString(offBy)}</span> unaccounted
            for. This is a fact about THE STATEMENT, not about the books — nothing here has been
            compared to what we recorded yet. Usually it means a row was missed or doubled when it
            was pasted, or the provider&apos;s own opening figure is not the one this period starts
            from. Matching still works; every count on this page is standing on a list of rows that
            is known to be incomplete.
          </Honesty>
        )}

        {selfCheck === null && (
          <Honesty verdict="cannot check itself">
            One of the two balances was not entered, so the statement cannot be checked against
            itself — opening plus its lines less closing is the sum, and it needs both. A missing or
            doubled row would therefore go unnoticed here. What is on this page is what was pasted.
          </Honesty>
        )}

        {allPlaced ? (
          <section className={cardCls}>
            <h2 className={sectionHeadCls}>Everything is placed</h2>
            <p className="mt-1.5 text-sm text-stone-700">
              Every one of the {statement.statement_lines} lines on this statement has been tied to
              an entry in the books. Nothing on the provider&apos;s side is unexplained.
            </p>
            {movementsTotal > 0 && (
              <p className="mt-2 text-sm text-stone-700">
                {movementsTotal} {movementsTotal === 1 ? 'entry' : 'entries'} on{' '}
                {statement.account_name} in the books still {movementsTotal === 1 ? 'has' : 'have'}{' '}
                nothing against {movementsTotal === 1 ? 'it' : 'them'} — money we recorded that this
                statement does not show. Some of that is ordinary: an entry dated outside this
                period, or one the provider has not posted yet. The rest is worth asking about.
              </p>
            )}
          </section>
        ) : (
          <>
            <Honesty
              verdict="not placed"
              meter={{ filled: statement.matched_lines, total: statement.statement_lines, unit: 'lines' }}
            >
              {statement.unmatched_lines} of {statement.statement_lines} lines on this statement have
              nothing against them yet. Until they do, this account has not been reconciled — the
              balances the app reports are still only what it was told.
            </Honesty>

            <MatchBoard
              lines={lines}
              movements={movements}
              booksTotal={counts.total}
              accountName={statement.account_name}
            />
          </>
        )}

        {truncated && (
          <Honesty verdict="list capped">
            {statement.account_name} has {movementsTotal} unmatched entries in the books and the
            {' '}{movements.length} most recent are shown. The older ones are not gone and are not
            matched — they are simply not on this screen. Match what is here and reload to reach the
            rest.
          </Honesty>
        )}

        {matched.length > 0 && (
          <section className={cardCls}>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className={sectionHeadCls}>Already matched · {matched.length}</h2>
              <span className="font-mono text-[10px] text-stone-400">reconciliation_matches</span>
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className={dataTableCls}>
                <thead>
                  <tr>
                    <th className={thCls}>Statement line</th>
                    <th className={thNumCls}>Says</th>
                    <th className={thCls}>Matched to</th>
                    <th className={thNumCls}>Books say</th>
                    <th className={thCls}>By</th>
                    <th className={thCls}>
                      <span className="sr-only">Unmatch</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {matched.map((m) => (
                    <tr key={m.statement_line_id} className={trCls}>
                      <td className={tdCls}>
                        <span className="font-mono text-[11px] text-stone-500">{fmtDate(m.stmt_date)}</span>{' '}
                        {m.description ?? <span className="text-stone-400">no description</span>}
                      </td>
                      <td className={tdNumCls}>{formatMoneyString(m.amount)}</td>
                      <td className={tdCls}>
                        {m.kind ?? m.entity_type}
                        {m.party !== null && ` — ${m.party}`}
                        {m.doc_no !== null && <span className={`ml-1 ${docNoCls}`}>{m.doc_no}</span>}
                        {m.note !== null && (
                          <span className="mt-0.5 block text-xs text-stone-500">{m.note}</span>
                        )}
                      </td>
                      <td className={tdNumCls}>
                        {m.movement_amount === null ? '—' : formatMoneyString(m.movement_amount)}
                      </td>
                      <td className={`${tdCls} text-xs text-stone-500`}>
                        {m.matched_by ?? '—'}
                        <span className="block">{fmtDateTime(m.matched_at)}</span>
                      </td>
                      <td className={tdCls}>
                        <UnmatchButton
                          statementLineId={m.statement_line_id}
                          label={`${fmtDate(m.stmt_date)} ${formatMoneyString(m.amount)}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-stone-500">
              A match is an assertion, not an event: it says a human decided these two rows are the
              same transaction. A wrong one is a mistake rather than history, so it is removed
              rather than reversed — the one place in these books where taking something back is
              the honest answer. Unmatching frees both sides to be matched again. A
              &ldquo;Books say&rdquo; of — means the entry it was tied to no longer appears in
              money_movements.
            </p>
          </section>
        )}
      </div>
    </>
  )
}

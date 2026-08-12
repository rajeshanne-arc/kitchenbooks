// Balances by SHAPE — cash, bank, wallet, card settlement, owner, other.
// The kinds are shapes and not brands, so this table reads the same in any
// country; nothing here knows what a bank is called anywhere.
//
// Every column foots. Sums are done in paise (decimalStringToPaise) rather
// than on the numeric strings, so a subtotal is exact and lands under its
// own column rather than near it.
import type { AccountBalanceRow } from '@/lib/types'
import { decimalStringToPaise, formatPaise } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { dataTableCls, tdCls, tdNumCls, thCls, thNumCls, trCls } from '@/components/ui'

const KIND_LABEL: Record<string, string> = {
  cash: 'Cash',
  bank: 'Bank',
  wallet: 'Wallet',
  card_settlement: 'Card settlement',
  owner: 'Owner',
  other: 'Other',
}

/** The order money is looked for in, not the order the accounts were typed. */
const ORDER = ['cash', 'bank', 'wallet', 'card_settlement', 'owner', 'other']

// A kind this file does not know would otherwise drop out of the table while
// still counting in the total — a silent disagreement between what is shown
// and what is summed. It gets its own group, under its raw name, last.
const rank = (kind: string): number => {
  const i = ORDER.indexOf(kind)
  return i === -1 ? ORDER.length : i
}

const label = (kind: string): string => KIND_LABEL[kind] ?? kind

type Col = 'opening_balance' | 'movements' | 'balance'

const foot = (rows: AccountBalanceRow[], col: Col): number =>
  rows.reduce((a, r) => a + decimalStringToPaise(r[col]), 0)

/** A balance below zero is a thing to look at, never a thing to tidy away. */
const balanceCls = (p: number): string => (p < 0 ? 'font-semibold text-red-700' : 'text-stone-900')

function Foots({ rows, strong }: { rows: AccountBalanceRow[]; strong: boolean }) {
  const bal = foot(rows, 'balance')
  const weight = strong ? 'font-semibold' : ''
  return (
    <>
      <td className={`${tdNumCls} ${weight} text-stone-500`}>{formatPaise(foot(rows, 'opening_balance'))}</td>
      <td className={`${tdNumCls} ${weight} text-stone-500`}>{formatPaise(foot(rows, 'movements'))}</td>
      <td className={`${tdNumCls} ${weight} ${balanceCls(bal)}`}>{formatPaise(bal)}</td>
    </>
  )
}

export default function BalancesTable({ rows }: { rows: AccountBalanceRow[] }) {
  const kinds = [...new Set(rows.map((r) => r.kind))].sort(
    (a, b) => rank(a) - rank(b) || a.localeCompare(b),
  )
  const groups = kinds.map((kind) => ({ kind, rows: rows.filter((r) => r.kind === kind) }))

  return (
    <div className="overflow-x-auto">
      <table className={dataTableCls}>
        <thead>
          <tr>
            <th className={thCls}>Account</th>
            <th className={thNumCls}>Opening</th>
            <th className={thNumCls}>Moved</th>
            <th className={thNumCls}>Balance</th>
            <th className={thCls}>Basis</th>
          </tr>
        </thead>

        {groups.map((g) => (
          <tbody key={g.kind}>
            <tr>
              <td
                colSpan={5}
                className="border-b border-rule bg-paper px-3 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500"
              >
                {label(g.kind)}
              </td>
            </tr>

            {g.rows.map((r) => {
              const bal = decimalStringToPaise(r.balance)
              // No last move means nothing has moved through the account.
              // The opening balance still stands — the blank is about
              // activity, not about money.
              const lastMove = r.last_move
              return (
                <tr key={r.account_id} className={trCls}>
                  <td className={tdCls}>
                    <span className="block truncate">
                      {r.name}
                      {r.is_till && (
                        <span className="ml-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                          till
                        </span>
                      )}
                    </span>
                    {r.identifier !== null && (
                      <span className="block truncate font-mono text-[11px] text-stone-400">
                        {r.identifier}
                      </span>
                    )}
                  </td>
                  <td className={`${tdNumCls} text-stone-500`}>{formatPaise(decimalStringToPaise(r.opening_balance))}</td>
                  <td className={`${tdNumCls} ${lastMove === null ? 'text-stone-300' : 'text-stone-500'}`}>
                    {lastMove === null ? '—' : formatPaise(decimalStringToPaise(r.movements))}
                  </td>
                  <td className={`${tdNumCls} ${balanceCls(bal)}`}>{formatPaise(bal)}</td>
                  <td className={`${tdCls} text-stone-500`}>
                    {r.basis === 'counted' ? (
                      <span className="text-stone-700">
                        counted{r.counted_on === null ? '' : ` ${fmtDate(r.counted_on)}`}
                      </span>
                    ) : lastMove === null ? (
                      <span className="text-stone-400">no movement</span>
                    ) : (
                      fmtDate(lastMove)
                    )}
                  </td>
                </tr>
              )
            })}

            {/* a subtotal is read, not clicked — so no hover, and the paper
                tint separates it from the rows it adds up */}
            <tr className="h-11 bg-paper">
              <td className={`${tdCls} text-stone-500`}>
                {label(g.kind)} subtotal
                <span className="ml-1.5 text-[11px] text-stone-400">
                  {g.rows.length} {g.rows.length === 1 ? 'account' : 'accounts'}
                </span>
              </td>
              <Foots rows={g.rows} strong={false} />
              <td className={tdCls} />
            </tr>
          </tbody>
        ))}

        <tfoot>
          <tr className="h-11 bg-paper">
            <td className={`${tdCls} font-medium text-stone-700`}>
              All accounts
              <span className="ml-1.5 text-[11px] text-stone-400">
                {rows.length} {rows.length === 1 ? 'account' : 'accounts'}
              </span>
            </td>
            <Foots rows={rows} strong />
            <td className={tdCls} />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

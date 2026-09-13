import 'server-only'

// THE ONE INSERT INTO `payments`, on a handle the caller lends.
//
// Two paths write a vendor payment now: the store manager recording cash he
// has already handed over, and whoever settles an approved transfer request.
// They are the same event — one payments row, one PAY number — and two INSERT
// statements for one table is how they drift, which is why `saveShort` was
// DELETED rather than left beside `saveShorts`.
//
// IT TAKES `tx` RATHER THAN OPENING ITS OWN TRANSACTION, because of what has
// to commit beside it, and the two callers need different things:
//
//   recordPayment  the DOCUMENT NUMBER. Allocating before the insert burns a
//                  number on every failed save, and a hole in a numbered
//                  series is precisely what an auditor asks about.
//   payApproval    the `paid` EVENT. A payment recorded with no event is money
//                  that moved with no account of who moved it; an event with
//                  no payment is a trail asserting a payment that does not
//                  exist. Both are worse than neither, and neither is
//                  repairable afterwards, because nothing else in the system
//                  knows which of the two you are looking at.
//
// Deliberately NOT a 'use server' file: every export from one of those is a
// public endpoint, and this one moves money while taking the payer as a
// parameter — the same reasoning that keeps `applyRequest` out of the action
// file.

import type postgres from 'postgres'
import { nextDocNo } from '@/server/doc-numbers'
import { paiseToString } from '@/lib/money'

export type PaymentRow = {
  id: string
  doc_no: string | null
  paid_date: string
  amount: string
  mode: string | null
  note: string | null
  created_at: string
}

export async function insertPayment(
  tx: postgres.TransactionSql,
  restaurantId: string,
  input: {
    vendorId: string
    paidDate: string
    amountPaise: number
    mode: string
    note: string
    /** Already through assertAccount by the time it reaches here. A payment
     *  naming no account can never be reconciled against a statement, and
     *  `account_id` is nullable only because history predates the master. */
    accountId: string
    enteredBy: string | null
  },
): Promise<PaymentRow> {
  const docNo = await nextDocNo(tx, restaurantId, 'PAY', input.paidDate)
  const [row] = await tx<PaymentRow[]>`
    insert into payments (restaurant_id, paid_date, vendor_id, doc_no, amount, mode, note, entered_by, account_id)
    values (${restaurantId}, ${input.paidDate}, ${input.vendorId}, ${docNo},
            ${paiseToString(input.amountPaise)}::numeric,
            ${input.mode === '' ? null : input.mode},
            ${input.note === '' ? null : input.note},
            ${input.enteredBy}, ${input.accountId})
    returning id, doc_no, paid_date::text as paid_date, amount::text as amount, mode, note,
              created_at::text as created_at`
  if (!row) throw new Error('Payment insert could not be verified')
  return row
}

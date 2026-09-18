import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/server/current-user'
import { finishMobileMutation, reserveMobileMutation } from '@/server/mobile-mutations'
import { saveIssue, saveReturn, saveWastage, saveStoreLosses, voidIssue, voidWastage } from '@/server/store-actions'
import { saveClosing, saveKitchenWastage, saveKitchenLosses, saveProductions, saveIndent, updateIndent, saveProduction, saveItemizedClosing, voidKitchenWastage, voidProduction } from '@/server/kitchen-actions'
import { saveSettlement, saveOffBook, saveNonRevenues, saveDue, confirmPosReceivable, voidSettlement, voidOffBook, voidNonRevenue, voidDue } from '@/server/cashier-actions'
import { closeDay } from '@/server/cash-actions'
import { createPurchaseOrder, updatePurchaseOrder, sendPurchaseOrder, requestPurchaseOrderApproval, decidePurchaseOrderApproval } from '@/server/po-actions'
import { saveBill } from '@/server/save-bill'
import { requestApproval, decideApproval, cancelApproval, requestReopen } from '@/server/approvals-actions'

type Payload = Record<string, unknown>
type Handler = (payload: unknown) => Promise<unknown>
const id = (payload: unknown) => String((payload as Payload).id ?? '')

const handlers: Record<string, Handler> = {
  'store.issue.save': (p) => saveIssue(p as Parameters<typeof saveIssue>[0]),
  'store.return.save': (p) => saveReturn(p as Parameters<typeof saveReturn>[0]),
  'store.wastage.save': (p) => saveWastage(p as Parameters<typeof saveWastage>[0]),
  'store.losses.save': (p) => saveStoreLosses(p as Parameters<typeof saveStoreLosses>[0]),
  'store.issue.void': (p) => voidIssue(id(p)),
  'store.wastage.void': (p) => voidWastage(id(p)),
  'kitchen.closing.save': (p) => saveClosing(p as Parameters<typeof saveClosing>[0]),
  'kitchen.wastage.save': (p) => saveKitchenWastage(p as Parameters<typeof saveKitchenWastage>[0]),
  'kitchen.losses.save': (p) => saveKitchenLosses(p as Parameters<typeof saveKitchenLosses>[0]),
  'kitchen.productions.save': (p) => saveProductions(p as Parameters<typeof saveProductions>[0]),
  'kitchen.indent.save': (p) => saveIndent(p as Parameters<typeof saveIndent>[0]),
  'kitchen.indent.update': (p) => updateIndent(p as Parameters<typeof updateIndent>[0]),
  'kitchen.production.save': (p) => saveProduction(p as Parameters<typeof saveProduction>[0]),
  'kitchen.itemized-closing.save': (p) => saveItemizedClosing(p as Parameters<typeof saveItemizedClosing>[0]),
  'kitchen.wastage.void': (p) => voidKitchenWastage(id(p)),
  'kitchen.production.void': (p) => voidProduction(id(p)),
  'sales.settlement.save': (p) => saveSettlement(p as Parameters<typeof saveSettlement>[0]),
  'sales.off-book.save': (p) => saveOffBook(p as Parameters<typeof saveOffBook>[0]),
  'sales.non-revenue.save': (p) => saveNonRevenues(p as Parameters<typeof saveNonRevenues>[0]),
  'sales.due.save': (p) => saveDue(p as Parameters<typeof saveDue>[0]),
  'sales.pos-receivable.confirm': (p) => confirmPosReceivable(p as Parameters<typeof confirmPosReceivable>[0]),
  'sales.settlement.void': (p) => voidSettlement(id(p)),
  'sales.off-book.void': (p) => voidOffBook(id(p)),
  'sales.non-revenue.void': (p) => voidNonRevenue(id(p)),
  'sales.due.void': (p) => voidDue(id(p)),
  'sales.day-close.save': (p) => closeDay(p as Parameters<typeof closeDay>[0]),
  'purchasing.approval.request': (p) => requestPurchaseOrderApproval(String((p as Payload).id ?? ''), String((p as Payload).reason ?? '')),
  'purchasing.approval.decide': (p) => decidePurchaseOrderApproval(String((p as Payload).id ?? ''), (p as Payload).decision as 'approved' | 'refused', String((p as Payload).note ?? '')),
  'purchasing.bill.save': (p) => saveBill(p as Parameters<typeof saveBill>[0]),
  'purchasing.order.create': (p) => createPurchaseOrder(p as Parameters<typeof createPurchaseOrder>[0]),
  'purchasing.order.update': (p) => updatePurchaseOrder(id(p), p as Parameters<typeof updatePurchaseOrder>[1]),
  'purchasing.order.send': (p) => sendPurchaseOrder(p as Parameters<typeof sendPurchaseOrder>[0]),
  'approval.request': (p) => requestApproval(p as Parameters<typeof requestApproval>[0]),
  'approval.decide': (p) => decideApproval(p as Parameters<typeof decideApproval>[0]),
  'approval.cancel': (p) => cancelApproval(id(p)),
  'approval.reopen.request': (p) => requestReopen(p as Parameters<typeof requestReopen>[0]),
}

const BodySchema = z.object({
  clientMutationId: z.string().regex(/^[a-zA-Z0-9_-]{12,120}$/),
  operation: z.string().min(1).max(80),
  payload: z.record(z.string(), z.unknown()),
})

export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 })
  let reservationId: string | null = null
  try {
    const body = BodySchema.parse(await request.json())
    const handler = handlers[body.operation]
    if (!handler) return NextResponse.json({ error: 'Unsupported mobile operation' }, { status: 400 })
    const reservation = await reserveMobileMutation({ restaurantId: user.restaurantId, clientMutationId: body.clientMutationId, operation: body.operation, request: body.payload, enteredBy: user.username })
    if (reservation.kind === 'replay') return NextResponse.json({ result: reservation.response, replayed: true })
    if (reservation.kind === 'processing') return NextResponse.json({ error: 'This save is already being processed — retry shortly' }, { status: 409 })
    reservationId = reservation.id
    const result = await handler(body.payload)
    const failed = typeof result === 'object' && result !== null && 'ok' in result && result.ok === false
    await finishMobileMutation(user.restaurantId, reservation.id, failed ? 'failed' : 'accepted', result)
    if (failed) return NextResponse.json({ result }, { status: 400 })
    return NextResponse.json({ result })
  } catch (error) {
    if (reservationId !== null) await finishMobileMutation(user.restaurantId, reservationId, 'failed', { ok: false, error: 'Could not complete this mutation' })
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid mobile mutation' }, { status: 400 })
    console.error('mobile mutation failed', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save mobile mutation' }, { status: 400 })
  }
}

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/server/current-user'

export const dynamic = 'force-dynamic'

const workflows: [string, string, string, string[]][] = [
  ['01', 'Buy with context', 'Vendors, quotations, purchase orders, approvals, receipts, returns, invoice matching and vendor dues stay connected to the original bill.', ['Vendors & items', 'Quotes & POs', 'Receipts & returns']],
  ['02', 'Know what is in the kitchen', 'Opening stock, FEFO-ready lots, storage locations, issues, wastage, counts, adjustments and transfers explain every quantity and rupee.', ['Stock ledger', 'Counts & lots', 'Reorder & expiry']],
  ['03', 'Cook from the right recipe', 'Recipes have effective versions, substitutions, production output, expected yield, measured waste, prep demand and variance review.', ['Recipes & costing', 'Production', 'Variance review']],
  ['04', 'Close the day honestly', 'Petpooja sales, cash, UPI, card, delivery, dues and unknown statuses are fetched, mapped, reconciled and closed without rewriting source history.', ['POS fetch & mapping', 'Cash close', 'Reconciliation']],
]

const systems: [string, string][] = [
  ['Accounting', 'Double-entry journals, chart of accounts, posting mappings, vendor payments, expenses, deposits, vouchers, P&L, balance sheet and cash flow.'],
  ['Payroll', 'Staff, attendance, salary structures, advances, leave approvals, salary runs, payslips, PF/ESI configuration and exports.'],
  ['Owner control', 'Approvals, activity history, operating settings, letterhead, account mappings, business-day rules and correction trails.'],
  ['Evidence', 'Private bill, meter and statement attachments with authenticated reads, archive metadata and tenant-scoped storage keys.'],
  ['Imports', 'Preview-first CSV imports for items, vendors, staff, opening stock, purchases, sales, payroll, accounts and opening balances.'],
  ['SOPs & language', 'Role-specific operating guides, live route links, printable moments and English/Telugu staff-facing labels.'],
]

const roles: [string, string][] = [
  ['Owner', 'See the whole business, approve the exceptions and decide what changes the books.'],
  ['Manager', 'Run the operation across kitchen, store, sales and staff without owner-only controls.'],
  ['Chef', 'Plan prep, follow recipes, record production, issues, waste and kitchen close.'],
  ['Store', 'Maintain masters, receive goods, manage stock, issue ingredients and handle returns.'],
  ['Cashier', 'Record sales, fetch POS days, manage cash and complete the day-close ladder.'],
  ['Accountant', 'Review the queue, reconcile cash and POS, post journals, run payroll and close periods.'],
]

function Arrow() { return <span aria-hidden="true" className="text-emerald-700">↗</span> }

export default async function Home() {
  const user = await getSessionUser()
  if (user !== null) {
    const destination = user.role === 'owner' || user.role === 'manager' ? '/owner' : user.role === 'chef' ? '/kitchen' : user.role === 'store' ? '/store' : user.role === 'cashier' ? '/sales' : '/accounts'
    redirect(destination)
  }

  return (
    <main className="overflow-hidden">
      <section className="border-b border-rule bg-stone-100">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 pb-20 pt-16 sm:px-8 sm:pt-24 lg:grid-cols-[1.1fr_0.9fr] lg:items-end lg:gap-20">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">KitchenBooks · restaurant operations</p>
            <h1 className="mt-6 max-w-3xl font-display text-5xl font-bold leading-[0.94] tracking-[-0.055em] text-stone-900 sm:text-7xl">The books behind a better kitchen.</h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-stone-600 sm:text-xl">KitchenBooks connects purchasing, stock, recipes, production, POS sales, cash, accounting and payroll into one operational record your team can actually run.</p>
            <div className="mt-9 flex flex-wrap items-center gap-3"><Link href="/login" className="rounded-xl bg-emerald-700 px-5 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-emerald-800 active:bg-emerald-900">Open KitchenBooks <span className="ml-1">↗</span></Link><a href="#how-it-works" className="rounded-xl border border-rule bg-cell px-5 py-3.5 text-[15px] font-semibold text-stone-700 transition-colors hover:border-stone-400">See how it works</a></div>
            <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.12em] text-stone-400">Built for India · GST-ready workflows · Asia/Kolkata business days</p>
          </div>
          <div className="relative rounded-2xl border border-stone-700 bg-stone-900 p-4 text-stone-100 shadow-lg sm:p-6">
            <div className="flex items-center justify-between border-b border-stone-700 pb-4"><div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-300">Owner&apos;s view</p><p className="mt-1 font-display text-xl font-semibold">Today at your restaurant</p></div><span className="rounded-full border border-emerald-500/40 px-2.5 py-1 font-mono text-[10px] text-emerald-300">LIVE BOOKS</span></div>
            <div className="grid grid-cols-2 gap-3 py-5"><div className="rounded-xl border border-stone-700 bg-stone-800 p-4"><p className="font-mono text-[10px] uppercase tracking-wider text-stone-400">Sales</p><p className="mt-2 font-display text-3xl font-bold">₹1,84,260</p><p className="mt-1 text-xs text-emerald-300">Mapped to 4 sections</p></div><div className="rounded-xl border border-stone-700 bg-stone-800 p-4"><p className="font-mono text-[10px] uppercase tracking-wider text-stone-400">Food cost</p><p className="mt-2 font-display text-3xl font-bold">34.8%</p><p className="mt-1 text-xs text-amber-300">2 items need review</p></div></div>
            <div className="space-y-2 border-t border-stone-700 pt-4 text-sm"><div className="flex items-center justify-between"><span className="text-stone-300">POS fetched</span><span className="font-mono text-emerald-300">✓ 182 orders</span></div><div className="flex items-center justify-between"><span className="text-stone-300">Cash counted</span><span className="font-mono text-emerald-300">✓ ₹42,600</span></div><div className="flex items-center justify-between"><span className="text-stone-300">Exceptions</span><span className="font-mono text-amber-300">3 to review</span></div></div>
            <p className="mt-5 border-l-2 border-emerald-500 pl-3 text-xs leading-5 text-stone-400">A number is only useful when the team can show where it came from.</p>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28"><div className="max-w-2xl"><p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">The operating spine</p><h2 className="mt-4 font-display text-4xl font-bold tracking-[-0.04em] text-stone-900 sm:text-5xl">One record from invoice to insight.</h2><p className="mt-5 text-lg leading-8 text-stone-600">Every handoff has a place, an owner and a history. The system follows the work instead of asking the team to rebuild it at month end.</p></div><div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-rule bg-rule md:grid-cols-2">{workflows.map(([number, title, text, links]) => <article key={number} className="bg-cell p-6 sm:p-8"><div className="flex items-start justify-between"><span className="font-mono text-xs text-emerald-700">{number}</span><span className="text-xl text-stone-300">—</span></div><h3 className="mt-10 font-display text-2xl font-bold tracking-[-0.025em] text-stone-900">{title}</h3><p className="mt-3 max-w-md text-[15px] leading-7 text-stone-600">{text}</p><div className="mt-6 flex flex-wrap gap-2">{links.map((link) => <span key={link} className="rounded-full bg-stone-100 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-stone-500">{link}</span>)}</div></article>)}</div></section>

      <section className="border-y border-rule bg-stone-100"><div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28"><div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-24"><div><p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">The full system</p><h2 className="mt-4 font-display text-4xl font-bold tracking-[-0.04em] text-stone-900 sm:text-5xl">Everything the restaurant needs to stay accountable.</h2><p className="mt-5 text-lg leading-8 text-stone-600">Small teams do not need more dashboards. They need the right answer at the moment a decision is made.</p></div><div className="grid gap-x-8 gap-y-8 sm:grid-cols-2">{systems.map(([title, text]) => <article key={title} className="border-t border-rule pt-4"><h3 className="font-display text-xl font-bold text-stone-900">{title}</h3><p className="mt-2 text-sm leading-6 text-stone-600">{text}</p></article>)}</div></div></div></section>

      <section id="roles" className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Made for the people doing the work</p><h2 className="mt-4 font-display text-4xl font-bold tracking-[-0.04em] text-stone-900 sm:text-5xl">One kitchen. Clear ownership.</h2></div><p className="max-w-sm text-sm leading-6 text-stone-600">Role boundaries are visible in the interface and enforced again on the server. People see the work they own, not a maze of permissions.</p></div><div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{roles.map(([title, text], index) => <article key={title} className="rounded-2xl border border-rule bg-cell p-5 transition-colors hover:border-emerald-400"><div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 font-mono text-xs font-semibold text-emerald-800">{String(index + 1).padStart(2, '0')}</span><h3 className="font-display text-lg font-bold text-stone-900">{title}</h3></div><p className="mt-4 text-sm leading-6 text-stone-600">{text}</p></article>)}</div></section>

      <section className="bg-emerald-800 text-white"><div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[1fr_0.8fr] lg:items-end"><div><p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-emerald-200">Control without guesswork</p><h2 className="mt-4 max-w-2xl font-display text-4xl font-bold tracking-[-0.04em] sm:text-6xl">When the number is wrong, KitchenBooks helps you find the moment it changed.</h2></div><div><p className="text-base leading-7 text-emerald-100">Append-only source events, tenant isolation, approval queues, correction trails, private evidence and business-day logic keep the books explainable—during service and after close.</p><Link href="/login" className="mt-7 inline-flex rounded-xl bg-white px-5 py-3.5 text-[15px] font-semibold text-emerald-800 transition-colors hover:bg-emerald-50">Sign in to your books <span className="ml-2">↗</span></Link></div></div></section>

      <footer className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8"><div><p className="font-display text-lg font-bold text-emerald-800">KitchenBooks</p><p className="mt-1 text-sm text-stone-500">Purchase-bill bookkeeping for the kitchen.</p></div><div className="flex flex-wrap gap-5 text-sm text-stone-500"><a href="#how-it-works" className="hover:text-stone-900">How it works</a><a href="#roles" className="hover:text-stone-900">Roles</a><Link href="/login" className="font-semibold text-emerald-700 hover:text-emerald-900">Sign in <Arrow /></Link></div></footer>
    </main>
  )
}

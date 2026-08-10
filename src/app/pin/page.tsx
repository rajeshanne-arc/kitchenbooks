export const dynamic = 'force-dynamic'

export default async function PinPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4">
      <form method="POST" action="/api/pin" className="w-full max-w-xs text-center">
        <p className="text-[15px] font-bold tracking-tight text-emerald-800">KitchenBooks</p>
        <h1 className="mt-1 text-xl font-bold text-stone-900">Enter the PIN</h1>
        <p className="mt-1 text-sm text-stone-500">One PIN for the whole book — ask Rajesh.</p>
        <input
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          maxLength={12}
          className="mt-5 w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-center text-2xl tracking-[0.4em] text-stone-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
        />
        {e === '1' && (
          <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-800">
            Wrong PIN — try again.
          </p>
        )}
        <button
          type="submit"
          className="mt-4 w-full rounded-xl bg-emerald-700 py-3 text-[15px] font-semibold text-white hover:bg-emerald-800"
        >
          Unlock
        </button>
      </form>
    </main>
  )
}

import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { getSessionUser } from '@/server/current-user'
import { canAccess, type Role } from '@/lib/roles'
import { isSopRole, SOP_MOMENTS, type SopCopy } from '@/lib/sops'
import { allTabRoutes } from '@/lib/routes'
import { LANG_COOKIE, type Lang } from '@/lib/i18n'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

function routeLabel(route: string): string {
  if (route === '/owner') return 'Owner dashboard'
  if (route === '/accounts') return 'Accounts review'
  const found = allTabRoutes().find((candidate) => route === candidate)
  return found?.split('/').filter(Boolean).at(-1)?.replaceAll('-', ' ') ?? route
}

function language(value: string | undefined): Lang {
  return value === 'te' ? 'te' : 'en'
}

export default async function SopPage({ params }: { params: Promise<{ role: string }> }) {
  const { role: raw } = await params
  if (!isSopRole(raw)) notFound()
  const role = raw as Role
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (user.role !== 'owner' && user.role !== role) {
    if (canAccess(user.role, `/sops/${user.role}`)) redirect(`/sops/${user.role}`)
    notFound()
  }

  const lang = language((await cookies()).get(LANG_COOKIE)?.value)
  const telugu = lang === 'te'
  const text = (moment: (typeof SOP_MOMENTS)[Role][number]): SopCopy => telugu ? moment.te : moment

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 print:max-w-none print:px-0">
      <header className="border-b border-rule pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">KitchenBooks · {telugu ? 'మీ రోజు' : 'Your day'}</p>
        <h1 className={`${pageTitleCls} mt-2`}>{telugu ? `${role === 'owner' ? 'యజమాని' : role === 'manager' ? 'మేనేజర్' : role === 'chef' ? 'చెఫ్' : role === 'store' ? 'స్టోర్' : role === 'cashier' ? 'క్యాషియర్' : 'అకౌంటెంట్'} నిర్వహణ మార్గదర్శిని` : `${role[0].toUpperCase() + role.slice(1)} operating guide`}</h1>
        <p className={pageSubCls}>{telugu ? 'చిన్న పని మార్గదర్శిని. లింకులు ప్రస్తుత ఉత్పత్తి మార్గాలకు వెళ్తాయి; ఫీల్డ్‌లు మరియు తిరస్కరణ వివరాలు సంబంధిత స్క్రీన్‌లో ఉంటాయి.' : 'A short working guide. Links follow the current product routes; timing, reason, and response are the restaurant’s operating practice.'}</p>
      </header>
      <div className="mt-6 space-y-5">
        {SOP_MOMENTS[role].map((moment, index) => {
          const copy = text(moment)
          return (
            <article key={moment.key} className="break-inside-avoid rounded-2xl border border-rule bg-cell p-5">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-display text-lg font-bold text-stone-900">{index + 1}. {copy.title}</h2>
                <span className="text-xs font-medium uppercase tracking-wide text-stone-400">{routeLabel(moment.route)}</span>
              </div>
              <dl className="mt-4 grid gap-3 text-sm">
                <div><dt className="font-semibold text-stone-800">{telugu ? 'ఎప్పుడు' : 'When'}</dt><dd className="text-stone-600">{copy.when}</dd></div>
                <div><dt className="font-semibold text-stone-800">{telugu ? 'ఎందుకు' : 'Why'}</dt><dd className="text-stone-600">{copy.why}</dd></div>
                <div><dt className="font-semibold text-stone-800">{telugu ? 'ఏదైనా తప్పు ఉంటే' : 'If something is wrong'}</dt><dd className="text-stone-600">{copy.ifWrong}</dd></div>
              </dl>
              <Link href={moment.route} className="mt-4 inline-flex rounded-lg border border-emerald-700 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50">{telugu ? `${routeLabel(moment.route)} తెరవండి` : `Open ${routeLabel(moment.route)}`}</Link>
            </article>
          )
        })}
      </div>
      <p className="mt-6 text-center text-xs text-stone-400">{telugu ? 'ఈ పేజీని ఈ పాత్ర కోసం ముద్రించండి. ప్రత్యక్ష ఫీల్డ్ మరియు తిరస్కరణ వివరాలు ఎల్లప్పుడూ సంబంధిత స్క్రీన్‌లో ఉంటాయి.' : 'Print this page for the role. Product fields and refusal details remain on the linked screen, where they stay current.'}</p>
    </main>
  )
}

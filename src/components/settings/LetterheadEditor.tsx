'use client'

// WHOSE NAME IS ON THE DOCUMENT — and what it looks like.
//
// Every field here is NULL on a new tenant and on Thrayam today. A purchase
// order with no letterhead is a list of items from nobody, so the screen leads
// with what is missing rather than presenting eleven empty boxes as a form
// somebody might get around to.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveLetterhead } from '@/server/letterhead-actions'
import { DOCUMENT_STYLE_NAMES, missingLetterheadFields } from '@/lib/letterhead'
import { DOCUMENT_STYLES, type DocumentStyle, type Letterhead } from '@/lib/types'
import SaveAck from '@/components/SaveAck'
import Honesty from '@/components/Honesty'
import {
  btnCls,
  cardCls,
  fieldLabelCls,
  inputCls,
  sectionHeadCls,
  selectCls,
} from '@/components/ui'

export default function LetterheadEditor({
  initial,
  initialStyle,
}: {
  initial: Letterhead
  initialStyle: DocumentStyle
}) {
  const router = useRouter()
  const v = (x: string | null) => x ?? ''
  const [f, setF] = useState({
    legalName: v(initial.legal_name),
    addressLine1: v(initial.address_line1),
    addressLine2: v(initial.address_line2),
    city: v(initial.city),
    state: v(initial.state),
    pincode: v(initial.pincode),
    phone: v(initial.phone),
    email: v(initial.email),
    gstin: v(initial.gstin),
    fssaiNumber: v(initial.fssai_number),
    logoUrl: v(initial.logo_url),
  })
  const [style, setStyle] = useState<DocumentStyle>(initialStyle)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ack, setAck] = useState<{ headline: string; sub?: string } | null>(null)
  const [current, setCurrent] = useState(initial)

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }))

  const missing = missingLetterheadFields(current)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await saveLetterhead({ ...f, documentStyle: style })
      if (res.ok) {
        setCurrent(res.letterhead)
        const left = missingLetterheadFields(res.letterhead)
        setAck({
          headline: `${res.letterhead.legal_name ?? res.letterhead.name} — letterhead saved`,
          sub:
            left.length === 0
              ? 'Every field a purchase order needs is now filled in.'
              : `Still missing: ${left.join(', ')}. A document prints without them and reads as coming from a name with no address.`,
        })
        router.refresh()
      } else setError(res.error)
    } catch {
      setError('Could not reach the server — nothing was saved.')
    } finally {
      setBusy(false)
    }
  }

  const Field = ({ k, label, hint }: { k: keyof typeof f; label: string; hint?: string }) => (
    <label className="block">
      <span className={fieldLabelCls}>{label}</span>
      <input value={f[k]} onChange={set(k)} className={inputCls} />
      {hint !== undefined && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  )

  return (
    <div className="space-y-4">
      {ack !== null && <SaveAck headline={ack.headline} sub={ack.sub} onDismiss={() => setAck(null)} />}

      {missing.length > 0 && (
        <Honesty verdict="nothing on the letterhead" level={missing.length >= 7 ? 'alarm' : 'pending'}>
          A purchase order carries {missing.length} {missing.length === 1 ? 'thing' : 'things'} this
          restaurant has not said: {missing.join(', ')}. Documents still print — a vendor reading one sees a
          list of items from a name with no address.
        </Honesty>
      )}

      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Who this restaurant is, on paper</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field k="legalName" label="Legal name" hint="The name on the GST registration, if it differs from the one above the door." />
          <Field k="phone" label="Phone" />
          <Field k="addressLine1" label="Address" />
          <Field k="addressLine2" label="Address, second line" />
          <Field k="city" label="City" />
          <Field k="state" label="State" />
          <Field k="pincode" label="Pincode" />
          <Field k="email" label="Email" />
          <Field k="gstin" label="GSTIN" />
          <Field k="fssaiNumber" label="FSSAI number" />
        </div>
      </section>

      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Logo</h2>
        {/* SAID PLAINLY. Upload waits on attachments — decided (Vercel Blob,
            server-side uploads only, per-tenant paths, signed reads) and
            unbuilt. A file picker that silently did nothing would be worse
            than a field that admits what it is. */}
        <p className="mt-1 text-sm text-stone-600">
          A web address for now, not an upload. Uploading files needs the attachments store, which is decided
          and not yet built — so this takes a link to an image you already host, and says so rather than
          offering a file picker that would not work.
        </p>
        <div className="mt-2">
          <Field k="logoUrl" label="Logo address" hint="Must start with https://" />
        </div>
      </section>

      <section className={cardCls}>
        <h2 className={sectionHeadCls}>How documents look</h2>
        <p className="mt-1 text-sm text-stone-600">
          A choice of layout, per restaurant. It changes nothing about any figure — which is the only reason
          it is allowed to be a setting at all.
        </p>
        <label className="mt-2 block">
          <span className={fieldLabelCls}>Document style</span>
          <select value={style} onChange={(e) => setStyle(e.target.value as DocumentStyle)} className={selectCls}>
            {DOCUMENT_STYLES.map((s) => (
              <option key={s} value={s}>
                {DOCUMENT_STYLE_NAMES[s]}
              </option>
            ))}
          </select>
        </label>
      </section>

      {error !== null && (
        <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      <button type="button" onClick={() => void save()} disabled={busy} className={`${btnCls} disabled:bg-stone-300`}>
        {busy ? 'Saving…' : 'Save letterhead'}
      </button>
    </div>
  )
}

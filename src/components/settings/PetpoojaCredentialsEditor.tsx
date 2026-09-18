'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { savePetpoojaCredentials } from '@/server/pos-credentials'
import { btnCls, cardCls, fieldLabelCls, inputCls, sectionHeadCls } from '@/components/ui'
import SaveAck from '@/components/SaveAck'
import { toast } from '@/components/Toasts'

export default function PetpoojaCredentialsEditor({ configured }: { configured: boolean }) {
  const router = useRouter()
  const [appKey, setAppKey] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [restaurantId, setRestaurantId] = useState('')
  const [busy, setBusy] = useState(false)
  const [ack, setAck] = useState(false)

  async function save() {
    if (busy) return
    setBusy(true)
    const result = await savePetpoojaCredentials({ appKey, appSecret, accessToken, restaurantId })
    setBusy(false)
    if (!result.ok) return toast(result.error, 'error')
    setAck(true)
    setAppKey(''); setAppSecret(''); setAccessToken(''); setRestaurantId('')
    router.refresh()
  }

  return (
    <section className={cardCls}>
      <h2 className={sectionHeadCls}>Petpooja connection</h2>
      <p className="mt-1.5 text-sm text-stone-600">
        {configured ? 'Credentials are configured for this restaurant. Enter all four fields to replace them.' : 'An owner enters the four values from Petpooja. They are encrypted before storage and never shown back.'}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label><span className={fieldLabelCls}>App key</span><input type="password" autoComplete="off" className={inputCls} value={appKey} onChange={(e) => setAppKey(e.target.value)} /></label>
        <label><span className={fieldLabelCls}>App secret</span><input type="password" autoComplete="off" className={inputCls} value={appSecret} onChange={(e) => setAppSecret(e.target.value)} /></label>
        <label><span className={fieldLabelCls}>Access token</span><input type="password" autoComplete="off" className={inputCls} value={accessToken} onChange={(e) => setAccessToken(e.target.value)} /></label>
        <label><span className={fieldLabelCls}>Petpooja restaurant ID</span><input autoComplete="off" className={inputCls} value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)} /></label>
      </div>
      <button type="button" onClick={() => void save()} disabled={busy || [appKey, appSecret, accessToken, restaurantId].some((v) => v.trim() === '')} className={`${btnCls} mt-3 disabled:opacity-50`}>{busy ? 'Saving…' : configured ? 'Replace credentials' : 'Save credentials'}</button>
      {ack && <SaveAck headline="Petpooja credentials saved" sub="The encrypted connection is ready for a future sync; secret values are not displayed." onDismiss={() => setAck(false)} />}
    </section>
  )
}

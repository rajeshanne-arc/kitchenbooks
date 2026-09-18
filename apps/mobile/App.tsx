import { StatusBar } from 'expo-status-bar'
import * as SecureStore from 'expo-secure-store'
import * as ImagePicker from 'expo-image-picker'
import * as Linking from 'expo-linking'
import * as Notifications from 'expo-notifications'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native'
import { cacheAttendance, cachedAttendance, flushAttendance, flushMutations, pendingMutations, queueMutation, removeMutation, retryMutation, type PendingMutation } from './offline'

const colors = { ink: '#172033', muted: '#6c746f', paper: '#f3f6f8', cell: '#ffffff', rule: '#d9dfda', green: '#2f6b47', greenSoft: '#e4f0e8', red: '#9b2c2c' }
type Role = 'owner' | 'manager' | 'chef' | 'store' | 'cashier' | 'accountant'
type Session = { username: string; displayName: string; role: Role; restaurantName: string; accessToken?: string }
type AttendanceStatus = 'present' | 'half' | 'off' | 'leave' | 'absent'
type AttendanceRow = { staff_id: string; code: string; name: string; designation: string | null; effective: AttendanceStatus | null; extra_hours: string | null }
type Bootstrap = { date: string; alerts: { negativeStock: number; unacceptedStock: number; reorderStock: number; missingCloses: number; approvals: number } }
type StockItem = { item_id: string; code: string; name: string; category_name: string; purchase_unit: string; on_hand_qty: string; issue_cost: string | null; on_hand_value: string }
type KitchenProduction = { id: string; production_date: string; recipe_name: string; section_name: string | null; quantity: string; unit_name: string; waste_qty: string | null }
type CashPrefill = { ok: boolean; opening?: string; posCash?: string; otherIncome?: string; cashierVouchers?: string; offBookCash?: string; error?: string }
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://kb.etdemo.in'
const SESSION_KEY = 'kitchenbooks.session'
const mutationId = () => `m_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
let sessionExpired: (() => void) | null = null

async function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await globalThis.fetch(input, init)
  if (response.status === 401) sessionExpired?.()
  return response
}

async function login(username: string, password: string): Promise<Session> {
  const response = await fetch(`${API_BASE_URL}/api/mobile/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })
  if (!response.ok) throw new Error('Wrong username or password')
  const payload = (await response.json()) as { session: Session }
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(payload.session))
  return payload.session
}

async function restoreSession(): Promise<Session | null> {
  const stored = await SecureStore.getItemAsync(SESSION_KEY)
  if (stored === null) return null
  const session = JSON.parse(stored) as Session
  if (!session.accessToken) return session
  try {
    const response = await fetch(`${API_BASE_URL}/api/mobile/v1/auth/refresh`, { method: 'POST', headers: { authorization: `Bearer ${session.accessToken}` } })
    if (!response.ok) throw new Error('expired')
    const payload = (await response.json()) as { session: Session }
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(payload.session))
    return payload.session
  } catch {
    await SecureStore.deleteItemAsync(SESSION_KEY)
    return null
  }
}

function LoginScreen({ onLogin }: { onLogin: (session: Session) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit() {
    setBusy(true); setError(null)
    try { onLogin(await login(username.trim(), password)) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to sign in') } finally { setBusy(false) }
  }
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.loginPage} keyboardShouldPersistTaps="handled">
    <Text style={styles.eyebrow}>KITCHENBOOKS MOBILE</Text>
    <Text style={styles.loginTitle}>The books behind a better kitchen.</Text>
    <Text style={styles.loginCopy}>Record the work where it happens. Your role, restaurant, and business day stay with every entry.</Text>
    <View style={styles.card}><Text style={styles.sectionLabel}>SIGN IN</Text>
      <TextInput autoCapitalize="none" autoCorrect={false} placeholder="Username" placeholderTextColor="#9ba39d" style={styles.input} value={username} onChangeText={setUsername} />
      <TextInput autoCapitalize="none" placeholder="Password" placeholderTextColor="#9ba39d" secureTextEntry style={styles.input} value={password} onChangeText={setPassword} />
      {error !== null && <Text style={styles.error}>{error}</Text>}
      <Pressable accessibilityRole="button" disabled={busy || username.trim() === '' || password === ''} onPress={() => void submit()} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, (busy || username.trim() === '' || password === '') && styles.disabled]}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Sign in</Text>}</Pressable>
      <Text style={styles.apiHint}>Server: {API_BASE_URL}</Text>
    </View>
  </ScrollView><StatusBar style="dark" /></SafeAreaView>
}

const actionsByRole: Record<Role, string[]> = { owner: ['Review approvals', 'Review stock', 'See dashboard'], manager: ['Close the shift', 'Review stock', 'Create purchase order'], chef: ['Record production', 'Mark wastage', 'Review sync history'], store: ['Receive a bill', 'Review stock', 'Create purchase order'], cashier: ['Record sales', 'Close cash', 'Review sync history'], accountant: ['Review books', 'Record payment', 'Review sync history'] }

function AttendanceScreen({ session, onBack }: { session: Session; onBack: () => void }) {
  const [date, setDate] = useState('')
  const [rows, setRows] = useState<AttendanceRow[]>([])
  const [marks, setMarks] = useState<Record<string, AttendanceStatus | null>>({})
  const [busy, setBusy] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void fetch(`${API_BASE_URL}/api/mobile/v1/attendance`, { headers: { authorization: `Bearer ${session.accessToken ?? ''}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load attendance')
        return (await response.json()) as { date: string; sheet: AttendanceRow[] }
      })
      .then(async (payload) => { setDate(payload.date); setRows(payload.sheet); setMarks(Object.fromEntries(payload.sheet.map((row) => [row.staff_id, row.effective]))); await cacheAttendance(payload.date, payload); const flushed = await flushAttendance(API_BASE_URL, session.accessToken ?? ''); if (flushed > 0) setMessage(`${flushed} offline save(s) synced`) })
      .catch(async (error) => {
        const local = await cachedAttendance(new Date().toISOString().slice(0, 10))
        if (local !== null) { const sheet = local.sheet as AttendanceRow[]; setDate(local.date); setRows(sheet); setMarks(Object.fromEntries(sheet.map((row) => [row.staff_id, row.effective]))); setMessage('Offline · showing the last saved attendance sheet') }
        else setMessage(error instanceof Error ? error.message : 'Could not load attendance')
      })
      .finally(() => setBusy(false))
  }, [session.accessToken])

  async function save() {
    const selected = Object.entries(marks).filter((entry): entry is [string, AttendanceStatus] => entry[1] !== null).map(([staffId, status]) => ({ staffId, status, extraHours: '' }))
    if (selected.length === 0 || date === '') { setMessage('Mark at least one person before saving'); return }
    const clientMutationId = mutationId()
    const requestPayload = { clientMutationId, date, marks: selected }
    setSaving(true); setMessage(null)
    try {
      let response: Response
      try {
        response = await fetch(`${API_BASE_URL}/api/mobile/v1/attendance`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session.accessToken ?? ''}` }, body: JSON.stringify(requestPayload) })
      } catch {
        await queueMutation({ clientMutationId, operation: 'attendance.save', payload: requestPayload })
        const pending = await pendingMutations()
        setMessage(`Offline · saved on this device (${pending.length} pending)`)
        return
      }
      const payload = (await response.json()) as { error?: string; inserted?: number }
      if (!response.ok) { setMessage(payload.error ?? 'Could not save attendance'); return }
      setMessage(`${payload.inserted ?? 0} attendance mark(s) saved`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save attendance') } finally { setSaving(false) }
  }

  return <SafeAreaView style={styles.safe}><View style={styles.header}><Pressable onPress={onBack} style={styles.backButton}><Text style={styles.backText}>← Back</Text></Pressable><Text style={styles.headerTitle}>Attendance</Text><View style={styles.headerSpacer} /></View><ScrollView contentContainerStyle={styles.homePage}>
    <Text style={styles.eyebrow}>STAFF · {date || 'LOADING'}</Text><Text style={styles.pageTitle}>Who worked today?</Text><Text style={styles.pageCopy}>A correction adds a new mark; it never erases the old one.</Text>
    {message !== null && <Text style={styles.notice}>{message}</Text>}
    {busy ? <ActivityIndicator color={colors.green} style={styles.loader} /> : rows.map((row) => <View key={row.staff_id} style={styles.attendanceRow}><View style={styles.staffIdentity}><Text style={styles.staffName}>{row.name}</Text><Text style={styles.staffMeta}>{row.code} · {row.designation ?? 'Staff'}</Text></View><View style={styles.statuses}>{(['present', 'half', 'off', 'leave', 'absent'] as AttendanceStatus[]).map((status) => { const selected = marks[row.staff_id] === status; return <Pressable key={status} accessibilityRole="button" onPress={() => setMarks((current) => ({ ...current, [row.staff_id]: status }))} style={[styles.statusButton, selected && styles.statusSelected]}><Text style={[styles.statusText, selected && styles.statusSelectedText]}>{status === 'present' ? 'P' : status === 'half' ? '½' : status === 'off' ? 'O' : status === 'leave' ? 'L' : 'A'}</Text></Pressable> })}</View></View>)}
    <Pressable disabled={saving || busy} onPress={() => void save()} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, (saving || busy) && styles.disabled]}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Save attendance</Text>}</Pressable>
  </ScrollView><StatusBar style="dark" /></SafeAreaView>
}

function StockScreen({ session, onBack }: { session: Session; onBack: () => void }) {
  const [items, setItems] = useState<StockItem[]>([])
  const [totalValue, setTotalValue] = useState('0')
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    void fetch(`${API_BASE_URL}/api/mobile/v1/stock`, { headers: { authorization: `Bearer ${session.accessToken ?? ''}` } })
      .then(async (response) => { if (!response.ok) throw new Error('Could not load stock'); return (await response.json()) as { items: StockItem[]; totalValue: string } })
      .then((payload) => { setItems(payload.items); setTotalValue(payload.totalValue) })
      .catch((error) => setMessage(error instanceof Error ? error.message : 'Could not load stock'))
  }, [session.accessToken])
  return <SafeAreaView style={styles.safe}><View style={styles.header}><Pressable onPress={onBack} style={styles.backButton}><Text style={styles.backText}>← Back</Text></Pressable><Text style={styles.headerTitle}>Stock on hand</Text><View style={styles.headerSpacer} /></View><ScrollView contentContainerStyle={styles.homePage}>
    <Text style={styles.eyebrow}>STORE · CURRENT VALUE</Text><Text style={styles.pageTitle}>What is on the shelf?</Text><Text style={styles.pageCopy}>The server’s stock ledger, ordered by value. No quantity is silently estimated.</Text>
    <View style={styles.stockTotal}><Text style={styles.sectionLabel}>TOTAL ON HAND</Text><Text style={styles.stockValue}>₹{totalValue}</Text></View>
    {message !== null && <Text style={styles.notice}>{message}</Text>}
    {items.map((item) => <View key={item.item_id} style={styles.stockRow}><View style={styles.staffIdentity}><Text style={styles.staffName}>{item.name}</Text><Text style={styles.staffMeta}>{item.code} · {item.category_name}</Text></View><View style={styles.stockNumbers}><Text style={styles.stockQty}>{item.on_hand_qty} {item.purchase_unit}</Text><Text style={styles.staffMeta}>{item.on_hand_value ? `₹${item.on_hand_value}` : '—'}</Text></View></View>)}
  </ScrollView><StatusBar style="dark" /></SafeAreaView>
}

function SalesScreen({ session, onBack }: { session: Session; onBack: () => void }) {
  const [date, setDate] = useState('')
  const [prefill, setPrefill] = useState<CashPrefill | null>(null)
  const [cashCounted, setCashCounted] = useState('')
  const [handedOver, setHandedOver] = useState('')
  const [handedTo, setHandedTo] = useState('')
  const [note, setNote] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => { void fetch(`${API_BASE_URL}/api/mobile/v1/sales`, { headers: { authorization: `Bearer ${session.accessToken ?? ''}` } }).then(async (response) => { if (!response.ok) throw new Error('Could not load cash close'); return (await response.json()) as { date: string; prefill: CashPrefill } }).then((payload) => { setDate(payload.date); setPrefill(payload.prefill) }).catch((error) => setMessage(error instanceof Error ? error.message : 'Could not load cash close')) }, [session.accessToken])
  async function save() {
    if (!date || !cashCounted.trim()) { setMessage('Enter counted cash before saving'); return }
    setSaving(true); setMessage(null)
    try {
      const response = await fetch(`${API_BASE_URL}/api/mobile/v1/mutations`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session.accessToken ?? ''}` }, body: JSON.stringify({ clientMutationId: mutationId(), operation: 'sales.day-close.save', payload: { bankAccountId: '', date, extraCashIn: '', handedOver, handedTo, cashCounted, bankSettled: '', note } }) })
      const payload = await response.json() as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Could not save cash close')
      setMessage('Cash close saved to the books')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save cash close') } finally { setSaving(false) }
  }
  return <SafeAreaView style={styles.safe}><View style={styles.header}><Pressable onPress={onBack} style={styles.backButton}><Text style={styles.backText}>← Back</Text></Pressable><Text style={styles.headerTitle}>Sales & cash</Text><View style={styles.headerSpacer} /></View><ScrollView contentContainerStyle={styles.homePage}><Text style={styles.eyebrow}>CASH CLOSE · {date || 'LOADING'}</Text><Text style={styles.pageTitle}>Count the drawer.</Text><Text style={styles.pageCopy}>The server has already resolved opening cash, POS cash, vouchers, and other income.</Text>{prefill?.ok === false && <Text style={styles.notice}>{prefill.error ?? 'This day cannot be closed yet'}</Text>}{prefill?.ok !== false && <View style={styles.card}><Text style={styles.sectionLabel}>SERVER PREFILL</Text><Text style={styles.cardCopy}>Opening ₹{prefill?.opening ?? '—'} · POS cash ₹{prefill?.posCash ?? '0'} · other income ₹{prefill?.otherIncome ?? '0'}</Text></View>}{message !== null && <Text style={styles.notice}>{message}</Text>}<TextInput keyboardType="decimal-pad" placeholder="Cash counted" placeholderTextColor="#9ba39d" style={styles.input} value={cashCounted} onChangeText={setCashCounted} /><TextInput keyboardType="decimal-pad" placeholder="Handed over (optional)" placeholderTextColor="#9ba39d" style={styles.input} value={handedOver} onChangeText={setHandedOver} /><TextInput placeholder="Handed to (optional)" placeholderTextColor="#9ba39d" style={styles.input} value={handedTo} onChangeText={setHandedTo} /><TextInput placeholder="Note (optional)" placeholderTextColor="#9ba39d" style={styles.input} value={note} onChangeText={setNote} /><Pressable disabled={saving || prefill?.ok === false} onPress={() => void save()} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, (saving || prefill?.ok === false) && styles.disabled]}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Save cash close</Text>}</Pressable></ScrollView><StatusBar style="dark" /></SafeAreaView>
}

function ApprovalsScreen({ session, onBack }: { session: Session; onBack: () => void }) {
  const [waiting, setWaiting] = useState<{ total: number; approvals: Array<{ id: string; kind: string; reason: string; status: string; requested_by: string | null; requested_at: string }>; purchaseApprovals: Array<{ id: string; purchase_order_id: string; doc_no: string | null; vendor_name: string; amount: string; reason: string; requested_by: string | null; requested_at: string; lines: number }> } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [decisionNote, setDecisionNote] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  useEffect(() => { void fetch(`${API_BASE_URL}/api/mobile/v1/approvals`, { headers: { authorization: `Bearer ${session.accessToken ?? ''}` } }).then(async (response) => { if (!response.ok) throw new Error('Could not load approvals'); return response.json() }).then(setWaiting).catch((error) => setMessage(error instanceof Error ? error.message : 'Could not load approvals')) }, [session.accessToken])
  async function decide(id: string, decision: 'approved' | 'refused') { const note = decisionNote[id] ?? ''; if (decision === 'refused' && note.trim() === '') { setMessage('A refusal needs a reason'); return } setBusyId(id); setMessage(null); try { const response = await fetch(`${API_BASE_URL}/api/mobile/v1/mutations`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session.accessToken ?? ''}` }, body: JSON.stringify({ clientMutationId: mutationId(), operation: 'purchasing.approval.decide', payload: { id, decision, note } }) }); const payload = await response.json() as { error?: string }; if (!response.ok) throw new Error(payload.error ?? 'Could not decide approval'); setWaiting((current) => current ? { ...current, purchaseApprovals: current.purchaseApprovals.filter((item) => item.id !== id), total: Math.max(0, current.total - 1) } : current); setMessage(decision === 'approved' ? 'Purchase order approved' : 'Purchase order refused') } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not decide approval') } finally { setBusyId(null) } }
  return <SafeAreaView style={styles.safe}><View style={styles.header}><Pressable onPress={onBack} style={styles.backButton}><Text style={styles.backText}>← Back</Text></Pressable><Text style={styles.headerTitle}>Approvals</Text><View style={styles.headerSpacer} /></View><ScrollView contentContainerStyle={styles.homePage}><Text style={styles.eyebrow}>OWNER · APPROVAL QUEUE</Text><Text style={styles.pageTitle}>What is waiting?</Text><Text style={styles.pageCopy}>{waiting ? `${waiting.total} item(s) waiting on the owner.` : 'Loading the approval queue…'}</Text>{message !== null && <Text style={styles.error}>{message}</Text>}{waiting?.purchaseApprovals.map((item) => <View key={item.id} style={styles.card}><Text style={styles.sectionLabel}>{item.doc_no ?? 'PURCHASE ORDER'} · {item.vendor_name}</Text><Text style={styles.cardCopy}>₹{item.amount} · {item.lines} line(s) · {item.reason}</Text><Text style={styles.staffMeta}>Requested by {item.requested_by ?? 'unknown'} · {item.requested_at.slice(0, 10)}</Text><TextInput placeholder="Decision note (required to refuse)" placeholderTextColor="#9ba39d" style={styles.input} value={decisionNote[item.id] ?? ''} onChangeText={(value) => setDecisionNote((current) => ({ ...current, [item.id]: value }))} /><View style={styles.decisionRow}><Pressable disabled={busyId === item.id} onPress={() => void decide(item.id, 'approved')} style={[styles.primaryButton, styles.decisionButton, busyId === item.id && styles.disabled]}><Text style={styles.primaryButtonText}>Approve</Text></Pressable><Pressable disabled={busyId === item.id} onPress={() => void decide(item.id, 'refused')} style={[styles.secondaryButton, styles.decisionButton, busyId === item.id && styles.disabled]}><Text style={styles.secondaryButtonText}>Refuse</Text></Pressable></View></View>)}{waiting?.approvals.map((item) => <View key={item.id} style={styles.card}><Text style={styles.sectionLabel}>{item.status.toUpperCase()} · {item.kind}</Text><Text style={styles.cardCopy}>{item.reason}</Text><Text style={styles.staffMeta}>Requested by {item.requested_by ?? 'unknown'} · {item.requested_at.slice(0, 10)}</Text></View>)}{waiting && waiting.purchaseApprovals.length === 0 && waiting.approvals.length === 0 && <View style={styles.card}><Text style={styles.cardCopy}>Nothing is waiting in the approval queue.</Text></View>}</ScrollView><StatusBar style="dark" /></SafeAreaView>
}

function PurchasingScreen({ session, onBack }: { session: Session; onBack: () => void }) {
  const [data, setData] = useState<{ orders: Array<{ id: string; doc_no: string | null; vendor_name: string; po_date: string; status: string; approval_status: string; lines: number; total: string }>; indents: Array<{ id: string; indent_date: string; section_name: string; session: string; line_count: number }> } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => { void fetch(`${API_BASE_URL}/api/mobile/v1/purchasing`, { headers: { authorization: `Bearer ${session.accessToken ?? ''}` } }).then(async (response) => { if (!response.ok) throw new Error('Could not load purchasing'); return response.json() }).then(setData).catch((error) => setMessage(error instanceof Error ? error.message : 'Could not load purchasing')) }, [session.accessToken])
  return <SafeAreaView style={styles.safe}><View style={styles.header}><Pressable onPress={onBack} style={styles.backButton}><Text style={styles.backText}>← Back</Text></Pressable><Text style={styles.headerTitle}>Purchasing</Text><View style={styles.headerSpacer} /></View><ScrollView contentContainerStyle={styles.homePage}><Text style={styles.eyebrow}>STORE · PURCHASING</Text><Text style={styles.pageTitle}>What needs attention?</Text><Text style={styles.pageCopy}>Open purchase orders and kitchen indents from the live ledger.</Text>{message !== null && <Text style={styles.error}>{message}</Text>}<Text style={[styles.sectionLabel, styles.actionsHeading]}>OPEN ORDERS</Text>{data?.orders.map((order) => <View key={order.id} style={styles.card}><Text style={styles.sectionLabel}>{order.doc_no ?? 'UNNUMBERED'} · {order.status.toUpperCase()}</Text><Text style={styles.cardCopy}>{order.vendor_name} · ₹{order.total} · {order.lines} line(s)</Text><Text style={styles.staffMeta}>{order.po_date} · approval {order.approval_status}</Text></View>)}{data && data.orders.length === 0 && <Text style={styles.muted}>No open purchase orders.</Text>}<Text style={[styles.sectionLabel, styles.actionsHeading]}>OPEN KITCHEN INDENTS</Text>{data?.indents.map((indent) => <View key={indent.id} style={styles.card}><Text style={styles.sectionLabel}>{indent.section_name} · {indent.session}</Text><Text style={styles.cardCopy}>{indent.indent_date} · {indent.line_count} line(s) waiting for store action</Text></View>)}{data && data.indents.length === 0 && <Text style={styles.muted}>No open indents.</Text>}</ScrollView><StatusBar style="dark" /></SafeAreaView>
}

function ReceivingScreen({ session, onBack }: { session: Session; onBack: () => void }) {
  const [data, setData] = useState<{ vendors: Array<{ id: string; code: string; name: string }>; items: Array<{ id: string; code: string; name: string; purchase_unit: string }>; orders: Array<{ id: string; doc_no: string | null; vendor_id: string; vendor_name: string; status: string }> } | null>(null)
  const [vendorId, setVendorId] = useState(''); const [purchaseOrderId, setPurchaseOrderId] = useState(''); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [billNo, setBillNo] = useState(''); const [gst, setGst] = useState('0'); const [transport, setTransport] = useState('0'); const [message, setMessage] = useState<string | null>(null); const [saving, setSaving] = useState(false)
  const [lines, setLines] = useState<Array<{ itemId: string; qty: string; rate: string; expiryDate: string }>>([{ itemId: '', qty: '', rate: '', expiryDate: '' }])
  const [photoUri, setPhotoUri] = useState<string | null>(null)
  useEffect(() => { void fetch(`${API_BASE_URL}/api/mobile/v1/purchasing`, { headers: { authorization: `Bearer ${session.accessToken ?? ''}` } }).then(async (response) => { if (!response.ok) throw new Error('Could not load receiving options'); return response.json() }).then(setData).catch((error) => setMessage(error instanceof Error ? error.message : 'Could not load receiving options')) }, [session.accessToken])
  async function choosePhoto() { const permission = await ImagePicker.requestCameraPermissionsAsync(); if (!permission.granted) { setMessage('Camera permission is required to photograph the bill'); return } const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 }); if (!result.canceled) setPhotoUri(result.assets[0]?.uri ?? null) }
  async function save() { if (!vendorId || lines.some((line) => !line.itemId || !line.qty || !line.rate)) { setMessage('Choose a vendor and complete every item line'); return } setSaving(true); setMessage(null); try { const response = await fetch(`${API_BASE_URL}/api/mobile/v1/mutations`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session.accessToken ?? ''}` }, body: JSON.stringify({ clientMutationId: mutationId(), operation: 'purchasing.bill.save', payload: { billDate: date, billNo, purchaseOrderId, vendor: { kind: 'existing', id: vendorId }, lines: lines.map((line) => ({ item: { kind: 'existing', id: line.itemId }, qty: line.qty, rate: line.rate, expiryDate: line.expiryDate })), gstTotal: gst, transport } }) }); const payload = await response.json() as { error?: string; result?: { ok?: boolean; purchase?: { id: string } } }; if (!response.ok) throw new Error(payload.error ?? 'Could not save bill'); const purchaseId = payload.result?.purchase?.id; if (purchaseId && photoUri) { const form = new FormData(); form.append('entity', 'purchase'); form.append('entityId', purchaseId); form.append('contentType', 'image/jpeg'); form.append('filename', 'mobile-bill-photo.jpg'); form.append('file', { uri: photoUri, name: 'mobile-bill-photo.jpg', type: 'image/jpeg' } as unknown as Blob); const photoResponse = await fetch(`${API_BASE_URL}/api/mobile/v1/attachments`, { method: 'POST', headers: { authorization: `Bearer ${session.accessToken ?? ''}` }, body: form }); if (!photoResponse.ok) setMessage('Bill saved, but the photo could not be uploaded') } if (!message) setMessage('Bill received and stock updated'); setLines([{ itemId: '', qty: '', rate: '', expiryDate: '' }]); setBillNo(''); setPurchaseOrderId(''); setPhotoUri(null) } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save bill') } finally { setSaving(false) } }
  const updateLine = (index: number, field: 'itemId' | 'qty' | 'rate' | 'expiryDate', value: string) => setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line))
  async function prefill(poId: string) { try { const response = await fetch(`${API_BASE_URL}/api/mobile/v1/purchasing?poId=${poId}`, { headers: { authorization: `Bearer ${session.accessToken ?? ''}` } }); if (!response.ok) throw new Error('Could not load purchase order'); const payload = await response.json() as { order: { po: { vendor_id: string; po_date: string }; lines: Array<{ item_id: string; qty: string; rate: string }> } }; setPurchaseOrderId(poId); setVendorId(payload.order.po.vendor_id); setDate(new Date().toISOString().slice(0, 10)); setLines(payload.order.lines.map((line) => ({ itemId: line.item_id, qty: line.qty, rate: line.rate, expiryDate: '' }))); setMessage('Purchase order loaded. Confirm the delivered quantities before saving.') } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not load purchase order') } }
  return <SafeAreaView style={styles.safe}><View style={styles.header}><Pressable onPress={onBack} style={styles.backButton}><Text style={styles.backText}>← Back</Text></Pressable><Text style={styles.headerTitle}>Receive a bill</Text><View style={styles.headerSpacer} /></View><ScrollView contentContainerStyle={styles.homePage}><Text style={styles.eyebrow}>STORE · RECEIVING</Text><Text style={styles.pageTitle}>Put the delivery on record.</Text><Text style={styles.pageCopy}>Every line becomes its own stock lot and accounting entry. Expiry is recorded only when the item needs it.</Text>{message !== null && <Text style={styles.notice}>{message}</Text>}<TextInput placeholder="Bill date YYYY-MM-DD" placeholderTextColor="#9ba39d" style={styles.input} value={date} onChangeText={setDate} /><TextInput placeholder="Supplier bill number (optional)" placeholderTextColor="#9ba39d" style={styles.input} value={billNo} onChangeText={setBillNo} /><Pressable onPress={() => void choosePhoto()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{photoUri ? 'Retake bill photo' : 'Take bill photo'}</Text></Pressable><Text style={[styles.sectionLabel, styles.actionsHeading]}>PREFILL FROM PURCHASE ORDER</Text>{data?.orders.filter((order) => order.status === 'sent' || order.status === 'received').slice(0, 20).map((order) => <Pressable key={order.id} onPress={() => void prefill(order.id)} style={styles.choiceRow}><Text style={styles.cardCopy}>{order.doc_no ?? 'PO'} · {order.vendor_name}</Text></Pressable>)}<Text style={[styles.sectionLabel, styles.actionsHeading]}>VENDOR</Text>{data?.vendors.slice(0, 30).map((vendor) => <Pressable key={vendor.id} onPress={() => setVendorId(vendor.id)} style={[styles.choiceRow, vendorId === vendor.id && styles.choiceSelected]}><Text style={styles.cardCopy}>{vendor.code} · {vendor.name}</Text></Pressable>)}{lines.map((line, index) => <View key={index} style={styles.card}><Text style={styles.sectionLabel}>ITEM LINE {index + 1}</Text>{data?.items.slice(0, 40).map((item) => <Pressable key={item.id} onPress={() => updateLine(index, 'itemId', item.id)} style={[styles.choiceRow, line.itemId === item.id && styles.choiceSelected]}><Text style={styles.cardCopy}>{item.code} · {item.name} ({item.purchase_unit})</Text></Pressable>)}<TextInput keyboardType="decimal-pad" placeholder="Quantity" placeholderTextColor="#9ba39d" style={styles.input} value={line.qty} onChangeText={(value) => updateLine(index, 'qty', value)} /><TextInput keyboardType="decimal-pad" placeholder="Rate" placeholderTextColor="#9ba39d" style={styles.input} value={line.rate} onChangeText={(value) => updateLine(index, 'rate', value)} /><TextInput placeholder="Expiry YYYY-MM-DD (optional)" placeholderTextColor="#9ba39d" style={styles.input} value={line.expiryDate} onChangeText={(value) => updateLine(index, 'expiryDate', value)} /></View>)}<Pressable onPress={() => setLines((current) => [...current, { itemId: '', qty: '', rate: '', expiryDate: '' }])} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>+ Add another line</Text></Pressable><TextInput keyboardType="decimal-pad" placeholder="GST total" placeholderTextColor="#9ba39d" style={styles.input} value={gst} onChangeText={setGst} /><TextInput keyboardType="decimal-pad" placeholder="Transport" placeholderTextColor="#9ba39d" style={styles.input} value={transport} onChangeText={setTransport} /><Pressable disabled={saving} onPress={() => void save()} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, saving && styles.disabled]}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Receive bill</Text>}</Pressable></ScrollView><StatusBar style="dark" /></SafeAreaView>
}

function PurchaseOrderScreen({ session, onBack }: { session: Session; onBack: () => void }) {
  const [data, setData] = useState<{ vendors: Array<{ id: string; code: string; name: string }>; items: Array<{ id: string; code: string; name: string; purchase_unit: string }> } | null>(null)
  const [vendorId, setVendorId] = useState(''); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [expectedDate, setExpectedDate] = useState(''); const [note, setNote] = useState(''); const [orderId, setOrderId] = useState(''); const [approvalReason, setApprovalReason] = useState(''); const [message, setMessage] = useState<string | null>(null); const [busy, setBusy] = useState(false)
  const [lines, setLines] = useState<Array<{ itemId: string; qty: string; rate: string }>>([{ itemId: '', qty: '', rate: '' }])
  useEffect(() => { void fetch(`${API_BASE_URL}/api/mobile/v1/purchasing`, { headers: { authorization: `Bearer ${session.accessToken ?? ''}` } }).then(async (response) => { if (!response.ok) throw new Error('Could not load order options'); return response.json() }).then(setData).catch((error) => setMessage(error instanceof Error ? error.message : 'Could not load order options')) }, [session.accessToken])
  async function mutate(operation: string, payload: Record<string, unknown>) { setBusy(true); setMessage(null); try { const response = await fetch(`${API_BASE_URL}/api/mobile/v1/mutations`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session.accessToken ?? ''}` }, body: JSON.stringify({ clientMutationId: mutationId(), operation, payload }) }); const body = await response.json() as { error?: string; result?: { ok?: boolean; id?: string; po?: { id: string } } }; if (!response.ok) throw new Error(body.error ?? 'Could not save purchase order'); return body.result } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save purchase order'); return null } finally { setBusy(false) } }
  async function save(send: boolean) { if (!vendorId || lines.some((line) => !line.itemId || !line.qty || !line.rate)) { setMessage('Choose a vendor and complete every order line'); return } const payload = { vendorId, poDate: date, expectedDate, note, lines: lines.map((line) => ({ ...line, note: '' })) }; const result = await mutate(orderId ? 'purchasing.order.update' : 'purchasing.order.create', orderId ? { id: orderId, ...payload } : payload); const id = orderId || result?.id || ''; if (id) { setOrderId(id); if (send) { const sent = await mutate('purchasing.order.send', { id, via: 'manual' }); if (sent) { await Share.share({ message: `KitchenBooks purchase order ${id} is ready for vendor handoff.` }); setMessage('Order sent and opened in the share sheet') } } else setMessage('Purchase order draft saved') } }
  async function requestApproval() { if (!orderId || !approvalReason.trim()) { setMessage('Save the draft and explain why the owner should approve it'); return } await mutate('purchasing.approval.request', { id: orderId, reason: approvalReason }); setMessage('Approval requested from the owner') }
  const updateLine = (index: number, field: 'itemId' | 'qty' | 'rate', value: string) => setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line))
  return <SafeAreaView style={styles.safe}><View style={styles.header}><Pressable onPress={onBack} style={styles.backButton}><Text style={styles.backText}>← Back</Text></Pressable><Text style={styles.headerTitle}>New purchase order</Text><View style={styles.headerSpacer} /></View><ScrollView contentContainerStyle={styles.homePage}><Text style={styles.eyebrow}>STORE · PURCHASE ORDER</Text><Text style={styles.pageTitle}>Ask for what the kitchen needs.</Text><Text style={styles.pageCopy}>Drafts can be edited. Sending freezes the order and records how it was handed over.</Text>{message !== null && <Text style={styles.notice}>{message}</Text>}<TextInput placeholder="Order date YYYY-MM-DD" placeholderTextColor="#9ba39d" style={styles.input} value={date} onChangeText={setDate} /><TextInput placeholder="Expected date YYYY-MM-DD (optional)" placeholderTextColor="#9ba39d" style={styles.input} value={expectedDate} onChangeText={setExpectedDate} /><Text style={[styles.sectionLabel, styles.actionsHeading]}>VENDOR</Text>{data?.vendors.slice(0, 30).map((vendor) => <Pressable key={vendor.id} onPress={() => setVendorId(vendor.id)} style={[styles.choiceRow, vendorId === vendor.id && styles.choiceSelected]}><Text style={styles.cardCopy}>{vendor.code} · {vendor.name}</Text></Pressable>)}{lines.map((line, index) => <View key={index} style={styles.card}><Text style={styles.sectionLabel}>ORDER LINE {index + 1}</Text>{data?.items.slice(0, 40).map((item) => <Pressable key={item.id} onPress={() => updateLine(index, 'itemId', item.id)} style={[styles.choiceRow, line.itemId === item.id && styles.choiceSelected]}><Text style={styles.cardCopy}>{item.code} · {item.name} ({item.purchase_unit})</Text></Pressable>)}<TextInput keyboardType="decimal-pad" placeholder="Quantity" placeholderTextColor="#9ba39d" style={styles.input} value={line.qty} onChangeText={(value) => updateLine(index, 'qty', value)} /><TextInput keyboardType="decimal-pad" placeholder="Rate (optional estimate)" placeholderTextColor="#9ba39d" style={styles.input} value={line.rate} onChangeText={(value) => updateLine(index, 'rate', value)} /></View>)}<Pressable onPress={() => setLines((current) => [...current, { itemId: '', qty: '', rate: '' }])} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>+ Add another line</Text></Pressable><TextInput placeholder="Order note (optional)" placeholderTextColor="#9ba39d" style={styles.input} value={note} onChangeText={setNote} /><Pressable disabled={busy} onPress={() => void save(false)} style={[styles.secondaryButton, busy && styles.disabled]}><Text style={styles.secondaryButtonText}>Save draft</Text></Pressable><TextInput placeholder="Reason for owner approval (if required)" placeholderTextColor="#9ba39d" style={styles.input} value={approvalReason} onChangeText={setApprovalReason} /><Pressable disabled={busy} onPress={() => void requestApproval()} style={[styles.secondaryButton, busy && styles.disabled]}><Text style={styles.secondaryButtonText}>Request owner approval</Text></Pressable><Pressable disabled={busy} onPress={() => void save(true)} style={[styles.primaryButton, busy && styles.disabled]}><Text style={styles.primaryButtonText}>Save and send</Text></Pressable></ScrollView><StatusBar style="dark" /></SafeAreaView>
}

function SyncScreen({ session, onBack }: { session: Session; onBack: () => void }) {
  const [rows, setRows] = useState<PendingMutation[]>([]); const [message, setMessage] = useState<string | null>(null)
  async function load() { setRows(await pendingMutations()) }
  useEffect(() => { let alive = true; void pendingMutations().then((value) => { if (alive) setRows(value) }); return () => { alive = false } }, [])
  async function sync() { const count = await flushMutations(API_BASE_URL, session.accessToken ?? ''); await load(); setMessage(count > 0 ? `${count} queued save(s) synced` : 'Nothing could be synced right now') }
  async function retry(id: number) { await retryMutation(id); await sync() }
  return <SafeAreaView style={styles.safe}><View style={styles.header}><Pressable onPress={onBack} style={styles.backButton}><Text style={styles.backText}>← Back</Text></Pressable><Text style={styles.headerTitle}>Sync history</Text><View style={styles.headerSpacer} /></View><ScrollView contentContainerStyle={styles.homePage}><Text style={styles.eyebrow}>DEVICE · SYNC QUEUE</Text><Text style={styles.pageTitle}>Nothing disappears quietly.</Text><Text style={styles.pageCopy}>Queued changes stay on this device until the server accepts them. Failed changes remain visible with their reason.</Text>{message !== null && <Text style={styles.notice}>{message}</Text>}{rows.length === 0 && <View style={styles.card}><Text style={styles.cardCopy}>No pending or failed changes.</Text></View>}{rows.map((row) => <View key={row.id} style={styles.card}><Text style={styles.sectionLabel}>{row.status.toUpperCase()} · {row.operation}</Text><Text style={styles.cardCopy}>{new Date(row.createdAt).toLocaleString()} · {row.attempts} attempt(s)</Text>{row.lastError && <Text style={styles.error}>{row.lastError}</Text>}<View style={styles.decisionRow}><Pressable onPress={() => void retry(row.id)} style={[styles.secondaryButton, styles.decisionButton]}><Text style={styles.secondaryButtonText}>Retry</Text></Pressable><Pressable onPress={() => void removeMutation(row.id).then(load)} style={[styles.secondaryButton, styles.decisionButton]}><Text style={styles.secondaryButtonText}>Remove</Text></Pressable></View></View>)}<Pressable onPress={() => void sync()} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Sync now</Text></Pressable></ScrollView><StatusBar style="dark" /></SafeAreaView>
}

function ReviewScreen({ session, onBack }: { session: Session; onBack: () => void }) {
  const [data, setData] = useState<{ kind: string; owed?: { balance: string; vendorCount: number }; completeness?: Array<{ what: string; n: number; severity: string }>; openQueries?: Array<{ subject: string; status: string }>; unaccountedMovements?: number } | null>(null); const [message, setMessage] = useState<string | null>(null)
  useEffect(() => { let alive = true; void fetch(`${API_BASE_URL}/api/mobile/v1/review`, { headers: { authorization: `Bearer ${session.accessToken ?? ''}` } }).then(async (response) => { if (!response.ok) throw new Error('Could not load review'); return response.json() }).then((value) => { if (alive) setData(value) }).catch((error) => { if (alive) setMessage(error instanceof Error ? error.message : 'Could not load review') }); return () => { alive = false } }, [session.accessToken])
  return <SafeAreaView style={styles.safe}><View style={styles.header}><Pressable onPress={onBack} style={styles.backButton}><Text style={styles.backText}>← Back</Text></Pressable><Text style={styles.headerTitle}>Review</Text><View style={styles.headerSpacer} /></View><ScrollView contentContainerStyle={styles.homePage}><Text style={styles.eyebrow}>{data?.kind.toUpperCase() ?? 'REVIEW'}</Text><Text style={styles.pageTitle}>What needs your attention?</Text>{message !== null && <Text style={styles.error}>{message}</Text>}{data?.kind === 'owner' && <View style={styles.card}><Text style={styles.sectionLabel}>VENDOR DUES</Text><Text style={styles.stockValue}>₹{data.owed?.balance ?? '0'}</Text><Text style={styles.muted}>{data.owed?.vendorCount ?? 0} vendor(s) currently owed.</Text></View>}{data?.kind === 'accountant' && <><View style={styles.card}><Text style={styles.sectionLabel}>UNACCOUNTED MOVEMENTS</Text><Text style={styles.stockValue}>{data.unaccountedMovements ?? 0}</Text></View>{data.completeness?.map((item, index) => <View key={`${item.what}-${index}`} style={styles.card}><Text style={styles.sectionLabel}>{item.severity}</Text><Text style={styles.cardCopy}>{item.what} · {item.n}</Text></View>)}<Text style={[styles.sectionLabel, styles.actionsHeading]}>OPEN QUERIES</Text>{data.openQueries?.map((query, index) => <View key={`${query.subject}-${index}`} style={styles.card}><Text style={styles.cardCopy}>{query.subject}</Text><Text style={styles.staffMeta}>{query.status}</Text></View>)}</>}</ScrollView><StatusBar style="dark" /></SafeAreaView>
}

function KitchenScreen({ session, onBack }: { session: Session; onBack: () => void }) {
  const [productions, setProductions] = useState<KitchenProduction[]>([])
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    void fetch(`${API_BASE_URL}/api/mobile/v1/kitchen`, { headers: { authorization: `Bearer ${session.accessToken ?? ''}` } })
      .then(async (response) => { if (!response.ok) throw new Error('Could not load kitchen records'); return (await response.json()) as { productions: KitchenProduction[] } })
      .then((payload) => setProductions(payload.productions))
      .catch((error) => setMessage(error instanceof Error ? error.message : 'Could not load kitchen records'))
  }, [session.accessToken])
  return <SafeAreaView style={styles.safe}><View style={styles.header}><Pressable onPress={onBack} style={styles.backButton}><Text style={styles.backText}>← Back</Text></Pressable><Text style={styles.headerTitle}>Kitchen</Text><View style={styles.headerSpacer} /></View><ScrollView contentContainerStyle={styles.homePage}>
    <Text style={styles.eyebrow}>KITCHEN · PRODUCTION</Text><Text style={styles.pageTitle}>What was made?</Text><Text style={styles.pageCopy}>Production history is pinned to the recipe version used that day.</Text>{message !== null && <Text style={styles.notice}>{message}</Text>}
    {productions.map((item) => <View key={item.id} style={styles.stockRow}><View style={styles.staffIdentity}><Text style={styles.staffName}>{item.recipe_name}</Text><Text style={styles.staffMeta}>{item.production_date} · {item.section_name ?? 'Unassigned'}</Text></View><View style={styles.stockNumbers}><Text style={styles.stockQty}>{item.quantity} {item.unit_name}</Text><Text style={styles.staffMeta}>{item.waste_qty ? `waste ${item.waste_qty}` : 'no waste recorded'}</Text></View></View>)}
  </ScrollView><StatusBar style="dark" /></SafeAreaView>
}

function HomeScreen({ session, onSignOut, onOpenAttendance, onOpenStock, onOpenKitchen, onOpenSales, onOpenApprovals, onOpenPurchasing, onOpenReceiving, onOpenOrder, onOpenSync, onOpenReview }: { session: Session; onSignOut: () => void; onOpenAttendance: () => void; onOpenStock: () => void; onOpenKitchen: () => void; onOpenSales: () => void; onOpenApprovals: () => void; onOpenPurchasing: () => void; onOpenReceiving: () => void; onOpenOrder: () => void; onOpenSync: () => void; onOpenReview: () => void }) {
  const actions = useMemo(() => actionsByRole[session.role] ?? actionsByRole.manager, [session.role])
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null)
  useEffect(() => {
    void fetch(`${API_BASE_URL}/api/mobile/v1/bootstrap`, { headers: { authorization: `Bearer ${session.accessToken ?? ''}` } })
      .then(async (response) => { if (!response.ok) throw new Error('Could not load your day'); return (await response.json()) as Bootstrap })
      .then(setBootstrap)
      .catch(() => setBootstrap(null))
  }, [session.accessToken])
  const dateLabel = bootstrap?.date ?? 'today'
  const missingClose = bootstrap?.alerts.missingCloses ?? 0
  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}><View><Text style={styles.brand}>KB</Text><Text style={styles.headerSub}>{session.restaurantName}</Text></View><Pressable accessibilityRole="button" onPress={onSignOut} style={styles.accountButton}><Text style={styles.accountButtonText}>{session.username}  ⏻</Text></Pressable></View>
    <ScrollView contentContainerStyle={styles.homePage}><Text style={styles.eyebrow}>BUSINESS DAY · {dateLabel}</Text><Text style={styles.pageTitle}>Good day, {session.displayName || session.username}.</Text><Text style={styles.pageCopy}>Here is the work your {session.role} role can open right now.</Text>
      <View style={[styles.card, styles.alertCard]}><Text style={styles.sectionLabel}>BUSINESS DAY</Text><Text style={styles.alertTitle}>{missingClose > 0 ? `${missingClose} day${missingClose === 1 ? '' : 's'} still need${missingClose === 1 ? 's' : ''} cash counted.` : 'Today’s books are ready to work.'}</Text><Text style={styles.cardCopy}>{missingClose > 0 ? 'A day that sold food cannot be quietly skipped. Open the close when you are ready.' : 'The server has no missing closes for the current period.'}</Text></View>
      <Text style={[styles.sectionLabel, styles.actionsHeading]}>YOUR NEXT MOVES</Text>
      {actions.map((action, index) => <Pressable key={action} onPress={action === 'Mark attendance' ? onOpenAttendance : action === 'Review stock' ? onOpenStock : action === 'Record production' || action === 'Open recipes' ? onOpenKitchen : action === 'Close cash' || action === 'Record sales' ? onOpenSales : action === 'Review approvals' ? onOpenApprovals : action === 'Review purchasing' ? onOpenPurchasing : action === 'Receive a bill' ? onOpenReceiving : action === 'Create purchase order' ? onOpenOrder : action === 'Review sync history' ? onOpenSync : action === 'See dashboard' || action === 'Review books' ? onOpenReview : undefined} style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}><View style={styles.actionNumber}><Text style={styles.actionNumberText}>{String(index + 1).padStart(2, '0')}</Text></View><Text style={styles.actionText}>{action}</Text><Text style={styles.arrow}>→</Text></Pressable>)}
      <View style={styles.onlineBar}><View style={styles.onlineDot} /><Text style={styles.onlineText}>Online · changes sync to KitchenBooks</Text></View>
    </ScrollView><StatusBar style="dark" />
  </SafeAreaView>
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [screen, setScreen] = useState<'home' | 'attendance' | 'stock' | 'kitchen' | 'sales' | 'approvals' | 'purchasing' | 'receiving' | 'purchase-order' | 'sync' | 'review'>('home')
  const [restoring, setRestoring] = useState(true)
  useEffect(() => { void restoreSession().then((value) => { setSession(value); setRestoring(false) }) }, [])
  useEffect(() => { if (session === null) return; sessionExpired = () => { sessionExpired = null; void SecureStore.deleteItemAsync(SESSION_KEY); setSession(null) }; return () => { sessionExpired = null } }, [session])
  useEffect(() => { const routeFromUrl = (url: string | null) => { if (!url) return; const path = Linking.parse(url).path ?? ''; const target = path.split('/')[0]; if (target === 'attendance' || target === 'stock' || target === 'kitchen' || target === 'sales' || target === 'approvals' || target === 'purchasing' || target === 'receiving' || target === 'purchase-order' || target === 'sync' || target === 'review') setScreen(target) }; void Linking.getInitialURL().then(routeFromUrl); const subscription = Linking.addEventListener('url', ({ url }) => routeFromUrl(url)); return () => subscription.remove() }, [])
  useEffect(() => { if (session === null) return; void Notifications.requestPermissionsAsync(); const subscription = Notifications.addNotificationResponseReceivedListener((response) => { const target = String(response.notification.request.content.data?.screen ?? ''); if (target === 'attendance' || target === 'stock' || target === 'kitchen' || target === 'sales' || target === 'approvals' || target === 'purchasing' || target === 'receiving' || target === 'purchase-order' || target === 'sync' || target === 'review') setScreen(target) }); return () => subscription.remove() }, [session])
  async function signOut() { await SecureStore.deleteItemAsync(SESSION_KEY); setSession(null) }
  if (restoring) return <SafeAreaView style={styles.loading}><ActivityIndicator color={colors.green} /></SafeAreaView>
  if (session === null) return <LoginScreen onLogin={setSession} />
  if (screen === 'attendance') return <AttendanceScreen session={session} onBack={() => setScreen('home')} />
  if (screen === 'stock') return <StockScreen session={session} onBack={() => setScreen('home')} />
  if (screen === 'kitchen') return <KitchenScreen session={session} onBack={() => setScreen('home')} />
  if (screen === 'sales') return <SalesScreen session={session} onBack={() => setScreen('home')} />
  if (screen === 'approvals') return <ApprovalsScreen session={session} onBack={() => setScreen('home')} />
  if (screen === 'purchasing') return <PurchasingScreen session={session} onBack={() => setScreen('home')} />
  if (screen === 'receiving') return <ReceivingScreen session={session} onBack={() => setScreen('home')} />
  if (screen === 'purchase-order') return <PurchaseOrderScreen session={session} onBack={() => setScreen('home')} />
  if (screen === 'sync') return <SyncScreen session={session} onBack={() => setScreen('home')} />
  if (screen === 'review') return <ReviewScreen session={session} onBack={() => setScreen('home')} />
  return <HomeScreen session={session} onSignOut={() => void signOut()} onOpenAttendance={() => setScreen('attendance')} onOpenStock={() => setScreen('stock')} onOpenKitchen={() => setScreen('kitchen')} onOpenSales={() => setScreen('sales')} onOpenApprovals={() => setScreen('approvals')} onOpenPurchasing={() => setScreen('purchasing')} onOpenReceiving={() => setScreen('receiving')} onOpenOrder={() => setScreen('purchase-order')} onOpenSync={() => setScreen('sync')} onOpenReview={() => setScreen('review')} />
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper }, loginPage: { flexGrow: 1, justifyContent: 'center', padding: 24 }, homePage: { padding: 20, paddingBottom: 40 },
  header: { minHeight: 72, paddingHorizontal: 20, paddingVertical: 12, backgroundColor: colors.cell, borderBottomWidth: 1, borderBottomColor: colors.rule, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, brand: { color: colors.green, fontSize: 20, fontWeight: '800', letterSpacing: -0.5 }, headerSub: { color: colors.muted, fontSize: 12, marginTop: 2 }, accountButton: { borderWidth: 1, borderColor: colors.rule, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8 }, accountButtonText: { color: colors.muted, fontSize: 12, fontWeight: '600' }, headerTitle: { color: colors.ink, fontSize: 16, fontWeight: '700' }, headerSpacer: { width: 60 }, backButton: { paddingVertical: 8 }, backText: { color: colors.green, fontWeight: '600' }, loader: { marginTop: 30 }, notice: { color: colors.green, fontSize: 13, fontWeight: '600', backgroundColor: colors.greenSoft, padding: 12, borderRadius: 10, marginTop: 18 },
  eyebrow: { color: colors.green, fontSize: 11, fontWeight: '700', letterSpacing: 1.4, marginBottom: 12 }, loginTitle: { color: colors.ink, fontSize: 38, lineHeight: 41, fontWeight: '800', letterSpacing: -1.2, maxWidth: 390 }, loginCopy: { color: colors.muted, fontSize: 16, lineHeight: 24, marginTop: 16, maxWidth: 390 }, pageTitle: { color: colors.ink, fontSize: 30, lineHeight: 35, fontWeight: '800', letterSpacing: -0.8 }, pageCopy: { color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: 7 },
  card: { backgroundColor: colors.cell, borderColor: colors.rule, borderWidth: 1, borderRadius: 16, padding: 18, marginTop: 24 }, sectionLabel: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.3 }, input: { backgroundColor: '#fffdf3', borderColor: '#e6c96c', borderWidth: 1, borderRadius: 10, minHeight: 50, paddingHorizontal: 14, fontSize: 16, color: colors.ink, marginTop: 12 }, primaryButton: { minHeight: 50, backgroundColor: colors.green, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 16 }, secondaryButton: { minHeight: 50, backgroundColor: colors.cell, borderColor: colors.rule, borderWidth: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 16 }, secondaryButtonText: { color: colors.ink, fontSize: 16, fontWeight: '700' }, decisionRow: { flexDirection: 'row', gap: 10 }, decisionButton: { flex: 1 }, primaryButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '700' }, disabled: { opacity: 0.45 }, pressed: { transform: [{ scale: 0.98 }] }, error: { color: colors.red, fontSize: 13, marginTop: 10 }, apiHint: { color: '#9ba39d', fontSize: 11, marginTop: 14 },
  alertCard: { backgroundColor: '#fffafa', borderColor: '#e4a2a2' }, alertTitle: { color: colors.red, fontSize: 18, lineHeight: 25, fontWeight: '700', marginTop: 9 }, cardCopy: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 8 }, muted: { color: colors.muted, fontSize: 13, lineHeight: 19 }, actionsHeading: { marginTop: 28, marginBottom: 8 }, actionRow: { minHeight: 64, backgroundColor: colors.cell, borderColor: colors.rule, borderWidth: 1, borderRadius: 13, padding: 12, flexDirection: 'row', alignItems: 'center', marginTop: 8 }, actionNumber: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' }, actionNumberText: { color: colors.green, fontSize: 12, fontWeight: '700' }, actionText: { flex: 1, color: colors.ink, fontSize: 15, fontWeight: '600', marginLeft: 12 }, arrow: { color: colors.green, fontSize: 19, marginLeft: 8 }, onlineBar: { flexDirection: 'row', alignItems: 'center', marginTop: 22, padding: 13, borderRadius: 11, backgroundColor: colors.greenSoft }, onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green, marginRight: 8 }, onlineText: { color: colors.green, fontSize: 12, fontWeight: '600' },
  attendanceRow: { backgroundColor: colors.cell, borderColor: colors.rule, borderWidth: 1, borderRadius: 13, padding: 13, marginTop: 9 }, staffIdentity: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }, staffName: { color: colors.ink, fontSize: 15, fontWeight: '700', flex: 1 }, staffMeta: { color: colors.muted, fontSize: 11 }, statuses: { flexDirection: 'row', gap: 7, marginTop: 12 }, statusButton: { width: 42, height: 38, borderRadius: 9, borderWidth: 1, borderColor: colors.rule, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }, statusSelected: { backgroundColor: colors.green, borderColor: colors.green }, statusText: { color: colors.muted, fontSize: 13, fontWeight: '700' }, statusSelectedText: { color: '#fff' },
  stockTotal: { backgroundColor: colors.cell, borderColor: colors.rule, borderWidth: 1, borderRadius: 16, padding: 18, marginTop: 24 }, stockValue: { color: colors.ink, fontSize: 28, fontWeight: '800', marginTop: 8 }, stockRow: { backgroundColor: colors.cell, borderColor: colors.rule, borderWidth: 1, borderRadius: 13, padding: 13, marginTop: 9, flexDirection: 'row', alignItems: 'center' }, choiceRow: { backgroundColor: colors.cell, borderColor: colors.rule, borderWidth: 1, borderRadius: 13, padding: 13, marginTop: 9 }, choiceSelected: { backgroundColor: colors.greenSoft, borderColor: colors.green }, stockNumbers: { alignItems: 'flex-end', marginLeft: 8 }, stockQty: { color: colors.ink, fontSize: 14, fontWeight: '700' },
})

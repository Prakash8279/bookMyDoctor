import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AdminRecordTable as DataTable } from '../components/AdminRecordTable'
import { FormField } from '../components/FormField'
import { StatCard } from '../components/StatCard'
import { StatusPill } from '../components/StatusPill'
import { formatDate, shortId } from '../lib/format'
import { useAppStore } from '../store/useAppStore'
import { indiaTodayDate } from '../lib/doctorAppointmentsExport'
import { indiaRecordDate } from '../lib/adminRecords'

const Page = ({ title, subtitle, children }) => <section><div className="page-heading mb-5"><h1 className="text-2xl sm:text-3xl">{title}</h1>{subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}</div>{children}</section>
const ErrorNote = ({ children }) => children ? <p role="alert" className="mb-4 rounded-button border border-error/30 bg-error/10 px-3 py-2 text-sm font-semibold text-error">{children}</p> : null
const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

export function PatientComplaints({ data }) {
  const fetchComplaints = useAppStore((state) => state.fetchComplaints)
  const addComplaint = useAppStore((state) => state.addComplaint)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    let active = true
    fetchComplaints({ pageSize: 100 }).catch((err) => { if (active) setError(err.message || 'Could not load complaints.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [fetchComplaints])
  const submit = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form).entries())
    setSubmitting(true); setError(''); setSaved(false)
    try {
      await addComplaint(values)
      form.reset()
      setSaved(true)
    } catch (err) {
      setError(err.message || 'Could not submit complaint.')
    } finally {
      setSubmitting(false)
    }
  }
  return <Page title="Help & Policies" subtitle="Get support, raise a complaint, or read BookADoctors policies.">
    <section className="mb-6 grid max-w-2xl gap-2 rounded-card border border-border bg-white p-4 shadow-card" aria-label="Help and policy links">
      <Link className="touch-target flex items-center justify-between rounded-button px-3 text-sm font-semibold text-ink hover:bg-surface" to="/privacy">Privacy Policy <span aria-hidden="true">›</span></Link>
      <Link className="touch-target flex items-center justify-between rounded-button px-3 text-sm font-semibold text-ink hover:bg-surface" to="/terms">Terms &amp; Conditions <span aria-hidden="true">›</span></Link>
      <Link className="touch-target flex items-center justify-between rounded-button px-3 text-sm font-semibold text-ink hover:bg-surface" to="/cancellation-refund-policy">Cancellation &amp; Refund Policy <span aria-hidden="true">›</span></Link>
      <Link className="touch-target flex items-center justify-between rounded-button px-3 text-sm font-semibold text-ink hover:bg-surface" to="/account-deletion">Account Deletion <span aria-hidden="true">›</span></Link>
      <Link className="touch-target flex items-center justify-between rounded-button px-3 text-sm font-semibold text-ink hover:bg-surface" to="/contact">Contact Us <span aria-hidden="true">›</span></Link>
    </section>
    <form onSubmit={submit} className="mb-6 grid max-w-2xl gap-4 rounded-card border border-border bg-white p-5 shadow-card">
      <FormField label="Subject" name="subject" minLength={3} maxLength={160} required />
      <FormField label="Describe the issue" name="description" type="textarea" minLength={10} maxLength={5000} required />
      <ErrorNote>{error}</ErrorNote>
      <button className="touch-target w-fit rounded-button bg-primary-dark px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit complaint'}</button>
      {saved && <p role="status" className="text-sm font-semibold text-success">Complaint submitted. You can track its response below.</p>}
    </form>
    <DataTable loading={loading} rows={data.complaints || []} columns={[
      { key: 'createdAt', label: 'Date', render: (item) => formatDate(item.createdAt) },
      { key: 'subject', label: 'Subject' },
      { key: 'description', label: 'Details' },
      { key: 'status', label: 'Status', render: (item) => <StatusPill status={item.status} /> },
      { key: 'adminResponse', label: 'Admin response', render: (item) => item.adminResponse || 'Awaiting response' },
    ]} />
  </Page>
}

export function PaymentOperations({ data }) {
  const fetchRefunds = useAppStore((state) => state.fetchRefunds)
  const fetchReconciliation = useAppStore((state) => state.fetchReconciliation)
  const retryRefund = useAppStore((state) => state.retryRefund)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retrying, setRetrying] = useState('')
  const [status, setStatus] = useState('')
  const [range, setRange] = useState(() => ({ from: indiaTodayDate(), to: indiaTodayDate() }))
  const load = useCallback(() => {
    setLoading(true); setError('')
    return Promise.all([fetchRefunds(status ? { status, pageSize: 100 } : { pageSize: 100 }), fetchReconciliation({ pageSize: 100 })])
      .catch((err) => setError(err.message || 'Could not load payment operations.'))
      .finally(() => setLoading(false))
  }, [fetchRefunds, fetchReconciliation, status])
  useEffect(() => { load() }, [load])
  const retry = async (id) => {
    setRetrying(id); setError('')
    try { await retryRefund(id) } catch (err) { setError(err.message || 'Refund retry failed.') } finally { setRetrying('') }
  }
  const inRange = (row) => {
    const day = indiaRecordDate(row.createdAt)
    return day && range.from && range.to && range.from <= range.to && day >= range.from && day <= range.to
  }
  const reconciliation = (data.reconciliation || []).filter(inRange)
  const refunds = (data.refunds || []).filter(inRange)
  const kpi = loading || error ? {} : {
    totalPayments: reconciliation.length,
    totalAmount: reconciliation.filter((row) => row.paymentStatus === 'paid').reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
    refundPendingCount: refunds.filter((row) => ['pending', 'processing'].includes(row.status)).length,
    refundFailedCount: refunds.filter((row) => row.status === 'failed').length,
    unreconciledCount: reconciliation.filter((row) => row.reconciliationCategory === 'UNRECONCILED').length,
  }
  return <Page title="Refunds & reconciliation" subtitle="Monitor gateway refunds, retry failures, and find ledger mismatches.">
    <ErrorNote>{error}</ErrorNote>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="TOTAL PAYMENTS" value={kpi.totalPayments ?? '—'} detail={money(kpi.totalAmount)} icon="₹" />
      <StatCard label="REFUND PENDING" value={kpi.refundPendingCount ?? '—'} icon="↻" />
      <StatCard label="REFUND FAILED" value={kpi.refundFailedCount ?? '—'} icon="!" />
      <StatCard label="UNRECONCILED" value={kpi.unreconciledCount ?? '—'} icon="≠" />
    </div>
    <section className="mt-6 rounded-card border border-border bg-white p-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg">Refund queue</h2><p className="text-sm text-muted">Retry is available for pending or failed gateway refunds.</p></div><FormField label="Refund status" type="select" options={['All', 'pending', 'processing', 'failed', 'processed']} value={status || 'All'} onChange={(event) => setStatus(event.target.value === 'All' ? '' : event.target.value)} /></div>
      <DataTable dateRange={range} onDateRangeChange={setRange} loading={loading} error={error} onRetry={load} rows={data.refunds || []} columns={[
        { key: 'createdAt', label: 'Date', render: (item) => formatDate(item.createdAt) },
        { key: 'appointment', label: 'Booking', render: (item) => item.appointment?.id ? shortId(item.appointment.id) : '—' },
        { key: 'patient', label: 'Patient', render: (item) => item.appointment?.patient?.name || '—' },
        { key: 'doctor', label: 'Doctor', render: (item) => item.appointment?.doctor?.name || '—' },
        { key: 'amount', label: 'Amount', render: (item) => money(item.amount) },
        { key: 'status', label: 'Status', render: (item) => <StatusPill status={item.status} /> },
        { key: 'failureReason', label: 'Gateway result', render: (item) => item.failureReason || item.razorpayRefundId || '—' },
        { key: 'actions', label: 'Action', render: (item) => item.status !== 'processed' ? <button type="button" className="touch-target text-sm font-semibold text-primary-dark disabled:opacity-60" disabled={retrying === item.id} onClick={() => retry(item.id)}>{retrying === item.id ? 'Retrying…' : 'Retry refund'}</button> : 'Complete' },
      ]} />
    </section>
    <section className="mt-6 rounded-card border border-border bg-white p-5 shadow-card"><h2 className="mb-4 text-lg">Payment reconciliation</h2><DataTable dateRange={range} onDateRangeChange={setRange} loading={loading} error={error} onRetry={load} rows={data.reconciliation || []} columns={[
      { key: 'createdAt', label: 'Date', render: (item) => formatDate(item.createdAt) },
      { key: 'receiptNumber', label: 'Receipt', render: (item) => item.receiptNumber || '—' },
      { key: 'appointmentId', label: 'Booking', render: (item) => item.appointmentId ? shortId(item.appointmentId) : '—' },
      { key: 'patient', label: 'Patient', render: (item) => item.patient?.name || '—' },
      { key: 'amount', label: 'Amount', render: (item) => money(item.amount) },
      { key: 'paymentStatus', label: 'Payment', render: (item) => <StatusPill status={item.paymentStatus} /> },
      { key: 'reconciliationCategory', label: 'Reconciliation', render: (item) => <StatusPill status={String(item.reconciliationCategory || '').toLowerCase()} /> },
    ]} /></section>
  </Page>
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'

export const isConfirmedPayment = (appointment) => appointment?.tokenNumber != null &&
  ['upcoming', 'confirmed', 'completed'].includes(appointment.status) &&
  ['paid', 'partial'].includes(appointment.paymentStatus)

// The countdown is a waiting budget, never a substitute for server-side capture verification.
export function usePaymentVerification() {
  const verifyPayment = useAppStore((state) => state.verifyRazorpayPayment)
  const getAppointment = useAppStore((state) => state.getAppointment)
  const [verification, setVerification] = useState(null)
  const active = useRef(null)
  const last = useRef(null)

  const stop = useCallback(() => {
    if (active.current) { active.current.stopped = true; clearInterval(active.current.timer) }
    active.current = null
  }, [])
  useEffect(() => stop, [stop])

  const start = useCallback(async (payload, onConfirmed) => {
    stop()
    last.current = { payload, onConfirmed }
    const run = { stopped: false, deadline: Date.now() + 60000, reading: false, verifying: false, lastVerify: 0 }
    active.current = run
    const current = () => !run.stopped && active.current === run
    setVerification({ phase: 'verifying', secondsLeft: 60 })
    const accept = (appointment) => {
      if (!current()) return
      if (isConfirmedPayment(appointment)) {
        stop()
        setVerification(null)
        onConfirmed?.(appointment)
      } else if (appointment?.status === 'cancelled' || appointment?.paymentStatus === 'refunded') {
        stop()
        setVerification({ phase: 'cancelled', secondsLeft: 0 })
      }
    }
    const read = async () => {
      if (!current() || run.reading) return
      run.reading = true
      try { accept(await getAppointment(payload.appointmentId)) } catch { /* Keep waiting; never suggest another charge. */ }
      finally { run.reading = false }
    }
    const verify = async () => {
      if (!current() || run.verifying) return
      run.verifying = true
      run.lastVerify = Date.now()
      try {
        const response = await verifyPayment(payload)
        accept(response?.appointment)
      } catch {
        await read() // A webhook may have committed despite a lost/processing verify response.
      } finally { run.verifying = false }
    }
    run.timer = setInterval(() => {
      if (!current()) return
      const secondsLeft = Math.max(0, Math.ceil((run.deadline - Date.now()) / 1000))
      if (!secondsLeft) {
        stop()
        setVerification({ phase: 'pending', secondsLeft: 0 })
        return
      }
      setVerification({ phase: 'verifying', secondsLeft })
      if (secondsLeft % 3 === 0) void read()
      if (Date.now() - run.lastVerify >= 6000) void verify()
    }, 1000)
    await verify()
  }, [verifyPayment, getAppointment, stop])

  const retry = () => last.current && start(last.current.payload, last.current.onConfirmed)
  return { verification, start, retry, stop }
}

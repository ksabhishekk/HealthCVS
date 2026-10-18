import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, Loader2, ArrowLeft, Lock, KeyRound } from 'lucide-react'
import { api, setToken } from '../lib/api'
import { isValidAadhaar, formatAadhaar } from '../lib/aadhaar'

export default function Login({ onSignedIn }) {
  const navigate = useNavigate()
  const [step, setStep] = useState('aadhaar')
  const [aadhaar, setAadhaar] = useState('')
  const [otp, setOtp] = useState('')
  const [login, setLogin] = useState(null)   // { loginId, destination, delivered, devOtp }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const digits = aadhaar.replace(/\D/g, '')

  const requestCode = async (e) => {
    e?.preventDefault()
    setError('')
    if (!isValidAadhaar(digits)) {
      setError('That is not a valid Aadhaar number. Check the 12 digits on your card.')
      return
    }
    setBusy(true)
    try {
      setLogin(await api('/auth/start', { method: 'POST', body: { aadhaarNumber: digits } }))
      setOtp('')
      setStep('otp')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const verify = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const { token } = await api('/auth/verify', { method: 'POST', body: { loginId: login.loginId, otp } })
      setToken(token)
      onSignedIn()
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="bg-gradient-to-b from-teal-600 to-teal-700 text-white px-6 pt-14 pb-10">
        <div className="max-w-md mx-auto">
          <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center mb-5">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold">Track your health claims</h1>
          <p className="text-teal-50/90 mt-2 text-[15px] leading-relaxed">
            See your cover, every claim a hospital files in your name, and where it is — read live from the blockchain.
          </p>
        </div>
      </div>

      <main className="flex-1 max-w-md w-full mx-auto px-6 -mt-6">
        <div className="card p-5">
          {step === 'aadhaar' ? (
            <form onSubmit={requestCode} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="aadhaar">Aadhaar number</label>
                <input
                  id="aadhaar"
                  className="input tracking-widest font-medium"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="1234 5678 9012"
                  value={formatAadhaar(digits)}
                  onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, '').slice(0, 12))}
                  autoFocus
                />
                <p className="text-xs text-slate-500 mt-1.5">We send a code to the phone or e-mail your insurer has on file for you.</p>
              </div>
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <button className="btn-primary w-full" disabled={busy || digits.length !== 12}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Send code
              </button>
            </form>
          ) : (
            <form onSubmit={verify} className="space-y-4">
              <button type="button" className="text-sm text-slate-500 inline-flex items-center gap-1" onClick={() => { setStep('aadhaar'); setError('') }}>
                <ArrowLeft className="w-4 h-4" /> Change number
              </button>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="otp">Enter the 6-digit code</label>
                <input
                  id="otp"
                  className="input text-center text-2xl tracking-[0.5em] font-semibold"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  autoFocus
                />
                <p className="text-xs text-slate-500 mt-1.5">
                  {login?.delivered ? `Sent to ${login.destination}. ` : ''}The code is valid for 10 minutes.
                </p>
              </div>
              {login?.devOtp && (
                <div className="rounded-xl bg-amber-50 text-amber-800 text-sm px-3 py-2.5">
                  Demo mode — no e-mail service is set up, so here is the code: <strong className="tracking-wider">{login.devOtp}</strong>
                </div>
              )}
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <button className="btn-primary w-full" disabled={busy || otp.length !== 6}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Sign in
              </button>
              <button type="button" className="text-sm text-teal-700 font-medium w-full" disabled={busy} onClick={requestCode}>
                Send a new code
              </button>
            </form>
          )}
        </div>

        <p className="flex items-start gap-2 text-xs text-slate-500 mt-5 px-1 leading-relaxed">
          <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Your Aadhaar number is not stored. It is turned into a one-way code (a hash) to find your policy — the same code the blockchain uses.
        </p>
      </main>
    </div>
  )
}

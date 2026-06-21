import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Hospital, Eye, EyeOff, AlertCircle, ShieldCheck, Database, FileSearch } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

const FEATURES = [
  { icon: ShieldCheck, text: 'Immutable audit trail on Polygon blockchain' },
  { icon: Database,    text: 'Document CIDs stored via IPFS (Pinata)' },
  { icon: FileSearch,  text: 'Automated fraud scoring and adjudication' },
]

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({ email: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(form.email, form.password)
      navigate('/dashboard')
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Check your credentials.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left panel */}
      <div
        className="hidden lg:flex w-5/12 bg-slate-900 flex-col justify-between p-12 relative overflow-hidden"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      >
        {/* Top: brand */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
            <Hospital className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="text-white font-bold text-base leading-tight">HealthCVS</div>
            <div className="text-slate-400 text-xs">Hospital Portal</div>
          </div>
        </div>

        {/* Middle: headline + features */}
        <div className="relative z-10">
          <h1 className="text-3xl font-bold text-white leading-snug mb-3">
            Blockchain-verified<br />insurance claims
          </h1>
          <p className="text-slate-400 text-sm leading-relaxed mb-8">
            City General Hospital's secure claim management platform. Every transaction is signed,
            timestamped, and recorded on-chain — tamper-proof by design.
          </p>

          <div className="space-y-4">
            {FEATURES.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <div className="w-7 h-7 bg-slate-800 border border-slate-700 rounded-lg flex items-center justify-center shrink-0">
                  <Icon className="w-3.5 h-3.5 text-blue-400" />
                </div>
                <span className="text-slate-300 text-sm">{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom: tech stack tags */}
        <div className="relative z-10 flex flex-wrap gap-2">
          {['Polygon Amoy', 'Pinata IPFS', 'PM-JAY Compliant', 'Solidity'].map(tag => (
            <span key={tag} className="px-2.5 py-1 bg-slate-800 border border-slate-700 rounded-md text-xs text-slate-400">
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-8 bg-gray-50">
        <div className="w-full max-w-sm">
          {/* Mobile-only logo */}
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Hospital className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-gray-900">HealthCVS</span>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-1">Welcome back</h2>
            <p className="text-gray-500 text-sm">Sign in with your staff credentials to continue</p>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="label">Email address</label>
              <input
                type="email"
                className="input"
                placeholder="staff@citygeneralhospital.in"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="label">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input pr-10"
                  placeholder="••••••••"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              className="btn-primary w-full justify-center py-2.5 mt-2"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Signing in…
                </>
              ) : 'Sign in'}
            </button>
          </form>

          <p className="text-xs text-gray-400 mt-8 text-center">
            Need access? Contact your hospital administrator.
          </p>
        </div>
      </div>
    </div>
  )
}

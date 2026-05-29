import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, Eye, EyeOff, AlertCircle, Bot, FileSearch, BadgeCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

const FEATURES = [
  { icon: ShieldCheck, text: 'Immutable claim records on Polygon blockchain with full audit trail' },
  { icon: Bot,         text: 'ML fraud scoring pipeline with automated adjudication rules' },
  { icon: FileSearch,  text: 'IPFS-backed document verification with PM-JAY ceiling enforcement' },
  { icon: BadgeCheck,  text: 'Role-based reviewer and finance workflows for every claim stage' },
]

const TAGS = ['Polygon Amoy', 'Pinata IPFS', 'PM-JAY Compliant', 'Solidity']

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
        className="hidden lg:flex w-1/2 bg-slate-900 flex-col justify-between p-12"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-600 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="text-white font-bold text-sm leading-tight">Star Health Insurance</div>
            <div className="text-slate-400 text-xs">HealthCVS Portal</div>
          </div>
        </div>

        <div>
          <h1 className="text-4xl font-bold text-white leading-tight mb-4">
            Insurance Claims<br />Processing Platform
          </h1>
          <p className="text-slate-400 text-base mb-8">
            Review, adjudicate, and settle health insurance claims with blockchain audit trails and automated fraud detection.
          </p>
          <div className="space-y-4">
            {FEATURES.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-md bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-3.5 h-3.5 text-emerald-400" />
                </div>
                <p className="text-slate-300 text-sm leading-relaxed">{text}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {TAGS.map(tag => (
            <span key={tag} className="text-xs px-3 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-400">
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-8 bg-gray-50">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <ShieldCheck className="w-7 h-7 text-emerald-600" />
            <span className="font-bold text-lg text-gray-900">HealthCVS</span>
          </div>

          <h2 className="text-2xl font-bold text-gray-900 mb-1">Welcome back</h2>
          <p className="text-gray-500 mb-8 text-sm">Sign in with your insurer staff credentials</p>

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
                placeholder="you@insurer.com"
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
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              className="btn-primary w-full justify-center py-2.5"
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
            Contact your insurance administrator if you need access.
          </p>
        </div>
      </div>
    </div>
  )
}

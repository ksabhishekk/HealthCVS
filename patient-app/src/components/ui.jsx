import { useEffect, useState } from 'react'
import { ShieldCheck, WifiOff, Download } from 'lucide-react'

const TONES = {
  progress: 'bg-sky-50 text-sky-700',
  good: 'bg-emerald-50 text-emerald-700',
  review: 'bg-amber-50 text-amber-700',
  bad: 'bg-rose-50 text-rose-700',
}

export function StatusChip({ tone, children }) {
  return (
    <span className={`chip ${TONES[tone] || TONES.progress}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {children}
    </span>
  )
}

// Six steps of the on-chain trail; how many are done for each status.
const DONE = { 0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 4, 7: 5 }
export function ClaimProgress({ status }) {
  const done = DONE[status] ?? 0
  const color = status === 7 ? 'bg-rose-400' : status === 6 ? 'bg-amber-400' : 'bg-teal-500'
  return (
    <div className="flex gap-1" aria-label={`${done} of 6 steps done`}>
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className={`h-1.5 flex-1 rounded-full ${i < done ? color : 'bg-slate-200'}`} />
      ))}
    </div>
  )
}

export function AppBar({ title, subtitle, left, right }) {
  return (
    <header className="sticky top-0 z-10 bg-slate-50/90 backdrop-blur border-b border-slate-200/60">
      <div className="max-w-md mx-auto px-4 h-14 flex items-center gap-3">
        {left || (
          <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-tight truncate">{title}</div>
          {subtitle && <div className="text-xs text-slate-500 truncate">{subtitle}</div>}
        </div>
        {right}
      </div>
    </header>
  )
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return online
}

export function StaleNote({ at, error }) {
  if (!at && !error) return null
  return (
    <div className="flex items-start gap-2 rounded-xl bg-amber-50 text-amber-800 text-sm px-3 py-2.5">
      <WifiOff className="w-4 h-4 mt-0.5 shrink-0" />
      <span>{error || 'You are offline.'}{at ? ` Showing what was last loaded, ${new Date(at).toLocaleString('en-IN')}.` : ''}</span>
    </div>
  )
}

// "Install app" — shown when the browser offers to install the PWA.
export function InstallButton() {
  const [prompt, setPrompt] = useState(null)
  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setPrompt(e) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', () => setPrompt(null))
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])
  if (!prompt) return null
  return (
    <button className="btn-ghost w-full" onClick={async () => { prompt.prompt(); await prompt.userChoice; setPrompt(null) }}>
      <Download className="w-4 h-4" /> Install the app on this device
    </button>
  )
}

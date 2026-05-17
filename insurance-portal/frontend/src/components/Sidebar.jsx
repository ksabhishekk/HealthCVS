import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, FileText, UserPlus, UserCog,
  LogOut, ShieldCheck,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'

const ROLE_LABELS = {
  admin: 'Admin',
  analyst: 'Fraud Analyst',
  adjudicator: 'Adjudicator',
  reviewer: 'Senior Reviewer',
  finance: 'Finance Officer',
}

const baseNav = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/claims', icon: FileText, label: 'Claims' },
  { to: '/patients/enroll', icon: UserPlus, label: 'Enroll Patient' },
]

const adminNav = [
  ...baseNav,
  { to: '/admin/staff', icon: UserCog, label: 'Staff' },
]

export default function Sidebar() {
  const { user, logout, isAdmin } = useAuth()
  const navigate = useNavigate()
  const nav = isAdmin ? adminNav : baseNav

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <aside className="w-64 min-h-screen bg-slate-900 text-slate-100 flex flex-col">
      <div className="px-6 py-5 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-emerald-400" />
          <div>
            <div className="font-bold text-sm leading-tight">HealthCVS</div>
            <div className="text-xs text-slate-400">Insurer Portal</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/dashboard'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`
            }
          >
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-4 py-4 border-t border-slate-700">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-xs font-bold">
            {user?.name?.[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{user?.name}</div>
            <div className="text-xs text-slate-400 truncate">{ROLE_LABELS[user?.role] || user?.role}</div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg text-sm transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </aside>
  )
}

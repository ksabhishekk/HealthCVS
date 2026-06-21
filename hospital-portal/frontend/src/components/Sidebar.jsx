import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, FileText, PlusCircle,
  UserCog, LogOut, Hospital, ShieldCheck, ChevronRight,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'

const clerkNav = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/patients',  icon: Users,           label: 'Patients' },
  { to: '/claims',    icon: FileText,         label: 'Claims' },
  { to: '/claims/new',icon: PlusCircle,       label: 'New Claim' },
]

const adminNav = [
  ...clerkNav,
  { to: '/admin/staff', icon: UserCog, label: 'Staff Management' },
]

export default function Sidebar() {
  const { user, logout, isAdmin } = useAuth()
  const navigate = useNavigate()
  const nav = isAdmin ? adminNav : clerkNav

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <aside className="w-64 min-h-screen bg-slate-900 text-slate-100 flex flex-col border-r border-slate-800">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
            <Hospital className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-sm text-white leading-tight">HealthCVS</div>
            <div className="text-xs text-slate-400 truncate">City General Hospital</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        <p className="px-3 mb-2 text-xs font-semibold text-slate-500 uppercase tracking-widest">Navigation</p>
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/dashboard'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
              }`
            }
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="flex-1">{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* User info */}
      <div className="px-4 py-4 border-t border-slate-800">
        <div className="flex items-center gap-3 mb-3 px-1">
          <div className="w-8 h-8 rounded-lg bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-200 shrink-0">
            {user?.name?.[0]?.toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-slate-100 truncate">{user?.name}</div>
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <ShieldCheck className="w-3 h-3" />
              {user?.role === 'admin' ? 'Administrator' : 'Desk Clerk'}
            </div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg text-sm transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </aside>
  )
}

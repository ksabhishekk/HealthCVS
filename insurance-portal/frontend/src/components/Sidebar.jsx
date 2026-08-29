import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, FileText, UserPlus, UserCog,
  LogOut, ShieldCheck,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'

const ROLE_LABELS = {
  admin:    'Administrator',
  reviewer: 'Senior Reviewer',
  finance:  'Finance Officer',
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
    <aside className="w-64 min-h-screen bg-white flex flex-col border-r border-gray-200">
      <div className="px-6 py-5 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-emerald-600 flex items-center justify-center shrink-0 shadow-sm">
            <ShieldCheck className="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <div className="font-bold text-[15px] text-gray-900 leading-tight">Star Health</div>
            <div className="text-xs text-gray-500 font-medium">HealthCVS Portal</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-6">
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-3 mb-3">Navigation</p>
        <div className="space-y-1">
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/dashboard'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium transition-all ${
                  isActive
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`
              }
            >
              <Icon className="w-4.5 h-4.5 shrink-0" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>

      <div className="px-4 py-4 border-t border-gray-100">
        <div className="flex items-center gap-3 mb-4 px-1">
          <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-sm font-bold text-emerald-700 shrink-0">
            {user?.name?.[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-gray-900 truncate">{user?.name}</div>
            <div className="text-[11px] font-medium text-gray-500 truncate">{ROLE_LABELS[user?.role] || user?.role}</div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-xl text-[13px] font-medium transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </aside>
  )
}

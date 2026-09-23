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
    <aside className="w-64 min-h-screen bg-white flex flex-col border-r border-gray-200">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center shrink-0 shadow-sm">
            <Hospital className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-[15px] text-gray-900 leading-tight">HealthCVS</div>
            <div className="text-xs text-gray-500 font-medium truncate">City General Hospital</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-6 space-y-1">
        <p className="px-3 mb-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Navigation</p>
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/dashboard'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium transition-all ${
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`
            }
          >
            <Icon className="w-4.5 h-4.5 shrink-0" />
            <span className="flex-1">{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* User info */}
      <div className="px-4 py-4 border-t border-gray-100">
        <div className="flex items-center gap-3 mb-4 px-1">
          <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-700 shrink-0">
            {user?.name?.[0]?.toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-gray-900 truncate">{user?.name}</div>
            <div className="flex items-center gap-1 text-[11px] font-medium text-gray-500">
              <ShieldCheck className="w-3 h-3 text-blue-500" />
              {user?.role === 'admin' ? 'Administrator' : 'Desk Clerk'}
            </div>
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

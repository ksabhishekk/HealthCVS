import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'

export default function Layout() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-auto">
        <div className="h-1 bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500" />
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

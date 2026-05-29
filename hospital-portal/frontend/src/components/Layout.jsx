import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'

export default function Layout() {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="h-1 bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-500" />
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

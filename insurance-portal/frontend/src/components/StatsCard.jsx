export default function StatsCard({ label, value, icon: Icon, color = 'emerald', sub }) {
  const colors = {
    emerald: 'bg-emerald-50 text-emerald-600',
    blue:    'bg-blue-50 text-blue-600',
    yellow:  'bg-yellow-50 text-yellow-600',
    red:     'bg-red-50 text-red-600',
    purple:  'bg-purple-50 text-purple-600',
    orange:  'bg-orange-50 text-orange-600',
  }
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-gray-500 font-medium">{label}</span>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${colors[color] || colors.emerald}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <div className="text-2xl font-bold text-gray-900">{value ?? '—'}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  )
}

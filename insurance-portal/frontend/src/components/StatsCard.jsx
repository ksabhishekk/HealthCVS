export default function StatsCard({ label, value, color = 'emerald', sub }) {
  const dot_color = {
    emerald: 'bg-emerald-500',
    blue:    'bg-blue-500',
    yellow:  'bg-amber-500',
    red:     'bg-red-500',
    purple:  'bg-purple-500',
    orange:  'bg-orange-500',
  }
  return (
    <div className="card p-6 relative overflow-hidden group">
      <div className={`absolute top-0 right-0 w-16 h-16 -mr-8 -mt-8 rounded-full opacity-10 transition-transform group-hover:scale-150 ${dot_color[color] || dot_color.emerald}`} />
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-2 h-2 rounded-full ${dot_color[color] || dot_color.emerald}`} />
        <div className="text-[13px] font-semibold text-gray-500 tracking-wide">{label}</div>
      </div>
      <div className="text-3xl font-bold text-gray-900 tracking-tight">{value ?? '—'}</div>
      {sub && <div className="text-sm font-medium text-gray-400 mt-2">{sub}</div>}
    </div>
  )
}

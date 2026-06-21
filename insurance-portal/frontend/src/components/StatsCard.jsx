export default function StatsCard({ label, value, color = 'emerald', sub }) {
  const borders = {
    emerald: 'border-l-emerald-500',
    blue:    'border-l-blue-500',
    yellow:  'border-l-yellow-500',
    red:     'border-l-red-500',
    purple:  'border-l-purple-500',
    orange:  'border-l-orange-500',
  }
  return (
    <div className={`card p-5 border-l-4 ${borders[color] || borders.emerald}`}>
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{label}</div>
      <div className="text-2xl font-bold text-gray-900">{value ?? '—'}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  )
}

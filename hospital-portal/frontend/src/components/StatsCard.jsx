const left_border = {
  blue:   'border-l-blue-500',
  green:  'border-l-green-500',
  yellow: 'border-l-amber-500',
  red:    'border-l-red-500',
  purple: 'border-l-purple-500',
}

export default function StatsCard({ label, value, color = 'blue', sub }) {
  return (
    <div className={`card p-5 border-l-4 ${left_border[color]}`}>
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{label}</div>
      <div className="text-2xl font-bold text-gray-900">{value ?? '—'}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  )
}

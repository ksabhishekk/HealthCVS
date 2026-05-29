export default function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-start justify-between mb-6 pb-5 border-b border-gray-100">
      <div>
        <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        {subtitle && <p className="text-sm text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}

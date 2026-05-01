// Mirrors ClaimSubmission.ClaimStatus enum (0-7)
const STATUS_CONFIG = {
  0: { label: 'Submitted',          color: 'bg-blue-100 text-blue-700' },
  1: { label: 'Doc Authenticated',  color: 'bg-indigo-100 text-indigo-700' },
  2: { label: 'Fraud Scored',       color: 'bg-purple-100 text-purple-700' },
  3: { label: 'Adjudicated',        color: 'bg-yellow-100 text-yellow-700' },
  4: { label: 'Insurer Reviewed',   color: 'bg-orange-100 text-orange-700' },
  5: { label: 'Settled',            color: 'bg-green-100 text-green-700' },
  6: { label: 'Flagged',            color: 'bg-red-100 text-red-700' },
  7: { label: 'Rejected',           color: 'bg-gray-100 text-gray-600' },
}

export default function ClaimStatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] ?? { label: `Status ${status}`, color: 'bg-gray-100 text-gray-600' }
  return (
    <span className={`badge ${cfg.color}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {cfg.label}
    </span>
  )
}

export { STATUS_CONFIG }

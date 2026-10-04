// Shared formatting for the policy pages.

export const POLICY_TYPE_STYLE = {
  individual: 'bg-blue-50 text-blue-700',
  family_floater: 'bg-violet-50 text-violet-700',
  corporate: 'bg-amber-50 text-amber-800',
  group: 'bg-teal-50 text-teal-700',
  government: 'bg-orange-50 text-orange-700',
}

export const RELATIONSHIP_LABELS = {
  self: 'Self', spouse: 'Spouse', son: 'Son', daughter: 'Daughter', father: 'Father', mother: 'Mother',
  father_in_law: 'Father-in-law', mother_in_law: 'Mother-in-law', other: 'Other family member',
}

// What "self" means on each kind of policy.
export const SELF_LABEL = {
  individual: 'Self (proposer)', family_floater: 'Self (proposer)', corporate: 'Employee',
  group: 'Group member', government: 'Head of family',
}

export const fmtINR = (n) =>
  n == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

export const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export const ageFrom = (dob) => {
  if (!dob) return null
  const d = new Date(dob), now = new Date()
  let a = now.getFullYear() - d.getFullYear()
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) a--
  return a
}

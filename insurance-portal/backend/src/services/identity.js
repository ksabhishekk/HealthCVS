/**
 * Does the patient a hospital describes match the person the insurer covers?
 *
 * The Aadhaar hash ties a claim to a member, but the hash is computed from a
 * number the hospital typed. The member's recorded name, date of birth and
 * gender are an independent check: a claim filed against a real member's
 * Aadhaar for a different person rarely gets all three right.
 */

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'shri', 'smt', 'kumari', 'kum', 'master', 'baby', 'late'])

const tokens = (name) => String(name || '')
  .toLowerCase()
  .replace(/[^a-z\s]/g, ' ')
  .split(/\s+/)
  .filter(t => t && !TITLES.has(t))

/**
 * Names match when more than half of the longer name's words appear in the
 * other — tolerant of a middle name, initials and word order, but not of a
 * different person. Family members share a surname, so "Priya Sharma" must
 * not pass for "Vikram Sharma": a shared surname alone is exactly half of a
 * two-word name, which is not enough. An initial ("R") matches a word that
 * starts with that letter.
 */
function namesMatch(a, b) {
  const x = tokens(a), y = tokens(b)
  if (!x.length || !y.length) return null
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  const used = new Set()
  let shared = 0
  for (const t of short) {
    const i = long.findIndex((u, k) => !used.has(k) && (u === t || (t.length === 1 && u[0] === t) || (u.length === 1 && t[0] === u)))
    if (i >= 0) { used.add(i); shared++ }
  }
  // Initials alone are too weak to establish identity: require one full word.
  const fullWordShared = short.some(t => t.length > 1 && long.includes(t))
  return fullWordShared && shared / long.length > 0.5
}

const sameDay = (a, b) => {
  if (!a || !b) return null
  const d1 = new Date(a), d2 = new Date(b)
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return null
  return d1.toISOString().slice(0, 10) === d2.toISOString().slice(0, 10)
}

/**
 * Compares submitted patient details with a member record. Each field is
 * 'match', 'mismatch' or 'not_checked' (nothing submitted to compare).
 */
function compareIdentity(submitted = {}, member = {}) {
  const verdict = (v) => (v === null ? 'not_checked' : v ? 'match' : 'mismatch')
  const name = verdict(submitted.name ? namesMatch(submitted.name, member.name) : null)
  const dateOfBirth = verdict(submitted.dateOfBirth ? sameDay(submitted.dateOfBirth, member.dateOfBirth) : null)
  const gender = verdict(submitted.gender ? String(submitted.gender).toLowerCase() === String(member.gender).toLowerCase() : null)
  const mismatched = [
    name === 'mismatch' && 'name',
    dateOfBirth === 'mismatch' && 'date of birth',
    gender === 'mismatch' && 'gender',
  ].filter(Boolean)
  return { name, dateOfBirth, gender, mismatched }
}

const sameRef = (a, b) => String(a || '').trim().toUpperCase().replace(/\s+/g, '') ===
  String(b || '').trim().toUpperCase().replace(/\s+/g, '')

module.exports = { namesMatch, compareIdentity, sameRef }

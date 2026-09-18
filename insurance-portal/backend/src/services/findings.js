/**
 * Evidence accumulation for the final fraud score.
 *
 * Each check used to apply Math.max(score, floor) on its own, so the floors
 * never added up: a claim that tripped five independent checks scored exactly
 * the same as one that tripped a single check. Claim #7 had a doctor name that
 * did not match its registration number, the wrong specialty, an unrelated
 * procedure, a supermarket receipt for a bill and one file in every document
 * slot — and scored 75, the lowest flagged score.
 *
 * Now the strongest floor sets the base and every further independent confirmed
 * finding adds ESCALATION_PER_FINDING. "Could not verify" items still gate the
 * claim into manual review through their floor, but never escalate — an
 * unreadable document is not evidence of anything.
 */
const ESCALATION_PER_FINDING = 5

function createFindings() {
  const items = []
  return {
    items,
    confirmed(key, floor, label) {
      items.push({ key, floor, label, kind: 'confirmed' })
    },
    unverified(key, floor, label) {
      items.push({ key, floor, label, kind: 'unverified' })
    },
  }
}

function applyFindings(baseScore, items) {
  const confirmed = items.filter(f => f.kind === 'confirmed')
  const maxFloor = items.reduce((m, f) => Math.max(m, f.floor || 0), 0)
  const escalation = confirmed.length > 1 ? ESCALATION_PER_FINDING * (confirmed.length - 1) : 0
  const score = Math.min(100, Math.max(baseScore, maxFloor) + escalation)
  return { score, maxFloor, escalation, confirmedCount: confirmed.length }
}

module.exports = { createFindings, applyFindings, ESCALATION_PER_FINDING }

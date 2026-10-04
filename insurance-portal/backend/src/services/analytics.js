/**
 * Insurer analytics — one payload for the Analytics page and the dashboard.
 *
 * Sources, and why each:
 *   - the chain: every claim's amount, status, fraud score and submitting wallet,
 *     the settlement amounts (TX5 recommended, TX6 approved), and the timestamp
 *     of every status change. This is the authoritative record, so money and
 *     timing figures come only from here.
 *   - MongoDB: what the oracle found (firedSignals / unverifiedSignals / model
 *     component scores), what the reviewer decided, and open information
 *     requests — none of which live on-chain.
 *   - IPFS: the AI explanation of claims scored before component scores were
 *     stored in MongoDB, fetched once and backfilled.
 *
 * `summarise` is a pure function of those inputs so it can be tested without a
 * chain or a database.
 */
const Claim = require('../models/Claim')
const EmpanelledHospital = require('../models/EmpanelledHospital')
const Policy = require('../models/Policy')
const PolicyMember = require('../models/PolicyMember')
const { getContracts, getSettlement, getPool, isOurClaim } = require('./blockchain')
const { TYPE_INFO } = require('./policyRules')

const S = { SUBMITTED: 0, AUTHENTICATED: 1, SCORED: 2, ADJUDICATED: 3, REVIEWED: 4, SETTLED: 5, FLAGGED: 6, REJECTED: 7 }
const FLAG_THRESHOLD = 75   // AutoAdjudication.FRAUD_THRESHOLD
const REVIEW_THRESHOLD = 50 // XaiPanel: 50–74 is "manual review"
const DAY_MS = 24 * 60 * 60 * 1000

// How far along the 7-TX lifecycle a status is. Flagged sits beside
// Adjudicated (both are TX5 outcomes), Rejected beside InsurerReviewed (TX6).
const RANK = { 0: 0, 1: 1, 2: 2, 3: 3, 6: 3, 4: 4, 7: 4, 5: 5 }

const outcomeOf = (status) =>
  status === S.SETTLED || status === S.REVIEWED ? 'approved'
    : status === S.REJECTED ? 'rejected'
    : status === S.FLAGGED ? 'flagged'
    : 'in_progress'

const median = (xs) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10)
const dayKey = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Chain ─────────────────────────────────────────────────────────────────────
async function readChain() {
  const { claimSubmission, autoAdjudication } = getContracts()
  if (!claimSubmission) return { claims: [], statusEvents: [], adjudications: [] }

  const total = Number(await claimSubmission.getTotalClaims())
  const claims = (await Promise.all(
    Array.from({ length: total }, (_, i) => i + 1).map(async (id) => {
      try {
        const c = await claimSubmission.getClaim(id)
        if (!isOurClaim(c)) return null   // another insurer's claim on the shared network
        const s = await getSettlement(id)
        return {
          id,
          policyKey: c.policyKey,
          status: Number(c.status),
          claimedAmount: Number(c.claimedAmount),
          fraudScore: Number(c.fraudScore),
          procedureCode: c.procedureCode,
          clerkAddress: String(c.clerkAddress).toLowerCase(),
          createdAt: Number(c.createdAt) * 1000,
          recommendedAmount: s?.recommendedAmount ?? 0,
          approvedAmount: s?.approvedAmount ?? 0,
        }
      } catch {
        return null
      }
    })
  )).filter(Boolean)

  let statusEvents = []
  try {
    const logs = await claimSubmission.queryFilter(claimSubmission.filters.ClaimStatusUpdated(), 0, 'latest')
    statusEvents = logs.map(l => ({ id: Number(l.args.claimId), status: Number(l.args.newStatus), at: Number(l.args.timestamp) * 1000 }))
  } catch (e) {
    console.warn(`[Analytics] Could not read status events: ${e.message}`)
  }

  // TX5's reason is only kept in its event: the claim's flagReason is
  // overwritten at TX6 ("Partially approved by insurer" and so on).
  let adjudications = []
  try {
    if (autoAdjudication) {
      const logs = await autoAdjudication.queryFilter(autoAdjudication.filters.ClaimAdjudicated(), 0, 'latest')
      adjudications = logs.map(l => ({ id: Number(l.args.claimId), approved: Boolean(l.args.approved), reason: l.args.reason }))
    }
  } catch (e) {
    console.warn(`[Analytics] Could not read adjudication events: ${e.message}`)
  }

  return { claims, statusEvents, adjudications }
}

// ── Model component scores, backfilled from IPFS for older claims ─────────────
const componentsFromXai = (xai) => {
  const c = xai?.components || {}
  const w = xai?.weights || { tabular: 0.5, cv: 0.3, nlp: 0.2 }
  const cv = xai?.cvAvailable === false ? null : (c.cvScore ?? null)
  const parts = [[c.tabularScore, w.tabular], [cv, w.cv], [c.nlpScore, w.nlp]].filter(([v, wt]) => v != null && wt)
  const used = parts.reduce((a, [, wt]) => a + wt, 0)
  return {
    scoreComponents: {
      tabular: c.tabularScore ?? null,
      xgboost: c.xgboostScore ?? null,
      anomaly: c.anomalyScore ?? null,
      cv,
      nlp: c.nlpScore ?? null,
      base: used ? Math.round(parts.reduce((a, [v, wt]) => a + v * wt, 0) / used) : null,
      final: xai?.finalFraudScore ?? null,
      escalation: c.escalation ?? 0,
    },
    unverifiedSignals: (c.findings || []).filter(f => f.kind === 'unverified').map(f => f.key),
  }
}

async function backfillComponents(dbClaims) {
  const gateway = process.env.PINATA_GATEWAY || 'gateway.pinata.cloud'
  const missing = dbClaims.filter(c => c.xaiCid && !c.scoreComponents)
  await Promise.all(missing.map(async (c) => {
    try {
      const r = await fetch(`https://${gateway}/ipfs/${c.xaiCid}`, { signal: AbortSignal.timeout(6000) })
      if (!r.ok) return
      const derived = componentsFromXai(await r.json())
      Object.assign(c, derived)
      await Claim.updateOne({ _id: c._id }, { $set: derived })
    } catch {
      // leave it out of the component averages; next load retries
    }
  }))
}

// ── Pure aggregation ──────────────────────────────────────────────────────────
function summarise({ chainClaims, statusEvents = [], adjudications = [], dbClaims = [], hospitals = [], policiesByKey = new Map(), cover = [], now = Date.now(), days = 14 }) {
  const db = new Map(dbClaims.map(c => [Number(c.blockchainClaimId), c]))
  const walletToHospital = new Map()
  for (const h of hospitals) for (const w of h.registeredWallets || []) walletToHospital.set(String(w).toLowerCase(), h)

  // When each claim first reached each status.
  const reachedAt = new Map()
  for (const e of statusEvents) {
    const m = reachedAt.get(e.id) || {}
    if (m[e.status] == null || e.at < m[e.status]) m[e.status] = e.at
    reachedAt.set(e.id, m)
  }

  const claims = chainClaims.map(c => {
    const d = db.get(c.id) || {}
    const hospital = walletToHospital.get(c.clerkAddress)
    const policy = policiesByKey.get(c.policyKey)
    return {
      ...c,
      policyType: policy?.policyType || 'unknown',
      outcome: outcomeOf(c.status),
      scored: RANK[c.status] >= 2,
      hospitalName: hospital?.name || `Unregistered wallet ${c.clerkAddress.slice(0, 6)}…${c.clerkAddress.slice(-4)}`,
      hospitalCode: hospital?.code || null,
      fired: d.firedSignals || [],
      unverified: d.unverifiedSignals || [],
      components: d.scoreComponents || null,
      review: d.reviewDecision?.decidedAt ? d.reviewDecision : null,
      openInfoRequests: (d.infoRequests || []).filter(r => r.status === 'open').length,
      oracleFailed: d.status === 'oracle_failed',
      doctors: String(d.doctorNames || '').split(',').map(s => s.trim()).filter(Boolean),
      at: reachedAt.get(c.id) || { [S.SUBMITTED]: c.createdAt },
    }
  })

  const scored = claims.filter(c => c.scored)
  const decided = claims.filter(c => [S.REVIEWED, S.SETTLED, S.REJECTED].includes(c.status))
  const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) || 0), 0)

  // Money
  const claimedTotal = sum(claims, c => c.claimedAmount)
  const paidTotal = sum(claims.filter(c => c.status === S.SETTLED), c => c.approvedAmount)
  const awaitingPayment = sum(claims.filter(c => c.status === S.REVIEWED), c => c.approvedAmount)
  const decidedClaimed = sum(decided, c => c.claimedAmount)
  const decidedApproved = sum(decided, c => (c.status === S.REJECTED ? 0 : c.approvedAmount))
  const adjudicatedClaims = claims.filter(c => RANK[c.status] >= 3)
  const recommendedTotal = sum(adjudicatedClaims, c => c.recommendedAmount)

  // Timing — each stage measured only on claims that completed it.
  const between = (from, toList) => claims.map(c => {
    const a = c.at[from]
    const b = toList.map(s => c.at[s]).filter(v => v != null).sort((x, y) => x - y)[0]
    return a != null && b != null && b >= a ? b - a : null
  }).filter(v => v != null)
  const stageDefs = [
    { key: 'doctor', label: 'Hospital → doctor authentication (TX2→TX3)', from: S.SUBMITTED, to: [S.AUTHENTICATED] },
    { key: 'ai', label: 'AI oracle scoring (TX3→TX4)', from: S.AUTHENTICATED, to: [S.SCORED] },
    { key: 'contract', label: 'Waiting for contract adjudication (TX4→TX5)', from: S.SCORED, to: [S.ADJUDICATED, S.FLAGGED] },
    { key: 'review', label: 'Human review (TX5→TX6)', from: S.ADJUDICATED, to: [S.REVIEWED, S.REJECTED] },
    { key: 'reviewFlagged', label: 'Human review of flagged claims (TX5→TX6)', from: S.FLAGGED, to: [S.REVIEWED, S.REJECTED] },
    { key: 'payment', label: 'Payment (TX6→TX7)', from: S.REVIEWED, to: [S.SETTLED] },
  ]
  const stageTimes = stageDefs
    .map(s => { const xs = between(s.from, s.to); return { key: s.key, label: s.label, medianMs: median(xs), n: xs.length } })
    .filter(s => s.n > 0)
  const endToEnd = between(S.SUBMITTED, [S.SETTLED, S.REJECTED])

  // Claims per day, by current outcome
  const start = new Date(now - (days - 1) * DAY_MS); start.setHours(0, 0, 0, 0)
  const daily = Array.from({ length: days }, (_, i) => {
    const date = dayKey(start.getTime() + i * DAY_MS)
    return { date, approved: 0, in_progress: 0, flagged: 0, rejected: 0 }
  })
  const byDay = new Map(daily.map(d => [d.date, d]))
  for (const c of claims) {
    const row = byDay.get(dayKey(c.createdAt))
    if (row) row[c.outcome]++
  }

  // AI risk
  const scoreBins = [
    { label: '0–24', min: 0, max: 24, band: 'approve' },
    { label: '25–49', min: 25, max: 49, band: 'approve' },
    { label: '50–74', min: 50, max: 74, band: 'review' },
    { label: '75–100', min: 75, max: 100, band: 'flag' },
  ].map(b => ({ ...b, count: scored.filter(c => c.fraudScore >= b.min && c.fraudScore <= b.max).length }))

  const withComponents = scored.filter(c => c.components)
  const avgOf = (k) => round1(mean(withComponents.map(c => c.components[k]).filter(v => v != null)))
  const components = {
    n: withComponents.length,
    tabular: avgOf('tabular'), xgboost: avgOf('xgboost'), anomaly: avgOf('anomaly'),
    cv: avgOf('cv'), nlp: avgOf('nlp'), base: avgOf('base'), final: avgOf('final'),
    liftedByFindings: withComponents.filter(c => c.components.final > c.components.base).length,
  }

  const countKeys = (xs, pick) => {
    const m = {}
    for (const c of xs) for (const k of new Set(pick(c))) m[k] = (m[k] || 0) + 1
    return Object.entries(m).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count)
  }

  // TX5 outcomes (latest adjudication per claim)
  const lastAdj = new Map()
  for (const a of adjudications) lastAdj.set(a.id, a)
  const contractOutcomes = countKeys([...lastAdj.values()], a => [a.reason])
    .map(r => ({ reason: r.key, count: r.count, approved: /^Approved/.test(r.key) }))

  // AI vs the human reviewer. "Rejected" is the reviewer calling it fraud; a
  // partial approval is a pricing decision on a genuine claim, so it counts as
  // approved here.
  const reviewed = claims.filter(c => c.review || c.status === S.REJECTED || c.status === S.REVIEWED || c.status === S.SETTLED)
  const aiHigh = c => c.fraudScore >= FLAG_THRESHOLD
  const rejected = c => c.status === S.REJECTED || c.review?.approved === false
  const matrix = {
    flaggedRejected: reviewed.filter(c => aiHigh(c) && rejected(c)).length,
    flaggedApproved: reviewed.filter(c => aiHigh(c) && !rejected(c)).length,
    clearRejected: reviewed.filter(c => !aiHigh(c) && rejected(c)).length,
    clearApproved: reviewed.filter(c => !aiHigh(c) && !rejected(c)).length,
  }
  const ratio = (a, b) => (b ? a / b : null)
  const aiVsReviewer = {
    reviewed: reviewed.length,
    ...matrix,
    agreement: ratio(matrix.flaggedRejected + matrix.clearApproved, reviewed.length),
    flagsUpheld: ratio(matrix.flaggedRejected, matrix.flaggedRejected + matrix.flaggedApproved),
    rejectionsCaught: ratio(matrix.flaggedRejected, matrix.flaggedRejected + matrix.clearRejected),
  }

  // Breakdowns
  const groupBy = (keyOf) => {
    const m = new Map()
    for (const c of claims) {
      for (const k of [].concat(keyOf(c)).filter(Boolean)) {
        const g = m.get(k) || { name: k, claims: 0, claimed: 0, paid: 0, rejected: 0, highRisk: 0, scores: [] }
        g.claims++
        g.claimed += c.claimedAmount
        if (c.status === S.SETTLED) g.paid += c.approvedAmount
        if (c.status === S.REJECTED) g.rejected++
        if (c.scored) { g.scores.push(c.fraudScore); if (aiHigh(c)) g.highRisk++ }
        m.set(k, g)
      }
    }
    return [...m.values()]
      .map(({ scores, ...g }) => ({ ...g, avgScore: round1(mean(scores)) }))
      .sort((a, b) => b.claimed - a.claimed)
  }

  const funnelSteps = [
    'Submitted (TX2)', 'Doctor authenticated (TX3)', 'AI scored (TX4)',
    'Adjudicated by contract (TX5)', 'Reviewed by insurer (TX6)', 'Settled (TX7)',
  ]

  return {
    generatedAt: new Date(now).toISOString(),
    kpis: {
      totalClaims: claims.length,
      claimedTotal,
      paidTotal,
      awaitingPayment,
      savedTotal: decidedClaimed - decidedApproved,
      decided: decided.length,
      rejected: claims.filter(c => c.status === S.REJECTED).length,
      partial: decided.filter(c => c.status !== S.REJECTED && c.approvedAmount < c.claimedAmount).length,
      recommendedTotal,
      avgScore: round1(mean(scored.map(c => c.fraudScore))),
      highRisk: scored.filter(aiHigh).length,
      needsReview: scored.filter(c => c.fraudScore >= REVIEW_THRESHOLD && !aiHigh(c)).length,
      scored: scored.length,
      medianDecisionMs: median(endToEnd),
      openInfoRequests: sum(claims, c => c.openInfoRequests),
      oracleFailed: claims.filter(c => c.oracleFailed && !c.scored).length,
      awaitingReview: claims.filter(c => c.status === S.ADJUDICATED || c.status === S.FLAGGED).length,
    },
    daily,
    funnel: funnelSteps.map((label, i) => ({ label, count: claims.filter(c => RANK[c.status] >= i).length })),
    scoreBins,
    components,
    findings: countKeys(claims, c => c.fired),
    unverified: countKeys(claims, c => c.unverified),
    contractOutcomes,
    aiVsReviewer,
    money: { claimed: claimedTotal, adjudicatedClaimed: sum(adjudicatedClaims, c => c.claimedAmount), recommended: recommendedTotal, decidedClaimed, approved: decidedApproved, paid: paidTotal },
    stageTimes,
    hospitals: groupBy(c => c.hospitalName),
    procedures: groupBy(c => c.procedureCode),
    doctors: groupBy(c => c.doctors).slice(0, 10),
    policyTypes: groupBy(c => TYPE_INFO[c.policyType]?.label || 'Unknown policy'),
    cover,
  }
}

// Sum insured issued and drawn, by policy type, from the on-chain pools.
async function coverByType(policies, members) {
  const out = new Map()
  for (const p of policies) {
    const row = out.get(p.policyType) || {
      type: p.policyType, label: TYPE_INFO[p.policyType]?.label || p.policyType,
      policies: 0, members: 0, pools: 0, sumInsured: 0, used: 0,
    }
    row.policies++
    const mine = members.filter(m => m.policyId === p.policyId)
    row.members += mine.length
    for (const poolKey of new Set(mine.map(m => m.poolKey).filter(Boolean))) {
      try {
        const pool = await getPool(poolKey)
        row.pools++
        row.sumInsured += pool.sumInsured
        row.used += pool.used
      } catch {}
    }
    out.set(p.policyType, row)
  }
  return Object.keys(TYPE_INFO).map(t => out.get(t)).filter(Boolean)
}

async function buildInsurerAnalytics() {
  const [{ claims, statusEvents, adjudications }, dbClaims, hospitals, policies, members] = await Promise.all([
    readChain(),
    Claim.find({}).select('blockchainClaimId firedSignals unverifiedSignals scoreComponents xaiCid reviewDecision infoRequests status doctorNames').lean(),
    EmpanelledHospital.find({}).select('name code registeredWallets').lean(),
    Policy.find({}).select('policyId policyKey policyType').lean(),
    PolicyMember.find({}).select('policyId poolKey').lean(),
  ])
  // Only claims on the current chain matter; skip stale records from earlier chains.
  const onChain = new Set(claims.map(c => c.id))
  const current = dbClaims.filter(c => onChain.has(Number(c.blockchainClaimId)))
  await backfillComponents(current)
  return summarise({
    chainClaims: claims, statusEvents, adjudications, dbClaims: current, hospitals,
    policiesByKey: new Map(policies.map(p => [p.policyKey, p])),
    cover: await coverByType(policies, members),
  })
}

module.exports = { buildInsurerAnalytics, summarise, componentsFromXai }

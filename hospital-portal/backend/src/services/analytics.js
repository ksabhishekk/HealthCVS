/**
 * Hospital analytics — how our claims are doing with the insurer.
 *
 * Sources:
 *   - the chain: amounts, status, AI risk score, what the insurer approved
 *     (getSettlement), when each status was reached, and TX5's reason.
 *   - the claim's IPFS metadata bundle: doctor, department, diagnosis,
 *     procedures and admission dates. A CID's content never changes, so each
 *     bundle is fetched once and cached for the life of the process.
 *   - the insurance portal: open requests for more information on claims
 *     still in progress.
 *
 * `summarise` is pure so it can be tested without a chain.
 */
const { getContracts, isOurClaim } = require('./blockchain')
const { insurerForWallet, insurerGet } = require('./insurers')

const POLICY_TYPE_LABELS = {
  individual: 'Individual', family_floater: 'Family Floater', corporate: 'Corporate (employer group)',
  group: 'Group (non-employer)', government: 'Government scheme (AB PM-JAY)',
}

const S = { SUBMITTED: 0, AUTHENTICATED: 1, SCORED: 2, ADJUDICATED: 3, REVIEWED: 4, SETTLED: 5, FLAGGED: 6, REJECTED: 7 }
const RANK = { 0: 0, 1: 1, 2: 2, 3: 3, 6: 3, 4: 4, 7: 4, 5: 5 }
const FLAG_THRESHOLD = 75
const DAY_MS = 24 * 60 * 60 * 1000

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

// ── Sources ───────────────────────────────────────────────────────────────────
const metadataCache = new Map()
async function fetchMetadata(cid) {
  if (!cid) return null
  if (metadataCache.has(cid)) return metadataCache.get(cid)
  try {
    const gateway = process.env.PINATA_GATEWAY || 'gateway.pinata.cloud'
    const r = await fetch(`https://${gateway}/ipfs/${cid}`, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) return null
    const json = await r.json()
    metadataCache.set(cid, json)
    return json
  } catch {
    return null // not cached, so the next load retries
  }
}

async function openInfoRequests(id, insurerWallet) {
  try {
    const insurer = await insurerForWallet(insurerWallet)
    if (!insurer) return 0
    return ((await insurerGet(insurer, `/api/claims/${id}/info-requests`)).infoRequests || []).filter(q => q.status === 'open').length
  } catch {
    return 0
  }
}

async function readSources() {
  const { claimSubmission, autoAdjudication } = getContracts()
  if (!claimSubmission) return { chainClaims: [], statusEvents: [], adjudications: [] }

  const total = Number(await claimSubmission.getTotalClaims())
  const chainClaims = (await Promise.all(
    Array.from({ length: total }, (_, i) => i + 1).map(async (id) => {
      try {
        const c = await claimSubmission.getClaim(id)
        if (!isOurClaim(c)) return null   // another hospital's claim on the shared network
        let recommendedAmount = 0, approvedAmount = 0
        try {
          if (autoAdjudication) {
            const [, rec, appr] = await autoAdjudication.getSettlement(BigInt(id))
            recommendedAmount = Number(rec)
            approvedAmount = Number(appr)
          }
        } catch {}
        const status = Number(c.status)
        const [metadata, infoOpen] = await Promise.all([
          fetchMetadata(c.cidDischarge),
          [S.SETTLED, S.REJECTED].includes(status) ? 0 : openInfoRequests(id, c.insurer),
        ])
        return {
          id,
          status,
          claimedAmount: Number(c.claimedAmount),
          fraudScore: Number(c.fraudScore),
          procedureCode: c.procedureCode,
          createdAt: Number(c.createdAt) * 1000,
          recommendedAmount,
          approvedAmount,
          openInfoRequests: infoOpen,
          metadata,
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

  let adjudications = []
  try {
    if (autoAdjudication) {
      const logs = await autoAdjudication.queryFilter(autoAdjudication.filters.ClaimAdjudicated(), 0, 'latest')
      adjudications = logs.map(l => ({ id: Number(l.args.claimId), approved: Boolean(l.args.approved), reason: l.args.reason }))
    }
  } catch (e) {
    console.warn(`[Analytics] Could not read adjudication events: ${e.message}`)
  }

  return { chainClaims, statusEvents, adjudications }
}

// ── Pure aggregation ──────────────────────────────────────────────────────────
function summarise({ chainClaims, statusEvents = [], adjudications = [], now = Date.now(), days = 14 }) {
  const reachedAt = new Map()
  for (const e of statusEvents) {
    const m = reachedAt.get(e.id) || {}
    if (m[e.status] == null || e.at < m[e.status]) m[e.status] = e.at
    reachedAt.set(e.id, m)
  }

  const claims = chainClaims.map(c => {
    const md = c.metadata || {}
    const procs = md.medical?.procedures || []
    const adm = md.admission?.admissionDate ? Date.parse(md.admission.admissionDate) : null
    const dis = md.admission?.dischargeDate ? Date.parse(md.admission.dischargeDate) : null
    return {
      ...c,
      outcome: outcomeOf(c.status),
      scored: RANK[c.status] >= 2,
      department: (md.medical?.doctors || [])[0]?.department || null,
      doctors: (md.medical?.doctors || []).map(d => d.name).filter(Boolean),
      diagnosis: md.medical?.diagnosis || null,
      procedureName: procs.find(p => p.code === c.procedureCode)?.name || null,
      insurer: md.insurer?.name || md.insurance?.company || null,
      policyType: POLICY_TYPE_LABELS[md.insurance?.policyType] || null,
      stayDays: adm != null && dis != null && dis >= adm ? Math.round((dis - adm) / DAY_MS) : null,
      received: c.status === S.SETTLED ? c.approvedAmount : 0,
      at: reachedAt.get(c.id) || { [S.SUBMITTED]: c.createdAt },
    }
  })

  const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) || 0), 0)
  const scored = claims.filter(c => c.scored)
  const approvedClaims = claims.filter(c => c.status === S.REVIEWED || c.status === S.SETTLED)
  const rejectedClaims = claims.filter(c => c.status === S.REJECTED)
  const decidedCount = approvedClaims.length + rejectedClaims.length

  const between = (from, toList) => claims.map(c => {
    const a = c.at[from]
    const b = toList.map(s => c.at[s]).filter(v => v != null).sort((x, y) => x - y)[0]
    return a != null && b != null && b >= a ? b - a : null
  }).filter(v => v != null)
  const stageDefs = [
    { key: 'doctor', label: 'Doctor authentication (TX2→TX3)', from: S.SUBMITTED, to: [S.AUTHENTICATED] },
    { key: 'ai', label: 'Insurer AI check (TX3→TX4)', from: S.AUTHENTICATED, to: [S.SCORED] },
    { key: 'contract', label: 'Smart-contract adjudication (TX4→TX5)', from: S.SCORED, to: [S.ADJUDICATED, S.FLAGGED] },
    { key: 'review', label: 'Insurer decision (TX5→TX6)', from: S.ADJUDICATED, to: [S.REVIEWED, S.REJECTED] },
    { key: 'reviewFlagged', label: 'Insurer decision on flagged claims (TX5→TX6)', from: S.FLAGGED, to: [S.REVIEWED, S.REJECTED] },
    { key: 'payment', label: 'Payment (TX6→TX7)', from: S.REVIEWED, to: [S.SETTLED] },
  ]
  const stageTimes = stageDefs
    .map(s => { const xs = between(s.from, s.to); return { key: s.key, label: s.label, medianMs: median(xs), n: xs.length } })
    .filter(s => s.n > 0)

  const start = new Date(now - (days - 1) * DAY_MS); start.setHours(0, 0, 0, 0)
  const daily = Array.from({ length: days }, (_, i) => ({ date: dayKey(start.getTime() + i * DAY_MS), approved: 0, in_progress: 0, flagged: 0, rejected: 0 }))
  const byDay = new Map(daily.map(d => [d.date, d]))
  for (const c of claims) { const row = byDay.get(dayKey(c.createdAt)); if (row) row[c.outcome]++ }

  // Where each claim is waiting, from the hospital's point of view.
  const stageOf = (s) => ({
    0: 'Waiting for doctor authentication', 1: 'Insurer AI check running', 2: 'Waiting for contract adjudication',
    3: 'Waiting for insurer decision', 6: 'Flagged — waiting for insurer decision', 4: 'Approved — waiting for payment',
    5: 'Settled', 7: 'Rejected',
  })[s]
  const pipelineOrder = [0, 1, 2, 3, 6, 4, 5, 7]
  const pipeline = pipelineOrder.map(s => ({ status: s, label: stageOf(s), count: claims.filter(c => c.status === s).length }))

  const groupBy = (keyOf) => {
    const m = new Map()
    for (const c of claims) {
      for (const k of [].concat(keyOf(c)).filter(Boolean)) {
        const g = m.get(k) || { name: k, claims: 0, claimed: 0, received: 0, deducted: 0, rejected: 0, scores: [], stays: [] }
        g.claims++
        g.claimed += c.claimedAmount
        g.received += c.received
        if (c.status === S.REVIEWED || c.status === S.SETTLED) g.deducted += Math.max(0, c.claimedAmount - c.approvedAmount)
        if (c.status === S.REJECTED) g.rejected++
        if (c.scored) g.scores.push(c.fraudScore)
        if (c.stayDays != null) g.stays.push(c.stayDays)
        m.set(k, g)
      }
    }
    return [...m.values()]
      .map(({ scores, stays, ...g }) => ({ ...g, avgScore: round1(mean(scores)), avgStayDays: round1(mean(stays)) }))
      .sort((a, b) => b.claimed - a.claimed)
  }

  const lastAdj = new Map()
  for (const a of adjudications) lastAdj.set(a.id, a)
  const reasons = {}
  for (const a of lastAdj.values()) reasons[a.reason] = (reasons[a.reason] || 0) + 1

  return {
    generatedAt: new Date(now).toISOString(),
    kpis: {
      totalClaims: claims.length,
      claimedTotal: sum(claims, c => c.claimedAmount),
      receivedTotal: sum(claims, c => c.received),
      awaitingPayment: sum(claims.filter(c => c.status === S.REVIEWED), c => c.approvedAmount),
      deductedTotal: sum(approvedClaims, c => Math.max(0, c.claimedAmount - c.approvedAmount)),
      rejectedAmount: sum(rejectedClaims, c => c.claimedAmount),
      decided: decidedCount,
      approvalRate: decidedCount ? approvedClaims.length / decidedCount : null,
      fullyPaidRate: decidedCount ? approvedClaims.filter(c => c.approvedAmount >= c.claimedAmount).length / decidedCount : null,
      avgScore: round1(mean(scored.map(c => c.fraudScore))),
      highRisk: scored.filter(c => c.fraudScore >= FLAG_THRESHOLD).length,
      medianToSettleMs: median(between(S.SUBMITTED, [S.SETTLED])),
      awaitingDoctor: claims.filter(c => c.status === S.SUBMITTED).length,
      openInfoRequests: sum(claims, c => c.openInfoRequests),
      flagged: claims.filter(c => c.status === S.FLAGGED).length,
      avgStayDays: round1(mean(claims.map(c => c.stayDays).filter(v => v != null))),
    },
    daily,
    pipeline,
    scoreBins: [
      { label: '0–24', min: 0, max: 24, band: 'approve' },
      { label: '25–49', min: 25, max: 49, band: 'approve' },
      { label: '50–74', min: 50, max: 74, band: 'review' },
      { label: '75–100', min: 75, max: 100, band: 'flag' },
    ].map(b => ({ ...b, count: scored.filter(c => c.fraudScore >= b.min && c.fraudScore <= b.max).length })),
    contractOutcomes: Object.entries(reasons).map(([reason, count]) => ({ reason, count, approved: /^Approved/.test(reason) })).sort((a, b) => b.count - a.count),
    stageTimes,
    departments: groupBy(c => c.department || 'Not recorded'),
    doctors: groupBy(c => c.doctors).slice(0, 10),
    procedures: groupBy(c => (c.procedureName ? `${c.procedureCode} · ${c.procedureName}` : c.procedureCode)),
    insurers: groupBy(c => c.insurer || 'Not recorded'),
    policyTypes: groupBy(c => c.policyType || 'Not recorded'),
  }
}

async function buildHospitalAnalytics() {
  return summarise(await readSources())
}

module.exports = { buildHospitalAnalytics, summarise }

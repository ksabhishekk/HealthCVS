const express = require('express')
const { body, validationResult } = require('express-validator')
const { ethers } = require('ethers')
const { authenticate, requireRole } = require('../middleware/auth')
const EmpanelledHospital = require('../models/EmpanelledHospital')
const { getContracts, isOurClaim } = require('../services/blockchain')

const router = express.Router()
router.use(authenticate)

const normaliseWallets = (list) => [...new Set(
  (Array.isArray(list) ? list : String(list || '').split(','))
    .map(w => String(w).trim())
    .filter(Boolean)
)]

const walletError = (wallets) => {
  if (!wallets.length) return 'At least one registered wallet address is required'
  const invalid = wallets.find(w => !ethers.isAddress(w))
  return invalid ? `Not a valid wallet address: ${invalid}` : null
}

const PROFILE_FIELDS = ['city', 'address', 'accreditation', 'contactPhone', 'contactEmail']
const profileFrom = (b) => {
  const out = {}
  for (const k of PROFILE_FIELDS) if (b[k] !== undefined) out[k] = String(b[k] || '').trim()
  if (b.specialities !== undefined) {
    out.specialities = (Array.isArray(b.specialities) ? b.specialities : String(b.specialities || '').split(','))
      .map(s => String(s).trim()).filter(Boolean)
  }
  if (b.beds !== undefined) out.beds = b.beds === '' || b.beds === null ? null : Math.max(0, Math.round(Number(b.beds))) || null
  return out
}

// Claims each hospital wallet has filed against this insurer's policies.
async function claimStatsByWallet() {
  const stats = new Map()
  const { claimSubmission } = getContracts()
  if (!claimSubmission) return stats
  try {
    const total = Number(await claimSubmission.getTotalClaims())
    for (let id = 1; id <= total; id++) {
      const c = await claimSubmission.getClaim(id)
      if (!isOurClaim(c)) continue
      const w = String(c.clerkAddress).toLowerCase()
      const s = stats.get(w) || { claims: 0, claimed: 0, flagged: 0, rejected: 0, settled: 0 }
      s.claims++
      s.claimed += Number(c.claimedAmount)
      if (Number(c.status) === 6) s.flagged++
      if (Number(c.status) === 7) s.rejected++
      if (Number(c.status) === 5) s.settled++
      stats.set(w, s)
    }
  } catch (e) {
    console.warn(`[Hospitals] Could not read claim stats: ${e.message}`)
  }
  return stats
}

// GET /api/hospitals — the network-hospital registry, with each hospital's claims
router.get('/', async (req, res) => {
  try {
    const [hospitals, stats] = await Promise.all([
      EmpanelledHospital.find({}).sort({ code: 1 }).lean(),
      claimStatsByWallet(),
    ])
    const rows = hospitals.map(h => {
      const s = { claims: 0, claimed: 0, flagged: 0, rejected: 0, settled: 0 }
      for (const w of h.registeredWallets) {
        const x = stats.get(w)
        if (x) for (const k of Object.keys(s)) s[k] += x[k]
      }
      return { ...h, claimStats: s }
    })
    // Wallets filing claims against our policies that belong to no empanelled hospital.
    const known = new Set(hospitals.flatMap(h => h.registeredWallets))
    const unregistered = [...stats.entries()].filter(([w]) => !known.has(w)).map(([wallet, s]) => ({ wallet, ...s }))
    res.json({ hospitals: rows, unregistered })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/hospitals — empanel a hospital and register its signing wallets
router.post('/',
  requireRole('admin'),
  body('code').trim().notEmpty().withMessage('Hospital code is required'),
  body('name').trim().notEmpty().withMessage('Hospital name is required'),
  body('empanelledUntil').optional({ checkFalsy: true }).isISO8601().withMessage('Empanelled-until must be a date'),
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg })

    const wallets = normaliseWallets(req.body.registeredWallets)
    const problem = walletError(wallets)
    if (problem) return res.status(400).json({ error: problem })

    try {
      const hospital = await EmpanelledHospital.create({
        code: req.body.code,
        name: req.body.name,
        registeredWallets: wallets.map(w => w.toLowerCase()),
        empanelledUntil: req.body.empanelledUntil || null,
        notes: req.body.notes || '',
        ...profileFrom(req.body),
        addedBy: req.user._id,
      })
      res.status(201).json({ hospital })
    } catch (err) {
      if (err.code === 11000) return res.status(409).json({ error: 'A hospital with this code is already empanelled' })
      res.status(500).json({ error: err.message })
    }
  }
)

// PATCH /api/hospitals/:id — suspend/reactivate, or update wallets, validity and profile
router.patch('/:id', requireRole('admin'), async (req, res) => {
  try {
    const update = { ...profileFrom(req.body) }
    if (req.body.status !== undefined) {
      if (!['active', 'suspended'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' })
      update.status = req.body.status
    }
    if (req.body.registeredWallets !== undefined) {
      const wallets = normaliseWallets(req.body.registeredWallets)
      const problem = walletError(wallets)
      if (problem) return res.status(400).json({ error: problem })
      update.registeredWallets = wallets.map(w => w.toLowerCase())
    }
    if (req.body.empanelledUntil !== undefined) update.empanelledUntil = req.body.empanelledUntil || null
    if (req.body.name) update.name = req.body.name
    if (req.body.notes !== undefined) update.notes = req.body.notes

    const hospital = await EmpanelledHospital.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true })
    if (!hospital) return res.status(404).json({ error: 'Hospital not found' })
    res.json({ hospital })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router

const express = require('express')
const { authenticate } = require('../middleware/auth')
const ClaimConsent = require('../models/ClaimConsent')
const { generateOtp, generateConsentToken, sendOtp } = require('../services/otp')

const router = express.Router()
router.use(authenticate)

const OTP_TTL_MS = 10 * 60 * 1000  // 10 minutes

// POST /api/consent/send — clerk triggers this before submitting a claim.
// Sends (or dev-mode logs) an OTP to the patient's own on-file contact number.
router.post('/send', async (req, res) => {
  try {
    const { contactNumber, patientName, procedureSummary } = req.body
    if (!contactNumber || !/^\d{10}$/.test(contactNumber)) {
      return res.status(400).json({ error: 'A valid 10-digit contact number is required' })
    }

    const otp = generateOtp()
    const expiresAt = new Date(Date.now() + OTP_TTL_MS)

    // One active OTP per contact number at a time — replace any prior unconsumed one
    await ClaimConsent.deleteMany({ contactNumber, consumed: false })
    await ClaimConsent.create({
      contactNumber, otp, expiresAt,
      patientName: patientName || '',
      procedureSummary: procedureSummary || '',
    })

    const result = await sendOtp(contactNumber, otp)

    let message
    if (result.sent) {
      message = `OTP sent to ${contactNumber}`
    } else if (result.error) {
      // A gateway was configured but the send failed (e.g. an unverified
      // number on a Twilio trial account) — say so explicitly rather than
      // silently looking identical to "no gateway configured at all."
      message = `SMS send failed (${result.error}) — falling back to on-screen OTP`
    } else {
      message = 'No SMS gateway configured — dev mode active, OTP returned directly'
    }

    res.json({
      success: true,
      message,
      devOtp: result.devMode ? otp : undefined,  // present whenever a real SMS wasn't actually delivered
      expiresInSeconds: OTP_TTL_MS / 1000,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/consent/verify — patient (or clerk reading it back from the patient) enters the OTP.
// Returns a short-lived consentToken the claim submission must include.
router.post('/verify', async (req, res) => {
  try {
    const { contactNumber, otp } = req.body
    if (!contactNumber || !otp) {
      return res.status(400).json({ error: 'contactNumber and otp are required' })
    }

    const record = await ClaimConsent.findOne({ contactNumber, consumed: false }).sort({ createdAt: -1 })
    if (!record) {
      return res.status(404).json({ error: 'No pending OTP for this number. Request a new one.' })
    }
    if (record.expiresAt < new Date()) {
      return res.status(410).json({ error: 'OTP expired. Request a new one.' })
    }
    if (record.otp !== String(otp).trim()) {
      return res.status(400).json({ error: 'Incorrect OTP.' })
    }

    record.verified = true
    record.verifiedAt = new Date()
    record.consentToken = generateConsentToken()
    await record.save()

    res.json({ success: true, consentToken: record.consentToken })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router

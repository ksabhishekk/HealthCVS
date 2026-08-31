const express = require('express')
const { ethers } = require('ethers')
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
    const { contactNumber: formNumber, aadhaarNumber, policyId, insuranceCompany, patientName, procedureSummary } = req.body

    // Prefer the number the *insurer* holds for this patient over the one the
    // clerk typed into the claim form. Whoever chooses the destination can
    // receive the OTP, so letting the hospital pick it makes the consent step
    // prove nothing against a colluding clerk — the exact blind spot this
    // feature exists to close. The form value is only a fallback for patients
    // enrolled before contactNumber was recorded.
    const consentAadhaarHash = aadhaarNumber
      ? ethers.keccak256(ethers.toUtf8Bytes(aadhaarNumber))
      : null

    let contactNumber = null
    let numberSource = 'form'
    if (process.env.INSURANCE_PORTAL_URL && aadhaarNumber && policyId && insuranceCompany) {
      try {
        const aadhaarHash = ethers.keccak256(ethers.toUtf8Bytes(aadhaarNumber))
        const verifyRes = await fetch(`${process.env.INSURANCE_PORTAL_URL}/api/policy/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.INSURANCE_API_KEY || '' },
          body: JSON.stringify({ aadhaarHash, policyId, insuranceCompany }),
          signal: AbortSignal.timeout(6000),
        })
        const verifyData = await verifyRes.json()
        if (verifyData?.valid && verifyData.contactNumber) {
          contactNumber = verifyData.contactNumber
          numberSource = 'insurer'
        }
      } catch (e) {
        console.warn(`[Consent] Could not reach insurer for the on-record number: ${e.message}`)
      }
    }
    if (!contactNumber) contactNumber = formNumber

    if (!contactNumber || !/^\d{10}$/.test(contactNumber)) {
      return res.status(400).json({ error: 'A valid 10-digit contact number is required' })
    }

    const otp = generateOtp()
    const expiresAt = new Date(Date.now() + OTP_TTL_MS)

    // One active OTP per contact number at a time — replace any prior unconsumed one
    await ClaimConsent.deleteMany({ contactNumber, consumed: false })
    const record = await ClaimConsent.create({
      contactNumber, otp, expiresAt,
      aadhaarHash: consentAadhaarHash,
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
      consentId: record._id,                     // /verify keys off this, not the number
      numberSource,                              // 'insurer' = verified against enrolment records
      maskedNumber: `xxxxxx${contactNumber.slice(-4)}`,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/consent/verify — patient (or clerk reading it back from the patient) enters the OTP.
// Returns a short-lived consentToken the claim submission must include.
router.post('/verify', async (req, res) => {
  try {
    const { consentId, contactNumber, otp } = req.body
    if (!otp || (!consentId && !contactNumber)) {
      return res.status(400).json({ error: 'otp and one of consentId or contactNumber are required' })
    }

    // Prefer consentId: the OTP may have gone to the insurer's number rather
    // than the one on the form, so the form number is not a reliable key.
    const record = consentId
      ? await ClaimConsent.findOne({ _id: consentId, consumed: false })
      : await ClaimConsent.findOne({ contactNumber, consumed: false }).sort({ createdAt: -1 })
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

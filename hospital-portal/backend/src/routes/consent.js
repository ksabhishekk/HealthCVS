const express = require('express')
const { ethers } = require('ethers')
const { authenticate } = require('../middleware/auth')
const ClaimConsent = require('../models/ClaimConsent')
const { generateOtp, generateConsentToken, sendOtp } = require('../services/otp')
const { verifyWithInsurer } = require('./insurance')

const router = express.Router()
router.use(authenticate)

const OTP_TTL_MS = 10 * 60 * 1000  // 10 minutes

// POST /api/consent/send — clerk triggers this before submitting a claim.
// Sends (or dev-mode logs) an OTP to the patient's own on-file contact number.
router.post('/send', async (req, res) => {
  try {
    const { contactNumber: formNumber, aadhaarNumber, aadhaarHash: givenHash, policyId, insurerCode, patientName, procedureSummary } = req.body

    // The code goes to the contact the *insurer* holds for this member, never
    // one the clerk typed: whoever chooses the destination can receive the
    // OTP, so letting the hospital pick it would make consent prove nothing
    // against a colluding clerk. The form number is only a fallback for a
    // member enrolled without any contact on record.
    const consentAadhaarHash = givenHash || (aadhaarNumber ? ethers.keccak256(ethers.toUtf8Bytes(aadhaarNumber)) : null)

    let contactNumber = null
    let email = null
    let numberSource = 'form'
    if (consentAadhaarHash && policyId) {
      try {
        const verifyData = await verifyWithInsurer({ insurerCode, aadhaarHash: consentAadhaarHash, policyId })
        if (verifyData?.valid && (verifyData.contactNumber || verifyData.email)) {
          contactNumber = verifyData.contactNumber || null
          email = verifyData.email || null
          numberSource = 'insurer'
        } else if (verifyData && !verifyData.valid) {
          return res.status(400).json({ error: `The insurer could not confirm this patient's cover: ${verifyData.reason}` })
        }
      } catch (e) {
        console.warn(`[Consent] Could not reach the insurer for the contact on record: ${e.message}`)
      }
    }
    // Deliver only to destinations the insurer holds. The form number is used
    // for delivery solely when the insurer has no contact on record at all.
    const deliveryNumber = numberSource === 'insurer' ? contactNumber : formNumber
    // Consent records are keyed by a number; an email-only member is keyed by the form number.
    const recordNumber = contactNumber || formNumber

    if (!recordNumber || !/^\d{10}$/.test(recordNumber)) {
      return res.status(400).json({ error: 'A valid 10-digit contact number is required' })
    }

    const otp = generateOtp()
    const expiresAt = new Date(Date.now() + OTP_TTL_MS)

    // One active OTP per patient at a time — replace any prior unconsumed one
    await ClaimConsent.deleteMany({ consumed: false, $or: [{ contactNumber: recordNumber }, ...(consentAadhaarHash ? [{ aadhaarHash: consentAadhaarHash }] : [])] })
    const record = await ClaimConsent.create({
      contactNumber: recordNumber, otp, expiresAt,
      aadhaarHash: consentAadhaarHash,
      patientName: patientName || '',
      procedureSummary: procedureSummary || '',
    })
    contactNumber = recordNumber

    const result = await sendOtp(deliveryNumber, otp, email)

    let message
    if (result.sent) {
      const masked = result.channel === 'email' && email
        ? email.replace(/^(.)[^@]*/, (_, c) => c + '*****')
        : contactNumber
      message = `OTP sent to ${masked}${result.channel === 'email' ? ' by email' : ''}`
    } else if (result.error) {
      // A gateway was configured but the send failed (e.g. an unverified
      // number on a Twilio trial account) — say so explicitly rather than
      // silently looking identical to "no gateway configured at all."
      // Raw provider errors ("ContentSid Required", DLT template rejections) are
      // meaningless to a clerk and read badly on screen. The detail is already
      // in the server log; the UI gets the actionable version.
      console.warn(`[Consent] Delivery failed for ${contactNumber}: ${result.error}`)
      const needsWhatsAppSession = /contentsid|63016|outside/i.test(result.error || '')
      message = needsWhatsAppSession
        ? 'Message gateway session expired — showing the OTP on screen instead. (Rejoin the WhatsApp sandbox to restore delivery.)'
        : 'Message gateway unavailable — showing the OTP on screen instead.'
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

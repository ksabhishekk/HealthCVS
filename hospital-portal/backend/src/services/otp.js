const crypto = require('crypto')

/**
 * otp.js
 * ------
 * Generates and sends patient-consent OTPs. Pluggable SMS backend, checked
 * in this order:
 *   1. Twilio, if TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM_NUMBER
 *      are set. Chosen over an Indian domestic gateway (MSG91 etc.) for dev/
 *      demo purposes specifically because it doesn't require TRAI DLT template
 *      registration — trial accounts just need the destination number
 *      verified in the Twilio console (Console → Phone Numbers → Verified
 *      Caller IDs), which takes a couple of minutes. Trial messages carry a
 *      "Sent from your Twilio trial account" prefix — cosmetic, expected.
 *   2. MSG91, if SMS_GATEWAY_API_KEY is set — a real Indian gateway for when
 *      DLT registration is actually done (production path).
 *   3. Dev mode — logs the OTP to the server console and returns it directly
 *      in the API response, so the flow is fully demoable with zero SMS
 *      gateway setup. Mirrors the existing MOCK_DOCTOR_VERIFY pattern already
 *      used in the AI service.
 */

const generateOtp = () => String(crypto.randomInt(100000, 999999))

const generateConsentToken = () => crypto.randomBytes(24).toString('hex')

async function sendViaTwilio(contactNumber, otp) {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM_NUMBER

  const body = new URLSearchParams({
    To: `+91${contactNumber}`,
    From: from,
    Body: `Your HealthCVS OTP is ${otp}. Valid for 10 minutes. Do not share this code.`,
  })

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(8000),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    // Common trial-account failure: destination number not verified yet.
    throw new Error(data.message || `Twilio request failed (${res.status})`)
  }
  return res.json()
}

async function sendViaMsg91(contactNumber, otp) {
  const apiKey = process.env.SMS_GATEWAY_API_KEY
  const templateId = process.env.SMS_GATEWAY_TEMPLATE_ID

  const res = await fetch('https://control.msg91.com/api/v5/otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authkey: apiKey },
    body: JSON.stringify({ template_id: templateId, mobile: `91${contactNumber}`, otp }),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`MSG91 request failed (${res.status}): ${text}`)
  }
  return res.json()
}

async function sendOtp(contactNumber, otp) {
  const hasTwilio = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER
  const hasMsg91 = process.env.SMS_GATEWAY_API_KEY

  if (!hasTwilio && !hasMsg91) {
    console.log(`[OTP] No SMS gateway configured — dev mode. OTP for ${contactNumber}: ${otp}`)
    return { sent: false, devMode: true }
  }

  try {
    if (hasTwilio) {
      await sendViaTwilio(contactNumber, otp)
    } else {
      await sendViaMsg91(contactNumber, otp)
    }
    return { sent: true, devMode: false }
  } catch (e) {
    console.warn(`[OTP] SMS send failed, falling back to dev mode for this request: ${e.message}`)
    // Fail open to dev mode rather than blocking the whole consent flow if the
    // gateway hiccups (e.g. an unverified number on a Twilio trial account) —
    // the clerk can still read the OTP off-screen and keep the demo moving.
    return { sent: false, devMode: true, error: e.message }
  }
}

module.exports = { generateOtp, generateConsentToken, sendOtp }

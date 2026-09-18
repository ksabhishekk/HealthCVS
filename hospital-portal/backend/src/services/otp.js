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

async function sendViaEmail(email, otp) {
  const nodemailer = require('nodemailer')
  const transport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.OTP_EMAIL_USER, pass: process.env.OTP_EMAIL_PASSWORD },
  })

  await transport.sendMail({
    from: `"HealthCVS" <${process.env.OTP_EMAIL_USER}>`,
    to: email,
    subject: `HealthCVS claim consent code: ${otp}`,
    text:
      `Your HealthCVS consent code is ${otp}.

` +
      `A hospital has filed an insurance claim on your behalf and needs your ` +
      `authorisation before it is submitted. This code is valid for 10 minutes.

` +
      `If you did not visit a hospital recently, do not share this code with anyone.`,
    html:
      `<p>Your HealthCVS consent code is <strong style="font-size:20px">${otp}</strong></p>` +
      `<p>A hospital has filed an insurance claim on your behalf and needs your ` +
      `authorisation before it is submitted. This code is valid for 10 minutes.</p>` +
      `<p style="color:#b91c1c">If you did not visit a hospital recently, do not share this code with anyone.</p>`,
  })
}

async function sendViaTwilioWhatsApp(contactNumber, otp) {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_WHATSAPP_FROM  // e.g. whatsapp:+14155238886 (Twilio sandbox)

  const body = new URLSearchParams({
    To: `whatsapp:+91${contactNumber}`,
    From: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
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
    throw new Error(data.message || `Twilio WhatsApp request failed (${res.status})`)
  }
  return res.json()
}

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

async function sendOtp(contactNumber, otp, email = null) {
  const hasEmail = process.env.OTP_EMAIL_USER && process.env.OTP_EMAIL_PASSWORD
  const hasTwilioAuth = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  // WhatsApp is tried first, and deliberately so. Plain SMS to an Indian (+91)
  // number requires TRAI DLT-registered sender IDs and message templates —
  // that is a destination-country rule, so it applies to every provider, not
  // just Twilio, and a trial account cannot satisfy it (the failure surfaces as
  // "Invalid template name. Trial accounts can only use predefined SMS
  // templates."). WhatsApp is outside DLT, so it delivers to Indian numbers on
  // a trial account. The recipient must have joined the Twilio sandbox first.
  const hasWhatsApp = hasTwilioAuth && process.env.TWILIO_WHATSAPP_FROM
  const hasSms = hasTwilioAuth && process.env.TWILIO_FROM_NUMBER
  const hasMsg91 = process.env.SMS_GATEWAY_API_KEY

  if (!(hasEmail && email) && !hasWhatsApp && !hasSms && !hasMsg91) {
    console.log(`[OTP] No gateway configured — dev mode. OTP for ${contactNumber}: ${otp}`)
    return { sent: false, devMode: true }
  }

  const channels = []
  // Email leads because it is the only channel that actually reaches an Indian
  // recipient from a demo-tier account: SMS to +91 needs TRAI DLT registration,
  // and the trial WhatsApp sender rejects every message without an approved
  // Content Template (error 21654), which trial accounts cannot create. The
  // security property is unchanged either way — what matters is that the
  // destination comes from the insurer's record, not the hospital's form.
  if (hasEmail && email) channels.push(['email', () => sendViaEmail(email, otp)])
  if (hasWhatsApp) channels.push(['whatsapp', () => sendViaTwilioWhatsApp(contactNumber, otp)])
  if (hasSms) channels.push(['sms', () => sendViaTwilio(contactNumber, otp)])
  if (hasMsg91) channels.push(['msg91', () => sendViaMsg91(contactNumber, otp)])

  const errors = []
  for (const [name, send] of channels) {
    try {
      await send()
      console.log(`[OTP] Sent to ${contactNumber} via ${name}`)
      return { sent: true, devMode: false, channel: name }
    } catch (e) {
      console.warn(`[OTP] ${name} failed: ${e.message}`)
      errors.push(`${name}: ${e.message}`)
    }
  }

  try {
    throw new Error(errors.join(' | '))
  } catch (e) {
    console.warn(`[OTP] SMS send failed, falling back to dev mode for this request: ${e.message}`)
    // Fail open to dev mode rather than blocking the whole consent flow if the
    // gateway hiccups (e.g. an unverified number on a Twilio trial account) —
    // the clerk can still read the OTP off-screen and keep the demo moving.
    return { sent: false, devMode: true, error: e.message }
  }
}

module.exports = { generateOtp, generateConsentToken, sendOtp }

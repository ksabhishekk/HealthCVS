const crypto = require('crypto')

/**
 * Sign-in codes for the patient app, sent to the e-mail address this insurer
 * holds for the member (OTP_EMAIL_USER / OTP_EMAIL_PASSWORD, a Gmail app
 * password — the same settings the hospital portal uses for consent codes).
 * Without them, or for a member with no e-mail on file, the code is returned to
 * the app and shown on screen, so the flow can be demonstrated without a mail
 * account.
 */

const generateOtp = () => String(crypto.randomInt(100000, 999999))
const hashOtp = (otp) => crypto.createHash('sha256').update(String(otp)).digest('hex')

const maskEmail = (email) => {
  const [local, domain] = String(email).split('@')
  if (!domain) return null
  return `${local.slice(0, 2)}••••@${domain}`
}
const maskPhone = (phone) => (phone ? `••••••${String(phone).slice(-4)}` : null)

async function sendLoginOtp({ email, contactNumber }, otp, insurerName) {
  const destination = maskEmail(email) || maskPhone(contactNumber)
  if (!(process.env.OTP_EMAIL_USER && process.env.OTP_EMAIL_PASSWORD) || !email) {
    console.log(`[Patient app] No e-mail delivery configured — sign-in code shown on screen: ${otp}`)
    return { sent: false, devMode: true, destination }
  }
  try {
    const nodemailer = require('nodemailer')
    const transport = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.OTP_EMAIL_USER, pass: process.env.OTP_EMAIL_PASSWORD },
    })
    await transport.sendMail({
      from: `"${insurerName}" <${process.env.OTP_EMAIL_USER}>`,
      to: email,
      subject: `Your sign-in code: ${otp}`,
      text: `Your code to sign in to the ${insurerName} patient app is ${otp}. It is valid for 10 minutes.\n\n` +
        'If you did not try to sign in, ignore this e-mail and do not share the code.',
      html: `<p>Your code to sign in to the ${insurerName} patient app is ` +
        `<strong style="font-size:20px">${otp}</strong>. It is valid for 10 minutes.</p>` +
        '<p style="color:#6b7280">If you did not try to sign in, ignore this e-mail and do not share the code.</p>',
    })
    return { sent: true, devMode: false, destination }
  } catch (err) {
    console.warn(`[Patient app] E-mail failed, showing the code on screen instead: ${err.message}`)
    return { sent: false, devMode: true, destination }
  }
}

module.exports = { generateOtp, hashOtp, sendLoginOtp }

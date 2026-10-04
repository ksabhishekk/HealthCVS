/**
 * Offline checks for Indian identifiers.
 *
 * These prove an identifier is well-formed — and, for GSTIN, internally
 * consistent through its check character — not that it belongs to anyone.
 * Live verification needs the issuing systems (Income Tax / GSTN for PAN and
 * GSTIN, NHA's Beneficiary Identification System for PM-JAY, ABDM for ABHA),
 * which require registered-entity access a prototype cannot get. Every result
 * says which kind of check ran.
 */

const PAN_HOLDER = {
  P: 'Individual',
  C: 'Company',
  H: 'Hindu Undivided Family',
  F: 'Firm / LLP',
  A: 'Association of Persons',
  T: 'Trust',
  B: 'Body of Individuals',
  L: 'Local Authority',
  J: 'Artificial Juridical Person',
  G: 'Government',
}

function checkPan(value) {
  const pan = String(value || '').trim().toUpperCase()
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
    return { valid: false, message: 'PAN must be 5 letters, 4 digits and a letter (e.g. AAACA1234C)' }
  }
  const holderCode = pan[3]
  if (!PAN_HOLDER[holderCode]) {
    return { valid: false, message: `The 4th character "${holderCode}" is not a valid PAN holder type` }
  }
  return { valid: true, pan, holderCode, holderType: PAN_HOLDER[holderCode], message: `Format valid — holder type: ${PAN_HOLDER[holderCode]}` }
}

// GSTIN check character: base-36 Luhn ("mod 36") over the first 14 characters.
const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
function gstinCheckChar(first14) {
  let factor = 2
  let sum = 0
  for (let i = first14.length - 1; i >= 0; i--) {
    let code = GST_CHARS.indexOf(first14[i]) * factor
    factor = factor === 2 ? 1 : 2
    code = Math.floor(code / 36) + (code % 36)
    sum += code
  }
  return GST_CHARS[(36 - (sum % 36)) % 36]
}

function checkGstin(value) {
  const gstin = String(value || '').trim().toUpperCase()
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
    return { valid: false, message: 'GSTIN must be 15 characters: state code, PAN, entity number, Z, check character' }
  }
  const state = Number(gstin.slice(0, 2))
  if (!((state >= 1 && state <= 38) || state === 97 || state === 99)) {
    return { valid: false, message: `"${gstin.slice(0, 2)}" is not a GST state code` }
  }
  const pan = gstin.slice(2, 12)
  if (!checkPan(pan).valid) return { valid: false, message: 'The PAN inside the GSTIN is not valid' }
  const expected = gstinCheckChar(gstin.slice(0, 14))
  if (gstin[14] !== expected) {
    return { valid: false, message: 'Check character does not match — the GSTIN has a typo or was made up' }
  }
  return { valid: true, gstin, pan, stateCode: gstin.slice(0, 2), message: 'Format and check character valid' }
}

function checkAbha(value) {
  const abha = String(value || '').trim()
  const valid = /^\d{2}-\d{4}-\d{4}-\d{4}$/.test(abha) || /^\d{14}$/.test(abha)
  return valid
    ? { valid: true, message: 'Format valid (14-digit ABHA number)' }
    : { valid: false, message: 'ABHA number must be 14 digits, written XX-XXXX-XXXX-XXXX' }
}

function checkPmjayId(value) {
  const id = String(value || '').trim().toUpperCase()
  return /^[A-Z0-9]{9}$/.test(id)
    ? { valid: true, message: 'Format valid (9-character PM-JAY ID)' }
    : { valid: false, message: 'PM-JAY ID must be 9 letters or digits' }
}

function checkRationCard(value) {
  const id = String(value || '').trim()
  return /^\d{10,12}$/.test(id)
    ? { valid: true, message: 'Format valid' }
    : { valid: false, message: 'Ration card number must be 10 to 12 digits (formats vary by state)' }
}

const CHECKS = { pan: checkPan, gstin: checkGstin, abha: checkAbha, pmjay: checkPmjayId, ration_card: checkRationCard }

module.exports = { checkPan, checkGstin, gstinCheckChar, checkAbha, checkPmjayId, checkRationCard, CHECKS, PAN_HOLDER }

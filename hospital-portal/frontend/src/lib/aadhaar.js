// Client-side mirror of the backend Aadhaar check (services/aadhaar.js), so a
// clerk sees an invalid number immediately instead of after submitting.
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]

export const isValidAadhaar = (number) => {
  const s = String(number || "")
  if (!/^[2-9]\d{11}$/.test(s)) return false
  let c = 0
  const digits = s.split("").reverse()
  for (let i = 0; i < digits.length; i++) c = D[c][P[i % 8][Number(digits[i])]]
  return c === 0
}

export const AADHAAR_INVALID_MESSAGE =
  "Not a valid Aadhaar number — it must start with 2-9 and end in a valid check digit."

// A person's PAN: 5 letters, 4 digits, a letter — and "P" as the 4th character,
// which marks an individual (C = company, F = firm, and so on).
export const isIndividualPan = (pan) => /^[A-Z]{3}P[A-Z][0-9]{4}[A-Z]$/.test(String(pan || '').toUpperCase())
export const PAN_INVALID_MESSAGE = 'Not a valid individual PAN — 5 letters, 4 digits, a letter, with "P" as the 4th character.'

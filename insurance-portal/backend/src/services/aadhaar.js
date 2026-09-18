// Aadhaar number validation.
//
// UIDAI issues 12-digit numbers whose first digit is 2-9 (0 and 1 are reserved)
// and whose 12th digit is a Verhoeff checksum. Previously only "is it 12
// digits" was checked, so fabricated numbers such as 111111111111 were accepted.
// This does not prove a person exists — that needs UIDAI e-KYC, which requires
// an AUA/KUA licence — but it rejects numbers that cannot be real.
//
// ENFORCE_AADHAAR_CHECKSUM=false disables enforcement for legacy test data.

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

const verhoeffValid = (number) => {
  let c = 0
  const digits = String(number).split("").reverse()
  for (let i = 0; i < digits.length; i++) c = D[c][P[i % 8][Number(digits[i])]]
  return c === 0
}

const isValidAadhaar = (number) => /^[2-9]\d{11}$/.test(String(number || "")) && verhoeffValid(number)

const aadhaarChecksumEnforced = () => process.env.ENFORCE_AADHAAR_CHECKSUM !== "false"

const AADHAAR_INVALID_MESSAGE =
  "This is not a valid Aadhaar number — Aadhaar numbers start with 2-9 and end in a Verhoeff check digit."

module.exports = { verhoeffValid, isValidAadhaar, aadhaarChecksumEnforced, AADHAAR_INVALID_MESSAGE }

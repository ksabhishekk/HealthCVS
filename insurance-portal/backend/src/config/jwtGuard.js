// Refuses to run quietly on a guessable JWT signing secret.
//
// The committed .env.example shipped a working placeholder secret, and both
// portals were running on exactly that value — so anyone who had read the
// public repository could sign a valid admin token and log in without a
// password. This warns loudly in development and refuses to start in production.

const COMMON_PLACEHOLDERS = ['secret', 'changeme', 'jwt_secret', 'your_jwt_secret', 'your-secret-key']

module.exports = function checkJwtSecret(portal) {
  const secret = process.env.JWT_SECRET || ''
  const weak =
    secret.length < 32 ||
    /^change/i.test(secret) ||
    COMMON_PLACEHOLDERS.includes(secret.toLowerCase())
  if (!weak) return

  const fix = 'node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
  if (process.env.NODE_ENV === 'production') {
    console.error(`[${portal}] JWT_SECRET is missing, too short, or a known placeholder. Refusing to start. Generate one with: ${fix}`)
    process.exit(1)
  }
  console.warn(`\n[${portal}] WARNING: JWT_SECRET is missing, too short, or a known placeholder — anyone who has read the repository can forge login tokens. Generate one with:\n  ${fix}\n`)
}

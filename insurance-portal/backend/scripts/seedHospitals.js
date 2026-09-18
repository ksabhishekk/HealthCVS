/**
 * Empanels a hospital so claims from it can be verified.
 *
 *   npm run seed:hospitals
 *   npm run seed:hospitals -- --code CGH001 --name "City General Hospital" --wallet 0xabc...
 *
 * With no arguments it reads HOSPITAL_CODE, HOSPITAL_NAME and the wallet derived
 * from HOSPITAL_WALLET_PRIVATE_KEY out of ../../hospital-portal/backend/.env —
 * so on a local setup where both portals live in this repo it registers the
 * hospital that will actually sign claims, whatever Ganache accounts that
 * machine happens to have. The private key is only used to derive the address.
 */
const dns = require('node:dns')
dns.setServers(['8.8.8.8', '1.1.1.1'])

const fs = require('fs')
const path = require('path')
const dotenv = require('dotenv')
dotenv.config({ path: path.join(__dirname, '../.env') })

const mongoose = require('mongoose')
const { ethers } = require('ethers')
const EmpanelledHospital = require('../src/models/EmpanelledHospital')

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}

function hospitalPortalDefaults() {
  const envPath = path.join(__dirname, '../../../hospital-portal/backend/.env')
  if (!fs.existsSync(envPath)) return {}
  const env = dotenv.parse(fs.readFileSync(envPath))
  let wallet
  try {
    if (env.HOSPITAL_WALLET_PRIVATE_KEY) wallet = new ethers.Wallet(env.HOSPITAL_WALLET_PRIVATE_KEY).address
  } catch {}
  return { code: env.HOSPITAL_CODE, name: env.HOSPITAL_NAME, wallet }
}

async function main() {
  const defaults = hospitalPortalDefaults()
  const code = arg('code') || defaults.code
  const name = arg('name') || defaults.name
  const wallet = arg('wallet') || defaults.wallet

  if (!code || !name || !wallet) {
    throw new Error('Need a hospital code, name and wallet — pass --code --name --wallet, or run from a checkout that has hospital-portal/backend/.env')
  }
  if (!ethers.isAddress(wallet)) throw new Error(`Not a valid wallet address: ${wallet}`)

  await mongoose.connect(process.env.MONGODB_URI)
  const hospital = await EmpanelledHospital.findOneAndUpdate(
    { code: code.toUpperCase() },
    {
      $set: { name, status: 'active' },
      $addToSet: { registeredWallets: wallet.toLowerCase() },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
  console.log(`Empanelled ${hospital.name} (${hospital.code})`)
  console.log(`Registered wallets: ${hospital.registeredWallets.join(', ')}`)
  await mongoose.disconnect()
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})

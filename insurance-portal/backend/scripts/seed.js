const dns = require('node:dns')
dns.setServers(['8.8.8.8', '1.1.1.1'])

require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const mongoose = require('mongoose')
const User = require('../src/models/User')

const DEMO_USERS = [
  { name: 'Insurer Admin',   email: 'admin@insurer.com',    password: 'Admin@1234',    role: 'admin',    department: 'Administration', employeeId: 'INS-ADM-001' },
  { name: 'Senior Reviewer', email: 'reviewer@insurer.com', password: 'Reviewer@1234', role: 'reviewer', department: 'Review Board',   employeeId: 'INS-REV-001' },
  { name: 'Finance Officer', email: 'finance@insurer.com',  password: 'Finance@1234',  role: 'finance',  department: 'Finance',        employeeId: 'INS-FIN-001' },
]

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/healthcvs_insurance')
  console.log('Connected to MongoDB')

  for (const userData of DEMO_USERS) {
    const existing = await User.findOne({ email: userData.email })
    if (!existing) {
      await User.create(userData)
      console.log(`Created ${userData.role}: ${userData.email} / ${userData.password}`)
    } else {
      console.log(`Already exists: ${userData.email}`)
    }
  }

  await mongoose.disconnect()
  console.log('Seeding complete.')
}

seed().catch((err) => {
  console.error(err)
  process.exit(1)
})

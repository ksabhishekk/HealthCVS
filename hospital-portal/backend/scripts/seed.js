const dns = require('node:dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const mongoose = require('mongoose')
const User = require('../src/models/User')

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/healthcvs_hospital')
  console.log('Connected to MongoDB')

  const admin = await User.findOne({ email: 'admin@hospital.com' })
  if (!admin) {
    await User.create({
      name: 'Hospital Admin',
      email: 'admin@hospital.com',
      password: 'Admin@1234',
      role: 'admin',
      department: 'Administration',
      employeeId: 'ADMIN001',
    })
    console.log('Created admin: admin@hospital.com / Admin@1234')
  } else {
    console.log('Admin already exists')
  }

  const clerk = await User.findOne({ email: 'clerk@hospital.com' })
  if (!clerk) {
    await User.create({
      name: 'Demo Clerk',
      email: 'clerk@hospital.com',
      password: 'Clerk@1234',
      role: 'clerk',
      department: 'Claims',
      employeeId: 'CLK001',
    })
    console.log('Created clerk:  clerk@hospital.com / Clerk@1234')
  } else {
    console.log('Clerk already exists')
  }

  await mongoose.disconnect()
  console.log('Seeding complete.')
}

seed().catch((err) => {
  console.error(err)
  process.exit(1)
})

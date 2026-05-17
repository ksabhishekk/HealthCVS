// Run: node scripts/seedCatalog.js
// Seeds sample doctors and procedures for City General Hospital
const dns = require('node:dns')
dns.setServers(['8.8.8.8', '1.1.1.1'])
require('dotenv').config()
const mongoose = require('mongoose')
const Doctor = require('../src/models/Doctor')
const Procedure = require('../src/models/Procedure')

const DOCTORS = [
  { name: 'Dr. Anil Sharma',    department: 'Cardiology',                  specialization: 'Interventional Cardiology', registrationNumber: 'MCI-12345' },
  { name: 'Dr. Priya Menon',    department: 'General Surgery',             specialization: 'Laparoscopic Surgery',       registrationNumber: 'MCI-12346' },
  { name: 'Dr. Ravi Kumar',     department: 'Orthopaedics',                specialization: 'Joint Replacement',          registrationNumber: 'MCI-12347' },
  { name: 'Dr. Sunita Rao',     department: 'Gynaecology & Obstetrics',    specialization: 'Maternal-Fetal Medicine',    registrationNumber: 'MCI-12348' },
  { name: 'Dr. Manoj Verma',    department: 'Ophthalmology',               specialization: 'Cataract & Retina',          registrationNumber: 'MCI-12349' },
  { name: 'Dr. Kavita Singh',   department: 'ENT',                         specialization: 'Head & Neck Surgery',        registrationNumber: 'MCI-12350' },
  { name: 'Dr. Deepak Joshi',   department: 'Neurology',                   specialization: 'Stroke & Epilepsy',          registrationNumber: 'MCI-12351' },
  { name: 'Dr. Anita Patil',    department: 'Paediatrics',                 specialization: 'Neonatology',                registrationNumber: 'MCI-12352' },
  { name: 'Dr. Suresh Nair',    department: 'Urology',                     specialization: 'Endourology',                registrationNumber: 'MCI-12353' },
  { name: 'Dr. Meena Gupta',    department: 'General Medicine',            specialization: 'Internal Medicine',          registrationNumber: 'MCI-12354' },
]

const PROCEDURES = [
  { code: 'S030008', name: 'Cataract Surgery',                          category: 'Ophthalmology',    ceilingAmount: 10000  },
  { code: 'S040001', name: 'Tonsillectomy',                             category: 'ENT',              ceilingAmount: 15000  },
  { code: 'S050002', name: 'Appendectomy',                              category: 'General Surgery',  ceilingAmount: 20000  },
  { code: 'S060001', name: 'Hernia Repair',                             category: 'General Surgery',  ceilingAmount: 25000  },
  { code: 'S060002', name: 'Cholecystectomy (Gallbladder Removal)',     category: 'General Surgery',  ceilingAmount: 30000  },
  { code: 'S060003', name: 'Hysterectomy',                              category: 'Gynaecology',      ceilingAmount: 35000  },
  { code: 'S060004', name: 'C-Section Delivery',                        category: 'Gynaecology',      ceilingAmount: 25000  },
  { code: 'S060005', name: 'Total Knee Replacement',                    category: 'Orthopaedics',     ceilingAmount: 80000  },
  { code: 'S060006', name: 'Total Hip Replacement',                     category: 'Orthopaedics',     ceilingAmount: 90000  },
  { code: 'S070001', name: 'Coronary Artery Bypass Grafting (CABG)',    category: 'Cardiology',       ceilingAmount: 100000 },
  { code: 'S070002', name: 'Coronary Angioplasty (PTCA)',               category: 'Cardiology',       ceilingAmount: 70000  },
  { code: 'S080001', name: 'Dialysis (per session)',                    category: 'Nephrology',       ceilingAmount: 2000   },
  { code: 'S090001', name: 'Chemotherapy (per cycle)',                  category: 'Oncology',         ceilingAmount: 50000  },
  { code: 'S100001', name: 'Craniotomy',                                category: 'Neurology',        ceilingAmount: 150000 },
  { code: 'S110001', name: 'General Anaesthesia',                       category: 'Anaesthesiology',  ceilingAmount: 10000  },
]

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('Connected to MongoDB')

  let doctorCount = 0
  for (const doc of DOCTORS) {
    try {
      await Doctor.create(doc)
      doctorCount++
    } catch (e) {
      if (e.code === 11000) {
        console.log(`  Skip (exists): ${doc.name}`)
      } else {
        console.error(`  Error seeding ${doc.name}:`, e.message)
      }
    }
  }
  console.log(`Seeded ${doctorCount} doctors`)

  let procCount = 0
  for (const proc of PROCEDURES) {
    try {
      await Procedure.create(proc)
      procCount++
    } catch (e) {
      if (e.code === 11000) {
        console.log(`  Skip (exists): ${proc.code}`)
      } else {
        console.error(`  Error seeding ${proc.code}:`, e.message)
      }
    }
  }
  console.log(`Seeded ${procCount} procedures`)

  await mongoose.disconnect()
  console.log('Done.')
}

seed().catch(err => { console.error(err); process.exit(1) })

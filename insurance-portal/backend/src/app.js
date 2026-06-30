const dns = require('node:dns')
dns.setServers(['8.8.8.8', '1.1.1.1'])

require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { connectDB } = require('./config/db')

const app = express()

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5174',
  credentials: true,
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use('/api/auth', require('./routes/auth'))
app.use('/api/claims', require('./routes/claims'))
app.use('/api/patients', require('./routes/patients'))
app.use('/api/staff', require('./routes/staff'))
app.use('/api/policy', require('./routes/policy'))

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }))

app.use((err, req, res, _next) => {
  console.error(err.stack)
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
})

const PORT = process.env.PORT || 5001

const { startOracleListener } = require('./oracleWorker')

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Insurer Portal API running on port ${PORT}`)
    console.log(`Insurer: ${process.env.INSURER_NAME} (${process.env.INSURER_CODE})`)
  })

  // Start blockchain oracle — listens for DoctorAuthenticated events
  // and triggers the AI fraud scoring pipeline (TX4)
  startOracleListener()
})


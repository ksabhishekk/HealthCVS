const dns = require('node:dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { connectDB } = require('./config/db')

const app = express()

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use('/api/auth', require('./routes/auth'))
app.use('/api/patients', require('./routes/patients'))
app.use('/api/claims', require('./routes/claims'))
app.use('/api/documents', require('./routes/documents'))
app.use('/api/staff', require('./routes/staff'))

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }))

app.use((err, req, res, _next) => {
  console.error(err.stack)
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
})

const PORT = process.env.PORT || 5000

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Hospital Portal API running on port ${PORT}`)
    console.log(`Hospital: ${process.env.HOSPITAL_NAME} (${process.env.HOSPITAL_CODE})`)
  })
})

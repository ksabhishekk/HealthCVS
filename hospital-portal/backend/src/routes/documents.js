const express = require('express')
const multer = require('multer')
const { authenticate } = require('../middleware/auth')
const { uploadToPinata, ipfsGatewayUrl } = require('../services/pinata')

const router = express.Router()
router.use(authenticate)

const storage = multer.memoryStorage()
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    if (allowed.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Only PDF and images (JPEG, PNG, WEBP) are allowed'))
    }
  },
})

// POST /api/documents/upload
// Upload a single document to IPFS and return its CID
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' })

  try {
    const cid = await uploadToPinata(req.file.buffer, req.file.originalname, req.file.mimetype)
    res.json({
      cid,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      url: ipfsGatewayUrl(cid),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Multer error handler
router.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${err.message}` })
  }
  res.status(400).json({ error: err.message })
})

module.exports = router

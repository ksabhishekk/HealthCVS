const mongoose = require('mongoose')

const doctorSchema = new mongoose.Schema({
  name:               { type: String, required: true, trim: true },
  department:         { type: String, required: true },
  specialization:     { type: String, trim: true },
  registrationNumber: { type: String, trim: true, unique: true, sparse: true },
  walletAddress:      { type: String, trim: true },
  isActive:           { type: Boolean, default: true },
  addedBy:            { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

doctorSchema.index({ name: 'text' })

module.exports = mongoose.model('Doctor', doctorSchema)

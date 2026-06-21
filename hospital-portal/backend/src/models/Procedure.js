const mongoose = require('mongoose')

const procedureSchema = new mongoose.Schema({
  code:          { type: String, required: true, unique: true, trim: true, uppercase: true },
  name:          { type: String, required: true, trim: true },
  category:      { type: String, trim: true },
  ceilingAmount: { type: Number, default: 0 },
  isActive:      { type: Boolean, default: true },
  addedBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

procedureSchema.index({ name: 'text' })

module.exports = mongoose.model('Procedure', procedureSchema)

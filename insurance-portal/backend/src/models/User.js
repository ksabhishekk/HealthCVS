const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  // Insurer roles: analyst reviews fraud scores, adjudicator runs TX5, reviewer does TX6, finance does TX7
  role: { type: String, enum: ['admin', 'analyst', 'adjudicator', 'reviewer', 'finance'], default: 'analyst' },
  department: { type: String, trim: true },
  employeeId: { type: String, trim: true },
  isActive: { type: Boolean, default: true },
  lastLogin: Date,
}, { timestamps: true })

UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next()
  this.password = await bcrypt.hash(this.password, 12)
  next()
})

UserSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password)
}

UserSchema.methods.toSafeObject = function () {
  const obj = this.toObject()
  delete obj.password
  return obj
}

module.exports = mongoose.model('User', UserSchema)

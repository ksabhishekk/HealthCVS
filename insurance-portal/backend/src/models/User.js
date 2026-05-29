const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  // TX4 + TX5 are ML oracle hooks — only admin can trigger manually; TX6 = reviewer, TX7 = finance
  role: { type: String, enum: ['admin', 'reviewer', 'finance'], default: 'reviewer' },
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

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a name'],
      trim: true,
      maxlength: [50, 'Name cannot exceed 50 characters'],
    },
    email: {
      type: String,
      required: [true, 'Please provide an email'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },
    passwordHash: {
      type: String,
      required: [true, 'Please provide a password'],
      minlength: [6, 'Password must be at least 6 characters'],
    },
    role: {
      type: String,
      enum: ['student', 'admin'],
      default: 'student',
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // Store createdAt as required
  }
);

// Indexes: email is unique
// userSchema.index({ email: 1 }, { unique: true }); // Handled by unique: true on field

/**
 * Compare candidate password with stored bcrypt hash
 */
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

/**
 * Sign JWT token for the user containing id, email, and role
 */
userSchema.methods.generateAuthToken = function () {
  return jwt.sign(
    {
      userId: this._id,
      email: this.email,
      role: this.role,
    },
    process.env.JWT_SECRET || 'codejudge_super_secret_jwt_key_change_in_production',
    {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    }
  );
};

/**
 * Sanitize user object to never return passwordHash in API responses
 */
userSchema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.passwordHash;
  return user;
};

const User = mongoose.model('User', userSchema);

module.exports = User;

import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    role: { type: String, enum: ['admin', 'manager', 'staff'], required: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
    managerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    passwordHash: { type: String, required: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' }
  },
  { timestamps: true }
);

export const User = mongoose.model('User', userSchema);

import mongoose from 'mongoose';

const reportSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    month: { type: Number, required: true },
    year: { type: Number, required: true },
    stats: { type: Object, default: {} },
    fileUrl: { type: String },
    generatedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

export const Report = mongoose.model('Report', reportSchema);

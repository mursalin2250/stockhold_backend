import mongoose from 'mongoose';

const companySchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    phoneSecondary: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

export default mongoose.model('Company', companySchema);

import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    note: { type: String, trim: true, default: '' },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    paidAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const supplierSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Supplier name is required'],
      trim: true,
    },
    bankAccount: {
      type: String,
      trim: true,
      default: '',
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    address: {
      type: String,
      required: [true, 'Supplier address is required'],
      trim: true,
    },
    // Payments recorded against purchases from this supplier
    payments: {
      type: [paymentSchema],
      default: [],
    },
    // Opening / adjusted due. totalDue = max(0, openingDue + purchased - paid)
    openingDue: {
      type: Number,
      default: 0,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

supplierSchema.index({ name: 'text', phone: 'text', address: 'text', bankAccount: 'text' });

export default mongoose.model('Supplier', supplierSchema);

import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    note: { type: String, trim: true, default: '' },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    paidAt: { type: Date, default: Date.now },
    // Optional link when payment was applied toward a specific sale
    sale: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null },
  },
  { _id: true }
);

const customerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Customer name is required'],
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    // Kept for backward compatibility with older records
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    bankAccount: {
      type: String,
      trim: true,
      default: '',
    },
    address: {
      type: String,
      trim: true,
      default: '',
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    // Opening / adjusted due. totalDue = max(0, openingDue + sum(sale.amountDue))
    openingDue: {
      type: Number,
      default: 0,
    },
    // Full payment history (like suppliers) — stores the exact amount paid each time
    payments: {
      type: [paymentSchema],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

customerSchema.index({ name: 'text', phone: 'text', email: 'text', address: 'text', bankAccount: 'text' });

export default mongoose.model('Customer', customerSchema);

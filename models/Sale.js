import mongoose from 'mongoose';

// A single line item within a sale. Product name/sku/unit are snapshotted at
// the time of sale so the sale record stays accurate even if the product is
// later renamed, re-priced, or deleted.
const saleItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    name: { type: String, required: true },
    sku: { type: String, required: true },
    unit: { type: String, default: 'pcs' },
    quantity: {
      type: Number,
      required: true,
      min: [1, 'Quantity must be at least 1'],
    },
    unitPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
    },
    categoryName: {
      type: String,
      trim: true,
      default: '',
    },
    // Total weight for this line (kg). Nominal unit weight is 50kg;
    // 45–55kg still counts as 1 unit for stock.
    weight: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  { _id: false }
);

const saleSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, 'Customer is required'],
    },
    items: {
      type: [saleItemSchema],
      validate: {
        validator: (items) => Array.isArray(items) && items.length > 0,
        message: 'A sale must include at least one product',
      },
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    amountPaid: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    amountDue: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    payments: {
      type: [
        {
          amount: { type: Number, required: true, min: 0.01 },
          date: { type: Date, default: Date.now },
          note: { type: String, trim: true, default: '' },
          recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        },
      ],
      default: [],
    },
    saleDate: {
      type: Date,
      default: Date.now,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

saleSchema.index({ customer: 1, createdAt: -1 });

export default mongoose.model('Sale', saleSchema);

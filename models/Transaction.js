import mongoose from 'mongoose';

// One invoice line attached to a stock movement (mainly for stock-in purchases).
// Calculated fields (totalWeight, totalPrice, netPrice) are stored so the user
// can override them when the real shipment price differs from the formula.
const invoiceLineSchema = new mongoose.Schema(
  {
    productName: {
      type: String,
      trim: true,
      default: '',
    },
    salesNumber: {
      type: String,
      trim: true,
      default: '',
    },
    supplier: {
      type: String,
      trim: true,
      default: '',
    },
    invoiceNo: {
      type: String,
      trim: true,
      default: '',
    },
    lotNumber: {
      type: String,
      trim: true,
      default: '',
    },
    category: {
      type: String,
      trim: true,
      default: '',
    },
    quantity: {
      type: Number,
      min: 0,
      default: 0,
    },
    // Weight per unit (e.g. kg)
    weight: {
      type: Number,
      min: 0,
      default: 0,
    },
    // quantity × weight (user-overridable)
    totalWeight: {
      type: Number,
      min: 0,
      default: 0,
    },
    // Price per kg
    price: {
      type: Number,
      min: 0,
      default: 0,
    },
    // price × totalWeight (user-overridable)
    totalPrice: {
      type: Number,
      min: 0,
      default: 0,
    },
    gst: {
      type: Number,
      min: 0,
      default: 0,
    },
    // totalPrice + gst (user-overridable)
    netPrice: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  { _id: false }
);

const transactionSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    // stock-in: goods received; stock-out: goods sold/issued; adjustment: manual correction
    type: {
      type: String,
      enum: ['stock-in', 'stock-out', 'adjustment'],
      required: true,
    },
    quantity: {
      type: Number,
      required: [true, 'Quantity is required'],
      min: 1,
    },
    // quantity on hand right after this transaction was applied, for audit trail purposes
    quantityAfter: {
      type: Number,
      required: true,
    },
    reason: {
      type: String,
      trim: true,
      default: '',
    },
    reference: {
      // optional PO number, invoice number, order id, etc.
      type: String,
      trim: true,
      default: '',
    },
    salesNumber: {
      type: String,
      trim: true,
      default: '',
    },
    supplier: {
      type: String,
      trim: true,
      default: '',
    },
    promptDate: {
      type: Date,
      default: null,
    },
    saleDate: {
      type: Date,
      default: null,
    },
    // Optional purchase / invoice details (typically used for stock-in)
    invoices: {
      type: [invoiceLineSchema],
      default: [],
    },
    // Convenience: sum of netPrice across all invoice lines (buying cost of this movement)
    totalBuyingPrice: {
      type: Number,
      min: 0,
      default: 0,
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

transactionSchema.index({ product: 1, createdAt: -1 });
transactionSchema.index({ createdAt: -1 });
transactionSchema.index({ type: 1, createdAt: -1 });

export default mongoose.model('Transaction', transactionSchema);

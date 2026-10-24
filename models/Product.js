import mongoose from 'mongoose';

const variantSchema = new mongoose.Schema(
  {
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'Category is required for each product line'],
    },
    sellingPrice: {
      type: Number,
      required: [true, 'Selling price is required'],
      min: 0,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    reorderLevel: {
      type: Number,
      default: 10,
      min: 0,
    },
    // Weight of one unit (e.g. kg per bag) — editable per category line
    weightPerUnit: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  { _id: true }
);

variantSchema.virtual('stockStatus').get(function getVariantStockStatus() {
  if (this.quantity <= 0) return 'out-of-stock';
  if (this.quantity <= this.reorderLevel) return 'low-stock';
  return 'in-stock';
});

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
    },
    sku: {
      type: String,
      required: [true, 'SKU is required'],
      unique: true,
      trim: true,
      uppercase: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
    },
    unit: {
      type: String,
      default: 'kg',
      trim: true,
    },
    // Category-wise stock & pricing lines
    variants: {
      type: [variantSchema],
      default: [],
      validate: {
        validator(v) {
          return Array.isArray(v) && v.length > 0;
        },
        message: 'Add at least one category line',
      },
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

productSchema.virtual('quantity').get(function totalQty() {
  return (this.variants || []).reduce((s, v) => s + (Number(v.quantity) || 0), 0);
});

productSchema.virtual('sellingPrice').get(function minPrice() {
  const prices = (this.variants || []).map((v) => Number(v.sellingPrice) || 0);
  if (!prices.length) return 0;
  return Math.min(...prices);
});

productSchema.virtual('stockStatus').get(function overallStatus() {
  const variants = this.variants || [];
  if (!variants.length) return 'out-of-stock';
  const statuses = variants.map((v) => {
    if (v.quantity <= 0) return 'out-of-stock';
    if (v.quantity <= v.reorderLevel) return 'low-stock';
    return 'in-stock';
  });
  if (statuses.every((s) => s === 'out-of-stock')) return 'out-of-stock';
  if (statuses.some((s) => s === 'out-of-stock' || s === 'low-stock')) return 'low-stock';
  return 'in-stock';
});

productSchema.set('toJSON', { virtuals: true });
productSchema.set('toObject', { virtuals: true });

productSchema.index({ name: 'text', sku: 'text' });
productSchema.index({ 'variants.category': 1 });

export default mongoose.model('Product', productSchema);

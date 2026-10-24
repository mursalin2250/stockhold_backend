import Product from '../models/Product.js';
import Transaction from '../models/Transaction.js';
import Category from '../models/Category.js';
import { asyncHandler } from '../middleware/errorHandler.js';

/** Estimate opening stock value for inventory (stock log uses totalBuyingPrice). */
function estimateLineValue(quantity, weightPerUnit, sellingPricePerKg) {
  const qty = Math.max(0, Number(quantity) || 0);
  const weight = Math.max(0, Number(weightPerUnit) || 0);
  const price = Math.max(0, Number(sellingPricePerKg) || 0);
  if (qty <= 0 || price <= 0) return 0;
  // sellingPrice is per kg; prefer qty × weight × price, else qty × price
  const totalWeight = weight > 0 ? qty * weight : qty;
  return Math.ceil(totalWeight * price);
}

async function categoryName(categoryId) {
  if (!categoryId) return '';
  try {
    const cat = await Category.findById(categoryId);
    return cat?.name || '';
  } catch {
    return '';
  }
}

/**
 * Write stock-in rows so dashboard inventory value (sum of totalBuyingPrice) includes this stock.
 */
async function logOpeningStockIn({ product, variants, userId, reason = 'Initial stock on product create' }) {
  const list = variants || product.variants || [];
  let runningTotal = (product.variants || []).reduce((s, v) => s + (Number(v.quantity) || 0), 0);
  // If we're logging at create time, runningTotal is already the full qty
  for (const v of list) {
    const qty = Math.max(0, Number(v.quantity) || 0);
    if (qty <= 0) continue;

    const weightPer = Math.max(0, Number(v.weightPerUnit) || 0);
    const pricePerKg = Math.max(0, Number(v.sellingPrice) || 0);
    const netPrice = estimateLineValue(qty, weightPer, pricePerKg);
    const totalWeight = weightPer > 0 ? qty * weightPer : qty;
    const catName = await categoryName(v.category);

    await Transaction.create({
      product: product._id,
      type: 'stock-in',
      quantity: qty,
      quantityAfter: runningTotal,
      reason,
      reference: 'Opening stock',
      invoices: [
        {
          productName: product.name,
          category: catName,
          quantity: qty,
          weight: weightPer,
          totalWeight,
          price: pricePerKg,
          totalPrice: netPrice,
          gst: 0,
          netPrice,
        },
      ],
      totalBuyingPrice: netPrice,
      performedBy: userId,
    });
  }
}


function normalizeVariants(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }
  return raw.map((v) => ({
    category: v.category,
    sellingPrice: Number(v.sellingPrice) || 0,
    quantity: Math.max(0, Number(v.quantity) || 0),
    reorderLevel: Math.max(0, Number(v.reorderLevel) || 0),
    weightPerUnit: Math.max(0, Number(v.weightPerUnit) || 0),
    ...(v._id ? { _id: v._id } : {}),
  }));
}

// @desc    Get all products
// @route   GET /api/products
// @access  Private
export const getProducts = asyncHandler(async (req, res) => {
  const { search, category, supplier, stockStatus, page = 1, limit = 20 } = req.query;

  const query = {};

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { sku: { $regex: search, $options: 'i' } },
    ];
  }
  if (category) query['variants.category'] = category;
  if (supplier) query.supplier = supplier;

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const skip = (pageNum - 1) * limitNum;

  let products = await Product.find(query)
    .populate('variants.category', 'name')
    .populate('supplier', 'name')
    .sort({ createdAt: -1 });

  if (stockStatus) {
    products = products.filter((p) => p.stockStatus === stockStatus);
  }

  const total = products.length;
  const paginated = products.slice(skip, skip + limitNum);

  res.json({
    products: paginated,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.max(1, Math.ceil(total / limitNum)),
    },
  });
});

// @desc    Get a single product
// @route   GET /api/products/:id
// @access  Private
export const getProductById = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id)
    .populate('variants.category', 'name')
    .populate('supplier', 'name');

  if (!product) {
    return res.status(404).json({ message: 'Product not found' });
  }
  res.json({ product });
});

// @desc    Create a product with one or more category lines
// @route   POST /api/products
// @access  Private/Admin/Manager
export const createProduct = asyncHandler(async (req, res) => {
  const { name, sku, description, supplier, unit, variants: rawVariants } = req.body;

  if (!name || !sku) {
    return res.status(400).json({ message: 'Name and SKU are required' });
  }

  const variants = normalizeVariants(rawVariants);
  if (!variants) {
    return res.status(400).json({ message: 'Add at least one category with selling price' });
  }
  for (const v of variants) {
    if (!v.category) {
      return res.status(400).json({ message: 'Each line needs a category' });
    }
  }

  const existing = await Product.findOne({ sku: String(sku).trim().toUpperCase() });
  if (existing) {
    return res.status(400).json({ message: 'A product with this SKU already exists' });
  }

  const product = await Product.create({
    name,
    sku: String(sku).trim().toUpperCase(),
    description: description || '',
    supplier: supplier || undefined,
    unit: unit || 'kg',
    variants,
    createdBy: req.user._id,
  });

  // Record opening stock-in so inventory value includes initial units
  const hasOpening = (product.variants || []).some((v) => (Number(v.quantity) || 0) > 0);
  if (hasOpening) {
    await logOpeningStockIn({
      product,
      variants: product.variants,
      userId: req.user._id,
      reason: 'Initial stock on product create',
    });
  }

  const populated = await Product.findById(product._id)
    .populate('variants.category', 'name')
    .populate('supplier', 'name');

  res.status(201).json({ product: populated });
});

// @desc    Update product (identity + variants pricing/reorder; quantity via stock log)
// @route   PUT /api/products/:id
// @access  Private/Admin/Manager
export const updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) {
    return res.status(404).json({ message: 'Product not found' });
  }

  if (req.body.name !== undefined) product.name = req.body.name;
  if (req.body.sku !== undefined) {
    const nextSku = String(req.body.sku).trim().toUpperCase();
    if (nextSku !== product.sku) {
      const clash = await Product.findOne({ sku: nextSku, _id: { $ne: product._id } });
      if (clash) {
        return res.status(400).json({ message: 'A product with this SKU already exists' });
      }
      product.sku = nextSku;
    }
  }
  if (req.body.description !== undefined) product.description = req.body.description;
  if (req.body.supplier !== undefined) product.supplier = req.body.supplier || undefined;
  if (req.body.unit !== undefined) product.unit = req.body.unit || 'kg';
  if (req.body.isActive !== undefined) product.isActive = req.body.isActive;

  if (req.body.variants !== undefined) {
    const incoming = normalizeVariants(req.body.variants);
    if (!incoming) {
      return res.status(400).json({ message: 'Add at least one category line' });
    }
    // Preserve quantities when updating existing variant ids; new lines start at given qty (edit usually 0)
    const byId = new Map(product.variants.map((v) => [String(v._id), v]));
    product.variants = incoming.map((v) => {
      if (v._id && byId.has(String(v._id))) {
        const prev = byId.get(String(v._id));
        return {
          _id: prev._id,
          category: v.category,
          sellingPrice: v.sellingPrice,
          reorderLevel: v.reorderLevel,
          weightPerUnit: v.weightPerUnit,
          // Allow explicit unit edits from product details; otherwise keep previous stock
          quantity:
            v.quantity !== undefined && v.quantity !== null ? v.quantity : prev.quantity,
        };
      }
      return {
        category: v.category,
        sellingPrice: v.sellingPrice,
        reorderLevel: v.reorderLevel,
        weightPerUnit: v.weightPerUnit || 0,
        quantity: v.quantity || 0,
      };
    });
  }

  await product.save();

  const populated = await Product.findById(product._id)
    .populate('variants.category', 'name')
    .populate('supplier', 'name');

  res.json({ product: populated });
});

// @desc    Delete a product
// @route   DELETE /api/products/:id
// @access  Private/Admin
export const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) {
    return res.status(404).json({ message: 'Product not found' });
  }
  await product.deleteOne();
  res.json({ message: 'Product deleted successfully' });
});

// @desc    Products / category lines that are low or out of stock
// @route   GET /api/products/alerts/low-stock
// @access  Private
export const getLowStockProducts = asyncHandler(async (req, res) => {
  const products = await Product.find({ isActive: true })
    .populate('variants.category', 'name')
    .populate('supplier', 'name')
    .sort({ name: 1 });

  const alerts = [];
  for (const p of products) {
    for (const v of p.variants || []) {
      const qty = Number(v.quantity) || 0;
      const reorder = Number(v.reorderLevel) || 0;
      if (qty <= reorder) {
        alerts.push({
          productId: p._id,
          name: p.name,
          sku: p.sku,
          category: v.category,
          variantId: v._id,
          quantity: qty,
          reorderLevel: reorder,
          stockStatus: qty <= 0 ? 'out-of-stock' : 'low-stock',
          unit: p.unit,
        });
      }
    }
  }

  res.json({ alerts, count: alerts.length });
});


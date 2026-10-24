import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Transaction from '../models/Transaction.js';
import { asyncHandler } from '../middleware/errorHandler.js';

// @desc    Get all transactions (supports filtering by product/type, pagination)
// @route   GET /api/transactions?product=&type=&page=&limit=
// @access  Private
export const getTransactions = asyncHandler(async (req, res) => {
  const { product, type, search, page = 1, limit = 20 } = req.query;

  const query = {};
  if (product) query.product = product;
  if (type) query.type = type;

  // Text search across product name/sku (via product ids) and invoice/reference fields
  if (search && String(search).trim()) {
    const term = String(search).trim();
    const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const matchingProducts = await Product.find({
      $or: [{ name: regex }, { sku: regex }],
    }).select('_id');
    const productIds = matchingProducts.map((p) => p._id);

    query.$or = [
      { product: { $in: productIds } },
      { reason: regex },
      { reference: regex },
      { 'invoices.invoiceNo': regex },
      { 'invoices.lotNumber': regex },
      { 'invoices.salesNumber': regex },
      { 'invoices.supplier': regex },
      { salesNumber: regex },
      { supplier: regex },
      { 'invoices.category': regex },
      { 'invoices.productName': regex },
    ];
  }

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const skip = (pageNum - 1) * limitNum;

  const [transactions, total] = await Promise.all([
    Transaction.find(query)
      .populate('product', 'name sku unit')
      .populate('performedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum),
    Transaction.countDocuments(query),
  ]);

  res.json({
    transactions,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

// @desc    Get a single transaction
// @route   GET /api/transactions/:id
// @access  Private
export const getTransactionById = asyncHandler(async (req, res) => {
  const transaction = await Transaction.findById(req.params.id)
    .populate('product', 'name sku unit')
    .populate('performedBy', 'name email');

  if (!transaction) {
    return res.status(404).json({ message: 'Transaction not found' });
  }
  res.json({ transaction });
});

// Normalize and lightly validate an invoices array from the request body.
function normalizeInvoices(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((line) => {
    const quantity = Number(line.quantity) || 0;
    const weight = Number(line.weight) || 0;
    const price = Number(line.price) || 0;
    const gst = Number(line.gst) || 0;

    // Prefer client-supplied calculated values (user may have overridden them).
    // Fall back to formula if the client left them blank / zero.
    let totalWeight = Number(line.totalWeight);
    if (Number.isNaN(totalWeight) || totalWeight === 0) {
      totalWeight = Math.ceil(quantity * weight);
    } else {
      totalWeight = Math.ceil(totalWeight);
    }

    let totalPrice = Number(line.totalPrice);
    if (Number.isNaN(totalPrice) || totalPrice === 0) {
      totalPrice = Math.ceil(price * totalWeight);
    } else {
      totalPrice = Math.ceil(totalPrice);
    }

    let netPrice = Number(line.netPrice);
    if (Number.isNaN(netPrice) || netPrice === 0) {
      // gst is a percentage: net = total + (total * gst / 100)
      netPrice = Math.ceil(totalPrice + (totalPrice * gst) / 100);
    } else {
      netPrice = Math.ceil(netPrice);
    }

    let date = null;
    if (line.date) {
      const parsed = new Date(line.date);
      if (!Number.isNaN(parsed.getTime())) date = parsed;
    }

    return {
      productName: (line.productName || '').trim(),
      salesNumber: (line.salesNumber || '').trim(),
      date,
      supplier: (line.supplier || '').trim(),
      invoiceNo: (line.invoiceNo || '').trim(),
      lotNumber: (line.lotNumber || '').trim(),
      category: (line.category || '').trim(),
      quantity,
      weight,
      totalWeight,
      price,
      totalPrice,
      gst,
      netPrice,
    };
  });
}

// @desc    Record a stock movement (stock-in, stock-out, or adjustment) and
//          atomically update the product's quantity
// @route   POST /api/transactions
// @access  Private (staff can do stock-in/out, admin/manager can also adjust)
export const createTransaction = asyncHandler(async (req, res) => {
  const { product: productId, type, quantity, reason, reference, salesNumber, supplier, promptDate, saleDate, invoices: rawInvoices } = req.body;

  if (!productId || !type || !quantity) {
    return res.status(400).json({ message: 'product, type and quantity are required' });
  }
  if (!['stock-in', 'stock-out', 'adjustment'].includes(type)) {
    return res.status(400).json({ message: 'type must be stock-in, stock-out, or adjustment' });
  }
  if (quantity <= 0) {
    return res.status(400).json({ message: 'quantity must be greater than 0' });
  }

  // Staff members are restricted to simple stock-in / stock-out movements;
  // only admins and managers may perform manual adjustments.
  if (type === 'adjustment' && req.user.role === 'staff') {
    return res.status(403).json({ message: 'Only admins and managers can record adjustments' });
  }

  // NOTE: this performs a sequential read-then-write rather than a multi-document
  // ACID transaction, so it works against a standalone MongoDB instance as well as
  // a replica set. If you deploy against a replica set / Atlas cluster and expect
  // heavy concurrent writes to the same product, consider wrapping this in a
  // mongoose session transaction (session.withTransaction) for stronger guarantees.
  const product = await Product.findById(productId);
  if (!product) {
    return res.status(404).json({ message: 'Product not found' });
  }
  if (!product.variants || product.variants.length === 0) {
    return res.status(400).json({ message: 'Product has no category lines to update stock for' });
  }

  const invoices = normalizeInvoices(rawInvoices);
  const qty = Number(quantity);

  // Resolve category for this movement (from invoice line name or id)
  const categoryRaw = (invoices[0]?.category || req.body.category || '').toString().trim();
  let variant = null;

  if (categoryRaw) {
    variant = product.variants.find((v) => String(v.category) === categoryRaw);
    if (!variant) {
      let cat = null;
      if (/^[a-f\d]{24}$/i.test(categoryRaw)) {
        cat = await Category.findById(categoryRaw);
      }
      if (!cat) {
        cat = await Category.findOne({ name: categoryRaw });
      }
      if (cat) {
        variant = product.variants.find((v) => String(v.category) === String(cat._id));
        invoices.forEach((inv) => {
          inv.category = cat.name;
        });
      }
    } else {
      const cat = await Category.findById(variant.category);
      if (cat) {
        invoices.forEach((inv) => {
          inv.category = cat.name;
        });
      }
    }
  }

  if (!variant) {
    if (product.variants.length === 1) {
      variant = product.variants[0];
      const cat = await Category.findById(variant.category);
      if (cat) {
        invoices.forEach((inv) => {
          if (!inv.category) inv.category = cat.name;
        });
      }
    } else {
      return res.status(400).json({
        message: 'Select a category that exists on this product so stock can be updated for the right line',
      });
    }
  }

  let newQuantity;
  if (type === 'stock-in') {
    variant.quantity += qty;
    newQuantity = variant.quantity;
  } else if (type === 'stock-out') {
    if (variant.quantity < qty) {
      return res.status(400).json({
        message: `Insufficient stock for this category: only ${variant.quantity} ${product.unit || 'kg'} available`,
      });
    }
    variant.quantity -= qty;
    newQuantity = variant.quantity;
  } else {
    variant.quantity = qty;
    newQuantity = variant.quantity;
  }

  await product.save();

  // Ensure product name is on each invoice line for historical display
  const invoicesWithName = invoices.map((inv) => ({
    ...inv,
    productName: inv.productName || product.name,
  }));
  const totalBuyingPrice = invoicesWithName.reduce(
    (sum, inv) => sum + (Number(inv.netPrice) || 0),
    0
  );

  const transaction = await Transaction.create({
    product: productId,
    type,
    quantity,
    quantityAfter: newQuantity,
    reason,
    reference,
    salesNumber: salesNumber || '',
    supplier: supplier || '',
    promptDate: promptDate || null,
    saleDate: saleDate || null,
    invoices: invoicesWithName,
    totalBuyingPrice,
    performedBy: req.user._id,
  });

  const populated = await Transaction.findById(transaction._id)
    .populate('product', 'name sku unit')
    .populate('performedBy', 'name email');

  res.status(201).json({ transaction: populated, product });
});

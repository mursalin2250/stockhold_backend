import Sale from '../models/Sale.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Customer from '../models/Customer.js';
import Transaction from '../models/Transaction.js';
import { asyncHandler } from '../middleware/errorHandler.js';


// @desc    Get all sales (supports filtering by customer, pagination)
// @route   GET /api/sales?customer=&page=&limit=
// @access  Private
export const getSales = asyncHandler(async (req, res) => {
  const { customer, page = 1, limit = 20 } = req.query;

  const query = {};
  if (customer) query.customer = customer;

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
  const skip = (pageNum - 1) * limitNum;

  const [sales, total] = await Promise.all([
    Sale.find(query)
      .populate('customer', 'name phone')
      .populate('createdBy', 'name')
      .sort({ saleDate: -1 })
      .skip(skip)
      .limit(limitNum),
    Sale.countDocuments(query),
  ]);

  res.json({
    sales,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

// @desc    Get a single sale with full details
// @route   GET /api/sales/:id
// @access  Private
export const getSaleById = asyncHandler(async (req, res) => {
  const sale = await Sale.findById(req.params.id)
    .populate('customer', 'name phone email')
    .populate('createdBy', 'name')
    .populate('payments.recordedBy', 'name');

  if (!sale) {
    return res.status(404).json({ message: 'Sale not found' });
  }
  res.json({ sale });
});

// @desc    Record a new sale: validates stock for every line item up front,
//          decrements product quantities, writes a stock-out Transaction for
//          each product (so the Stock Log stays the single source of truth
//          for stock movements), and stores the sale with its due balance.
// @route   POST /api/sales
// @access  Private
export const createSale = asyncHandler(async (req, res) => {
  const { customer: customerId, items, amountPaid = 0, notes, saleDate } = req.body;

  if (!customerId) {
    return res.status(400).json({ message: 'Customer is required' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'At least one product line item is required' });
  }

  const customer = await Customer.findById(customerId);
  if (!customer) {
    return res.status(404).json({ message: 'Customer not found' });
  }

  // Load every referenced product up front so we can validate stock for the
  // whole sale before mutating anything.
  const productIds = items.map((item) => item.product);
  const products = await Product.find({ _id: { $in: productIds } });
  const productMap = new Map(products.map((p) => [String(p._id), p]));

  const insufficientStock = [];
  const preparedItems = [];
  let totalAmount = 0;

  for (const item of items) {
    const product = productMap.get(String(item.product));
    const quantity = Number(item.quantity) || 0;
    // Keep exact weight (no rounding). Unit count drives stock; a bag of ~45–55kg is still 1 unit.
    const weight = Number(item.weight);

    if (!product) {
      return res.status(404).json({ message: `Product not found: ${item.product}` });
    }
    if (!quantity || quantity <= 0) {
      return res.status(400).json({ message: `Invalid quantity for ${product.name}` });
    }

    const variants = product.variants || [];
    if (!variants.length) {
      return res.status(400).json({ message: `${product.name} has no category stock lines` });
    }

    let variant = null;
    const categoryRaw = (item.category || '').toString().trim();
    if (categoryRaw) {
      variant = variants.find((v) => String(v.category) === categoryRaw);
      if (!variant) {
        let cat = null;
        if (/^[a-f\d]{24}$/i.test(categoryRaw)) cat = await Category.findById(categoryRaw);
        if (!cat) cat = await Category.findOne({ name: categoryRaw });
        if (cat) variant = variants.find((v) => String(v.category) === String(cat._id));
      }
    }
    if (!variant && variants.length === 1) {
      variant = variants[0];
    }
    if (!variant) {
      return res.status(400).json({
        message: `Select a category for ${product.name}`,
      });
    }

    const available = Number(variant.quantity) || 0;
    if (available < quantity) {
      insufficientStock.push(
        `${product.name} / category (have ${available} ${product.unit || 'kg'}, need ${quantity})`
      );
    }

    const defaultPrice = variant.sellingPrice ?? product.sellingPrice ?? 0;
    // unitPrice is price per kg; line total = weight (kg) × price per kg
    const unitPrice = item.unitPrice !== undefined && item.unitPrice !== '' ? Number(item.unitPrice) : defaultPrice;
    const lineWeight = weight > 0 ? weight : quantity * 50;
    const subtotal = unitPrice * lineWeight;
    totalAmount += subtotal;

    let categoryName = '';
    const catDoc = await Category.findById(variant.category);
    categoryName = catDoc?.name || '';

    preparedItems.push({
      product: product._id,
      name: product.name,
      sku: product.sku,
      unit: product.unit,
      quantity,
      weight: lineWeight, // exact kg, not rounded
      unitPrice, // per kg
      subtotal,
      category: variant.category,
      categoryName,
      _variantId: variant._id, // temp for stock update only
    });
  }

  if (insufficientStock.length > 0) {
    return res.status(400).json({
      message: `Insufficient stock for: ${insufficientStock.join('; ')}`,
    });
  }

  const paid = Math.min(Number(amountPaid) || 0, totalAmount);
  const amountDue = Math.max(totalAmount - paid, 0);

  // Instantiate (but don't save yet) so we have a real sale._id to stamp onto
  // each stock-out transaction as its reference, for full traceability.
  const sale = new Sale({
    customer: customer._id,
    items: preparedItems,
    totalAmount,
    amountPaid: paid,
    amountDue,
    saleDate: saleDate || Date.now(),
    notes,
    createdBy: req.user._id,
    payments: paid > 0 ? [{ amount: paid, recordedBy: req.user._id, date: new Date() }] : [],
  });

  // Decrement stock from the selected category line and log stock-out
  for (const item of preparedItems) {
    const product = productMap.get(String(item.product));
    const variant =
      (product.variants || []).find((v) => String(v._id) === String(item._variantId)) ||
      (product.variants || []).find((v) => String(v.category) === String(item.category));
    if (!variant) {
      return res.status(400).json({ message: `Category stock line missing for ${item.name}` });
    }
    variant.quantity = (Number(variant.quantity) || 0) - item.quantity;
    await product.save();
    const qtyAfter = (product.variants || []).reduce((s, v) => s + (Number(v.quantity) || 0), 0);

    await Transaction.create({
      product: product._id,
      type: 'stock-out',
      quantity: item.quantity,
      quantityAfter: qtyAfter,
      reason: `Sale to ${customer.name}`,
      reference: `Sale #${sale._id}`,
      supplier: '',
      invoices: [
        {
          productName: item.name,
          category: item.categoryName || '',
          quantity: item.quantity,
          price: item.unitPrice,
          totalPrice: item.subtotal,
          netPrice: item.subtotal,
        },
      ],
      performedBy: req.user._id,
    });
  }

  // Strip temp fields before saving sale items
  sale.items = preparedItems.map(({ _variantId, ...rest }) => rest);

  await sale.save();

  // Mirror initial payment onto customer history (full amount paid at sale time)
  if (paid > 0) {
    customer.payments = customer.payments || [];
    customer.payments.push({
      amount: paid,
      note: notes ? String(notes).trim() : `Sale ${new Date(sale.saleDate || Date.now()).toLocaleDateString()}`,
      recordedBy: req.user._id,
      paidAt: new Date(),
      sale: sale._id,
    });
    await customer.save();
  }

  const populatedSale = await Sale.findById(sale._id).populate('customer', 'name phone');

  res.status(201).json({ sale: populatedSale });
});

// @desc    Record an additional payment against an existing sale, reducing
//          its outstanding due balance
// @route   POST /api/sales/:id/payment
// @access  Private
export const recordPayment = asyncHandler(async (req, res) => {
  const { amount, note } = req.body;
  const paymentAmount = Number(amount);

  if (!paymentAmount || paymentAmount <= 0) {
    return res.status(400).json({ message: 'A positive payment amount is required' });
  }

  const sale = await Sale.findById(req.params.id);
  if (!sale) {
    return res.status(404).json({ message: 'Sale not found' });
  }

  const customer = await Customer.findById(sale.customer);
  if (!customer) {
    return res.status(404).json({ message: 'Customer not found' });
  }

  // Total this customer can absorb: this sale + other open sales + opening due
  const otherSales = await Sale.find({
    customer: customer._id,
    amountDue: { $gt: 0 },
    _id: { $ne: sale._id },
  }).sort({ saleDate: 1 });

  const otherDue = otherSales.reduce((s, x) => s + (Number(x.amountDue) || 0), 0);
  const openingDue = Number.isFinite(Number(customer.openingDue)) ? Number(customer.openingDue) : 0;
  const maxApplicable = Math.max(0, (Number(sale.amountDue) || 0) + otherDue + openingDue);

  if (maxApplicable <= 0) {
    return res.status(400).json({ message: 'This customer has no outstanding due' });
  }

  let remaining = Math.min(paymentAmount, maxApplicable);
  const appliedTotal = remaining;
  const paidAt = new Date();
  const userNote = (note || '').trim();

  // Full amount on customer payment history (supplier-style)
  customer.payments = customer.payments || [];
  customer.payments.push({
    amount: appliedTotal,
    note: userNote,
    recordedBy: req.user._id,
    paidAt,
    sale: sale._id,
  });

  // Apply to this sale first
  const onThis = Math.min(Number(sale.amountDue) || 0, remaining);
  if (onThis > 0) {
    sale.amountPaid = (Number(sale.amountPaid) || 0) + onThis;
    sale.amountDue = Math.max(0, Number(sale.totalAmount) - sale.amountPaid);
    sale.payments.push({
      amount: onThis,
      note: userNote,
      recordedBy: req.user._id,
      date: paidAt,
    });
    await sale.save();
    remaining -= onThis;
  }

  // FIFO to other sales
  for (const other of otherSales) {
    if (remaining <= 0) break;
    const apply = Math.min(Number(other.amountDue) || 0, remaining);
    other.amountPaid = (Number(other.amountPaid) || 0) + apply;
    other.amountDue = Math.max(0, Number(other.totalAmount) - other.amountPaid);
    other.payments.push({
      amount: apply,
      note: userNote,
      recordedBy: req.user._id,
      date: paidAt,
    });
    await other.save();
    remaining -= apply;
  }

  // Remainder → opening due
  if (remaining > 0) {
    customer.openingDue = Math.max(0, openingDue - remaining);
  }
  await customer.save();

  const refreshed = await Sale.findById(sale._id).populate('customer', 'name phone');
  res.json({ sale: refreshed });
});

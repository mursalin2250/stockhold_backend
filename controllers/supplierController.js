import Supplier from '../models/Supplier.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Transaction from '../models/Transaction.js';
import { asyncHandler } from '../middleware/errorHandler.js';

async function purchaseTotalsBySupplierName(names) {
  if (!names.length) return {};
  const rows = await Transaction.aggregate([
    {
      $match: {
        $or: [
          { supplier: { $in: names } },
          { 'invoices.supplier': { $in: names } },
        ],
      },
    },
    {
      $group: {
        _id: {
          $ifNull: ['$supplier', { $arrayElemAt: ['$invoices.supplier', 0] }],
        },
        totalPurchased: { $sum: '$totalBuyingPrice' },
      },
    },
  ]);
  const map = {};
  for (const r of rows) {
    if (r._id) map[r._id] = r.totalPurchased || 0;
  }
  return map;
}

// @desc    Get all suppliers with purchase / paid / due summary
// @route   GET /api/suppliers
// @access  Private
export const getSuppliers = asyncHandler(async (req, res) => {
  const { search } = req.query;
  const query = {};
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
      { address: { $regex: search, $options: 'i' } },
      { bankAccount: { $regex: search, $options: 'i' } },
    ];
  }

  const suppliers = await Supplier.find(query).sort({ name: 1 });
  const names = suppliers.map((s) => s.name);
  const purchaseMap = await purchaseTotalsBySupplierName(names);

  const enriched = suppliers.map((s) => {
    const obj = s.toObject();
    const totalPurchased = purchaseMap[s.name] || 0;
    const totalPaid = (s.payments || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const openingDue = Number.isFinite(Number(s.openingDue)) ? Number(s.openingDue) : 0;
    const totalDue = Math.max(0, openingDue + totalPurchased - totalPaid);
    return {
      ...obj,
      totalPurchased,
      totalPaid,
      totalDue,
      openingDue,
    };
  });

  res.json({ suppliers: enriched });
});

// @desc    Get a single supplier with summary
// @route   GET /api/suppliers/:id
// @access  Private
export const getSupplierById = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) {
    return res.status(404).json({ message: 'Supplier not found' });
  }

  const purchaseMap = await purchaseTotalsBySupplierName([supplier.name]);
  const totalPurchased = purchaseMap[supplier.name] || 0;
  const totalPaid = (supplier.payments || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const openingDue = Number.isFinite(Number(supplier.openingDue)) ? Number(supplier.openingDue) : 0;
  const totalDue = Math.max(0, openingDue + totalPurchased - totalPaid);

  res.json({
    supplier,
    summary: { totalPurchased, totalPaid, totalDue, openingDue },
  });
});

// @desc    Purchase (stock-in) history for a supplier
// @route   GET /api/suppliers/:id/purchases
// @access  Private
export const getSupplierPurchases = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) {
    return res.status(404).json({ message: 'Supplier not found' });
  }

  const pageNum = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(req.query.limit, 10) || 10, 1);
  const skip = (pageNum - 1) * limitNum;

  const filter = {
    $or: [{ supplier: supplier.name }, { 'invoices.supplier': supplier.name }],
  };

  const [transactions, total] = await Promise.all([
    Transaction.find(filter)
      .populate('product', 'name sku')
      .populate('performedBy', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum),
    Transaction.countDocuments(filter),
  ]);

  res.json({
    transactions,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.max(1, Math.ceil(total / limitNum)),
    },
  });
});

// @desc    Record a payment to a supplier
// @route   POST /api/suppliers/:id/payments
// @access  Private/Admin/Manager
export const recordSupplierPayment = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) {
    return res.status(404).json({ message: 'Supplier not found' });
  }

  const amount = Number(req.body.amount);
  if (!amount || amount <= 0) {
    return res.status(400).json({ message: 'Payment amount must be greater than 0' });
  }

  supplier.payments.push({
    amount,
    note: req.body.note || '',
    recordedBy: req.user._id,
    paidAt: req.body.paidAt ? new Date(req.body.paidAt) : new Date(),
  });
  await supplier.save();

  const purchaseMap = await purchaseTotalsBySupplierName([supplier.name]);
  const totalPurchased = purchaseMap[supplier.name] || 0;
  const totalPaid = supplier.payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const openingDue = Number.isFinite(Number(supplier.openingDue)) ? Number(supplier.openingDue) : 0;

  res.status(201).json({
    supplier,
    summary: {
      totalPurchased,
      totalPaid,
      totalDue: Math.max(0, openingDue + totalPurchased - totalPaid),
      openingDue,
    },
  });
});

// @desc    Create a supplier
// @route   POST /api/suppliers
// @access  Private/Admin/Manager
export const createSupplier = asyncHandler(async (req, res) => {
  const { name, bankAccount, email, phone, address, openingDue } = req.body;
  if (!name || !String(name).trim()) {
    return res.status(400).json({ message: 'Supplier name is required' });
  }
  if (!address || !String(address).trim()) {
    return res.status(400).json({ message: 'Supplier address is required' });
  }

  const due = Math.max(0, Number(openingDue) || 0);

  const supplier = await Supplier.create({
    name: String(name).trim(),
    bankAccount: bankAccount || '',
    email: email || '',
    phone: phone || '',
    address: String(address).trim(),
    openingDue: due,
    createdBy: req.user._id,
  });

  res.status(201).json({ supplier });
});

// @desc    Update a supplier
// @route   PUT /api/suppliers/:id
// @access  Private/Admin/Manager
export const updateSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) {
    return res.status(404).json({ message: 'Supplier not found' });
  }

  if (req.body.name !== undefined) {
    const n = String(req.body.name).trim();
    if (!n) return res.status(400).json({ message: 'Supplier name is required' });
    supplier.name = n;
  }
  if (req.body.address !== undefined) {
    const a = String(req.body.address).trim();
    if (!a) return res.status(400).json({ message: 'Supplier address is required' });
    supplier.address = a;
  }
  if (req.body.bankAccount !== undefined) supplier.bankAccount = req.body.bankAccount || '';
  if (req.body.email !== undefined) supplier.email = req.body.email || '';
  if (req.body.phone !== undefined) supplier.phone = req.body.phone || '';

  await supplier.save();
  res.json({ supplier });
});

// @desc    Delete a supplier
// @route   DELETE /api/suppliers/:id
// @access  Private/Admin/Manager
export const deleteSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) {
    return res.status(404).json({ message: 'Supplier not found' });
  }

  const productCount = await Product.countDocuments({ supplier: supplier._id });
  if (productCount > 0) {
    return res.status(400).json({
      message: `Cannot delete supplier: ${productCount} product(s) are still linked to it`,
    });
  }

  await supplier.deleteOne();
  res.json({ message: 'Supplier deleted successfully' });
});

// @desc    Set / replace supplier total due (admin + password)
// @route   PUT /api/suppliers/:id/due
// @access  Private/Admin
export const setSupplierDue = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Only admins can set due amounts' });
  }

  const password = req.body.password;
  if (!password) {
    return res.status(400).json({ message: 'Admin password is required' });
  }

  const admin = await User.findById(req.user._id).select('+password');
  if (!admin) {
    return res.status(401).json({ message: 'User not found' });
  }
  const match = await admin.comparePassword(password);
  if (!match) {
    return res.status(401).json({ message: 'Incorrect password' });
  }

  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) {
    return res.status(404).json({ message: 'Supplier not found' });
  }

  const target = Math.max(0, Number(req.body.amount));
  if (Number.isNaN(target)) {
    return res.status(400).json({ message: 'Invalid due amount' });
  }

  const purchaseMap = await purchaseTotalsBySupplierName([supplier.name]);
  const totalPurchased = purchaseMap[supplier.name] || 0;
  const totalPaid = (supplier.payments || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  // openingDue + purchased - paid = target  =>  openingDue = target - purchased + paid
  supplier.openingDue = target - totalPurchased + totalPaid;
  await supplier.save();

  res.json({
    supplier,
    summary: {
      totalPurchased,
      totalPaid,
      totalDue: target,
      openingDue: supplier.openingDue,
    },
  });
});

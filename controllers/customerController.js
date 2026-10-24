import mongoose from 'mongoose';
import Customer from '../models/Customer.js';
import Sale from '../models/Sale.js';
import User from '../models/User.js';
import { asyncHandler } from '../middleware/errorHandler.js';

// @desc    Get all customers (supports search + pagination), each with a
//          lightweight totalDue summary so the list view can flag balances
// @route   GET /api/customers?search=&page=&limit=
// @access  Private
export const getCustomers = asyncHandler(async (req, res) => {
  const { search, page = 1, limit = 20 } = req.query;

  const query = {};
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { address: { $regex: search, $options: 'i' } },
      { bankAccount: { $regex: search, $options: 'i' } },
    ];
  }

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
  const skip = (pageNum - 1) * limitNum;

  const [customers, total] = await Promise.all([
    Customer.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
    Customer.countDocuments(query),
  ]);

  // Aggregate outstanding due per customer in one query rather than N+1 lookups
  const customerIds = customers.map((c) => c._id);
  const dueByCustomer = await Sale.aggregate([
    {
      $match: {
        $or: [
          { customer: { $in: customerIds } },
          { customer: { $in: customerIds.map((id) => String(id)) } },
        ],
      },
    },
    {
      $group: {
        _id: '$customer',
        totalDue: { $sum: { $ifNull: ['$amountDue', 0] } },
        totalSpent: { $sum: { $ifNull: ['$totalAmount', 0] } },
      },
    },
  ]);
  const dueMap = new Map(dueByCustomer.map((d) => [String(d._id), d]));

  const customersWithSummary = customers.map((c) => {
    const summary = dueMap.get(String(c._id));
    const salesDue = Number(summary?.totalDue) || 0;
    const openingDue = Number.isFinite(Number(c.openingDue)) ? Number(c.openingDue) : 0;
    return {
      ...c.toObject(),
      totalDue: Math.max(0, openingDue + salesDue),
      totalSpent: Number(summary?.totalSpent) || 0,
    };
  });

  res.json({
    customers: customersWithSummary,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

// @desc    Get a single customer's profile: contact info + aggregated stats
//          (total due, total spent, total purchases). Purchase history itself
//          is fetched separately (paginated) via GET /customers/:id/sales
// @route   GET /api/customers/:id
// @access  Private
export const getCustomerById = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) {
    return res.status(404).json({ message: 'Customer not found' });
  }

  const cid = customer._id;
  const [summary] = await Sale.aggregate([
    {
      $match: {
        $or: [{ customer: cid }, { customer: String(cid) }],
      },
    },
    {
      $group: {
        _id: null,
        totalDue: { $sum: { $ifNull: ['$amountDue', 0] } },
        totalSpent: { $sum: { $ifNull: ['$totalAmount', 0] } },
        totalPaid: { $sum: { $ifNull: ['$amountPaid', 0] } },
        totalPurchases: { $sum: 1 },
      },
    },
  ]);

  // Opening due is additive base; sales due is unpaid sale balances. Both always combine.
  const salesDue = Number(summary?.totalDue) || 0;
  const openingDue = Number.isFinite(Number(customer.openingDue)) ? Number(customer.openingDue) : 0;
  const totalDue = Math.max(0, openingDue + salesDue);

  // Prefer explicit payment log (supplier-style); fall back to sum of sale amountPaid
  const paymentsTotal = (customer.payments || []).reduce(
    (s, p) => s + (Number(p.amount) || 0),
    0
  );
  const totalPaid =
    paymentsTotal > 0 ? paymentsTotal : Number(summary?.totalPaid) || 0;

  res.json({
    customer,
    summary: {
      totalDue,
      salesDue,
      openingDue,
      totalSpent: Number(summary?.totalSpent) || 0,
      totalPaid,
      totalPurchases: Number(summary?.totalPurchases) || 0,
    },
  });
});

// @desc    Get a customer's paginated purchase history
// @route   GET /api/customers/:id/sales?page=&limit=
// @access  Private
export const getCustomerSales = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;

  const customer = await Customer.findById(req.params.id);
  if (!customer) {
    return res.status(404).json({ message: 'Customer not found' });
  }

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit, 10) || 10, 1);
  const skip = (pageNum - 1) * limitNum;

  const [sales, total] = await Promise.all([
    Sale.find({ customer: customer._id })
      .populate('createdBy', 'name')
      .sort({ saleDate: -1 })
      .skip(skip)
      .limit(limitNum),
    Sale.countDocuments({ customer: customer._id }),
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

// @desc    Create a customer
// @route   POST /api/customers
// @access  Private
export const createCustomer = asyncHandler(async (req, res) => {
  const { name, phone, email, bankAccount, address, notes, openingDue } = req.body;
  if (!name) {
    return res.status(400).json({ message: 'Customer name is required' });
  }

  const due = Math.max(0, Number(openingDue) || 0);

  const customer = await Customer.create({
    name,
    phone,
    email,
    bankAccount,
    address,
    notes,
    openingDue: due,
    createdBy: req.user._id,
  });

  res.status(201).json({ customer });
});

// @desc    Update a customer's details
// @route   PUT /api/customers/:id
// @access  Private
export const updateCustomer = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) {
    return res.status(404).json({ message: 'Customer not found' });
  }

  const fields = ['name', 'phone', 'email', 'bankAccount', 'address', 'notes', 'isActive'];
  fields.forEach((field) => {
    if (req.body[field] !== undefined) customer[field] = req.body[field];
  });

  await customer.save();
  res.json({ customer });
});

// @desc    Delete a customer (blocked if they have sales history, to preserve
//          the sales audit trail)
// @route   DELETE /api/customers/:id
// @access  Private/Admin
export const deleteCustomer = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) {
    return res.status(404).json({ message: 'Customer not found' });
  }

  const saleCount = await Sale.countDocuments({ customer: customer._id });
  if (saleCount > 0) {
    return res.status(400).json({
      message: `Cannot delete customer: ${saleCount} sale(s) are on record for them`,
    });
  }

  await customer.deleteOne();
  res.json({ message: 'Customer deleted successfully' });
});

// @desc    Flat payment history across all of a customer's sales
// @route   GET /api/customers/:id/payments
// @access  Private
export const getCustomerPayments = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id).populate(
    'payments.recordedBy',
    'name'
  );
  if (!customer) {
    return res.status(404).json({ message: 'Customer not found' });
  }

  // Primary source: customer-level payments (full amounts, same pattern as suppliers)
  const payments = (customer.payments || []).map((p) => ({
    _id: p._id,
    amount: p.amount,
    date: p.paidAt || p.date,
    paidAt: p.paidAt || p.date,
    recordedBy: p.recordedBy,
    saleId: p.sale || null,
    note: p.note || '',
  }));

  // Legacy: sale-embedded payments not yet mirrored onto the customer record
  const sales = await Sale.find({ customer: customer._id })
    .populate('payments.recordedBy', 'name')
    .select('payments saleDate totalAmount items');

  const mirroredKeys = new Set(
    payments.map((p) => `${Number(p.amount)}|${new Date(p.date).getTime()}|${(p.note || '').trim()}`)
  );

  for (const sale of sales) {
    for (const p of sale.payments || []) {
      const date = p.date || sale.saleDate;
      const key = `${Number(p.amount)}|${new Date(date).getTime()}|${(p.note || '').trim()}`;
      if (mirroredKeys.has(key)) continue;
      payments.push({
        _id: p._id,
        amount: p.amount,
        date,
        paidAt: date,
        recordedBy: p.recordedBy,
        saleId: sale._id,
        saleTotal: sale.totalAmount,
        note:
          p.note ||
          `Purchase date: ${new Date(sale.saleDate).toLocaleDateString()}`,
        legacy: true,
      });
    }
  }

  payments.sort((a, b) => new Date(b.date) - new Date(a.date));

  res.json({ payments });
});

// @desc    Record a payment against a customer's outstanding sales (FIFO by date)
// @route   POST /api/customers/:id/payments
// @access  Private
export const recordCustomerPayment = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) {
    return res.status(404).json({ message: 'Customer not found' });
  }

  const requested = Number(req.body.amount);
  if (!requested || requested <= 0) {
    return res.status(400).json({ message: 'Payment amount must be greater than 0' });
  }
  const userNote = (req.body.note || '').trim();

  const sales = await Sale.find({ customer: customer._id, amountDue: { $gt: 0 } }).sort({
    saleDate: 1,
  });

  const salesDue = sales.reduce((s, sale) => s + (sale.amountDue || 0), 0);
  const openingDue = Number(customer.openingDue) || 0;
  const totalDue = Math.max(0, openingDue + salesDue);

  if (totalDue <= 0) {
    return res.status(400).json({ message: 'This customer has no outstanding due' });
  }

  // Cap at total outstanding (same as before), but always log the applied total once
  let remaining = Math.min(requested, totalDue);
  const appliedTotal = remaining;
  const paidAt = new Date();

  // Store the full payment on the customer (supplier-style) so history shows exact amount
  customer.payments = customer.payments || [];
  customer.payments.push({
    amount: appliedTotal,
    note: userNote,
    recordedBy: req.user._id,
    paidAt,
    sale: null,
  });

  for (const sale of sales) {
    if (remaining <= 0) break;
    const apply = Math.min(sale.amountDue, remaining);
    sale.amountPaid = (sale.amountPaid || 0) + apply;
    sale.amountDue = Math.max(0, sale.totalAmount - sale.amountPaid);
    // Keep per-sale trail for purchase-linked context (optional split)
    sale.payments.push({
      amount: apply,
      note: userNote,
      recordedBy: req.user._id,
      date: paidAt,
    });
    await sale.save();
    remaining -= apply;
  }

  // Any remainder reduces opening due
  if (remaining > 0) {
    customer.openingDue = Math.max(0, (Number(customer.openingDue) || 0) - remaining);
  }
  await customer.save();

  // Refresh summary
  const cid = customer._id;
  const [agg] = await Sale.aggregate([
    {
      $match: {
        $or: [{ customer: cid }, { customer: String(cid) }],
      },
    },
    {
      $group: {
        _id: null,
        totalSpent: { $sum: { $ifNull: ['$totalAmount', 0] } },
        totalPaid: { $sum: { $ifNull: ['$amountPaid', 0] } },
        totalDue: { $sum: { $ifNull: ['$amountDue', 0] } },
        totalPurchases: { $sum: 1 },
      },
    },
  ]);

  const refreshed = await Customer.findById(customer._id);
  const salesDueNow = Number(agg?.totalDue) || 0;
  const openingNow = Number.isFinite(Number(refreshed?.openingDue))
    ? Number(refreshed.openingDue)
    : 0;
  const paymentsTotal = (refreshed.payments || []).reduce(
    (s, p) => s + (Number(p.amount) || 0),
    0
  );

  res.status(201).json({
    message: 'Payment recorded',
    customer: refreshed,
    summary: {
      totalSpent: Number(agg?.totalSpent) || 0,
      totalPaid: paymentsTotal > 0 ? paymentsTotal : Number(agg?.totalPaid) || 0,
      totalDue: Math.max(0, openingNow + salesDueNow),
      salesDue: salesDueNow,
      openingDue: openingNow,
      totalPurchases: Number(agg?.totalPurchases) || 0,
    },
  });
});

// @desc    Set / replace customer total due (admin + password). Adjusts openingDue so
//          totalDue (openingDue + sales due) equals the requested amount.
// @route   PUT /api/customers/:id/due
// @access  Private/Admin
export const setCustomerDue = asyncHandler(async (req, res) => {
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

  const customer = await Customer.findById(req.params.id);
  if (!customer) {
    return res.status(404).json({ message: 'Customer not found' });
  }

  const target = Math.max(0, Number(req.body.amount));
  if (Number.isNaN(target)) {
    return res.status(400).json({ message: 'Invalid due amount' });
  }

  const cid = customer._id;
  const [summary] = await Sale.aggregate([
    {
      $match: {
        $or: [{ customer: cid }, { customer: String(cid) }],
      },
    },
    {
      $group: {
        _id: null,
        totalDue: { $sum: { $ifNull: ['$amountDue', 0] } },
        totalSpent: { $sum: { $ifNull: ['$totalAmount', 0] } },
        totalPaid: { $sum: { $ifNull: ['$amountPaid', 0] } },
        totalPurchases: { $sum: 1 },
      },
    },
  ]);

  const salesDue = Number(summary?.totalDue) || 0;
  // Keep openingDue as the residual so: openingDue + salesDue === target
  // Future unpaid sales increase salesDue and therefore totalDue automatically.
  customer.openingDue = target - salesDue;
  await customer.save();

  res.json({
    customer,
    summary: {
      totalDue: Math.max(0, Number(customer.openingDue) + salesDue),
      salesDue,
      openingDue: Number(customer.openingDue) || 0,
      totalSpent: Number(summary?.totalSpent) || 0,
      totalPaid: Number(summary?.totalPaid) || 0,
      totalPurchases: Number(summary?.totalPurchases) || 0,
    },
  });
});

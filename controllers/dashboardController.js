import Product from '../models/Product.js';
import Transaction from '../models/Transaction.js';
import Category from '../models/Category.js';
import Supplier from '../models/Supplier.js';
import Customer from '../models/Customer.js';
import Sale from '../models/Sale.js';
import { asyncHandler } from '../middleware/errorHandler.js';

// @desc    Get summary statistics for the dashboard
// @route   GET /api/dashboard/summary
// @access  Private
export const getSummary = asyncHandler(async (req, res) => {
  const products = await Product.find({ isActive: true });

  const totalProducts = products.length;
  const totalStockUnits = products.reduce((sum, p) => {
    const q = (p.variants || []).reduce((s, v) => s + (Number(v.quantity) || 0), 0);
    return sum + q;
  }, 0);
  // Inventory value = sum of buying cost on stock-in movements (includes opening stock)
  const [inventoryAgg] = await Transaction.aggregate([
    { $match: { type: 'stock-in' } },
    { $group: { _id: null, total: { $sum: { $ifNull: ['$totalBuyingPrice', 0] } } } },
  ]);
  const totalInventoryValue = inventoryAgg?.total || 0;
  const lowStockCount = products.filter((p) => p.stockStatus === 'low-stock').length;
  const outOfStockCount = products.filter((p) => p.stockStatus === 'out-of-stock').length;

  const [totalCategories, totalSuppliers, totalCustomers] = await Promise.all([
    Category.countDocuments(),
    Supplier.countDocuments(),
    Customer.countDocuments(),
  ]);

  const [receivables] = await Sale.aggregate([
    { $group: { _id: null, totalDue: { $sum: '$amountDue' }, totalSales: { $sum: '$totalAmount' } } },
  ]);

  const recentTransactions = await Transaction.find()
    .populate('product', 'name sku')
    .populate('performedBy', 'name')
    .sort({ createdAt: -1 })
    .limit(10);

  // Stock movement totals over the last 30 days, useful for a simple trend chart
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentMovements = await Transaction.aggregate([
    { $match: { createdAt: { $gte: thirtyDaysAgo } } },
    {
      $group: {
        _id: { type: '$type', day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } },
        totalQuantity: { $sum: '$quantity' },
      },
    },
    { $sort: { '_id.day': 1 } },
  ]);

  // Most sold products & categories (by quantity sold)
  const topProducts = await Sale.aggregate([
    { $unwind: '$items' },
    {
      $group: {
        _id: { product: '$items.product', name: '$items.name' },
        totalQty: { $sum: '$items.quantity' },
        totalRevenue: { $sum: '$items.subtotal' },
      },
    },
    { $sort: { totalQty: -1 } },
    { $limit: 8 },
    {
      $project: {
        _id: 0,
        productId: '$_id.product',
        name: '$_id.name',
        totalQty: 1,
        totalRevenue: 1,
      },
    },
  ]);

  const topCategories = await Sale.aggregate([
    { $unwind: '$items' },
    {
      $group: {
        _id: {
          category: '$items.category',
          name: { $ifNull: ['$items.categoryName', 'Uncategorized'] },
        },
        totalQty: { $sum: '$items.quantity' },
        totalRevenue: { $sum: '$items.subtotal' },
      },
    },
    { $sort: { totalQty: -1 } },
    { $limit: 8 },
    {
      $project: {
        _id: 0,
        categoryId: '$_id.category',
        name: '$_id.name',
        totalQty: 1,
        totalRevenue: 1,
      },
    },
  ]);

  res.json({
    totalProducts,
    totalStockUnits,
    totalInventoryValue,
    lowStockCount,
    outOfStockCount,
    totalCategories,
    totalSuppliers,
    totalCustomers,
    totalSales: receivables?.totalSales || 0,
    totalReceivables: receivables?.totalDue || 0,
    recentTransactions,
    recentMovements,
    topProducts,
    topCategories,
  });
});

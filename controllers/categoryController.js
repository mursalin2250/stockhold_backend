import Category from '../models/Category.js';
import Product from '../models/Product.js';
import { asyncHandler } from '../middleware/errorHandler.js';

// @desc    Get all categories
// @route   GET /api/categories
// @access  Private
export const getCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find().sort({ name: 1 });
  res.json({ categories });
});

// @desc    Get a single category
// @route   GET /api/categories/:id
// @access  Private
export const getCategoryById = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) {
    return res.status(404).json({ message: 'Category not found' });
  }
  res.json({ category });
});

// @desc    Create a category
// @route   POST /api/categories
// @access  Private/Admin/Manager
export const createCategory = asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  if (!name) {
    return res.status(400).json({ message: 'Category name is required' });
  }

  const exists = await Category.findOne({ name: name.trim() });
  if (exists) {
    return res.status(400).json({ message: 'A category with this name already exists' });
  }

  const category = await Category.create({
    name,
    description,
    createdBy: req.user._id,
  });

  res.status(201).json({ category });
});

// @desc    Update a category
// @route   PUT /api/categories/:id
// @access  Private/Admin/Manager
export const updateCategory = asyncHandler(async (req, res) => {
  const { name, description } = req.body;

  const category = await Category.findById(req.params.id);
  if (!category) {
    return res.status(404).json({ message: 'Category not found' });
  }

  if (name !== undefined) category.name = name;
  if (description !== undefined) category.description = description;

  await category.save();
  res.json({ category });
});

// @desc    Delete a category
// @route   DELETE /api/categories/:id
// @access  Private/Admin/Manager
export const deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) {
    return res.status(404).json({ message: 'Category not found' });
  }

  const productCount = await Product.countDocuments({ category: category._id });
  if (productCount > 0) {
    return res.status(400).json({
      message: `Cannot delete category: ${productCount} product(s) are still assigned to it`,
    });
  }

  await category.deleteOne();
  res.json({ message: 'Category deleted successfully' });
});

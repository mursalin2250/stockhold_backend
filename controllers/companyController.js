import Company from '../models/Company.js';
import { asyncHandler } from '../middleware/errorHandler.js';

async function getOrCreateCompany() {
  let company = await Company.findOne();
  if (!company) {
    company = await Company.create({});
  }
  return company;
}

// @desc    Get company profile (any authenticated user — used on PDFs)
// @route   GET /api/company
// @access  Private
export const getCompany = asyncHandler(async (req, res) => {
  const company = await getOrCreateCompany();
  res.json({ company });
});

// @desc    Update company profile
// @route   PUT /api/company
// @access  Private/Admin
export const updateCompany = asyncHandler(async (req, res) => {
  const company = await getOrCreateCompany();
  const { name, address, email, phone, phoneSecondary } = req.body;

  const nextName = name !== undefined ? String(name).trim() : company.name;
  const nextAddress = address !== undefined ? String(address).trim() : company.address;

  // Once name/address have been set, they cannot be cleared
  if (company.name && !nextName) {
    return res.status(400).json({ message: 'Company name cannot be left empty once set' });
  }
  if (company.address && !nextAddress) {
    return res.status(400).json({ message: 'Company address cannot be left empty once set' });
  }

  company.name = nextName;
  company.address = nextAddress;
  if (email !== undefined) company.email = String(email).trim();
  if (phone !== undefined) company.phone = String(phone).trim();
  if (phoneSecondary !== undefined) company.phoneSecondary = String(phoneSecondary).trim();

  await company.save();
  res.json({ company });
});

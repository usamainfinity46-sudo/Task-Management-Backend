import { Company } from '../models/company.model.js';
import { companySchema } from '../validations/company.schema.js';

export const createCompany = async (req, res, next) => {
  try {
    const body = companySchema.parse(req.body);
    const exists = await Company.findOne({ slug: body.slug });
    if (exists) return res.status(400).json({ message: 'Slug already exists' });
    const company = await Company.create({ ...body, createdBy: req.user.id });
    res.status(201).json({ company });
  } catch (err) {
    next(err);
  }
};

export const listCompanies = async (_req, res, next) => {
  try {
    const companies = await Company.find().sort({ createdAt: -1 });
    res.json({ companies });
  } catch (err) {
    next(err);
  }
};

export const updateCompany = async (req, res, next) => {
  try {
    const body = companySchema.partial().parse(req.body);
    const company = await Company.findByIdAndUpdate(req.params.id, body, { new: true });
    res.json({ company });
  } catch (err) {
    next(err);
  }
};

export const deleteCompany = async (req, res, next) => {
  try {
    await Company.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

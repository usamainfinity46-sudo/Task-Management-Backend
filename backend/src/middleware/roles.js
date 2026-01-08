export const requireRole = (roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!allowed.includes(req.user.role)) return res.status(403).json({ message: 'Forbidden' });
  next();
};

export const companyScoped = (req, res, next) => {
  if (req.user.role === 'admin') return next();
  if (!req.user.companyId) return res.status(400).json({ message: 'Company context required' });
  req.companyFilter = { companyId: req.user.companyId };
  next();
};

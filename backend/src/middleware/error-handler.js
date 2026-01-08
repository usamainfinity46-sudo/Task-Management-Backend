export const errorHandler = (err, req, res, _next) => {
  console.error(err);
  if (err.name === 'ZodError') {
    return res.status(400).json({ message: 'Validation error', issues: err.errors });
  }
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ message: 'Invalid token' });
  }
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
};

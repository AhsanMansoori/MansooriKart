const jwt = require('jsonwebtoken');
const User = require('../models/user');

async function requireAuth(req, res, next) {
  const authorization = req.header('authorization') || '';
  const bearerToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearerToken || req.header('x-auth-token');
  if (!token) {
    return res.status(401).json({ msg: 'No token, authorization denied' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.user.id).select('_id role passwordChangedAt');
    if (!user) return res.status(401).json({ success: false, error: { code: 'AUTH_UNAUTHORIZED', message: 'Authentication is required.' } });
    req.user = { id: user.id, role: user.role };
    next();
  } catch (err) {
    res.status(401).json({ success: false, error: { code: 'AUTH_UNAUTHORIZED', message: 'Authentication is required.' } });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role))
      return res.status(403).json({ success: false, error: { code: 'AUTH_FORBIDDEN', message: 'You do not have permission to access this resource.' } });
    next();
  };
}

const requireSuperAdmin = requireRole('SUPER_ADMIN');
module.exports = { requireAuth, requireRole, requireSuperAdmin };

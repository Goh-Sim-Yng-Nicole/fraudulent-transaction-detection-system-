const jwt = require('jsonwebtoken');

const parseCookies = (cookieHeader = '') => {
  return String(cookieHeader || '')
    .split(';')
    .map((cookie) => cookie.trim())
    .filter(Boolean)
    .reduce((accumulator, cookie) => {
      const separatorIndex = cookie.indexOf('=');
      if (separatorIndex === -1) {
        return accumulator;
      }

      const name = cookie.slice(0, separatorIndex).trim();
      const value = cookie.slice(separatorIndex + 1).trim();
      if (name) {
        accumulator[name] = decodeURIComponent(value);
      }
      return accumulator;
    }, {});
};

const extractToken = (req) => {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  const cookies = parseCookies(req.headers.cookie || '');
  return cookies[process.env.STAFF_SESSION_COOKIE_NAME || 'ftds_staff_token'] || '';
};

const verifyToken = (token) => {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const allowedIssuers = new Set([
    process.env.JWT_ISSUER || 'fraud-detection-platform',
    process.env.CUSTOMER_JWT_ISSUER || 'ftds-customer-service',
  ]);

  if (decoded.iss && !allowedIssuers.has(decoded.iss)) {
    throw new Error('invalid token issuer');
  }

  return decoded;
};

const authenticateStaff = (allowedRoles = []) => (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ success: false, error: 'staff token required' });
    }

    const decoded = verifyToken(token);
    const role = decoded.role || null;
    if (!role || role === 'customer') {
      return res.status(403).json({ success: false, error: 'staff session required' });
    }

    if (allowedRoles.length > 0 && !allowedRoles.includes(role)) {
      return res.status(403).json({ success: false, error: 'insufficient permissions' });
    }

    req.staff = {
      userId: decoded.userId || decoded.sub,
      role,
      permissions: decoded.permissions || [],
      displayName: decoded.displayName || decoded.name || decoded.userId || decoded.sub || null,
      token,
    };

    return next();
  } catch (_error) {
    return res.status(401).json({ success: false, error: 'invalid or expired token' });
  }
};

module.exports = {
  authenticateStaff,
};

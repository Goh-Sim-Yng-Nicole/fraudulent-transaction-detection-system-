const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../config/logger');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');
const MetricsService = require('../utils/metrics');

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

const extractTokenFromRequest = (req) => {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  const cookies = parseCookies(req.headers.cookie || '');
  return cookies[config.auth.staffCookieName] || '';
};

// Handles verify token.
const verifyToken = (token) => {
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    const allowedIssuers = new Set(
      [config.jwt.issuer, config.jwt.customerIssuer].filter(Boolean)
    );

    if (allowedIssuers.size > 0 && decoded.iss && !allowedIssuers.has(decoded.iss)) {
      throw new UnauthorizedError('Invalid token issuer');
    }

    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new UnauthorizedError('Token has expired');
    }
    if (error.name === 'JsonWebTokenError') {
      throw new UnauthorizedError('Invalid token');
    }
    throw new UnauthorizedError('Token verification failed');
  }
};

// Handles authenticate.
const authenticate = async (req, res, next) => {
  try {
    const token = extractTokenFromRequest(req);
    if (!token) {
      MetricsService.recordAuthAttempt('missing_token');
      throw new UnauthorizedError('No authentication token provided');
    }

    const decoded = verifyToken(token);
    req.user = {
      userId: decoded.userId || decoded.sub,
      email: decoded.email || null,
      role: decoded.role || (decoded.sub ? 'customer' : null),
      permissions: decoded.permissions || [],
      displayName: decoded.displayName || decoded.name || decoded.userId || decoded.sub || null,
    };

    req.token = token;

    MetricsService.recordAuthAttempt('success');
    logger.debug('User authenticated successfully', { userId: decoded.userId });

    next();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      next(error);
    } else {
      MetricsService.recordAuthAttempt('error');
      logger.error('Authentication error:', error);
      next(new UnauthorizedError('Authentication failed'));
    }
  }
};

// Handles authorize.
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('User not authenticated');
      }

      const hasRole = allowedRoles.includes(req.user.role);

      if (!hasRole) {
        logger.warn('Authorization failed', {
          userId: req.user.userId,
          userRole: req.user.role,
          requiredRoles: allowedRoles,
        });
        throw new ForbiddenError('Insufficient permissions');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

// Handles optional auth.
const optionalAuth = async (req, res, next) => {
  try {
    const token = extractTokenFromRequest(req);
    if (!token) {
      return next();
    }

    try {
      const decoded = verifyToken(token);
      req.user = {
        userId: decoded.userId || decoded.sub,
        email: decoded.email || null,
        role: decoded.role || (decoded.sub ? 'customer' : null),
        permissions: decoded.permissions || [],
        displayName: decoded.displayName || decoded.name || decoded.userId || decoded.sub || null,
      };
      req.token = token;
    } catch (error) {
      logger.debug('Optional auth failed:', error.message);
    }

    next();
  } catch (error) {
    next();
  }
};

module.exports = {
  authenticate,
  authorize,
  optionalAuth,
  verifyToken,
  parseCookies,
  extractTokenFromRequest,
};

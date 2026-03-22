const express = require('express');
const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../config/logger');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const buildCookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: config.auth.secureCookies,
  path: '/',
  maxAge: config.auth.sessionMaxAgeMs,
});

const signStaffToken = (user) => jwt.sign({
  userId: user.username,
  role: user.role,
  permissions: user.permissions || [],
  displayName: user.displayName || user.username,
  authType: 'staff',
}, config.jwt.secret, {
  expiresIn: config.jwt.expiresIn,
  issuer: config.jwt.issuer,
  subject: user.username,
});

const sanitizeUser = (user) => ({
  userId: user.username,
  username: user.username,
  role: user.role,
  displayName: user.displayName || user.username,
  permissions: user.permissions || [],
});

router.post('/staff/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const user = config.auth.staffUsers[username];

  if (!user || user.password !== password) {
    logger.warn('Staff login failed', { username });
    return res.status(401).json({
      success: false,
      error: 'invalid credentials',
    });
  }

  const accessToken = signStaffToken(user);
  res.cookie(config.auth.staffCookieName, accessToken, buildCookieOptions());

  logger.info('Staff login succeeded', {
    username: user.username,
    role: user.role,
  });

  return res.json({
    success: true,
    access_token: accessToken,
    token_type: 'bearer',
    user: sanitizeUser(user),
  });
});

router.post('/staff/logout', (_req, res) => {
  res.clearCookie(config.auth.staffCookieName, {
    ...buildCookieOptions(),
    maxAge: undefined,
  });

  return res.json({ success: true });
});

router.get('/staff/me', authenticate, (req, res) => {
  if (req.user?.role === 'customer') {
    return res.status(403).json({
      success: false,
      error: 'customer tokens cannot access staff endpoints',
    });
  }

  return res.json({
    success: true,
    user: {
      userId: req.user.userId,
      role: req.user.role,
      displayName: req.user.displayName,
      permissions: req.user.permissions || [],
    },
  });
});

router.get('/internal/staff/authorize', authenticate, (req, res) => {
  if (req.user?.role === 'customer') {
    return res.status(403).json({ success: false, error: 'staff session required' });
  }

  const allowedRoles = String(req.query.roles || '')
    .split(',')
    .map((role) => role.trim())
    .filter(Boolean);

  if (allowedRoles.length > 0 && !allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ success: false, error: 'insufficient permissions' });
  }

  res.setHeader('X-Staff-User', req.user.userId || '');
  res.setHeader('X-Staff-Role', req.user.role || '');
  res.setHeader('X-Staff-Name', req.user.displayName || '');
  return res.status(200).json({ success: true });
});

module.exports = router;

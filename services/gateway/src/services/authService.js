const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../config/logger');

class AuthService {
  static generateToken(payload) {
    try {
      const token = jwt.sign(payload, config.jwt.secret, {
        expiresIn: config.jwt.expiresIn,
        issuer: config.jwt.issuer,
      });

      logger.debug('Token generated successfully', { userId: payload.userId });
      return token;
    } catch (error) {
      logger.error('Error generating token:', error);
      throw error;
    }
  }

  static verifyToken(token) {
    try {
      const decoded = jwt.verify(token, config.jwt.secret, {
        issuer: config.jwt.issuer,
      });

      return decoded;
    } catch (error) {
      logger.error('Error verifying token:', error);
      throw error;
    }
  }

  static decodeToken(token) {
    try {
      return jwt.decode(token);
    } catch (error) {
      logger.error('Error decoding token:', error);
      return null;
    }
  }

  static async validateCredentials(email, password) {
    logger.info('Validating credentials', { email });
    if (email === 'admin@example.com' && password === 'admin123') {
      return {
        userId: '550e8400-e29b-41d4-a716-446655440000',
        email: 'admin@example.com',
        role: 'admin',
        permissions: ['read', 'write', 'delete'],
      };
    }

    if (email === 'user@example.com' && password === 'user123') {
      return {
        userId: '550e8400-e29b-41d4-a716-446655440001',
        email: 'user@example.com',
        role: 'user',
        permissions: ['read'],
      };
    }

    return null;
  }
}

module.exports = AuthService;
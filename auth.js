const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'pc-builder-jwt-secret-key-production-2026-safe';
const ADMIN_STATIC_TOKEN = process.env.ADMIN_TOKEN || 'dev-admin';

/**
 * Hash password with scrypt and random salt
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verify password against salt:hash
 */
function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string' || !storedHash.includes(':')) {
    return false;
  }
  try {
    const [salt, key] = storedHash.split(':');
    const keyBuffer = Buffer.from(key, 'hex');
    const derivedKey = crypto.scryptSync(password, salt, 64);
    return crypto.timingSafeEqual(keyBuffer, derivedKey);
  } catch (e) {
    return false;
  }
}

/**
 * Generate signed JWT-like token
 */
function generateToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const exp = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
  const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

/**
 * Verify and decode token
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expectedSignature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  if (signature !== expectedSignature) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Date.now()) return null; // Expired
    return payload;
  } catch (e) {
    return null;
  }
}

/**
 * Express middleware to authenticate any user via Bearer token
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please login.' });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired session. Please login again.' });
  }

  req.user = payload; // { id, email, name, role }
  next();
}

/**
 * Express middleware to optionally authenticate user if token is provided
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  if (token) {
    const payload = verifyToken(token);
    if (payload) req.user = payload;
  }
  next();
}

/**
 * Express middleware to require ADMIN role or static admin token
 */
function requireAdmin(req, res, next) {
  // Check static header token for backward compatibility with tooling
  const staticToken = req.headers['x-admin-token'];
  if (staticToken && staticToken === ADMIN_STATIC_TOKEN) {
    req.user = { id: 1, name: 'System Admin', email: 'admin@pcbuilder.com', role: 'ADMIN' };
    return next();
  }

  // Check Bearer JWT token
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  if (token) {
    const payload = verifyToken(token);
    if (payload && payload.role === 'ADMIN') {
      req.user = payload;
      return next();
    }
  }

  return res.status(403).json({ error: 'Access denied: Admin privileges required.' });
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
  authenticateToken,
  optionalAuth,
  requireAdmin,
  ADMIN_STATIC_TOKEN,
};

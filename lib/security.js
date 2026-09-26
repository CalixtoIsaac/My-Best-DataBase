/**
 * ============================================================================
 * SEGURIDAD DEL SERVIDOR (lib/security.js)
 * ============================================================================
 * 1. Clave JWT: se lee de JWT_SECRET (.env). Si falta o es débil:
 *      - en producción (NODE_ENV=production) el servidor NO arranca;
 *      - en desarrollo se genera una clave aleatoria temporal y se avisa
 *        (las sesiones se cierran al reiniciar el servidor).
 * 2. requireAuth: middleware que exige un token JWT válido en
 *    "Authorization: Bearer <token>" para usar la API.
 * 3. rateLimit: limitador de intentos en memoria (sin dependencias), para
 *    frenar ataques de fuerza bruta en el inicio de sesión y el registro.
 * ============================================================================
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_ALGORITHM = 'HS256';
const JWT_EXPIRES_IN = '8h';
const MIN_SECRET_LENGTH = 32;
const WEAK_SECRETS = ['secreto_super_seguro', 'secret', 'changeme', 'jwt_secret'];

// ==========================================
// 1. CLAVE JWT
// ==========================================
function resolveJwtSecret() {
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (secret.length >= MIN_SECRET_LENGTH && !WEAK_SECRETS.includes(secret.toLowerCase())) return secret;

  const problem = secret
    ? `JWT_SECRET es inseguro (mínimo ${MIN_SECRET_LENGTH} caracteres aleatorios)`
    : 'JWT_SECRET no está definido en .env';
  const howTo = 'Genera una clave con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"';

  if (process.env.NODE_ENV === 'production') {
    console.error(`❌ ${problem}. El servidor no arranca en producción sin una clave segura.\n   ${howTo}`);
    process.exit(1);
  }
  console.warn(`⚠️  ${problem}. Se usará una clave temporal: las sesiones se cerrarán al reiniciar el servidor.\n   ${howTo}`);
  return crypto.randomBytes(48).toString('hex');
}

const JWT_SECRET = resolveJwtSecret();

/** Firma el token de sesión (8 horas) */
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { algorithm: JWT_ALGORITHM, expiresIn: JWT_EXPIRES_IN });
}

// ==========================================
// 2. AUTENTICACIÓN DE LA API
// ==========================================
/**
 * Exige "Authorization: Bearer <token>". Si el token falta, es inválido o expiró,
 * responde 401 con code = 'AUTH_REQUIRED' (el navegador redirige al login).
 * Si es válido, deja los datos del usuario en req.user.
 */
function requireAuth(req, res, next) {
  const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '');
  if (!match) {
    return res.status(401).json({ error: 'Inicia sesión para usar el Studio.', code: 'AUTH_REQUIRED' });
  }
  try {
    req.user = jwt.verify(match[1], JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
    return next();
  } catch (error) {
    const expired = error.name === 'TokenExpiredError';
    return res.status(401).json({
      error: expired ? 'Tu sesión expiró. Inicia sesión de nuevo.' : 'Sesión no válida. Inicia sesión de nuevo.',
      code: 'AUTH_REQUIRED'
    });
  }
}

// ==========================================
// 3. LIMITADOR DE INTENTOS
// ==========================================
/**
 * Crea un middleware que permite como máximo `max` peticiones por `windowMs`
 * para cada clave (por defecto, la IP). Al superar el límite responde 429.
 * @param {{windowMs: number, max: number, key?: (req) => string, message?: string}} opts
 */
function rateLimit({ windowMs, max, key = (req) => req.ip, message }) {
  const hits = new Map(); // clave -> { count, reset }

  // Limpieza periódica para que el mapa no crezca sin límite
  const cleaner = setInterval(() => {
    const now = Date.now();
    for (const [k, entry] of hits) if (entry.reset <= now) hits.delete(k);
  }, windowMs);
  cleaner.unref();

  return (req, res, next) => {
    const now = Date.now();
    const k = String(key(req) || 'desconocido');
    let entry = hits.get(k);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(k, entry);
    }
    entry.count++;
    if (entry.count > max) {
      const retrySeconds = Math.ceil((entry.reset - now) / 1000);
      res.set('Retry-After', String(retrySeconds));
      return res.status(429).json({
        error: message || `Demasiados intentos. Espera ${Math.ceil(retrySeconds / 60)} minuto(s) e inténtalo de nuevo.`
      });
    }
    return next();
  };
}

module.exports = { signToken, requireAuth, rateLimit };

const crypto = require('crypto');

const PROVIDER = 'linux_do';
const START_PATH = '/api/auth/linux-do/start';
const CALLBACK_PATH = '/api/auth/linux-do/callback';
const DEFAULT_ISSUER = 'https://connect.linux.do/';
const DEFAULT_AUTHORIZE_URL = 'https://connect.linux.do/oauth2/authorize';
const DEFAULT_TOKEN_URL = 'https://connect.linux.do/oauth2/token';
const DEFAULT_USERINFO_URL = 'https://connect.linux.do/api/user';
const DEFAULT_JWKS_URL = 'https://connect.linux.do/.well-known/jwks.json';
const SESSION_KEY = 'linux_do_oauth_states';
const STATE_TTL_MS = 7 * 60 * 1000;
const MAX_STATES = 5;

function envBool(name, fallback = false) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function envText(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function mustHttpUrl(value, label) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${label} must use http/https`);
    return url.toString();
  } catch {
    throw new Error(`${label} 必须是 http/https 绝对 URL`);
  }
}

function readConfig() {
  const enabled = envBool('LINUX_DO_OAUTH_ENABLED', false);
  const config = {
    enabled,
    autoCreateEnabled: envBool('LINUX_DO_AUTO_CREATE_ENABLED', true),
    clientId: envText('LINUX_DO_OAUTH_CLIENT_ID') || envText('LINUX_DO_CLIENT_ID'),
    clientSecret: envText('LINUX_DO_OAUTH_CLIENT_SECRET') || envText('LINUX_DO_CLIENT_SECRET'),
    redirectUri: envText('LINUX_DO_OAUTH_REDIRECT_URI') || envText('LINUX_DO_REDIRECT_URI'),
    issuer: envText('LINUX_DO_OAUTH_ISSUER', DEFAULT_ISSUER),
    authorizeUrl: envText('LINUX_DO_OAUTH_AUTHORIZE_URL', DEFAULT_AUTHORIZE_URL),
    tokenUrl: envText('LINUX_DO_OAUTH_TOKEN_URL', DEFAULT_TOKEN_URL),
    userinfoUrl: envText('LINUX_DO_OAUTH_USERINFO_URL', DEFAULT_USERINFO_URL),
    jwksUrl: envText('LINUX_DO_OAUTH_JWKS_URL', DEFAULT_JWKS_URL),
  };
  if (enabled) validateConfig(config);
  return config;
}

function validateConfig(config = readConfig()) {
  if (!config.enabled) return config;
  const missing = [
    ['client_id', config.clientId],
    ['client_secret', config.clientSecret],
    ['redirect_uri', config.redirectUri],
    ['issuer', config.issuer],
    ['authorize', config.authorizeUrl],
    ['token', config.tokenUrl],
    ['userinfo', config.userinfoUrl],
    ['JWKS', config.jwksUrl],
  ].filter(([, value]) => !String(value || '').trim()).map(([key]) => key);
  if (missing.length) throw new Error(`Linux DO OAuth 配置缺失：${missing.join(', ')}`);
  config.redirectUri = mustHttpUrl(config.redirectUri, 'LINUX_DO_OAUTH_REDIRECT_URI');
  config.issuer = mustHttpUrl(config.issuer, 'LINUX_DO_OAUTH_ISSUER');
  config.authorizeUrl = mustHttpUrl(config.authorizeUrl, 'LINUX_DO_OAUTH_AUTHORIZE_URL');
  config.tokenUrl = mustHttpUrl(config.tokenUrl, 'LINUX_DO_OAUTH_TOKEN_URL');
  config.userinfoUrl = mustHttpUrl(config.userinfoUrl, 'LINUX_DO_OAUTH_USERINFO_URL');
  config.jwksUrl = mustHttpUrl(config.jwksUrl, 'LINUX_DO_OAUTH_JWKS_URL');
  return config;
}

function publicConfig() {
  const config = readConfig();
  return {
    linux_do_oauth_enabled: config.enabled,
    linux_do_oauth_start_path: START_PATH,
  };
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256Base64url(value) {
  return crypto.createHash('sha256').update(String(value)).digest('base64url');
}

function sanitizeReturnTo(value) {
  const raw = String(value || '').trim();
  if (!raw) return '/';
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {}
  if (!decoded.startsWith('/') || decoded.startsWith('//')) return '/';
  if (decoded.includes('\\') || /[\u0000-\u001f\u007f]/.test(decoded)) return '/';
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded)) return '/';
  return decoded;
}

function pruneStates(session) {
  const now = Date.now();
  const current = session?.[SESSION_KEY] && typeof session[SESSION_KEY] === 'object'
    ? session[SESSION_KEY]
    : {};
  const entries = Object.entries(current)
    .filter(([, item]) => item && Number(item.expires_at) > now)
    .sort((a, b) => Number(b[1].created_at || 0) - Number(a[1].created_at || 0))
    .slice(0, MAX_STATES);
  session[SESSION_KEY] = Object.fromEntries(entries);
  return session[SESSION_KEY];
}

function createStartContext(req, returnTo) {
  const states = pruneStates(req.session);
  const state = randomToken(32);
  const nonce = randomToken(32);
  const codeVerifier = randomToken(48);
  states[state] = {
    nonce,
    code_verifier: codeVerifier,
    return_to: sanitizeReturnTo(returnTo),
    created_at: Date.now(),
    expires_at: Date.now() + STATE_TTL_MS,
  };
  pruneStates(req.session);
  return {
    state,
    nonce,
    codeVerifier,
    codeChallenge: sha256Base64url(codeVerifier),
    returnTo: states[state]?.return_to || '/',
  };
}

function consumeStartContext(req, state) {
  const states = pruneStates(req.session || {});
  const key = String(state || '');
  const item = states[key];
  if (!key || !item) return null;
  delete states[key];
  if (Number(item.expires_at) <= Date.now()) return null;
  return item;
}

function buildAuthorizeUrl(config, context) {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', 'openid profile');
  url.searchParams.set('state', context.state);
  url.searchParams.set('nonce', context.nonce);
  url.searchParams.set('code_challenge', context.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

function authRedirect(errorCode, returnTo = '/') {
  const params = new URLSearchParams();
  if (errorCode) {
    params.set('linuxdo_error', errorCode);
  } else {
    params.set('linuxdo', 'success');
    params.set('redirect', sanitizeReturnTo(returnTo));
  }
  return `/#/auth?${params.toString()}`;
}

async function requestToken(config, code, codeVerifier) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    code_verifier: codeVerifier,
  });
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!response.ok) throw createOAuthError('token_failed', `token endpoint returned ${response.status}`);
  const payload = await response.json();
  if (!payload?.access_token || !payload?.id_token) {
    throw createOAuthError('token_invalid', 'token response missing access_token or id_token');
  }
  return payload;
}

async function requestUserinfo(config, accessToken) {
  const response = await fetch(config.userinfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) throw createOAuthError('userinfo_failed', `userinfo endpoint returned ${response.status}`);
  const payload = await response.json();
  if (!payload?.sub) throw createOAuthError('userinfo_invalid', 'userinfo missing sub');
  return payload;
}

async function fetchJwks(config) {
  const response = await fetch(config.jwksUrl);
  if (!response.ok) throw createOAuthError('jwks_failed', `JWKS endpoint returned ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload?.keys)) throw createOAuthError('jwks_invalid', 'JWKS missing keys');
  return payload;
}

function parseJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw createOAuthError('id_token_invalid', 'ID Token format invalid');
  try {
    return {
      header: JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')),
      payload: JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')),
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: Buffer.from(parts[2], 'base64url'),
    };
  } catch {
    throw createOAuthError('id_token_invalid', 'ID Token JSON invalid');
  }
}

function verifyJwtSignature(parsed, jwks) {
  if (parsed.header?.alg !== 'RS256') throw createOAuthError('id_token_alg', 'ID Token alg must be RS256');
  const kid = String(parsed.header?.kid || '');
  if (!kid) throw createOAuthError('id_token_kid', 'ID Token missing kid');
  const jwk = jwks.keys.find(key => key?.kid === kid && key?.kty === 'RSA');
  if (!jwk) throw createOAuthError('id_token_kid', 'JWKS kid not found');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const ok = crypto.verify('RSA-SHA256', Buffer.from(parsed.signingInput), key, parsed.signature);
  if (!ok) throw createOAuthError('id_token_signature', 'ID Token signature invalid');
}

async function verifyIdToken(config, idToken, nonce) {
  const parsed = parseJwt(idToken);
  const jwks = await fetchJwks(config);
  verifyJwtSignature(parsed, jwks);
  const claims = parsed.payload || {};
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== config.issuer) throw createOAuthError('id_token_iss', 'ID Token issuer invalid');
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(config.clientId)) throw createOAuthError('id_token_aud', 'ID Token audience invalid');
  if (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) <= now) {
    throw createOAuthError('id_token_exp', 'ID Token expired');
  }
  if (!Number.isFinite(Number(claims.iat)) || Number(claims.iat) > now + 60) {
    throw createOAuthError('id_token_iat', 'ID Token iat invalid');
  }
  if (String(claims.nonce || '') !== String(nonce || '')) {
    throw createOAuthError('id_token_nonce', 'ID Token nonce invalid');
  }
  if (!claims.sub) throw createOAuthError('id_token_sub', 'ID Token missing sub');
  return claims;
}

function createOAuthError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeProviderProfile(userinfo = {}) {
  return {
    sub: String(userinfo.sub || ''),
    username: String(userinfo.username || '').slice(0, 191),
    login: String(userinfo.login || '').slice(0, 191),
    name: String(userinfo.name || '').slice(0, 191),
    avatar_url: String(userinfo.avatar_url || '').slice(0, 512),
    trust_level: userinfo.trust_level === null || userinfo.trust_level === undefined
      ? null
      : Number(userinfo.trust_level) || 0,
    active: typeof userinfo.active === 'boolean' ? userinfo.active : null,
    silenced: typeof userinfo.silenced === 'boolean' ? userinfo.silenced : null,
  };
}

function mapErrorCode(error) {
  const raw = String(error?.code || '').trim();
  const allowed = new Set([
    'oauth_disabled',
    'provider_error',
    'missing_code_state',
    'state_invalid',
    'token_failed',
    'token_invalid',
    'jwks_failed',
    'jwks_invalid',
    'id_token_invalid',
    'id_token_alg',
    'id_token_kid',
    'id_token_signature',
    'id_token_iss',
    'id_token_aud',
    'id_token_exp',
    'id_token_iat',
    'id_token_nonce',
    'id_token_sub',
    'userinfo_failed',
    'userinfo_invalid',
    'subject_mismatch',
    'provider_inactive',
    'provider_silenced',
    'local_deleted',
    'local_banned',
    'local_inactive',
    'auto_create_disabled',
    'username_conflict',
  ]);
  return allowed.has(raw) ? raw : 'oauth_failed';
}

module.exports = {
  PROVIDER,
  START_PATH,
  CALLBACK_PATH,
  readConfig,
  validateConfig,
  publicConfig,
  createStartContext,
  consumeStartContext,
  buildAuthorizeUrl,
  authRedirect,
  requestToken,
  requestUserinfo,
  verifyIdToken,
  normalizeProviderProfile,
  mapErrorCode,
  sanitizeReturnTo,
  base64url,
};

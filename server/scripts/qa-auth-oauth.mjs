import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import fs from 'node:fs'
import { rm } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const serverRoot = path.resolve(__dirname, '..')
const tempDir = path.resolve(serverRoot, '.tmp-auth-oauth-run')
const storageFile = path.resolve(tempDir, '.storage.json')
const usersFile = path.resolve(tempDir, 'users.json')
const oauthIdentitiesFile = path.resolve(tempDir, 'oauth_identities.json')
const host = '127.0.0.1'
const preferredAppPort = Number(process.env.TAOYUAN_AUTH_OAUTH_PORT || 4123)
const preferredProviderPort = Number(process.env.TAOYUAN_AUTH_OAUTH_PROVIDER_PORT || 5123)

const checks = []
const serverLogs = []
const codeRecords = new Map()
const accessRecords = new Map()
const clientId = 'mock_linux_do_client'
const clientSecret = 'mock_linux_do_secret_do_not_log'
const forcedIdentityFailureSub = 'atomic-failure-sub'
const issuerPath = '/'
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
})
const jwk = publicKey.export({ format: 'jwk' })
jwk.kid = 'mock-key-1'
jwk.alg = 'RS256'
jwk.use = 'sig'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

const canListenOnPort = (targetHost, port) =>
  new Promise(resolve => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ host: targetHost, port }, () => {
      server.close(() => resolve(true))
    })
  })

const findAvailablePort = async (targetHost, startPort, attempts = 40) => {
  for (let port = startPort; port < startPort + attempts; port += 1) {
    if (await canListenOnPort(targetHost, port)) return port
  }
  return startPort
}

const appPort = await findAvailablePort(host, preferredAppPort)
const providerPort = await findAvailablePort(host, preferredProviderPort)
const baseURL = `http://${host}:${appPort}`
const providerBaseURL = `http://${host}:${providerPort}`

const base64urlJson = value => Buffer.from(JSON.stringify(value)).toString('base64url')

const signIdToken = payload => {
  const header = { alg: 'RS256', typ: 'JWT', kid: jwk.kid }
  const signingInput = `${base64urlJson(header)}.${base64urlJson(payload)}`
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url')
  return `${signingInput}.${signature}`
}

const oauthUsernameForSub = (sub, attempt = 0) => {
  const seed = attempt > 0 ? `${sub}:${attempt}` : sub
  return `ldo_${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16)}`
}

const readJsonFile = (filePath, fallback) => {
  try {
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

const readLocalUsers = () => readJsonFile(usersFile, { users: [] }).users || []
const readLocalIdentities = () => readJsonFile(oauthIdentitiesFile, { identities: [] }).identities || []

const readRequestBody = req =>
  new Promise(resolve => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })

const jsonResponse = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

const providerServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', providerBaseURL)
    if (url.pathname === '/.well-known/jwks.json') {
      jsonResponse(res, 200, { keys: [jwk] })
      return
    }

    if (url.pathname === '/oauth2/authorize') {
      const redirectUri = url.searchParams.get('redirect_uri') || ''
      const state = url.searchParams.get('state') || ''
      const code = url.searchParams.get('mock_code') || `code_${crypto.randomBytes(8).toString('hex')}`
      codeRecords.set(code, {
        clientId: url.searchParams.get('client_id') || '',
        redirectUri,
        nonce: url.searchParams.get('nonce') || '',
        codeChallenge: url.searchParams.get('code_challenge') || '',
        mode: url.searchParams.get('mock_mode') || 'ok',
        sub: url.searchParams.get('mock_sub') || 'linux-do-sub-main',
      })
      const callback = new URL(redirectUri)
      callback.searchParams.set('code', code)
      callback.searchParams.set('state', state)
      res.writeHead(302, { Location: callback.toString() })
      res.end()
      return
    }

    if (url.pathname === '/oauth2/token') {
      const auth = String(req.headers.authorization || '')
      const expected = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
      if (auth !== expected) {
        jsonResponse(res, 401, { error: 'invalid_client' })
        return
      }
      const body = new URLSearchParams(await readRequestBody(req))
      const code = body.get('code') || ''
      const record = codeRecords.get(code)
      const verifier = body.get('code_verifier') || ''
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
      if (!record || body.get('grant_type') !== 'authorization_code' || body.get('redirect_uri') !== record.redirectUri || challenge !== record.codeChallenge) {
        jsonResponse(res, 400, { error: 'invalid_grant' })
        return
      }
      if (record.mode === 'token_error') {
        jsonResponse(res, 400, { error: 'invalid_grant' })
        return
      }
      const now = Math.floor(Date.now() / 1000)
      const claims = {
        iss: `${providerBaseURL}${issuerPath}`,
        aud: record.mode === 'bad_aud' ? 'wrong-client' : clientId,
        sub: record.mode === 'missing_sub' ? '' : record.sub,
        exp: record.mode === 'expired' ? now - 10 : now + 600,
        iat: now,
        nonce: record.mode === 'bad_nonce' ? 'wrong-nonce' : record.nonce,
      }
      const accessToken = `access_${crypto.randomBytes(10).toString('hex')}`
      accessRecords.set(accessToken, record)
      jsonResponse(res, 200, {
        token_type: 'Bearer',
        access_token: accessToken,
        id_token: signIdToken(claims),
      })
      return
    }

    if (url.pathname === '/api/user') {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
      const record = accessRecords.get(token)
      if (!record || record.mode === 'userinfo_error') {
        jsonResponse(res, 401, { error: 'invalid_token' })
        return
      }
      jsonResponse(res, 200, {
        sub: record.mode === 'userinfo_mismatch' ? `${record.sub}-other` : record.sub,
        username: 'linuxdo_user',
        login: 'linuxdo_login',
        name: 'Linux DO 用户',
        avatar_url: 'https://example.test/avatar.png',
        active: record.mode === 'provider_inactive' ? false : true,
        silenced: record.mode === 'provider_silenced' ? true : false,
        trust_level: 2,
      })
      return
    }

    jsonResponse(res, 404, { error: 'not_found' })
  } catch (error) {
    jsonResponse(res, 500, { error: error?.message || 'provider_error' })
  }
})

const listen = server =>
  new Promise(resolve => server.listen(providerPort, host, resolve))

const closeProvider = () =>
  new Promise(resolve => providerServer.close(() => resolve()))

const waitForServer = async (url, timeoutMs = 120_000) => {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await wait(500)
  }
  throw new Error(`Timed out waiting for server at ${url}`)
}

const getSetCookies = response =>
  typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []

const updateCookie = (session, response) => {
  const parts = getSetCookies(response).map(item => String(item).split(';', 1)[0]).filter(Boolean)
  if (parts.length) session.cookie = parts.join('; ')
}

const request = async (pathnameOrUrl, session = {}, init = {}) => {
  const headers = new Headers(init.headers || {})
  if (session.cookie) headers.set('Cookie', session.cookie)
  const response = await fetch(pathnameOrUrl.startsWith('http') ? pathnameOrUrl : `${baseURL}${pathnameOrUrl}`, {
    redirect: 'manual',
    ...init,
    headers,
  })
  updateCookie(session, response)
  return response
}

const readJson = async response => {
  try {
    return await response.json()
  } catch {
    return null
  }
}

const runCheck = async (label, runner) => {
  await runner()
  checks.push(label)
}

let serverProcess = null

const startServer = () => {
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: serverRoot,
    env: {
      ...process.env,
      PORT: String(appPort),
      DB_STORAGE: storageFile,
      SECRET_KEY: 'taoyuan_smoke_secret_key_123456789',
      ADMIN_TOKEN: 'taoyuan_smoke_admin_token_123',
      MYSQL_HOST: '',
      MYSQL_USER: '',
      MYSQL_PASSWORD: '',
      MYSQL_DATABASE: '',
      LINUX_DO_OAUTH_ENABLED: 'true',
      LINUX_DO_AUTO_CREATE_ENABLED: 'true',
      LINUX_DO_OAUTH_CLIENT_ID: clientId,
      LINUX_DO_OAUTH_CLIENT_SECRET: clientSecret,
      LINUX_DO_OAUTH_REDIRECT_URI: `${baseURL}/api/auth/linux-do/callback`,
      LINUX_DO_OAUTH_ISSUER: `${providerBaseURL}/`,
      LINUX_DO_OAUTH_AUTHORIZE_URL: `${providerBaseURL}/oauth2/authorize`,
      LINUX_DO_OAUTH_TOKEN_URL: `${providerBaseURL}/oauth2/token`,
      LINUX_DO_OAUTH_USERINFO_URL: `${providerBaseURL}/api/user`,
      LINUX_DO_OAUTH_JWKS_URL: `${providerBaseURL}/.well-known/jwks.json`,
      TAOYUAN_QA_FAIL_OAUTH_IDENTITY_WRITE_SUB: forcedIdentityFailureSub,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', chunk => {
    const text = chunk.toString()
    serverLogs.push(text)
    process.stdout.write(text)
  })
  child.stderr.on('data', chunk => {
    const text = chunk.toString()
    serverLogs.push(text)
    process.stderr.write(text)
  })
  return child
}

const stopServer = async () => {
  if (!serverProcess || serverProcess.killed) return
  await new Promise(resolve => {
    serverProcess.once('exit', () => resolve())
    try {
      serverProcess.kill('SIGTERM')
    } catch {
      resolve()
    }
    setTimeout(resolve, 3000)
  })
}

const cleanup = async () => {
  await stopServer()
  await closeProvider()
  await rm(tempDir, { recursive: true, force: true }).catch(() => {})
}

const getStartRedirect = async (session, returnTo = '/taoyuan') => {
  const response = await request(`/api/auth/linux-do/start?return_to=${encodeURIComponent(returnTo)}`, session)
  assert(response.status === 302, `start returned ${response.status}`)
  const location = response.headers.get('location') || ''
  const authUrl = new URL(location)
  assert(authUrl.origin === providerBaseURL, 'start did not redirect to mock provider')
  assert(authUrl.searchParams.get('response_type') === 'code', 'response_type must be code')
  assert(authUrl.searchParams.get('scope') === 'openid profile', 'scope must be openid profile')
  assert(authUrl.searchParams.get('code_challenge_method') === 'S256', 'PKCE method must be S256')
  assert(authUrl.searchParams.get('state')?.length > 30, 'state is not high entropy')
  assert(authUrl.searchParams.get('nonce')?.length > 30, 'nonce is not high entropy')
  assert(authUrl.searchParams.get('code_challenge')?.length > 30, 'code_challenge is missing')
  return authUrl
}

const authorizeAndCallback = async (authUrl, session, options = {}) => {
  if (options.mode) authUrl.searchParams.set('mock_mode', options.mode)
  if (options.sub) authUrl.searchParams.set('mock_sub', options.sub)
  if (options.code) authUrl.searchParams.set('mock_code', options.code)
  const providerResponse = await fetch(authUrl, { redirect: 'manual' })
  assert(providerResponse.status === 302, `provider authorize returned ${providerResponse.status}`)
  const callbackUrl = providerResponse.headers.get('location') || ''
  const callbackResponse = await request(callbackUrl, session, {
    headers: options.headers || {},
  })
  assert(callbackResponse.status === 302, `callback returned ${callbackResponse.status}`)
  return callbackResponse.headers.get('location') || ''
}

const loginFlow = async (sub, options = {}) => {
  const session = {}
  const authUrl = await getStartRedirect(session, options.returnTo || '/taoyuan')
  const location = await authorizeAndCallback(authUrl, session, { ...options, sub })
  return { session, location }
}

try {
  await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  await listen(providerServer)
  serverProcess = startServer()
  await waitForServer(`${baseURL}/api/health`)

  await runCheck('public-config exposes only safe OAuth fields', async () => {
    const response = await request('/api/public-config')
    const data = await readJson(response)
    assert(response.ok && data?.ok === true, 'public-config failed')
    assert(data.linux_do_oauth_enabled === true, 'public-config missing enabled flag')
    assert(data.linux_do_oauth_start_path === '/api/auth/linux-do/start', 'public-config start path mismatch')
    const raw = JSON.stringify(data)
    assert(!raw.includes(clientSecret), 'public-config leaked client_secret')
    assert(!raw.includes(providerBaseURL), 'public-config leaked provider URL')
    assert(!raw.includes(clientId), 'public-config leaked client id')
  })

  await runCheck('start sanitizes return_to and emits OIDC PKCE params', async () => {
    const session = {}
    const authUrl = await getStartRedirect(session, 'https://evil.example/pwn')
    const location = await authorizeAndCallback(authUrl, session, { sub: 'return-to-sub' })
    assert(location.includes('linuxdo=success'), 'callback should succeed')
    assert(location.includes('redirect=%2F'), 'illegal return_to should fallback to /')
  })

  let firstUsername = ''
  await runCheck('JSON auto-create login and /api/me', async () => {
    const { session, location } = await loginFlow('linux-do-sub-main')
    assert(location.includes('linuxdo=success'), `login did not succeed: ${location}`)
    const meResponse = await request('/api/me', session)
    const me = await readJson(meResponse)
    assert(meResponse.ok && me?.ok === true, '/api/me failed after OAuth login')
    firstUsername = me.user.username
    assert(/^ldo_[a-f0-9]{16}$/.test(firstUsername), 'auto-created username format is invalid')
  })

  await runCheck('duplicate callback is rejected after one-time state consumption', async () => {
    const session = {}
    const authUrl = await getStartRedirect(session)
    const providerResponse = await fetch(authUrl, { redirect: 'manual' })
    const callbackUrl = providerResponse.headers.get('location') || ''
    const okLocation = (await request(callbackUrl, session)).headers.get('location') || ''
    assert(okLocation.includes('linuxdo=success'), 'first callback should succeed')
    const replayLocation = (await request(callbackUrl, session)).headers.get('location') || ''
    assert(replayLocation.includes('linuxdo_error=state_invalid'), 'replayed callback should fail with state_invalid')
  })

  await runCheck('repeat login reuses existing project account', async () => {
    const { session, location } = await loginFlow('linux-do-sub-main')
    assert(location.includes('linuxdo=success'), 'repeat login failed')
    const meResponse = await request('/api/me', session)
    const me = await readJson(meResponse)
    assert(me?.user?.username === firstUsername, 'repeat login did not reuse the same account')
  })

  await runCheck('ID Token and userinfo failures return short error codes', async () => {
    for (const [mode, expected] of [
      ['bad_nonce', 'id_token_nonce'],
      ['expired', 'id_token_exp'],
      ['bad_aud', 'id_token_aud'],
      ['userinfo_mismatch', 'subject_mismatch'],
      ['userinfo_error', 'userinfo_failed'],
    ]) {
      const { location } = await loginFlow(`sub-${mode}`, { mode })
      assert(location.includes(`linuxdo_error=${expected}`), `${mode} should fail as ${expected}, got ${location}`)
    }
  })

  await runCheck('provider inactive/silenced accounts are rejected', async () => {
    const inactive = await loginFlow('inactive-sub', { mode: 'provider_inactive' })
    assert(inactive.location.includes('linuxdo_error=provider_inactive'), 'inactive provider account should be rejected')
    const silenced = await loginFlow('silenced-sub', { mode: 'provider_silenced' })
    assert(silenced.location.includes('linuxdo_error=provider_silenced'), 'silenced provider account should be rejected')
  })

  await runCheck('local banned/deleted users are rejected before session login', async () => {
    const banned = await loginFlow('banned-sub')
    const bannedMe = await readJson(await request('/api/me', banned.session))
    const bannedUsername = bannedMe.user.username
    const banResponse = await request(`/api/admin/users/${encodeURIComponent(bannedUsername)}/status`, {}, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': 'taoyuan_smoke_admin_token_123',
      },
      body: JSON.stringify({ status: 'banned' }),
    })
    assert(banResponse.ok, 'failed to ban OAuth user')
    const bannedAgain = await loginFlow('banned-sub')
    assert(bannedAgain.location.includes('linuxdo_error=local_banned'), 'banned local user should be rejected')

    const deleted = await loginFlow('deleted-sub')
    const deletedMe = await readJson(await request('/api/me', deleted.session))
    const deletedUsername = deletedMe.user.username
    const deleteResponse = await request(`/api/admin/users/${encodeURIComponent(deletedUsername)}`, {}, {
      method: 'DELETE',
      headers: {
        'X-Admin-Token': 'taoyuan_smoke_admin_token_123',
      },
    })
    assert(deleteResponse.ok, 'failed to delete OAuth user')
    const deletedAgain = await loginFlow('deleted-sub')
    assert(deletedAgain.location.includes('linuxdo_error=local_deleted'), 'deleted local user should be rejected')
  })

  await runCheck('callback logs do not expose code/state/tokens/secrets', async () => {
    const session = {}
    const authUrl = await getStartRedirect(session)
    const sensitiveCode = 'sensitive_code_secret_123'
    const sensitiveState = authUrl.searchParams.get('state') || ''
    const location = await authorizeAndCallback(authUrl, session, {
      sub: 'log-sub',
      code: sensitiveCode,
      headers: {
        Authorization: 'Bearer should_not_log_authorization',
        Referer: `${baseURL}/api/auth/linux-do/callback?code=referer_code_should_not_log&state=referer_state_should_not_log`,
      },
    })
    assert(location.includes('linuxdo=success'), 'log sensitivity login should succeed')
    await wait(300)
    const logs = serverLogs.join('')
    for (const secret of [
      sensitiveCode,
      sensitiveState,
      clientSecret,
      'should_not_log_authorization',
      'referer_code_should_not_log',
      'referer_state_should_not_log',
    ]) {
      assert(!logs.includes(secret), `server logs leaked sensitive value: ${secret}`)
    }
  })

  const mysqlEnvProvided = Boolean(process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_DATABASE)
  if (mysqlEnvProvided) {
    console.log('[qa:auth-oauth] MySQL env detected; JSON smoke ran in isolated mode, run MySQL scenario with dedicated DB in follow-up.')
  } else {
    console.log('[qa:auth-oauth] MySQL env not provided; skipped MySQL OAuth identity sub-scenario.')
  }

  console.log(`[qa:auth-oauth] passed ${checks.length} checks`)
} finally {
  await cleanup()
}

'use strict'

/**
 * End-to-end check of the approval HTTP surface against a throwaway DSH_HOME.
 *
 * This mounts the plugin's real route handler on a plain node:http server with
 * a stubbed Cordis context, so the request handling, trust fence, status codes
 * and JSON shapes are exercised as shipped — without starting DSH, without the
 * real profile and without touching the real skill library.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const { join } = require('node:path')

async function mount(t, { rejection } = {}) {
  const home = await fsp.mkdtemp(join(os.tmpdir(), 'hermes-http-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  await fsp.mkdir(join(home, 'hermes-loop', 'pending'), { recursive: true })
  await fsp.mkdir(join(home, 'skills'), { recursive: true })
  await fsp.mkdir(join(home, 'memory'), { recursive: true })

  let handler
  const routes = []
  const effects = []
  const ctx = {
    logger: { info() {}, warn() {}, debug() {} },
    settings: {
      describe: () => [{ ns: 'hermes-loop', value: {} }],
      update: async () => {},
    },
    systemPrompt: { section: () => () => {}, context: () => () => {} },
    skills: { snapshot: async () => ({ skills: [] }) },
    sessions: {
      // 'session-http' is the source session every staged test candidate names;
      // 'session-verify' is not, so its absence stays testable.
      get: (id) => (id === 'session-http'
        ? { id, header: { cwd: '/work/http-test' }, deriveMessages: () => [{ role: 'user', content: 'hi' }] }
        : undefined),
    },
    agents: {},
    agentDefaultModel: {},
    connection: { requestRejection: () => rejection },
    on: () => () => {},
    get: () => undefined,
    provide: () => {},
    effect: (fn) => { const dispose = fn(); effects.push(dispose); return dispose },
    inject: (names, cb) => cb({
      webServer: { register: (route) => { routes.push(route); return () => {} } },
    }),
  }

  delete require.cache[require.resolve('../src/index')]
  const plugin = require('../src/index')
  plugin.apply(ctx, { mode: 'approval' })
  assert.equal(routes.length, 1, 'the plugin must register exactly one prefix route')
  handler = routes[0].handler
  assert.equal(routes[0].kind, 'prefix')

  const server = http.createServer((req, res) => { handler(req, res).catch(() => { res.writeHead(500); res.end() }) })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  const base = `http://127.0.0.1:${port}/hermes-loop/api`

  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: text === '' ? undefined : JSON.parse(text) }
  }

  const stage = async (id, payload) => {
    await fsp.writeFile(join(home, 'hermes-loop', 'pending', `${id}.json`), JSON.stringify(payload, null, 2), 'utf8')
  }

  t.after(async () => {
    await new Promise((r) => server.close(r))
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await fsp.rm(home, { recursive: true, force: true })
  })

  return { home, call, stage, plugin, ctx }
}

const candidate = (id, extra = {}) => ({
  id,
  at: '2026-11-13T00:00:00.000Z',
  sourceSession: 'session-http',
  mode: 'approval',
  globalDir: '/stale/skills',
  memoryDir: '/stale/memory',
  cwd: '/work/http-test',
  conclusion: {
    action: 'create',
    skill: 'http-skill',
    description: 'HTTP test skill',
    body: '# HTTP\n\nBody.',
    rationale: 'staged for the http test',
  },
  ...extra,
})

test('the trust fence answers before any route logic', async (t) => {
  const { call, stage } = await mount(t, { rejection: 401 })
  await stage('h1', candidate('h1'))
  const res = await call('GET', '/pending')
  assert.equal(res.status, 401)
  assert.equal(res.body, undefined, 'a rejected request must be empty, not a JSON body')
})

test('list, detail and decide work over HTTP and write once', async (t) => {
  const { call, stage, home } = await mount(t)
  await stage('h2', candidate('h2'))

  const list = await call('GET', '/pending')
  assert.equal(list.status, 200)
  assert.equal(list.body.total, 1)
  assert.equal(list.body.rows[0].skill, 'http-skill')
  assert.equal(list.body.rows[0].revision, 1)

  const detail = await call('GET', '/pending/detail?id=h2')
  assert.equal(detail.status, 200)
  assert.equal(detail.body.channels.skill.action, 'create')
  assert.ok(Array.isArray(detail.body.warnings))

  const decide = await call('POST', '/pending/decide', {
    id: 'h2', expectedRevision: detail.body.revision, operationId: 'op-http000001', skill: 'apply',
  })
  assert.equal(decide.status, 200)
  assert.equal(decide.body.status, 'applied')
  assert.equal(decide.body.results.skill.verified, true)
  const written = await fsp.readFile(join(home, 'skills', 'http-skill', 'SKILL.md'), 'utf8')
  assert.match(written, /# HTTP/)

  const receipt = await call('GET', '/operations?operationId=op-http000001')
  assert.equal(receipt.status, 200)
  assert.equal(receipt.body.state, 'done')
  assert.equal(receipt.body.result.status, 'applied')
})

test('stale revision, unknown id and bad input map to distinct statuses', async (t) => {
  const { call, stage } = await mount(t)
  await stage('h3', candidate('h3'))
  const detail = await call('GET', '/pending/detail?id=h3')

  const stale = await call('POST', '/pending/decide', {
    id: 'h3', expectedRevision: detail.body.revision + 5, operationId: 'op-http000002', skill: 'apply',
  })
  assert.equal(stale.status, 409)
  assert.equal(stale.body.code, 'EREVISION')

  const blankReq = await call('POST', '/pending/improve', { id: 'h3', instruction: '   ' })
  assert.equal(blankReq.status, 400)
  assert.equal(blankReq.body.code, 'EINVALID')

  const missing = await call('GET', '/pending/detail?id=nope-nope')
  assert.equal(missing.status, 404)
  assert.equal(missing.body.code, 'ENOTFOUND')

  const traversal = await call('GET', '/pending/detail?id=..%2Fetc%2Fpasswd')
  assert.equal(traversal.status, 400)
  assert.equal(traversal.body.code, 'EINVALID')

  const noOp = await call('POST', '/pending/decide', { id: 'h3', skill: 'apply' })
  assert.equal(noOp.status, 400)
  assert.equal(noOp.body.code, 'EINVALID')

  const badChannel = await call('POST', '/pending/decide', { id: 'h3', operationId: 'op-http000003', skill: 'maybe' })
  assert.equal(badChannel.status, 400)
  assert.equal(badChannel.body.code, 'EINVALID')
})

test('an oversized requirement is refused rather than silently cut', async (t) => {
  const { call, stage } = await mount(t)
  await stage('h4', candidate('h4'))
  const res = await call('POST', '/pending/improve', { id: 'h4', instruction: 'x'.repeat(5000) })
  assert.equal(res.status, 413)
  assert.equal(res.body.code, 'ETOOLARGE')
})

test('an oversized request body is refused cleanly instead of dropping the socket', async (t) => {
  const { call, stage } = await mount(t)
  await stage('h4b', candidate('h4b'))
  const res = await call('POST', '/pending/improve', { id: 'h4b', instruction: 'x'.repeat(70 * 1024) })
  assert.equal(res.status, 413)
  assert.equal(res.body.code, 'ETOOLARGE')
})

test('a requirement without a live source session is refused, not faked', async (t) => {
  const { call, stage, home } = await mount(t)
  // A candidate whose source session is not live here.
  await stage('h5', candidate('h5', { sourceSession: 'session-closed' }))
  const detail = await call('GET', '/pending/detail?id=h5')
  assert.equal(detail.body.sourceKnown, true)

  // The stubbed sessions service knows no session, which is exactly the case a
  // real deployment hits once the source conversation has closed.
  const res = await call('POST', '/pending/improve', { id: 'h5', instruction: 'shorten the description' })
  assert.equal(res.status, 409)
  assert.equal(res.body.code, 'ESESSIONGONE')

  const after = await call('GET', '/pending/detail?id=h5')
  assert.equal(after.body.revision, detail.body.revision, 'refusal must not mutate the candidate')
  assert.equal(fs.existsSync(join(home, 'skills', 'http-skill')), false, 'nothing written')
})

test('a curator candidate cannot be revised from a source it does not have', async (t) => {
  const { call, stage } = await mount(t)
  await stage('h5b', {
    ...candidate('h5b'),
    sourceSession: 'curator',
    governance: { action: 'archive', skill: 'x-skill', from: 'stale' },
    conclusion: { action: 'nothing', rationale: 'curator' },
  })
  const res = await call('POST', '/pending/improve', { id: 'h5b', instruction: 'do not archive' })
  assert.equal(res.status, 409)
  assert.equal(res.body.code, 'ENOSOURCE')
})

test('an improvement for a live source delivers the requirement into the review prompt', async (t) => {
  const { call, stage, plugin, sessions } = await mount(t)
  await stage('h7', candidate('h7'))
  const out = await call('POST', '/pending/improve', {
    id: 'h7', instruction: 'cut the description under 60 characters',
  })
  assert.equal(out.status, 202)
  assert.equal(out.body.delivered, 'instruction')
  assert.equal(out.body.candidateId, 'h7')
  // The requirement is real prompt text, not a UI label: it reaches the review run.
  const prompt = plugin.__internals.REVISION_DIRECTIVE.en({
    candidateBody: 'BODY', instruction: 'cut the description under 60 characters',
  })
  assert.match(prompt, /cut the description under 60 characters/)
  assert.match(prompt, /BODY/)
})

test('unknown sub-paths and methods answer 404/405, not a crash', async (t) => {
  const { call } = await mount(t)
  const notFound = await call('GET', '/nope')
  assert.equal(notFound.status, 404)
  const wrongMethod = await call('POST', '/pending', {})
  assert.equal(wrongMethod.status, 405)
})

test('the legacy status endpoint still reports the inbox count', async (t) => {
  const { call, stage } = await mount(t)
  await stage('h6', candidate('h6'))
  const status = await call('GET', '/status?sessionId=')
  assert.equal(status.status, 200)
  assert.equal(typeof status.body.settings, 'object')
  assert.equal(status.body.pending.count, 1)
  assert.ok(Array.isArray(status.body.written), 'existing clients must keep their fields')
})

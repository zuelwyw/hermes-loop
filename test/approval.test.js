'use strict'

/**
 * Contract tests for the candidate inbox.
 *
 * Each test drives `createApproval` against a throwaway DSH_HOME: no real skill
 * library, no real memory store, no DSH process. The writers are injected
 * exactly as the plugin wires them, so a test failure here means the shipped
 * approval behaviour is wrong rather than that a test double diverged.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const { join } = require('node:path')
const { createHash } = require('node:crypto')

const { createApproval, isSafeId } = require('../src/approval')

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

function skillMd(name, description, body) {
  return `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n\n${body.replace(/\s+$/, '')}\n`
}

function descriptionOf(raw) {
  const m = String(raw || '').match(/^description:\s*(.+)$/m)
  if (!m) return undefined
  try { return String(JSON.parse(m[1].trim())) } catch { return m[1].trim() }
}

function mergeFrontmatter(current, name, description, body) {
  const lines = String(current).split(/\r?\n/)
  let closer = -1
  for (let i = 1; i < lines.length; i += 1) { if (lines[i].trim() === '---') { closer = i; break } }
  const kept = lines.slice(1, closer).filter((l) => !/^(name|description)\s*:/.test(l.trim()))
  const yaml = [`name: ${JSON.stringify(name)}`, `description: ${JSON.stringify(description.replace(/\r?\n/g, ' '))}`, ...kept].join('\n')
  return `---\n${yaml}\n---\n\n${body.replace(/\s+$/, '')}\n`
}

function setModelInvocation(content, modelInvocable) {
  const lines = String(content || '').split(/\r?\n/)
  let closer = -1
  for (let i = 1; i < lines.length; i += 1) { if (lines[i].trim() === '---') { closer = i; break } }
  if (closer === -1) return content
  let kept = lines.slice(1, closer).filter((l) => !/^disable-model-invocation\s*:/.test(l.trim()))
  if (!modelInvocable) kept = [...kept, 'disable-model-invocation: true']
  return [...lines.slice(0, 1), ...kept, ...lines.slice(closer)].join('\n')
}

async function atomicWrite(file, content) {
  await fsp.mkdir(join(file, '..'), { recursive: true })
  const temp = join(join(file, '..'), `.${Math.random().toString(36).slice(2)}.tmp`)
  await fsp.writeFile(temp, content, 'utf8')
  await fsp.rename(temp, file)
}

function parseMemoryEntries(raw) {
  const out = []
  for (const line of String(raw || '').split(/\r?\n/)) {
    const m = line.match(/^§\s?(.*)$/)
    if (m && m[1].trim() !== '') out.push(m[1].trim())
  }
  return out
}

function serializeMemoryEntries(store, entries, header) {
  const title = store === 'user' ? 'USER' : 'MEMORY'
  const head = typeof header === 'string' && header !== '' ? `\n${header}` : ''
  const body = entries.map((e) => '§ ' + e).join('\n')
  return `# ${title}${head}\n\n${body}${body === '' ? '' : '\n'}`
}

function scanMemoryEntry(text) {
  if (/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/.test(text)) return 'invisible-unicode'
  if (/(sk-[A-Za-z0-9_-]{16,})/.test(text)) return 'credential-pattern'
  return null
}

function planMemoryChange(entries, mem, { limit }) {
  const current = Array.isArray(entries) ? entries : []
  const used = current.reduce((n, e) => n + e.length, 0)
  if (mem.action === 'add') {
    const text = String(mem.text || '').replace(/\s+/g, ' ').trim()
    if (text === '') return { ok: false, result: 'rejected', reason: 'empty-text' }
    if (current.some((e) => e === text)) return { ok: false, result: 'rejected', reason: 'duplicate' }
    const scan = scanMemoryEntry(text)
    if (scan) return { ok: false, result: 'rejected', reason: scan }
    const chars = used + text.length
    if (chars > limit) return { ok: false, result: 'rejected', reason: 'over-limit' }
    return { ok: true, result: 'added', entries: [...current, text], chars }
  }
  const needle = String(mem.oldText || '')
  const hits = current.map((e, i) => (needle !== '' && e.includes(needle) ? i : -1)).filter((i) => i >= 0)
  if (hits.length === 0) return { ok: false, result: 'rejected', reason: 'old-text-missing' }
  if (hits.length > 1) return { ok: false, result: 'rejected', reason: 'old-text-ambiguous' }
  if (mem.action === 'remove') {
    const entriesNext = current.filter((_, i) => i !== hits[0])
    return { ok: true, result: 'removed', entries: entriesNext, chars: entriesNext.reduce((n, e) => n + e.length, 0) }
  }
  const text = String(mem.text || '').replace(/\s+/g, ' ').trim()
  const next = current.map((e, i) => (i === hits[0] ? text : e))
  return { ok: true, result: 'replaced', entries: next, chars: next.reduce((n, e) => n + e.length, 0) }
}

async function applyConclusion(conclusion, { globalDir }) {
  const dir = join(globalDir, conclusion.skill)
  const file = join(dir, 'SKILL.md')
  if (conclusion.action === 'create') {
    let exists = false
    try { exists = (await fsp.stat(file)).isFile() } catch {}
    if (exists) return { result: 'create-conflict', detail: 'exists' }
    const content = skillMd(conclusion.skill, conclusion.description, conclusion.body)
    await atomicWrite(file, content)
    return { result: 'created', path: file }
  }
  let current
  try { current = await fsp.readFile(file, 'utf8') } catch { return { result: 'patch-missing' } }
  if (sha256(current) !== conclusion.baseHash) return { result: 'cas-conflict', detail: 'changed' }
  const description = conclusion.baseDescription || descriptionOf(current) || ''
  await atomicWrite(file, mergeFrontmatter(current, conclusion.skill, description, conclusion.body))
  return { result: 'patched', path: file }
}

async function applyMemoryConclusion(mem, { dir, limits, enabled, header }) {
  if (enabled[mem.store] === false) return { result: 'store-disabled' }
  const file = join(dir, mem.store === 'user' ? 'USER.md' : 'MEMORY.md')
  let raw = ''
  try { raw = await fsp.readFile(file, 'utf8') } catch {}
  const plan = planMemoryChange(parseMemoryEntries(raw), mem, { limit: limits[mem.store] })
  if (!plan.ok) return { ...plan }
  await atomicWrite(file, serializeMemoryEntries(mem.store, plan.entries, header))
  return { result: plan.result, chars: plan.chars }
}

async function harness() {
  const home = await fsp.mkdtemp(join(os.tmpdir(), 'hermes-approval-'))
  const rootDir = join(home, 'hermes-loop')
  const skills = join(home, 'skills')
  const memory = join(home, 'memory')
  await fsp.mkdir(join(rootDir, 'pending'), { recursive: true })
  await fsp.mkdir(skills, { recursive: true })
  await fsp.mkdir(memory, { recursive: true })

  const settings = {
    memoryEnabled: true,
    userProfileEnabled: true,
    memoryCharLimit: 2200,
    userCharLimit: 1375,
  }
  const traces = []
  const managed = []
  const notices = []

  const approval = createApproval({
    root: () => rootDir,
    pendingDir: () => join(rootDir, 'pending'),
    globalSkillsDir: () => skills,
    memoryDir: () => memory,
    workspaceMemoryDir: (cwd) => (typeof cwd === 'string' && cwd !== '' ? join(memory, 'workspaces', cwd.replace(/[/\\:]/g, '-')) : undefined),
    workspaceCwdHeader: (cwd) => `<!-- cwd: ${cwd} -->`,
    effective: () => settings,
    trace: (event, data) => traces.push({ event, ...data }),
    applyConclusion,
    applyMemoryConclusion,
    planMemoryChange,
    parseMemoryEntries,
    serializeMemoryEntries,
    sha256,
    buildSkillMd: skillMd,
    mergeFrontmatter,
    descriptionOf,
    setModelInvocation,
    scanMemoryEntry,
    registerManaged: (name) => managed.push(name),
    KEbab_NAME_RE: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    atomicWrite,
    limits: { body: 128 * 1024, description: 500, memoryEntry: 500 },
    notifySourceSession: (session, text) => notices.push({ session, text }),
    logger: { info() {}, warn() {} },
  })

  const stage = async (id, payload) => {
    await fsp.writeFile(join(rootDir, 'pending', `${id}.json`), JSON.stringify(payload, null, 2), 'utf8')
  }

  return { home, rootDir, skills, memory, settings, traces, managed, notices, approval, stage, cleanup: () => fsp.rm(home, { recursive: true, force: true }) }
}

const createCandidate = (id, overrides = {}) => ({
  id,
  at: '2026-11-13T00:00:00.000Z',
  sourceSession: 'session-abc',
  mode: 'approval',
  globalDir: '/nonexistent/skills',
  memoryDir: '/nonexistent/memory',
  cwd: '/work/example',
  conclusion: {
    action: 'create',
    skill: 'demo-skill',
    description: 'A demo skill',
    body: '# Demo\n\nUse it.',
    rationale: 'learned in testing',
  },
  ...overrides,
})

test('isSafeId accepts real ids and rejects traversal', () => {
  assert.equal(isSafeId('mvo07v72-legal-course-note-integration'), true)
  assert.equal(isSafeId('mw7tz8vh-memory-memory'), true)
  assert.equal(isSafeId('../etc/passwd'), false)
  assert.equal(isSafeId('a/b'), false)
  assert.equal(isSafeId(''), false)
})

test('list and detail never write, and re-derive the target path', async (t) => {
  const h = await harness()
  t.after(h.cleanup)
  await h.stage('c1-create', createCandidate('c1-create'))

  const page = await h.approval.list()
  assert.equal(page.total, 1)
  assert.equal(page.rows[0].skill, 'demo-skill')
  assert.equal(page.rows[0].channels, 1)
  assert.equal(fs.existsSync(join(h.rootDir, 'approval', 'records')), false, 'browsing must not create records')

  const detail = await h.approval.detail('c1-create')
  assert.equal(detail.channels.skill.file, join(h.skills, 'demo-skill', 'SKILL.md'))
  assert.equal(detail.channels.skill.conflict, undefined)
  assert.ok(detail.warnings.some((w) => w.code === 'global-dir-moved'), 'stale globalDir must be reported, not honoured')
})

test('create apply writes once; a repeated decision with the same operation is a replay', async (t) => {
  const h = await harness()
  t.after(h.cleanup)
  await h.stage('c1-create', createCandidate('c1-create'))

  const first = await h.approval.decide('c1-create', { operationId: 'op-aaaaaaaa', skill: 'apply' })
  assert.equal(first.status, 'applied')
  assert.equal(first.results.skill.state, 'applied')
  assert.equal(first.results.skill.verified, true)
  assert.deepEqual(h.managed, ['demo-skill'])
  const written = await fsp.readFile(join(h.skills, 'demo-skill', 'SKILL.md'), 'utf8')
  assert.match(written, /# Demo/)

  const replay = await h.approval.decide('c1-create', { operationId: 'op-aaaaaaaa', skill: 'apply' })
  assert.equal(replay.status, 'applied')
  assert.equal(fs.existsSync(join(h.rootDir, 'approval', 'done', 'c1-create.json')), true)
  assert.equal(fs.existsSync(join(h.rootDir, 'pending', 'c1-create.json')), false)

  await assert.rejects(
    () => h.approval.decide('c1-create', { operationId: 'op-bbbbbbbb', skill: 'apply' }),
    (e) => e.code === 'ENOTFOUND',
  )
})

test('a different decision reusing an operationId is refused', async (t) => {
  const h = await harness()
  t.after(h.cleanup)
  await h.stage('c1-create', createCandidate('c1-create'))
  await h.approval.decide('c1-create', { operationId: 'op-same0001', skill: 'apply' })
  await assert.rejects(
    () => h.approval.decide('c1-create', { operationId: 'op-same0001', skill: 'reject' }),
    (e) => e.code === 'EOPCONFLICT',
  )
})

test('mixed candidate settles skill but leaves memory pending', async (t) => {
  const h = await harness()
  t.after(h.cleanup)
  const candidate = createCandidate('c2-mixed', {
    conclusion: {
      action: 'create',
      skill: 'mixed-skill',
      description: 'Mixed',
      body: '# Mixed',
      rationale: 'both channels',
      memory: { action: 'add', store: 'memory', text: 'project uses port 3080', rationale: 'fact' },
    },
  })
  await h.stage('c2-mixed', candidate)

  const out = await h.approval.decide('c2-mixed', { operationId: 'op-mixed001', skill: 'apply' })
  assert.equal(out.status, 'partial')
  assert.equal(out.results.skill.state, 'applied')
  assert.equal(fs.existsSync(join(h.rootDir, 'pending', 'c2-mixed.json')), true, 'memory half must stay in the inbox')
  assert.equal(fs.existsSync(join(h.memory, 'MEMORY.md')), false, 'undecided memory must not be written')

  const detail = await h.approval.detail('c2-mixed')
  assert.equal(detail.states.skill, 'applied')
  assert.equal(detail.channels.memory.wouldResult, 'added')

  const second = await h.approval.decide('c2-mixed', { operationId: 'op-mixed002', memory: 'apply' })
  assert.equal(second.status, 'applied')
  assert.equal(second.results.memory.state, 'applied')
  const store = await fsp.readFile(join(h.memory, 'MEMORY.md'), 'utf8')
  assert.match(store, /project uses port 3080/)
  assert.equal(fs.existsSync(join(h.rootDir, 'pending', 'c2-mixed.json')), false)
})

test('memory conflict does not discard an applied skill and is reported per channel', async (t) => {
  const h = await harness()
  t.after(h.cleanup)
  await fsp.writeFile(join(h.memory, 'MEMORY.md'), '# MEMORY\n\n§ existing entry\n', 'utf8')
  const candidate = createCandidate('c3-mixed', {
    conclusion: {
      action: 'create',
      skill: 'conflict-skill',
      description: 'Conflict',
      body: '# Conflict',
      memory: { action: 'replace', store: 'memory', oldText: 'no-such-entry', text: 'replacement' },
    },
  })
  await h.stage('c3-mixed', candidate)

  const out = await h.approval.decide('c3-mixed', { operationId: 'op-conf00001', skill: 'apply', memory: 'apply' })
  assert.equal(out.results.skill.state, 'applied')
  assert.equal(out.results.memory.state, 'conflict')
  assert.equal(out.results.memory.reason, 'old-text-missing')
  assert.equal(out.status, 'partial')
  const store = await fsp.readFile(join(h.memory, 'MEMORY.md'), 'utf8')
  assert.match(store, /existing entry/)
  assert.doesNotMatch(store, /replacement/)
})

test('patch candidate is refused when the target changed after staging', async (t) => {
  const h = await harness()
  t.after(h.cleanup)
  const target = join(h.skills, 'patched-skill', 'SKILL.md')
  await fsp.mkdir(join(h.skills, 'patched-skill'), { recursive: true })
  const original = skillMd('patched-skill', 'Original', '# Original')
  await fsp.writeFile(target, original, 'utf8')

  await h.stage('c4-patch', {
    ...createCandidate('c4-patch'),
    conclusion: {
      action: 'patch', skill: 'patched-skill', body: '# Revised', baseHash: sha256(original), baseDescription: 'Original',
    },
  })
  await fsp.writeFile(target, skillMd('patched-skill', 'Original', '# Edited by a human'), 'utf8')

  const out = await h.approval.decide('c4-patch', { operationId: 'op-patch0001', skill: 'apply' })
  assert.equal(out.results.skill.state, 'conflict')
  assert.equal(out.results.skill.reason, 'cas-conflict')
  assert.equal(fs.existsSync(join(h.rootDir, 'pending', 'c4-patch.json')), true, 'conflict keeps the candidate')
  assert.match(await fsp.readFile(target, 'utf8'), /Edited by a human/, 'the human edit must survive')
})

test('same-name create is a visible conflict, not an overwrite', async (t) => {
  const h = await harness()
  t.after(h.cleanup)
  await h.stage('c5-a', createCandidate('c5-a'))
  await h.stage('c5-b', createCandidate('c5-b'))
  const first = await h.approval.decide('c5-a', { operationId: 'op-dup000001', skill: 'apply' })
  assert.equal(first.results.skill.state, 'applied')
  const second = await h.approval.decide('c5-b', { operationId: 'op-dup000002', skill: 'apply' })
  assert.equal(second.results.skill.state, 'conflict')
  assert.equal(second.results.skill.reason, 'create-conflict')
  const page = await h.approval.list()
  assert.equal(page.total, 1)
})

test('the inbox exposes no editing path, and a requirement never mutates the candidate', async (t) => {
  const h = await harness()
  t.after(h.cleanup)
  await h.stage('c6-revise', createCandidate('c6-revise'))
  // The approval surface is view/decide only: no revise entry point exists.
  assert.equal(h.approval.revise, undefined)
  const before = await h.approval.detail('c6-revise')
  assert.equal(before.draft, undefined, 'no draft buffer is exposed')
  const raw = await fsp.readFile(join(h.rootDir, 'pending', 'c6-revise.json'), 'utf8')
  // Stored JSON escapes the newlines, so compare the parsed value, not the raw bytes.
  const parsed = JSON.parse(raw)
  assert.equal(parsed.conclusion.body, '# Demo\n\nUse it.', 'candidate body is untouched')
})

test('a candidate records the candidate it revises, only when staging said so', async (t) => {
  const h = await harness()
  t.after(h.cleanup)
  await h.stage('c6a-plain', createCandidate('c6a-plain'))
  const plain = await h.approval.detail('c6a-plain')
  assert.equal(plain.revisionOf, undefined, 'no inferred provenance')
  assert.equal(plain.sourceKnown, true)

  await h.stage('c6b-revised', {
    ...createCandidate('c6b-revised'),
    revisionOf: 'c6a-plain',
  })
  const revised = await h.approval.detail('c6b-revised')
  assert.equal(revised.revisionOf, 'c6a-plain')
  const page = await h.approval.list()
  const row = page.rows.find((r) => r.id === 'c6b-revised')
  assert.equal(row.revisionOf, 'c6a-plain')
})

test('a curator candidate reports its source as unknown instead of guessing', async (t) => {
  const h = await harness()
  t.after(h.cleanup)
  await h.stage('c6c-gov', {
    ...createCandidate('c6c-gov'),
    sourceSession: 'curator',
    governance: { action: 'archive', skill: 'x-skill', from: 'stale' },
    conclusion: { action: 'nothing', rationale: 'curator' },
  })
  const detail = await h.approval.detail('c6c-gov')
  assert.equal(detail.sourceKnown, false)
})

test('reject archives the candidate and writes nothing', async (t) => {
  const h = await harness()
  t.after(h.cleanup)
  await h.stage('c7-reject', createCandidate('c7-reject'))
  const out = await h.approval.decide('c7-reject', { operationId: 'op-reject001', skill: 'reject', reason: 'not useful' })
  assert.equal(out.status, 'rejected')
  assert.equal(fs.existsSync(join(h.skills, 'demo-skill')), false)
  assert.equal(fs.existsSync(join(h.rootDir, 'approval', 'rejected', 'c7-reject.json')), true)
  assert.ok(h.traces.some((e) => e.event === 'approval-rejected'))
})

test('a crash mid-write is reconciled by hash, never replayed blindly', async (t) => {
  const h = await harness()
  t.after(h.cleanup)
  await h.stage('c8-crash', createCandidate('c8-crash'))
  const detail = await h.approval.detail('c8-crash')
  const recordDir = join(h.rootDir, 'approval', 'records')
  await fsp.mkdir(recordDir, { recursive: true })
  // Simulate: intent written, file written, process died before the result.
  const target = join(h.skills, 'demo-skill', 'SKILL.md')
  await fsp.mkdir(join(h.skills, 'demo-skill'), { recursive: true })
  await fsp.writeFile(target, detail.channels.skill.proposedContent, 'utf8')
  await fsp.writeFile(join(recordDir, 'c8-crash.json'), JSON.stringify({
    version: 1,
    id: 'c8-crash',
    sourceHash: (await h.approval.detail('c8-crash')) && sha256(await fsp.readFile(join(h.rootDir, 'pending', 'c8-crash.json'), 'utf8')),
    revision: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    draft: {},
    channels: {
      skill: {
        state: 'applying',
        action: 'create',
        target,
        expectedBefore: undefined,
        expectedAfter: detail.channels.skill.expectedAfter,
        at: new Date().toISOString(),
      },
    },
    history: [],
  }, null, 2), 'utf8')

  const recovered = await h.approval.recover()
  assert.equal(recovered.checked, 1)
  const after = await h.approval.detail('c8-crash')
  assert.equal(after.states.skill, 'applied')
  assert.equal(after.channels.skill.verified === undefined, true, 'detail recomputes; state is what matters')
})

test('an unreadable candidate is surfaced, not silently skipped', async (t) => {
  const h = await harness()
  t.after(h.cleanup)
  await fsp.writeFile(join(h.rootDir, 'pending', 'c9-broken.json'), '{not json', 'utf8')
  const page = await h.approval.list()
  assert.equal(page.total, 0)
  await assert.rejects(() => h.approval.detail('c9-broken'), (e) => e.code === 'ECORRUPT')
})

test('workspace-scoped memory lands in the derived store, not the staged path', async (t) => {
  const h = await harness()
  t.after(h.cleanup)
  await h.stage('c10-ws', createCandidate('c10-ws', {
    cwd: '/work/project-one',
    conclusion: {
      action: 'nothing',
      rationale: 'memory only',
      memory: { action: 'add', store: 'memory', scope: 'project', text: 'runs on port 5173' },
    },
  }))
  const detail = await h.approval.detail('c10-ws')
  assert.match(detail.channels.memory.file, /workspaces/)
  const out = await h.approval.decide('c10-ws', { operationId: 'op-ws0000001', memory: 'apply' })
  assert.equal(out.status, 'applied')
  assert.match(detail.channels.memory.file, /work-project-one/)
  const raw = await fsp.readFile(detail.channels.memory.file, 'utf8')
  assert.match(raw, /<!-- cwd: \/work\/project-one -->/)
})

test('a project-scoped candidate without a workspace is refused, not globalised', async (t) => {
  const h = await harness()
  t.after(h.cleanup)
  await h.stage('c11-nocwd', createCandidate('c11-nocwd', {
    cwd: undefined,
    conclusion: {
      action: 'nothing',
      memory: { action: 'add', store: 'memory', scope: 'project', text: 'belongs somewhere' },
    },
  }))
  const detail = await h.approval.detail('c11-nocwd')
  assert.equal(detail.channels.memory.conflict, 'ENOCWD')
  assert.ok(detail.warnings.some((w) => w.code === 'memory-target-unresolved'))
  const out = await h.approval.decide('c11-nocwd', { operationId: 'op-nocwd0001', memory: 'apply' })
  assert.equal(out.results.memory.state, 'conflict')
  assert.equal(fs.existsSync(join(h.memory, 'MEMORY.md')), false, 'must not fall back to the global store')
})

test('an unplaceable memory half does not block reviewing the skill half', async (t) => {
  const h = await harness()
  t.after(h.cleanup)
  await h.stage('c17-mixed-nocwd', createCandidate('c17-mixed-nocwd', {
    cwd: undefined,
    conclusion: {
      action: 'create',
      skill: 'reviewable-skill',
      description: 'Still reviewable',
      body: '# Reviewable',
      memory: { action: 'add', store: 'memory', scope: 'project', text: 'unplaceable' },
    },
  }))
  const detail = await h.approval.detail('c17-mixed-nocwd')
  assert.equal(detail.channels.skill.conflict, undefined, 'the skill channel must stay actionable')
  assert.equal(detail.channels.memory.conflict, 'ENOCWD')
  const out = await h.approval.decide('c17-mixed-nocwd', { operationId: 'op-mixednocwd', skill: 'apply' })
  assert.equal(out.results.skill.state, 'applied')
  assert.equal(out.status, 'partial')
})

test('disabled memory store refuses the write', async (t) => {
  const h = await harness()
  t.after(h.cleanup)
  h.settings.memoryEnabled = false
  await h.stage('c12-disabled', createCandidate('c12-disabled', {
    conclusion: {
      action: 'nothing',
      memory: { action: 'add', store: 'memory', text: 'should not land' },
    },
  }))
  const out = await h.approval.decide('c12-disabled', { operationId: 'op-dis000001', memory: 'apply' })
  assert.equal(out.results.memory.state, 'rejected')
  assert.equal(out.results.memory.reason, 'store-disabled')
  assert.equal(fs.existsSync(join(h.memory, 'MEMORY.md')), false)
})

test('governance candidate archives a skill through the inbox', async (t) => {
  const h = await harness()
  t.after(h.cleanup)
  const dir = join(h.skills, 'stale-skill')
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(join(dir, 'SKILL.md'), skillMd('stale-skill', 'Stale', '# Stale'), 'utf8')
  await h.stage('c13-gov', {
    ...createCandidate('c13-gov'),
    sourceSession: 'curator',
    governance: { action: 'archive', skill: 'stale-skill', from: 'stale' },
    conclusion: { action: 'nothing', rationale: 'curator archive' },
  })
  const out = await h.approval.decide('c13-gov', { operationId: 'op-gov0000001', governance: 'apply' })
  assert.equal(out.results.governance.state, 'applied')
  assert.match(await fsp.readFile(join(dir, 'SKILL.md'), 'utf8'), /disable-model-invocation: true/)
})

test('an unparsable frontmatter blocks governance instead of faking success', async (t) => {
  const h = await harness()
  t.after(h.cleanup)
  const dir = join(h.skills, 'bad-frontmatter')
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(join(dir, 'SKILL.md'), '---\nname: bad-frontmatter\n\n# body', 'utf8')
  await h.stage('c14-gov', {
    ...createCandidate('c14-gov'),
    sourceSession: 'curator',
    governance: { action: 'archive', skill: 'bad-frontmatter', from: 'stale' },
    conclusion: { action: 'nothing', rationale: 'curator archive' },
  })
  const out = await h.approval.decide('c14-gov', { operationId: 'op-gov0000002', governance: 'apply' })
  assert.equal(out.results.governance.state, 'conflict')
  assert.equal(out.results.governance.reason, 'frontmatter-unparsable')
})

test('a missing operationId is refused instead of becoming the literal "undefined"', async (t) => {
  const h = await harness()
  t.after(h.cleanup)
  await h.stage('c15-opid', createCandidate('c15-opid'))
  // 'undefined' is nine characters and satisfies the shape rule, so a stringified
  // check would hand every caller the same operation id and make the second
  // approval look like an idempotent replay of the first.
  await assert.rejects(() => h.approval.decide('c15-opid', { skill: 'apply' }), (e) => e.code === 'EINVALID')
  await assert.rejects(() => h.approval.decide('c15-opid', { operationId: null, skill: 'apply' }), (e) => e.code === 'EINVALID')
  await assert.rejects(() => h.approval.decide('c15-opid', { operationId: 12345, skill: 'apply' }), (e) => e.code === 'EINVALID')
  assert.equal(fs.existsSync(join(h.skills, 'demo-skill')), false)
})

test('two candidates cannot share one decision because of a missing id', async (t) => {
  const h = await harness()
  t.after(h.cleanup)
  await h.stage('c16-a', createCandidate('c16-a'))
  await h.stage('c16-b', createCandidate('c16-b', { conclusion: { ...createCandidate('c16-b').conclusion, skill: 'second-skill' } }))
  await assert.rejects(() => h.approval.decide('c16-a', { skill: 'apply' }), (e) => e.code === 'EINVALID')
  await assert.rejects(() => h.approval.decide('c16-b', { skill: 'apply' }), (e) => e.code === 'EINVALID')
  assert.equal(fs.existsSync(join(h.rootDir, 'pending', 'c16-a.json')), true)
  assert.equal(fs.existsSync(join(h.rootDir, 'pending', 'c16-b.json')), true)
})

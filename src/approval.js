'use strict'

/**
 * Candidate inbox for hermes-loop: read, approve or reject the staged
 * conclusions that `mode: approval` writes to `hermes-loop/pending/`.
 *
 * This surface never edits a candidate. Improvement is a model action: the
 * reviewer states a requirement, a focused review runs on the source session,
 * and its output becomes a NEW staged candidate. The old one stays untouched
 * until a human approves or rejects it.
 *
 * Distinct from the host's `approval/request` seam: that grants one tool call
 * inside an open turn. These candidates are out-of-turn, survive restarts and
 * may sit for weeks, so they need their own durable state machine.
 *
 * Guarantees this module owns:
 *   - the staged file is never mutated; every decision is recorded beside it
 *   - each channel (skill / memory / governance) settles independently, so a
 *     memory conflict never discards an already-applied skill and never
 *     silently drops the memory half
 *   - every write is preceded by a durable intent carrying the exact content
 *     hash it expects on disk; a crash is reconciled by hash, not by replay
 *   - one operationId yields one effect, even across concurrent requests
 *
 * It does NOT claim to lock external editors: their writes surface as a hash
 * mismatch (conflict), never as an overwrite.
 */

const fsP = require('node:fs/promises')
const { join, resolve, sep } = require('node:path')
const { randomUUID } = require('node:crypto')

const PENDING_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const OPERATION_ID_RE = /^[A-Za-z0-9_-]{8,80}$/
const MAX_ID_LENGTH = 200
const LOCK_STALE_MS = 60_000
const LOCK_WAIT_MS = 5_000
const LOCK_POLL_MS = 25
const HISTORY_MAX = 100

/** Channel states. `applying` is durable intent: never a transient in-memory flag. */
const SETTLED = new Set(['applied', 'skipped', 'rejected'])

const isSafeId = (id) =>
  typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH &&
  !id.includes('..') && !id.includes('/') && !id.includes('\\') && PENDING_ID_RE.test(id)

/** Resolve `child` under `root` and refuse anything that escapes it. */
function insideRoot(root, child) {
  const base = resolve(root)
  const target = resolve(child)
  if (target !== base && !target.startsWith(base + sep)) {
    const error = new Error(`path escapes ${base}`)
    error.code = 'EPATH'
    throw error
  }
  return target
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Serialize every plugin-originated write (review dispatch, curator, approval).
 * Cross-process safe: the lock is a file, not a mutex, because the same DSH_HOME
 * may be served by more than one process.
 */
async function withLock(root, fn) {
  const file = insideRoot(root, join(root, 'approval.lock'))
  await fsP.mkdir(join(file, '..'), { recursive: true })
  const deadline = Date.now() + LOCK_WAIT_MS
  let handle
  for (;;) {
    try {
      handle = await fsP.open(file, 'wx')
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))
      break
    } catch (error) {
      if (error && error.code !== 'EEXIST') throw error
      // A crashed holder must not wedge the plugin forever.
      try {
        const stat = await fsP.stat(file)
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) { await fsP.rm(file, { force: true }); continue }
      } catch { /* holder vanished between open and stat */ }
      if (Date.now() > deadline) {
        const busy = new Error('another hermes-loop write is in progress')
        busy.code = 'EBUSY'
        throw busy
      }
      await sleep(LOCK_POLL_MS)
    }
  }
  try {
    return await fn()
  } finally {
    try { await handle.close() } catch {}
    try { await fsP.rm(file, { force: true }) } catch {}
  }
}

/** Durable, bounded review record stored beside — never instead of — the candidate. */
function emptyRecord(id, sourceHash) {
  return {
    version: 1,
    id,
    sourceHash,
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    channels: {},
    history: [],
  }
}

function pushHistory(record, entry) {
  record.history.push({ at: new Date().toISOString(), ...entry })
  if (record.history.length > HISTORY_MAX) record.history = record.history.slice(-HISTORY_MAX)
  record.updatedAt = new Date().toISOString()
}

/**
 * Build the approval service.
 *
 * @param {object} deps Injected so the module stays free of module-level I/O and
 *   so tests can drive it against a throwaway DSH_HOME.
 */
function createApproval(deps) {
  const {
    root, pendingDir, globalSkillsDir, memoryDir, workspaceMemoryDir,
    workspaceCwdHeader, effective, trace, applyConclusion, applyMemoryConclusion,
    planMemoryChange, parseMemoryEntries, serializeMemoryEntries, sha256,
    buildSkillMd, mergeFrontmatter, descriptionOf, setModelInvocation,
    scanMemoryEntry, registerManaged, KEbab_NAME_RE, atomicWrite,
    limits, notifySourceSession, logger,
  } = deps

  const recordDir = () => join(root(), 'approval', 'records')
  const doneDir = () => join(root(), 'approval', 'done')
  const rejectedDir = () => join(root(), 'approval', 'rejected')
  const opsDir = () => join(root(), 'approval', 'ops')
  const candidateFile = (id) => insideRoot(pendingDir(), join(pendingDir(), `${id}.json`))
  const recordFile = (id) => insideRoot(recordDir(), join(recordDir(), `${id}.json`))
  const opFile = (id) => insideRoot(opsDir(), join(opsDir(), `${id}.json`))

  async function readJson(file) {
    try { return JSON.parse(await fsP.readFile(file, 'utf8')) } catch { return undefined }
  }

  async function writeJson(file, value) {
    await atomicWrite(file, JSON.stringify(value, null, 2))
  }

  /** Load the staged candidate. A missing file is a settled candidate, not an error. */
  async function readCandidate(id) {
    const file = candidateFile(id)
    let raw
    try { raw = await fsP.readFile(file, 'utf8') } catch { return undefined }
    let payload
    try { payload = JSON.parse(raw) } catch {
      const error = new Error(`candidate '${id}' is not valid JSON`)
      error.code = 'ECORRUPT'
      throw error
    }
    return { payload, raw, hash: sha256(raw), file }
  }

  const loadRecord = async (id) => readJson(recordFile(id))

  async function saveRecord(record) {
    await writeJson(recordFile(record.id), record)
    return record
  }

  /** Create the record on first write; browsing never writes. */
  async function ensureRecord(id, sourceHash) {
    const existing = await loadRecord(id)
    if (existing !== undefined && existing.sourceHash === sourceHash) return existing
    const fresh = emptyRecord(id, sourceHash)
    if (existing !== undefined) {
      // The staged file changed underneath an existing review: keep the history,
      // drop channel state that no longer describes this content.
      fresh.revision = existing.revision + 1
      fresh.createdAt = existing.createdAt
      fresh.history = [...existing.history]
      pushHistory(fresh, { op: 'source-changed', detail: 'staged candidate re-staged; earlier channel state discarded' })
    }
    return fresh
  }

  // ── Target resolution ──────────────────────────────────────────────────
  // Paths recorded at staging time are snapshots: DSH_HOME may have moved and
  // the workspace memory root is derived from cwd. Always re-derive, and report
  // disagreement instead of silently following either value.
  function skillTarget(name) {
    if (typeof name !== 'string' || !KEbab_NAME_RE.test(name)) {
      const error = new Error(`invalid skill name '${name}'`)
      error.code = 'EINVALID'
      throw error
    }
    return insideRoot(globalSkillsDir(), join(globalSkillsDir(), name, 'SKILL.md'))
  }

  function memoryTarget(payload) {
    const mem = payload.conclusion && payload.conclusion.memory
    if (!mem || mem.action === 'nothing') return undefined
    const cwd = payload.cwd
    const dir = mem.scope === 'project' && mem.store !== 'user' ? workspaceMemoryDir(cwd) : memoryDir()
    if (dir === undefined) {
      const error = new Error('project-scoped memory candidate has no recorded workspace')
      error.code = 'ENOCWD'
      throw error
    }
    return { dir, file: insideRoot(dir, join(dir, mem.store === 'user' ? 'USER.md' : 'MEMORY.md')), header: dir === memoryDir() ? undefined : workspaceCwdHeader(cwd) }
  }

  function pathWarnings(payload, skillFile, memTarget) {
    const warnings = []
    const stagedGlobal = payload.globalDir
    if (typeof stagedGlobal === 'string' && skillFile !== undefined && resolve(stagedGlobal) !== resolve(globalSkillsDir())) {
      warnings.push({ code: 'global-dir-moved', staged: stagedGlobal, current: globalSkillsDir() })
    }
    const stagedMemory = payload.memoryDir
    if (typeof stagedMemory === 'string' && memTarget !== undefined && resolve(stagedMemory) !== resolve(memTarget.dir)) {
      warnings.push({ code: 'memory-dir-moved', staged: stagedMemory, current: memTarget.dir })
    }
    return warnings
  }

  // ── Preflight: what would applying this candidate do right now? ─────────
  async function planSkill(payload) {
    const c = payload.conclusion || {}
    if (c.action !== 'create' && c.action !== 'patch') return { present: false }
    const body = c.body
    const description = c.description
    const file = skillTarget(c.skill)
    let current
    try { current = await fsP.readFile(file, 'utf8') } catch { current = undefined }

    if (c.action === 'create') {
      if (body === undefined || String(body).trim() === '') return { present: true, action: 'create', name: c.skill, file, conflict: 'empty-body' }
      if (description === undefined || String(description).trim() === '') return { present: true, action: 'create', name: c.skill, file, conflict: 'empty-description' }
      if (current !== undefined) {
        return { present: true, action: 'create', name: c.skill, file, conflict: 'create-conflict', detail: `skill '${c.skill}' already exists`, expectedAfter: undefined }
      }
      const content = buildSkillMd(c.skill, description, body)
      return { present: true, action: 'create', name: c.skill, file, body, description, currentContent: '', proposedContent: content, expectedBefore: undefined, expectedAfter: sha256(content) }
    }

    if (current === undefined) return { present: true, action: 'patch', name: c.skill, file, conflict: 'patch-missing' }
    if (sha256(current) !== c.baseHash) return { present: true, action: 'patch', name: c.skill, file, conflict: 'cas-conflict', detail: `skill '${c.skill}' changed since the review read it`, currentContent: current }
    if (body === undefined || String(body).trim() === '') return { present: true, action: 'patch', name: c.skill, file, conflict: 'empty-body', currentContent: current }
    const baseDescription = description !== undefined ? description : (c.baseDescription !== undefined && c.baseDescription !== '' ? c.baseDescription : descriptionOf(current) || '')
    const content = mergeFrontmatter(current, c.skill, baseDescription, body)
    return { present: true, action: 'patch', name: c.skill, file, body, description: baseDescription, currentContent: current, proposedContent: content, expectedBefore: sha256(current), expectedAfter: sha256(content) }
  }

  async function planMemory(payload) {
    const mem = payload.conclusion && payload.conclusion.memory
    if (!mem || mem.action === 'nothing') return { present: false }
    // A project-scoped candidate with no recorded workspace cannot be placed.
    // That is one channel's problem: report it as a conflict so the skill half
    // of a mixed candidate stays reviewable instead of the whole detail 409ing.
    let target
    try {
      target = memoryTarget(payload)
    } catch (error) {
      return {
        present: true,
        action: mem.action,
        store: mem.store,
        scope: mem.scope === 'project' && mem.store !== 'user' ? 'project' : 'global',
        conflict: (error && error.code) || 'target-unresolved',
        detail: String(error && error.message || error),
        oldText: mem.oldText,
        text: mem.text,
      }
    }
    const eff = effective()
    const enabled = mem.store === 'user' ? eff.userProfileEnabled !== false : eff.memoryEnabled !== false
    const limit = mem.store === 'user' ? eff.userCharLimit : eff.memoryCharLimit
    const effectiveMem = mem
    let raw = ''
    try { raw = await fsP.readFile(target.file, 'utf8') } catch { /* new store */ }
    const entries = parseMemoryEntries(raw)
    const plan = planMemoryChange(entries, effectiveMem, { limit })
    const body = {
      present: true,
      action: mem.action,
      store: mem.store,
      scope: mem.scope === 'project' && mem.store !== 'user' ? 'project' : 'global',
      file: target.file,
      enabled,
      limit,
      entries: entries.length,
      wouldResult: enabled ? (plan.ok ? plan.result : plan.reason) : 'store-disabled',
      detail: plan.detail,
      oldText: mem.oldText,
      text: effectiveMem.text,
      currentContent: raw,
    }
    if (enabled && plan.ok) {
      body.proposedContent = serializeMemoryEntries(mem.store, plan.entries, target.header)
      body.expectedBefore = raw === '' ? undefined : sha256(raw)
      body.expectedAfter = sha256(body.proposedContent)
      body.previewEntries = plan.entries
    }
    return body
  }

  async function planGovernance(payload) {
    const g = payload.governance
    if (g === undefined || g === null) return { present: false }
    if (g.action !== 'archive' && g.action !== 'restore') return { present: true, conflict: 'unknown-governance-action' }
    const file = skillTarget(g.skill)
    let current
    try { current = await fsP.readFile(file, 'utf8') } catch { return { present: true, action: g.action, skill: g.skill, file, conflict: 'skill-missing' } }
    const desired = g.action === 'archive' ? false : true
    const content = setModelInvocation(current, desired)
    if (content === current) {
      // Malformed frontmatter: setModelInvocation is a documented no-op here, so
      // reporting success would desynchronize the record from the file.
      return { present: true, action: g.action, skill: g.skill, file, conflict: 'frontmatter-unparsable', currentContent: current }
    }
    return { present: true, action: g.action, skill: g.skill, file, currentContent: current, proposedContent: content, expectedBefore: sha256(current), expectedAfter: sha256(content) }
  }

  async function preflight(payload) {
    const skill = await planSkill(payload)
    const memory = await planMemory(payload)
    const governance = await planGovernance(payload)
    return { skill, memory, governance }
  }

  // ── Listing ────────────────────────────────────────────────────────────
  let listCache = { key: '', value: undefined }

  async function stagedIds() {
    let names
    try { names = await fsP.readdir(pendingDir()) } catch { return [] }
    return names.filter((n) => n.endsWith('.json') && isSafeId(n.slice(0, -5))).map((n) => n.slice(0, -5)).sort()
  }

  function summarize(id, payload) {
    const c = payload.conclusion || {}
    const mem = c.memory
    const hasSkill = c.action === 'create' || c.action === 'patch'
    const hasMemory = mem !== undefined && mem.action !== 'nothing'
    const hasGovernance = payload.governance !== undefined && payload.governance !== null
    return {
      id,
      at: payload.at,
      sourceSession: payload.sourceSession,
      cwd: payload.cwd,
      action: hasSkill ? c.action : (hasGovernance ? 'governance' : 'memory'),
      skill: hasSkill ? c.skill : (hasGovernance ? payload.governance.skill : undefined),
      memory: hasMemory ? { store: mem.store, action: mem.action, scope: mem.scope } : undefined,
      governance: hasGovernance ? { action: payload.governance.action, skill: payload.governance.skill } : undefined,
      channels: (hasSkill ? 1 : 0) + (hasMemory ? 1 : 0) + (hasGovernance ? 1 : 0),
      // Recorded at staging time, never inferred from a same-named skill's history.
      revisionOf: typeof payload.revisionOf === 'string' ? payload.revisionOf : undefined,
      sourceKnown: typeof payload.sourceSession === 'string' && payload.sourceSession !== '' && payload.sourceSession !== 'curator',
      mixed: [hasSkill, hasMemory, hasGovernance].filter(Boolean).length > 1,
      rationale: typeof c.rationale === 'string' ? c.rationale : (mem && mem.rationale),
    }
  }

  async function loadIndex() {
    let names = []
    try { names = await fsP.readdir(pendingDir()) } catch { return [] }
    const files = names.filter((n) => n.endsWith('.json') && isSafeId(n.slice(0, -5)))
    const stat = await fsP.stat(pendingDir()).catch(() => undefined)
    const key = `${stat ? stat.mtimeMs : 0}:${files.length}`
    if (listCache.key === key && listCache.value !== undefined) return listCache.value
    const rows = []
    for (const name of files) {
      const id = name.slice(0, -5)
      try {
        const parsed = JSON.parse(await fsP.readFile(join(pendingDir(), name), 'utf8'))
        rows.push({ ...summarize(id, parsed), rawSize: name })
      } catch { /* unreadable candidate: surfaced via detail, not the list */ }
    }
    rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
    listCache = { key, value: rows }
    return rows
  }

  async function list({ sourceSession, cursor, limit } = {}) {
    const all = await loadIndex()
    const filtered = typeof sourceSession === 'string' && sourceSession !== ''
      ? all.filter((r) => r.sourceSession === sourceSession)
      : all
    const size = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 20
    const start = Number.isFinite(cursor) && cursor >= 0 ? cursor : 0
    const page = filtered.slice(start, start + size)
    const rows = []
    for (const row of page) {
      const record = await loadRecord(row.id)
      rows.push({
        ...row,
        revision: record ? record.revision : 1,
        states: {
          skill: record && record.channels.skill ? record.channels.skill.state : 'pending',
          memory: record && record.channels.memory ? record.channels.memory.state : 'pending',
          governance: record && record.channels.governance ? record.channels.governance.state : 'pending',
        },
      })
    }
    return {
      total: filtered.length,
      nextCursor: start + size < filtered.length ? start + size : undefined,
      rows,
    }
  }

  async function count() {
    const all = await loadIndex()
    return all.length
  }

  // ── Detail ─────────────────────────────────────────────────────────────
  async function detail(id) {
    if (!isSafeId(id)) { const e = new Error('invalid candidate id'); e.code = 'EINVALID'; throw e }
    const candidate = await readCandidate(id)
    if (candidate === undefined) { const e = new Error(`candidate '${id}' not found`); e.code = 'ENOTFOUND'; throw e }
    const payload = candidate.payload
    const record = (await loadRecord(id)) || emptyRecord(id, candidate.hash)
    const plans = await preflight(payload)
    const warnings = []
    if (plans.skill.present) warnings.push(...pathWarnings(payload, plans.skill.file, undefined))
    if (plans.memory.present && plans.memory.file !== undefined) {
      warnings.push(...pathWarnings(payload, undefined, { dir: plans.memory.scope === 'project' ? join(plans.memory.file, '..') : memoryDir() }))
    }
    if (plans.memory.present && plans.memory.conflict !== undefined) {
      warnings.push({ code: 'memory-target-unresolved', detail: plans.memory.detail })
    }
    return {
      id,
      at: payload.at,
      sourceSession: payload.sourceSession,
      cwd: payload.cwd,
      revision: record.revision,
      rationale: payload.conclusion && payload.conclusion.rationale,
      revisionOf: typeof payload.revisionOf === 'string' ? payload.revisionOf : undefined,
      sourceKnown: typeof payload.sourceSession === 'string' && payload.sourceSession !== '' && payload.sourceSession !== 'curator',
      channels: {
        skill: plans.skill,
        memory: {
          ...plans.memory,
          currentContent: plans.memory.currentContent === undefined ? undefined : String(plans.memory.currentContent).slice(0, 40_000),
        },
        governance: plans.governance,
      },
      states: {
        skill: record.channels.skill ? record.channels.skill.state : 'pending',
        memory: record.channels.memory ? record.channels.memory.state : 'pending',
        governance: record.channels.governance ? record.channels.governance.state : 'pending',
      },
      warnings,
      history: (record.history || []).slice(-20),
    }
  }

  // ── Operations ─────────────────────────────────────────────────────────
  const fingerprint = (value) => sha256(JSON.stringify(value))

  async function readOperation(operationId) {
    return readJson(opFile(operationId))
  }

  async function writeOperation(operationId, value) {
    await writeJson(opFile(operationId), value)
  }

  async function operation(operationId) {
    if (typeof operationId !== 'string' || !OPERATION_ID_RE.test(operationId)) { const e = new Error('invalid operation id'); e.code = 'EINVALID'; throw e }
    const receipt = await readOperation(operationId)
    if (receipt === undefined) { const e = new Error('operation not found'); e.code = 'ENOTFOUND'; throw e }
    return receipt
  }

  // ── Applying one channel ───────────────────────────────────────────────
  /**
   * Write intent → execute → verify by hash. `applying` on disk is the recovery
   * hook: a crash after the rename leaves an intent that the next startup can
   * settle by comparing what is actually in the target file.
   */
  async function runChannel(record, channel, plan) {
    if (plan.conflict !== undefined) {
      record.channels[channel] = { state: 'conflict', reason: plan.conflict, detail: plan.detail, at: new Date().toISOString() }
      return record.channels[channel]
    }
    if (plan.present !== true) {
      record.channels[channel] = { state: 'skipped', at: new Date().toISOString() }
      return record.channels[channel]
    }
    const state = {
      state: 'applying',
      action: plan.action,
      target: plan.file,
      expectedBefore: plan.expectedBefore,
      expectedAfter: plan.expectedAfter,
      at: new Date().toISOString(),
    }
    record.channels[channel] = state
    await saveRecord(record)

    let outcome
    try {
      if (channel === 'skill') {
        outcome = await applyConclusion(plan.conclusion, { globalDir: globalSkillsDir() })
      } else if (channel === 'memory') {
        outcome = await applyMemoryConclusion(plan.memory, {
          dir: plan.memoryDir,
          limits: plan.memoryLimits,
          enabled: plan.memoryEnabled,
          header: plan.memoryHeader,
        })
      } else {
        const current = await fsP.readFile(plan.file, 'utf8')
        const content = setModelInvocation(current, plan.action === 'restore')
        if (content === current) {
          record.channels[channel] = { ...state, state: 'conflict', reason: 'frontmatter-unparsable', at: new Date().toISOString() }
          return record.channels[channel]
        }
        await atomicWrite(plan.file, content)
        outcome = { result: plan.action === 'restore' ? 'restored' : 'archived', path: plan.file }
      }
    } catch (error) {
      record.channels[channel] = { ...state, state: 'failed', reason: 'write-failed', detail: String(error && error.message || error), at: new Date().toISOString() }
      return record.channels[channel]
    }

    const ok = ['created', 'patched', 'added', 'replaced', 'removed', 'archived', 'restored'].includes(outcome.result)
    const settledState = ok ? 'applied' : (outcome.result === 'cas-conflict' || outcome.result === 'create-conflict' ? 'conflict' : 'failed')
    const next = {
      ...state,
      state: settledState,
      result: outcome.result,
      detail: outcome.detail,
      path: outcome.path,
      at: new Date().toISOString(),
      verified: undefined,
    }
    // Verify the effect by hash where the writer reports a path we can read back.
    if (ok && state.expectedAfter !== undefined) {
      try {
        const written = await fsP.readFile(state.target, 'utf8')
        next.verified = sha256(written) === state.expectedAfter
        if (next.verified === false) {
          next.state = 'reconciliation-required'
          next.reason = 'post-write-hash-mismatch'
        }
      } catch {
        next.verified = false
        next.state = 'reconciliation-required'
        next.reason = 'post-write-unreadable'
      }
    }
    record.channels[channel] = next
    if (channel === 'skill' && ok && outcome.result === 'created' && typeof registerManaged === 'function') {
      try { registerManaged(plan.conclusion.skill) } catch {}
    }
    return next
  }

  async function archive(id, candidate, record, bucket, verdict) {
    const dir = bucket()
    await fsP.mkdir(dir, { recursive: true })
    if (candidate !== undefined) {
      await atomicWrite(join(dir, `${id}.json`), candidate.raw)
      await fsP.rm(candidate.file, { force: true })
    }
    record.verdict = verdict
    record.archivedAt = new Date().toISOString()
    await saveRecord(record)
    await writeJson(join(dir, `${id}.record.json`), record)
    try { await fsP.rm(recordFile(id), { force: true }) } catch {}
    return record
  }

  // ── Decide ─────────────────────────────────────────────────────────────
  async function decide(id, body) {
    if (!isSafeId(id)) { const e = new Error('invalid candidate id'); e.code = 'EINVALID'; throw e }
    const { expectedRevision, operationId, reason } = body || {}
    // Check the type before the pattern: `String(undefined)` is the literal
    // 'undefined', which is 9 characters and would otherwise pass the check and
    // give this call a shared, accidental operation id.
    if (typeof operationId !== 'string' || !OPERATION_ID_RE.test(operationId)) {
      const e = new Error('operationId is required (8-80 chars: A-Za-z0-9_-)'); e.code = 'EINVALID'; throw e
    }
    const decisions = {}
    for (const channel of ['skill', 'memory', 'governance']) {
      const value = body && body[channel]
      if (value === undefined) continue
      if (value !== 'apply' && value !== 'skip' && value !== 'reject') {
        const e = new Error(`${channel} must be apply|skip|reject`); e.code = 'EINVALID'; throw e
      }
      decisions[channel] = value
    }
    if (Object.keys(decisions).length === 0) { const e = new Error('no channel decision supplied'); e.code = 'EINVALID'; throw e }

    const fp = fingerprint({ id, expectedRevision, decisions, reason })
    const existing = await readOperation(operationId)
    if (existing !== undefined) {
      if (existing.fingerprint !== fp) { const e = new Error('operationId already used for a different decision'); e.code = 'EOPCONFLICT'; throw e }
      if (existing.state === 'done') return existing.result
      const e = new Error('operation already in progress'); e.code = 'EINPROGRESS'; throw e
    }

    return withLock(root(), async () => {
      const replay = await readOperation(operationId)
      if (replay !== undefined) {
        if (replay.fingerprint !== fp) { const e = new Error('operationId already used for a different decision'); e.code = 'EOPCONFLICT'; throw e }
        if (replay.state === 'done') return replay.result
        const e = new Error('operation already in progress'); e.code = 'EINPROGRESS'; throw e
      }
      await writeOperation(operationId, { operationId, fingerprint: fp, state: 'running', at: new Date().toISOString(), id })

      let result
      try {
        result = await decideLocked(id, { expectedRevision, decisions, reason, operationId })
      } catch (error) {
        await writeOperation(operationId, {
          operationId, fingerprint: fp, state: 'failed', id, at: new Date().toISOString(),
          error: { code: error.code || 'EERROR', message: String(error && error.message || error) },
        }).catch(() => {})
        throw error
      }
      await writeOperation(operationId, { operationId, fingerprint: fp, state: 'done', id, at: new Date().toISOString(), result })
      return result
    })
  }

  async function decideLocked(id, { expectedRevision, decisions, reason, operationId }) {
    const candidate = await readCandidate(id)
    if (candidate === undefined) { const e = new Error(`candidate '${id}' not found or already handled`); e.code = 'ENOTFOUND'; throw e }
    const payload = candidate.payload
    const record = await ensureRecord(id, candidate.hash)
    if (expectedRevision !== undefined && expectedRevision !== record.revision) {
      const e = new Error(`candidate changed (expected revision ${expectedRevision}, current ${record.revision})`)
      e.code = 'EREVISION'
      throw e
    }
    record.channels = record.channels || {}
    // A workspace store written by the old slug scheme must be adopted before the
    // plan reads it, otherwise the preview measures an empty file and the write
    // would silently start a second, divergent store.
    if (typeof deps.adoptWorkspaceStore === 'function') {
      const mem = payload.conclusion && payload.conclusion.memory
      if (mem && mem.action !== 'nothing' && mem.scope === 'project' && mem.store !== 'user') {
        try { await deps.adoptWorkspaceStore(payload.cwd) } catch { /* adoption is best-effort; the plan reports the real state */ }
      }
    }
    const plans = await preflight(payload)
    const results = {}
    // Only the channels this candidate actually carries can be settled; a partial
    // decision on a mixed candidate must not archive the untouched half.
    const presentChannels = ['skill', 'memory', 'governance'].filter((ch) => plans[ch].present === true)

    const rejectAll = presentChannels.length > 0 &&
      presentChannels.every((ch) => decisions[ch] === 'reject')
    if (rejectAll) {
      for (const channel of presentChannels) {
        record.channels[channel] = { state: 'rejected', reason: reason || 'rejected by reviewer', at: new Date().toISOString() }
        results[channel] = { state: 'rejected' }
      }
      pushHistory(record, { op: 'reject', operationId, channels: presentChannels, reason })
      record.revision += 1
      await saveRecord(record)
      await archive(id, candidate, record, rejectedDir, 'rejected')
      trace('approval-rejected', { id, reason, channels: presentChannels, sessionId: payload.sourceSession })
      return { ok: true, id, status: 'rejected', revision: record.revision, results }
    }

    for (const channel of ['skill', 'memory', 'governance']) {
      const value = decisions[channel]
      if (value === undefined) continue
      const plan = plans[channel]
      if (value === 'reject') {
        record.channels[channel] = { state: 'rejected', reason: reason || 'rejected by reviewer', at: new Date().toISOString() }
        results[channel] = { state: 'rejected' }
        continue
      }
      if (value === 'skip') {
        if (record.channels[channel] && record.channels[channel].state === 'applied') {
          results[channel] = { state: 'applied', note: 'already-applied' }
          continue
        }
        record.channels[channel] = { state: 'skipped', at: new Date().toISOString() }
        results[channel] = { state: 'skipped' }
        continue
      }
      // already settled: never write twice
      const prior = record.channels[channel]
      if (prior && prior.state === 'applied') {
        results[channel] = { state: 'applied', note: 'already-applied', verified: prior.verified }
        continue
      }
      if (prior && prior.state === 'applying') {
        // A previous attempt died mid-write: settle by hash before doing anything.
        const settled = await reconcileChannel(record, channel, prior)
        results[channel] = settled
        if (settled.state === 'applied' || settled.state === 'reconciliation-required') continue
      }
      if (plan.present !== true) {
        record.channels[channel] = { state: 'skipped', at: new Date().toISOString() }
        results[channel] = { state: 'skipped', note: 'channel-not-present' }
        continue
      }
      // A plan that already knows it cannot be placed or written is a conflict the
      // reviewer must see; calling the writer would only reproduce it.
      if (plan.conflict !== undefined) {
        record.channels[channel] = { state: 'conflict', reason: plan.conflict, detail: plan.detail, at: new Date().toISOString() }
        results[channel] = { state: 'conflict', reason: plan.conflict }
        continue
      }
      if (channel === 'skill') {
        const c = payload.conclusion
        const body = plan.body
        plan.conclusion = c.action === 'create'
          ? { action: 'create', skill: c.skill, description: plan.description, body }
          : { action: 'patch', skill: c.skill, body, baseHash: c.baseHash, baseDescription: c.baseDescription }
        plan.file = skillTarget(c.skill)
        plan.target = plan.file
      } else if (channel === 'memory') {
        const mem = payload.conclusion.memory
        const effectiveMem = mem
        const target = memoryTarget(payload)
        const eff = effective()
        plan.memory = effectiveMem
        plan.memoryDir = target.dir
        plan.memoryHeader = target.header
        plan.memoryLimits = { memory: eff.memoryCharLimit, user: eff.userCharLimit }
        plan.memoryEnabled = { memory: eff.memoryEnabled !== false, user: eff.userProfileEnabled !== false }
        plan.file = target.file
        plan.target = target.file
        // A store switch that was turned off, or a guard that rejects (duplicate,
        // missing oldText, over limit), is a decision the reviewer must see: do not
        // call the writer hoping it agrees with the preview.
        if (plan.enabled === false) {
          record.channels[channel] = { state: 'rejected', reason: 'store-disabled', at: new Date().toISOString() }
          results[channel] = { state: 'rejected', reason: 'store-disabled' }
          continue
        }
        if (plan.proposedContent === undefined) {
          const why = plan.wouldResult || 'memory-plan-failed'
          record.channels[channel] = { state: 'conflict', reason: why, detail: plan.detail, at: new Date().toISOString() }
          results[channel] = { state: 'conflict', reason: why }
          continue
        }
        plan.expectedAfter = sha256(plan.proposedContent)
      }
      const written = await runChannel(record, channel, plan)
      results[channel] = { state: written.state, result: written.result, reason: written.reason, verified: written.verified, target: written.target }
      record.revision += 1
      await saveRecord(record)
    }

    // Channels nobody decided stay untouched and un-settled, so the candidate
    // remains in the inbox and the same button cannot imply consent for them.
    // An untouched channel has no state at all: that is still "remaining".
    const remaining = presentChannels.some((ch) => {
      const s = record.channels[ch] && record.channels[ch].state
      return s === undefined || !SETTLED.has(s)
    })
    pushHistory(record, { op: 'decide', operationId, decisions, remaining })
    record.revision += 1
    await saveRecord(record)

    if (!remaining) {
      await archive(id, candidate, record, doneDir, 'applied')
      trace('approval-applied', { id, results, sessionId: payload.sourceSession })
      if (typeof notifySourceSession === 'function') {
        for (const ch of Object.keys(results)) {
          if (results[ch].state === 'applied') {
            const label = payload.conclusion && payload.conclusion.skill ? payload.conclusion.skill : `${ch}`
            notifySourceSession(payload.sourceSession, `审批已通过「${label}」（${ch}），写入完成`)
          }
        }
      }
      return { ok: true, id, status: 'applied', revision: record.revision, results }
    }
    trace('approval-partial', { id, results, sessionId: payload.sourceSession })
    return { ok: true, id, status: 'partial', revision: record.revision, results }
  }

  /** Settle a durable `applying` intent by looking at the target file. */
  async function reconcileChannel(record, channel, prior) {
    if (prior.target === undefined) {
      record.channels[channel] = { ...prior, state: 'pending', note: 'no target recorded' }
      return { state: 'pending' }
    }
    let current
    try { current = await fsP.readFile(prior.target, 'utf8') } catch { current = undefined }
    const hash = current === undefined ? undefined : sha256(current)
    if (prior.expectedAfter !== undefined && hash === prior.expectedAfter) {
      record.channels[channel] = { ...prior, state: 'applied', reconciled: 'after-write', at: new Date().toISOString() }
      return { state: 'applied', note: 'reconciled-after-crash' }
    }
    if (prior.expectedBefore !== undefined && hash === prior.expectedBefore) {
      record.channels[channel] = { ...prior, state: 'pending', reconciled: 'not-written' }
      return { state: 'pending', note: 'not-written' }
    }
    if (prior.expectedBefore === undefined && hash === undefined) {
      record.channels[channel] = { ...prior, state: 'pending', reconciled: 'absent' }
      return { state: 'pending', note: 'target-absent' }
    }
    record.channels[channel] = { ...prior, state: 'reconciliation-required', reason: 'target-changed-during-crash', at: new Date().toISOString() }
    return { state: 'reconciliation-required' }
  }

  /** Startup sweep: settle or flag every channel left in `applying`. */
  async function recover() {
    let names
    try { names = await fsP.readdir(recordDir()) } catch { return { checked: 0 } }
    let checked = 0
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const id = name.slice(0, -5)
      if (!isSafeId(id)) continue
      const record = await loadRecord(id)
      if (record === undefined || record.channels === undefined) continue
      let touched = false
      for (const channel of ['skill', 'memory', 'governance']) {
        const state = record.channels[channel]
        if (state && state.state === 'applying') {
          await withLock(root(), async () => {
            const source = await readCandidate(id)
            if (source === undefined) {
              record.channels[channel] = { ...state, state: 'reconciliation-required', reason: 'candidate-vanished' }
              return
            }
            await reconcileChannel(record, channel, state)
          })
          touched = true
        }
      }
      if (touched) {
        record.revision += 1
        pushHistory(record, { op: 'recover' })
        await saveRecord(record).catch(() => {})
        checked += 1
      }
    }
    return { checked }
  }

  return { list, detail, decide, operation, recover, count, withLock, isSafeId }
}

module.exports = { createApproval, withLock, isSafeId, PENDING_ID_RE, OPERATION_ID_RE, SETTLED }

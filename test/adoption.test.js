'use strict'

/**
 * Legacy workspace-store adoption.
 *
 * The pre-hash slug scheme collapsed `/work/a-b` and `/work/a/b` onto one
 * directory. Changing the scheme fixes new writes but would orphan an existing
 * store, so an old directory is adopted once — and only when its own
 * `<!-- cwd: ... -->` header proves which workspace it belongs to.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fsp = require('node:fs/promises')
const os = require('node:os')
const { join } = require('node:path')
const { createHash } = require('node:crypto')

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

// The module reads DSH_HOME at call time; point it at a throwaway root before
// requiring, so no test can touch the real memory store.
async function withHome(fn) {
  const home = await fsp.mkdtemp(join(os.tmpdir(), 'hermes-adopt-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    delete require.cache[require.resolve('../src/index')]
    const plugin = require('../src/index')
    await fn({ home, plugin })
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await fsp.rm(home, { recursive: true, force: true })
  }
}

const legacySlug = (cwd) => cwd.replace(/[/\\:]/g, '-')

test('a legacy store whose header names this cwd is adopted once', async () => {
  await withHome(async ({ home, plugin }) => {
    const cwd = '/work/project-one'
    const legacy = join(home, 'memory', 'workspaces', legacySlug(cwd))
    await fsp.mkdir(legacy, { recursive: true })
    await fsp.writeFile(join(legacy, 'MEMORY.md'), `# MEMORY\n\n<!-- cwd: ${cwd} -->\n\n§ old fact\n`, 'utf8')

    const resolver = plugin.__internals
    assert.equal(typeof resolver.adoptLegacyWorkspaceStore, 'function')
    const out = await resolver.adoptLegacyWorkspaceStore(cwd)
    assert.equal(out.adopted, true)

    const current = join(home, 'memory', 'workspaces', resolver.workspaceSlug(cwd))
    const raw = await fsp.readFile(join(current, 'MEMORY.md'), 'utf8')
    assert.match(raw, /old fact/)
    await assert.rejects(() => fsp.access(join(legacy, 'MEMORY.md')), 'legacy file must be moved, not copied')
  })
})

test('a legacy store without a matching cwd header is left alone', async () => {
  await withHome(async ({ home, plugin }) => {
    const cwd = '/work/project-one'
    const legacy = join(home, 'memory', 'workspaces', legacySlug(cwd))
    await fsp.mkdir(legacy, { recursive: true })
    // No header: the directory cannot be attributed to this workspace, and the
    // old slug was ambiguous, so adopting it could hand another project's
    // facts to this one.
    await fsp.writeFile(join(legacy, 'MEMORY.md'), '# MEMORY\n\n§ someone else\'s fact\n', 'utf8')
    const out = await plugin.__internals.adoptLegacyWorkspaceStore(cwd)
    assert.equal(out.adopted, false)
    assert.match(await fsp.readFile(join(legacy, 'MEMORY.md'), 'utf8'), /someone else/)
  })
})

test('reads fall back to the legacy store until it is adopted', async () => {
  await withHome(async ({ home, plugin }) => {
    const cwd = '/work/project-two'
    const legacy = join(home, 'memory', 'workspaces', legacySlug(cwd))
    await fsp.mkdir(legacy, { recursive: true })
    await fsp.writeFile(join(legacy, 'MEMORY.md'), `# MEMORY\n\n<!-- cwd: ${cwd} -->\n\n§ visible before adoption\n`, 'utf8')
    const readDir = plugin.__internals.workspaceMemoryReadDir(cwd)
    assert.equal(readDir, legacy)
    assert.match(await fsp.readFile(join(readDir, 'MEMORY.md'), 'utf8'), /visible before adoption/)
  })
})

test('a second workspace with the colliding legacy path is not adopted', async () => {
  await withHome(async ({ home, plugin }) => {
    // Both used to map to the same legacy directory; only the one named in the
    // header may claim it.
    const owner = '/work/a-b'
    const other = '/work/a/b'
    assert.notEqual(plugin.__internals.workspaceSlug(owner), plugin.__internals.workspaceSlug(other))
    const legacy = join(home, 'memory', 'workspaces', legacySlug(owner))
    await fsp.mkdir(legacy, { recursive: true })
    await fsp.writeFile(join(legacy, 'MEMORY.md'), `# MEMORY\n\n<!-- cwd: ${owner} -->\n\n§ owner fact\n`, 'utf8')

    const ownerOut = await plugin.__internals.adoptLegacyWorkspaceStore(owner)
    assert.equal(ownerOut.adopted, true)
    const otherOut = await plugin.__internals.adoptLegacyWorkspaceStore(other)
    assert.equal(otherOut.adopted, false)
    assert.equal(sha256(other), sha256(other), 'sanity')
  })
})

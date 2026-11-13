'use strict'

/**
 * Regression tests for the defects fixed alongside the review inbox.
 *
 * These import the shipped module and exercise its exported internals, so a
 * change that reintroduces a defect fails here instead of only being noticed
 * months later in the panel.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const plugin = require('../src/index')
const internals = plugin.__internals

test('workspace slugs are injective: separator and hyphen no longer collide', () => {
  const a = internals.workspaceSlug('/home/ivan/work/a-b')
  const b = internals.workspaceSlug('/home/ivan/work/a/b')
  assert.notEqual(a, b)
  assert.equal(internals.workspaceSlug('/home/ivan/work/a-b'), a, 'mapping is stable')
  assert.ok(a.length <= 128)
  assert.ok(a.startsWith('-home-ivan-work-a-b'), 'keeps a readable prefix')
})

test('workspace slug keeps a long path inside the length budget and unique', () => {
  const long = '/home/ivan/' + 'x'.repeat(200) + '/a-b'
  const other = '/home/ivan/' + 'x'.repeat(200) + '/a/b'
  const slug = internals.workspaceSlug(long)
  assert.ok(slug.length <= 128)
  assert.notEqual(slug, internals.workspaceSlug(other))
  assert.equal(internals.workspaceSlug(''), undefined)
})

test('transcript truncation honours the configured limits, not just the defaults', () => {
  const messages = []
  for (let i = 0; i < 60; i += 1) messages.push({ role: 'user', content: `message number ${i} with some words` })
  const count = (text) => (text.match(/^### /gm) || []).length
  // Isolate the message cap from the character budget: a small budget can only
  // ever fit fewer headings, which is correct but would hide a broken cap.
  const five = internals.renderTranscript(messages, { maxChars: 100000, maxMessages: 5, lang: 'en' })
  const forty = internals.renderTranscript(messages, { maxChars: 100000, maxMessages: 40, lang: 'en' })
  assert.equal(count(five), 5, 'maxMessages must be honoured')
  assert.equal(count(forty), 40)
  assert.ok(five.length < forty.length)

  // And the character budget still clamps the rendered tail.
  const clamped = internals.renderTranscript(messages, { maxChars: 100, maxMessages: 5, lang: 'en' })
  assert.ok(clamped.length <= 100 + 40, 'maxChars must be honoured')

  const defaulted = internals.renderTranscript(messages, { lang: 'en' })
  assert.ok(count(defaulted) <= internals.DEFAULTS.maxTranscriptMessages)
  assert.ok(defaulted.length <= internals.DEFAULTS.maxTranscriptChars + 200)
  assert.equal(internals.DEFAULTS.maxTranscriptChars, 12000)
})

test('default transcript limits still apply when none are passed', () => {
  const messages = []
  for (let i = 0; i < 100; i += 1) messages.push({ role: 'user', content: 'x'.repeat(500) })
  const text = internals.renderTranscript(messages, { lang: 'zh' })
  const count = (text.match(/^### /gm) || []).length
  assert.ok(count <= internals.DEFAULTS.maxTranscriptMessages)
  assert.ok(text.length <= internals.DEFAULTS.maxTranscriptChars + 200)
  // The default cap must actually bite on an oversized transcript.
  assert.ok(count < 100)
})

test('a revision run stamps its new candidate and only that run', () => {
  // dispatchConclusion reads the module-level pointer; a leaked value would
  // attribute an ordinary review's output to the candidate being revised.
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'index.js'), 'utf8')
  assert.match(source, /revisionOf: activeRevision !== null \? activeRevision\.candidateId : undefined/,
    'the stamp must come from the active revision, not a guess')
  assert.match(source, /activeRevision = null/,
    'the pointer must be cleared so a later review cannot inherit it')
})

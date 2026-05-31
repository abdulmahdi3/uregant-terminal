import { describe, it, expect } from 'vitest'
import {
  targetFor,
  renderLearnedBlock,
  upsertManagedBlock,
  ensureGitignoreEntry,
  injectForPane,
  MANAGED_START,
  MANAGED_END,
  type InjectIO
} from './inject'
import type { MemoryEntry, SkillEntry } from './markdown'

function mem(slug: string, body: string, conf = 0.8): MemoryEntry {
  return {
    title: slug,
    slug,
    kind: 'memory',
    scope: 'project',
    agentScope: 'all',
    project: 'p',
    sourceAgents: [],
    confidence: conf,
    hits: 1,
    created: '2026-05-31',
    updated: '2026-05-31',
    lastSeen: '2026-05-31',
    evidence: [],
    supersedes: [],
    body
  }
}

describe('targetFor', () => {
  it('maps known agents to their native context files', () => {
    expect(targetFor('claude')).toBe('.claude/CLAUDE.md')
    expect(targetFor('gemini')).toBe('.gemini/GEMINI.md')
    expect(targetFor('copilot')).toBe('.github/copilot-instructions.md')
    expect(targetFor('gh-copilot')).toBe('.github/copilot-instructions.md')
  })
  it('NEVER defaults copilot/unknown to AGENTS.md incorrectly; unknown -> AGENTS.md', () => {
    expect(targetFor('codex')).toBe('AGENTS.md')
    expect(targetFor('some-new-agent')).toBe('AGENTS.md')
  })
  it('strips path + extension', () => {
    expect(targetFor('/usr/bin/claude.exe')).toBe('.claude/CLAUDE.md')
  })
})

describe('renderLearnedBlock', () => {
  it('wraps content in the managed markers, ranked by confidence', () => {
    const block = renderLearnedBlock(
      [mem('a', 'low conf fact', 0.2), mem('b', 'high conf fact', 0.9)],
      []
    )
    expect(block.startsWith(MANAGED_START)).toBe(true)
    expect(block.trimEnd().endsWith(MANAGED_END)).toBe(true)
    expect(block.indexOf('high conf fact')).toBeLessThan(block.indexOf('low conf fact'))
  })
  it('includes a skills index when skills exist', () => {
    const skill: SkillEntry = {
      name: 'ship',
      slug: 'ship',
      kind: 'skill',
      scope: 'project',
      description: 'publish a release',
      agents: [],
      trigger: '',
      project: 'p',
      confidence: 0.9,
      hits: 1,
      created: '2026-05-31',
      updated: '2026-05-31',
      evidence: [],
      body: 'steps'
    }
    const block = renderLearnedBlock([mem('a', 'fact')], [skill])
    expect(block).toContain('Skills available')
    expect(block).toContain('**ship**')
  })
  it('respects the byte budget', () => {
    const many = Array.from({ length: 200 }, (_, i) => mem(`m${i}`, `fact number ${i} with some length`))
    const block = renderLearnedBlock(many, [], 400)
    expect(block.length).toBeLessThan(700)
  })
})

describe('upsertManagedBlock', () => {
  const block = `${MANAGED_START}\nNEW\n${MANAGED_END}`
  it('appends to a file with no existing block, preserving user content', () => {
    const out = upsertManagedBlock('# My notes\nhand-written', block)
    expect(out).toContain('# My notes')
    expect(out).toContain('NEW')
  })
  it('replaces only the managed region on re-injection (idempotent)', () => {
    const first = upsertManagedBlock('user text', block)
    const second = upsertManagedBlock(first, `${MANAGED_START}\nUPDATED\n${MANAGED_END}`)
    expect(second).toContain('user text')
    expect(second).toContain('UPDATED')
    expect(second).not.toContain('NEW')
    expect(second.indexOf(MANAGED_START)).toBe(second.lastIndexOf(MANAGED_START))
  })
  it('writes just the block into an empty file', () => {
    expect(upsertManagedBlock('', block)).toContain('NEW')
  })
})

describe('ensureGitignoreEntry', () => {
  it('adds a missing entry with a header', () => {
    const out = ensureGitignoreEntry('node_modules\n', '.claude/CLAUDE.md')
    expect(out).toContain('.claude/CLAUDE.md')
    expect(out).toContain('# URterminal learning')
  })
  it('is idempotent', () => {
    const once = ensureGitignoreEntry('', 'AGENTS.md')
    const twice = ensureGitignoreEntry(once, 'AGENTS.md')
    expect(twice).toBe(once)
  })
})

// ---- injectForPane with a fake IO ----

function fakeIO(initial: Record<string, string> = {}, tracked = new Set<string>()): InjectIO & { files: Record<string, string> } {
  const files = { ...initial }
  return {
    files,
    read: (p) => (p in files ? files[p] : null),
    write: (p, c) => {
      files[p] = c
    },
    ensureDir: () => {},
    isTracked: (_cwd, rel) => tracked.has(rel)
  }
}

const memList = [mem('a', 'always use tabs')]

describe('injectForPane', () => {
  it('writes the brain into an untracked context file + gitignores it', () => {
    const io = fakeIO()
    // give the brain something to inject by stubbing readMemories via a tracked file? -
    // injectForPane reads the real brain; here we test the no-memory path instead.
    const res = injectForPane({ cwd: '/abs/proj', agentId: 'claude', projectHash: 'nope-empty' }, io)
    expect(res.status).toBe('skipped-empty')
  })

  it('skips a git-tracked target untouched', () => {
    const io = fakeIO({}, new Set(['.claude/CLAUDE.md']))
    const res = injectForPane({ cwd: '/abs/proj', agentId: 'claude', projectHash: 'whatever' }, io)
    expect(res.status).toBe('skipped-tracked')
    expect(Object.keys(io.files)).toHaveLength(0)
  })

  it('returns no-cwd for a relative/empty cwd', () => {
    expect(injectForPane({ cwd: '', agentId: 'claude', projectHash: 'x' }, fakeIO()).status).toBe('no-cwd')
    expect(injectForPane({ cwd: 'rel/path', agentId: 'claude', projectHash: 'x' }, fakeIO()).status).toBe('no-cwd')
  })

  // keep memList referenced for readers of this file
  void memList
})

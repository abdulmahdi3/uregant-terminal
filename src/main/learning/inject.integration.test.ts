import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => {
  const { mkdtempSync } = require('fs')
  const { tmpdir } = require('os')
  const { join } = require('path')
  const dir = mkdtempSync(join(tmpdir(), 'urt-inject-int-'))
  return { app: { getPath: (): string => dir } }
})

import { injectForPane, MANAGED_START, type InjectIO } from './inject'
import { writeMemory } from './brain'
import type { MemoryEntry } from './markdown'

const PH = 'projinject1'

function mem(slug: string, body: string): MemoryEntry {
  return {
    title: slug,
    slug,
    kind: 'memory',
    scope: 'project',
    agentScope: 'all',
    project: PH,
    sourceAgents: [],
    confidence: 0.9,
    hits: 1,
    created: '2026-05-31',
    updated: '2026-05-31',
    lastSeen: '2026-05-31',
    evidence: [],
    supersedes: [],
    body
  }
}

/** In-memory IO so we exercise the real brain read but not the real FS/git. */
function fakeIO(): InjectIO & { files: Record<string, string> } {
  const files: Record<string, string> = {}
  return {
    files,
    read: (p) => (p in files ? files[p] : null),
    write: (p, c) => {
      files[p] = c
    },
    ensureDir: () => {},
    isTracked: () => false
  }
}

describe('injectForPane (real brain)', () => {
  it('renders approved memories into the agent context file + gitignore', () => {
    writeMemory(PH, mem('use-pnpm', 'This repo uses pnpm, never npm'))
    const io = fakeIO()
    const res = injectForPane({ cwd: '/abs/proj', agentId: 'claude', projectHash: PH }, io)
    expect(res.status).toBe('written')
    expect(res.file).toBe('.claude/CLAUDE.md')

    const ctx = io.files['/abs/proj/.claude/CLAUDE.md']
    expect(ctx).toContain(MANAGED_START)
    expect(ctx).toContain('This repo uses pnpm, never npm')

    const gi = io.files['/abs/proj/.gitignore']
    expect(gi).toContain('.claude/CLAUDE.md')
  })

  it('is idempotent across repeated injections (single managed block)', () => {
    const io = fakeIO()
    injectForPane({ cwd: '/abs/proj', agentId: 'claude', projectHash: PH }, io)
    injectForPane({ cwd: '/abs/proj', agentId: 'claude', projectHash: PH }, io)
    const ctx = io.files['/abs/proj/.claude/CLAUDE.md']
    const occurrences = ctx.split(MANAGED_START).length - 1
    expect(occurrences).toBe(1)
  })
})

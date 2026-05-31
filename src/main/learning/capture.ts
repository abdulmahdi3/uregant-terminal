import { TurnAssembler } from './turnAssembler'
import { CandidateGate } from './candidates'
import { runDistillForProject, type DistillOutcome } from './distillRunner'
import { getRunModel } from './model'
import { ReviewQueue, commitOp, type PendingOp } from './review'
import { brainIndex } from './brain'
import { injectForPane } from './inject'
import { projectHash as hashOf } from './paths'
import { appendTurn, getLearningConfig, type LearningConfig, type TurnRecord } from './store'
import type { Candidate } from './heuristics'
import type { DistillOp } from './merge'

interface PaneCtx {
  cwd: string
  agentId: string
  projectHash: string
}

// Drop a turn marker that's an exact duplicate of the previous one for the same
// pane within this window — defends against a mirrored renderer double-delivering
// the same submitted prompt across windows.
const COALESCE_MS = 250

/**
 * The tap that PtyManager calls. Keeps one TurnAssembler per pane, routes raw
 * output plus clean user-turn markers into it, then feeds each completed turn to
 * both the on-disk transcript store and the zero-token candidate gate.
 *
 * Entirely no-op unless the learning layer is enabled AND capture is on, so the
 * hot path (every PTY byte, every keystroke turn) stays cheap when the feature
 * is off — which is the default. Capture lives wholly in the main process, so it
 * sees each pty exactly once regardless of how many windows render it; that is
 * what makes multi-window de-duplication structural rather than something we
 * have to police.
 */
export interface CaptureSink {
  onSessionStart(p: { ptyId: string; paneId: string; agentId: string; cwd: string }): void
  onPtyData(paneId: string, chunk: string): void
  onUserTurn(paneId: string, text: string, ts: number): void
  onSessionEnd(paneId: string): void
}

export class CaptureService implements CaptureSink {
  // Keyed by paneId: at most one live pty per pane, and the renderer turn marker
  // arrives by paneId. A re-spawn in the same pane replaces the assembler.
  private assemblers = new Map<string, TurnAssembler>()
  // Last submitted prompt per pane, for coalescing duplicate markers.
  private lastTurn = new Map<string, { text: string; ts: number }>()
  // Live pane → { cwd, agentId, projectHash } so we can re-inject open panes
  // after a learning is approved.
  private paneCtx = new Map<string, PaneCtx>()
  // Lazily constructed (reads state.json) — only once a turn actually completes.
  private gate: CandidateGate | null = null

  /**
   * @param onCandidates Called with any NEW gate candidates a completed turn
   *   produced, so the IPC layer can broadcast them to the review UI.
   */
  constructor(private readonly onCandidates?: (c: Candidate[]) => void) {}

  private cfg(): LearningConfig {
    return getLearningConfig()
  }

  private active(): boolean {
    const c = this.cfg()
    return c.enabled && c.capture
  }

  /** Persist + gate one completed turn. Wired as the TurnAssembler emit sink. */
  private handleTurn(rec: TurnRecord): void {
    appendTurn(rec)
    try {
      if (!this.gate) this.gate = new CandidateGate()
      const fresh = this.gate.ingest(rec)
      if (fresh.length) this.onCandidates?.(fresh)
    } catch {
      /* gating must never break capture */
    }
  }

  onSessionStart({ ptyId, paneId, agentId, cwd }: { ptyId: string; paneId: string; agentId: string; cwd: string }): void {
    const cfg = this.cfg()
    // Passive injection at spawn (independent of capture): write the project's
    // current learnings into the agent's native context file before it boots, so
    // the agent reads them on startup. Untracked-only; never crashes the spawn.
    if (cfg.enabled && cfg.injectionPassive && cwd && agentId) {
      const ctx: PaneCtx = { cwd, agentId, projectHash: hashOf(cwd) }
      this.paneCtx.set(paneId, ctx)
      this.injectPane(ctx)
    }

    if (!cfg.enabled || !cfg.capture) return
    // v1: capture only AI-agent panes. Shells/SSH spawn with no agent command,
    // so an empty agentId means "not an agent" — skip it to cut noise + surface.
    if (cfg.aiOnly && !agentId) return
    this.assemblers.get(paneId)?.end()
    this.assemblers.set(
      paneId,
      new TurnAssembler(paneId, ptyId, agentId, cwd, () => this.cfg(), (rec) => this.handleTurn(rec))
    )
  }

  private injectPane(ctx: PaneCtx): void {
    try {
      injectForPane({ cwd: ctx.cwd, agentId: ctx.agentId, projectHash: ctx.projectHash, maxBytes: this.cfg().maxInjectBytes })
    } catch {
      /* injection must never break a pane spawn */
    }
  }

  onPtyData(paneId: string, chunk: string): void {
    if (!this.active()) return
    this.assemblers.get(paneId)?.output(chunk)
  }

  onUserTurn(paneId: string, text: string, ts: number): void {
    if (!this.active()) return
    const t = text.trim()
    if (!t) return
    const prev = this.lastTurn.get(paneId)
    if (prev && prev.text === t && ts - prev.ts < COALESCE_MS) return
    this.lastTurn.set(paneId, { text: t, ts })
    this.assemblers.get(paneId)?.userTurn(t, ts)
  }

  onSessionEnd(paneId: string): void {
    this.lastTurn.delete(paneId)
    this.paneCtx.delete(paneId)
    const a = this.assemblers.get(paneId)
    if (!a) return
    a.end()
    this.assemblers.delete(paneId)
  }

  /** Re-inject every open pane whose project matches (after an approve/distill). */
  private reinjectProject(projectHash: string): void {
    if (!this.cfg().injectionPassive) return
    for (const ctx of this.paneCtx.values()) {
      if (ctx.projectHash === projectHash) this.injectPane(ctx)
    }
  }

  /** Current candidate review queue (for the renderer's learning panel). */
  listCandidates(): Candidate[] {
    try {
      if (!this.gate) this.gate = new CandidateGate()
      return this.gate.pending()
    } catch {
      return []
    }
  }

  private ensureGate(): CandidateGate {
    if (!this.gate) this.gate = new CandidateGate()
    return this.gate
  }

  /**
   * Run a distillation pass (a model call — the only egress point). Requires the
   * separate egress gate `egressAllowed`. Distils the given project, or every
   * project with pending candidates. Returns a summary for the caller to relay.
   */
  async distill(projectHash?: string): Promise<DistillOutcome> {
    const cfg = this.cfg()
    if (!cfg.enabled || !cfg.egressAllowed) {
      throw new Error('Distillation is off — enable learning + the distill (egress) toggle first.')
    }
    const gate = this.ensureGate()
    const review = new ReviewQueue()
    const runModel = getRunModel(cfg)
    const projects = projectHash ? [projectHash] : gate.projectsWithPending()
    const merged: DistillOutcome = { ops: [], applied: 0, queued: [] }
    for (const ph of projects) {
      const r = await runDistillForProject(ph, gate, runModel, cfg, review)
      merged.ops.push(...r.ops)
      merged.applied += r.applied
      merged.queued.push(...r.queued)
    }
    return merged
  }

  /** Pending distilled ops awaiting the user's approval. */
  listPendingOps(): PendingOp[] {
    try {
      return new ReviewQueue().list()
    } catch {
      return []
    }
  }

  /** Approve a pending op → write it into the brain, then refresh open panes. */
  approveOp(id: string): boolean {
    const review = new ReviewQueue()
    const pending = review.list().find((p) => p.id === id)
    const ok = review.approve(id)
    if (ok && pending) this.reinjectProject(pending.projectHash)
    return ok
  }

  /** Reject (discard) a pending op. */
  rejectOp(id: string): void {
    new ReviewQueue().reject(id)
  }

  /** Directly commit an op (used by tests / future auto-approve paths). */
  commit(projectHash: string, op: DistillOp): void {
    commitOp(projectHash, op)
  }

  /** The current brain index for a scope (memories + skills), for the UI. */
  brain(projectHash: string | null): ReturnType<typeof brainIndex> {
    return brainIndex(projectHash)
  }

  /** Manually inject the brain into an agent's context file for a cwd. */
  injectNow(cwd: string, agentId: string): ReturnType<typeof injectForPane> {
    return injectForPane({ cwd, agentId, projectHash: hashOf(cwd), maxBytes: this.cfg().maxInjectBytes })
  }
}

import { useWorkspace, newMessageId } from '@renderer/store/workspace'
import { useTokens } from '@renderer/store/tokens'
import type { Pane, ChatMessage } from '@shared/types'

interface StreamTarget {
  paneId: string
  messageId: string
}

const registry = new Map<string, StreamTarget>()

/** Optional hook so Phase 5 (Telegram) can forward completed assistant replies. */
let onAssistantComplete: ((paneId: string, text: string) => void) | null = null
export function setAssistantCompleteHook(fn: (paneId: string, text: string) => void): void {
  onAssistantComplete = fn
}

// ---- streaming metrics (consumed by the metrics store / status bar) ----
let chunkCount = 0
export function takeChunkCount(): number {
  const n = chunkCount
  chunkCount = 0
  return n
}

// Characters streamed since the last read — used to estimate tokens/sec
// (≈ chars / 4) for the live TOK/S pill. Fed by both AI streams and agent
// terminal output so the pill reflects live activity.
let charCount = 0
export function takeCharCount(): number {
  const n = charCount
  charCount = 0
  return n
}
export function noteOutputChars(n: number): void {
  charCount += n
}

// ---- rAF-batched commits: coalesce text appends to one re-render per frame ----
let pending: { paneId: string; messageId: string; text: string }[] = []
let rafHandle = 0

function flushPending(): void {
  rafHandle = 0
  if (!pending.length) return
  const batch = pending
  pending = []
  useWorkspace.getState().appendBatch(batch)
}

function scheduleFlush(): void {
  if (rafHandle) return
  rafHandle = requestAnimationFrame(flushPending)
}

let installed = false
export function installChatStream(): void {
  if (installed) return
  installed = true
  const ws = useWorkspace.getState

  window.api.onChatChunk((chunk) => {
    const target = registry.get(chunk.streamId)
    if (!target) return
    if (chunk.type === 'text') {
      chunkCount++
      charCount += chunk.text.length
      useTokens.getState().note(chunk.text.length, target.paneId)
      pending.push({ paneId: target.paneId, messageId: target.messageId, text: chunk.text })
      scheduleFlush()
    } else if (chunk.type === 'done') {
      flushPending() // ensure buffered text is committed before finalizing
      ws().endMessage(target.paneId, target.messageId)
      ws().setActiveStream(target.paneId, undefined)
      registry.delete(chunk.streamId)
      const msg = ws().panes[target.paneId]?.ai?.messages.find((m) => m.id === target.messageId)
      if (msg && onAssistantComplete) onAssistantComplete(target.paneId, msg.content)
    } else if (chunk.type === 'error') {
      flushPending()
      ws().appendToMessage(target.paneId, target.messageId, `\n\n⚠️ ${chunk.message}`)
      ws().endMessage(target.paneId, target.messageId)
      ws().setActiveStream(target.paneId, undefined)
      registry.delete(chunk.streamId)
    }
  })
}

export function sendChat(pane: Pane, prompt: string): void {
  if (!pane.ai || !prompt.trim()) return
  const ws = useWorkspace.getState()

  const userMsg: ChatMessage = {
    id: newMessageId(),
    role: 'user',
    content: prompt,
    createdAt: Date.now()
  }
  ws.addMessage(pane.id, userMsg)

  const assistantId = newMessageId()
  ws.addMessage(pane.id, {
    id: assistantId,
    role: 'assistant',
    content: '',
    streaming: true,
    createdAt: Date.now()
  })

  const streamId = newMessageId()
  registry.set(streamId, { paneId: pane.id, messageId: assistantId })
  ws.setActiveStream(pane.id, streamId)

  // Build history from the freshly-updated store, excluding the empty placeholder.
  const history = useWorkspace
    .getState()
    .panes[pane.id]?.ai!.messages.filter((m) => m.id !== assistantId)
    .map((m) => ({ role: m.role, content: m.content }))

  void window.api.startChat({
    streamId,
    paneId: pane.id,
    provider: pane.ai.provider,
    model: pane.ai.model,
    messages: history ?? []
  })
}

export function stopChat(pane: Pane): void {
  const streamId = pane.ai?.activeStreamId
  if (!streamId) return
  void window.api.cancelChat(streamId)
  const target = registry.get(streamId)
  if (target) {
    useWorkspace.getState().endMessage(target.paneId, target.messageId)
    registry.delete(streamId)
  }
  useWorkspace.getState().setActiveStream(pane.id, undefined)
}

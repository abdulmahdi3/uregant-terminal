import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react'
import clsx from 'clsx'
import { useUi } from '@renderer/store/ui'
import { useWorkspace } from '@renderer/store/workspace'
import { getLeaves } from '@renderer/lib/mosaicTree'
import {
  searchInPane,
  clearSearch,
  onSearchResults,
  findMatchesInPane,
  scrollPaneToLine,
  type PaneMatch
} from '@renderer/lib/terminalPool'

type Scope = 'pane' | 'all'

interface PaneHits {
  paneId: string
  title: string
  num: number
  matches: PaneMatch[]
}

/**
 * Ctrl+F scrollback search. Two scopes: the active pane (xterm's in-place
 * highlight + next/prev), or every pane in the workspace (a grouped results
 * panel — click a hit to jump to that pane and line).
 */
export default function SearchBar(): JSX.Element | null {
  const open = useUi((s) => s.searchOpen)
  const setOpen = useUi((s) => s.setSearchOpen)
  const paneId = useWorkspace((s) => s.activePaneId)
  const panes = useWorkspace((s) => s.panes)
  const layout = useWorkspace((s) => s.layout)
  const setActive = useWorkspace((s) => s.setActive)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<Scope>('pane')
  const [results, setResults] = useState({ resultIndex: -1, resultCount: 0 })
  const [allHits, setAllHits] = useState<PaneHits[]>([])
  const ref = useRef<HTMLInputElement>(null)

  const leaves = useMemo(() => getLeaves(layout), [layout])

  // Track per-pane match counts (active pane) while in single-pane mode.
  useEffect(() => {
    if (!open || scope !== 'pane' || !paneId) return
    const off = onSearchResults(paneId, setResults)
    return off
  }, [open, scope, paneId])

  useEffect(() => {
    if (open) requestAnimationFrame(() => ref.current?.focus())
  }, [open])

  // Single-pane: drive xterm's search addon. All-panes: scan every buffer.
  useEffect(() => {
    if (!open) return
    if (scope === 'pane') {
      if (paneId) searchInPane(paneId, query, 'next')
      if (!query) setResults({ resultIndex: -1, resultCount: 0 })
      return
    }
    if (!query) {
      setAllHits([])
      return
    }
    const hits: PaneHits[] = []
    for (const id of leaves) {
      const matches = findMatchesInPane(id, query)
      if (matches.length) {
        hits.push({ paneId: id, title: panes[id]?.title ?? id, num: leaves.indexOf(id) + 1, matches })
      }
    }
    setAllHits(hits)
  }, [query, open, scope, paneId, leaves, panes])

  if (!open) return null

  const close = (): void => {
    if (paneId) clearSearch(paneId)
    leaves.forEach((id) => clearSearch(id))
    setOpen(false)
  }
  const find = (dir: 'next' | 'prev'): void => {
    if (paneId && query) searchInPane(paneId, query, dir)
  }
  const jumpTo = (id: string, line: number): void => {
    setActive(id)
    searchInPane(id, query, 'next')
    scrollPaneToLine(id, line)
  }

  const totalAll = allHits.reduce((n, h) => n + h.matches.length, 0)

  return (
    <div className="search-bar" onMouseDown={(e) => e.stopPropagation()}>
      <div className="search-bar-row">
        <Search size={13} className="search-bar-icon" />
        <input
          ref={ref}
          className="search-bar-input"
          placeholder={scope === 'all' ? 'Search all panes…' : 'Search scrollback…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && scope === 'pane') {
              e.preventDefault()
              find(e.shiftKey ? 'prev' : 'next')
            } else if (e.key === 'Escape') {
              e.preventDefault()
              close()
            }
          }}
        />
        {scope === 'pane' ? (
          <>
            <span className="search-bar-count">
              {results.resultCount
                ? `${results.resultIndex + 1}/${results.resultCount}`
                : query
                  ? '0/0'
                  : ''}
            </span>
            <button className="icon-btn" title="Previous (Shift+Enter)" onClick={() => find('prev')}>
              <ChevronUp size={14} />
            </button>
            <button className="icon-btn" title="Next (Enter)" onClick={() => find('next')}>
              <ChevronDown size={14} />
            </button>
          </>
        ) : (
          <span className="search-bar-count">{query ? `${totalAll}` : ''}</span>
        )}
        <button className="icon-btn" title="Close (Esc)" onClick={close}>
          <X size={14} />
        </button>
      </div>

      <div className="search-scope">
        <button
          className={clsx('search-scope-btn', scope === 'pane' && 'active')}
          onClick={() => setScope('pane')}
        >
          This pane
        </button>
        <button
          className={clsx('search-scope-btn', scope === 'all' && 'active')}
          onClick={() => setScope('all')}
        >
          All panes
        </button>
      </div>

      {scope === 'all' && query && (
        <div className="search-results">
          {allHits.length === 0 ? (
            <div className="search-empty">No matches in any pane</div>
          ) : (
            allHits.map((h) => (
              <div className="search-group" key={h.paneId}>
                <div className="search-group-head">
                  <span className="search-group-num">{h.num}</span>
                  <span className="search-group-title">{h.title}</span>
                  <span className="search-group-count">
                    {h.matches.length} match{h.matches.length !== 1 ? 'es' : ''}
                  </span>
                </div>
                {h.matches.map((m) => (
                  <button
                    key={m.line}
                    className="search-hit"
                    title={m.text}
                    onClick={() => jumpTo(h.paneId, m.line)}
                  >
                    {m.text || ' '}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

import type { MosaicNode, MosaicDirection } from 'react-mosaic-component'

export interface PaneNeighbors {
  left?: string
  right?: string
  up?: string
  down?: string
}

/**
 * Find the immediate spatial neighbor of `target` in each direction.
 * For a row split (horizontal), first=left / second=right.
 * For a column split (vertical), first=top / second=bottom.
 * Returns the nearest leaf in each direction.
 */
export function getMosaicNeighbors(
  layout: MosaicNode<string> | null,
  target: string
): PaneNeighbors {
  if (!layout) return {}

  function firstLeaf(node: MosaicNode<string>): string {
    if (typeof node === 'string') return node
    return firstLeaf(node.first)
  }

  function lastLeaf(node: MosaicNode<string>): string {
    if (typeof node === 'string') return node
    return lastLeaf(node.second)
  }

  const result: PaneNeighbors = {}

  function visit(node: MosaicNode<string>, ctx: PaneNeighbors): boolean {
    if (typeof node === 'string') {
      if (node === target) {
        Object.assign(result, ctx)
        return true
      }
      return false
    }
    if (node.direction === 'row') {
      if (visit(node.first, { ...ctx, right: firstLeaf(node.second) })) return true
      if (visit(node.second, { ...ctx, left: lastLeaf(node.first) })) return true
    } else {
      if (visit(node.first, { ...ctx, down: firstLeaf(node.second) })) return true
      if (visit(node.second, { ...ctx, up: lastLeaf(node.first) })) return true
    }
    return false
  }

  visit(layout, {})
  return result
}

/** Collect all leaf ids in the tree. */
export function getLeaves(node: MosaicNode<string> | null): string[] {
  if (node === null) return []
  if (typeof node === 'string') return [node]
  return [...getLeaves(node.first), ...getLeaves(node.second)]
}

/** Replace a single leaf with a split node containing the leaf plus a new pane. */
export function splitLeaf(
  node: MosaicNode<string> | null,
  targetId: string,
  newId: string,
  direction: MosaicDirection
): MosaicNode<string> {
  const split: MosaicNode<string> = {
    direction,
    first: targetId,
    second: newId,
    splitPercentage: 50
  }
  if (node === null) return newId
  if (typeof node === 'string') return node === targetId ? split : node
  return {
    ...node,
    first: splitLeaf(node.first, targetId, newId, direction),
    second: splitLeaf(node.second, targetId, newId, direction)
  }
}

/** Remove a leaf and promote its sibling so the tree stays well-formed. */
export function removeLeaf(
  node: MosaicNode<string> | null,
  targetId: string
): MosaicNode<string> | null {
  if (node === null) return null
  if (typeof node === 'string') return node === targetId ? null : node
  const first = removeLeaf(node.first, targetId)
  const second = removeLeaf(node.second, targetId)
  if (first === null) return second
  if (second === null) return first
  return { ...node, first, second }
}

/**
 * Pure helpers for parent/child trees built from flat records (`{ id, parentId }`).
 * Used by the org chart; reusable for any department picker, breadcrumb or indented list.
 * Cycle-safe: a node whose parent chain loops, or whose parent is missing, becomes a root.
 */

export interface FlatNode {
  id: string
  parentId: string | null
}

export interface TreeNode<T extends FlatNode> {
  node: T
  children: TreeNode<T>[]
  /** 0 = root. */
  depth: number
}

/** Index of children by parent id (null key = roots), in input order. */
export function childrenIndex<T extends FlatNode>(nodes: T[]): Map<string | null, T[]> {
  const ids = new Set(nodes.map((n) => n.id))
  const safeParent = parentResolver(nodes)
  const out = new Map<string | null, T[]>()
  for (const n of nodes) {
    const p = n.parentId && ids.has(n.parentId) ? safeParent(n) : null
    const list = out.get(p)
    if (list) list.push(n)
    else out.set(p, [n])
  }
  return out
}

/** Returns the parent id to use for a node, or null when following it would create a cycle. */
function parentResolver<T extends FlatNode>(nodes: T[]): (n: T) => string | null {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const cache = new Map<string, boolean>()
  function inCycle(id: string): boolean {
    const cached = cache.get(id)
    if (cached !== undefined) return cached
    const seen = new Set<string>()
    let cur: string | null = id
    let cyclic = false
    while (cur) {
      if (seen.has(cur)) {
        cyclic = true
        break
      }
      seen.add(cur)
      cur = byId.get(cur)?.parentId ?? null
    }
    cache.set(id, cyclic)
    return cyclic
  }
  return (n) => (n.parentId && byId.has(n.parentId) && !inCycle(n.id) ? n.parentId : null)
}

/**
 * Builds the forest. `compare` orders siblings (defaults to input order).
 * Nodes with a missing parent (e.g. filtered out) become roots.
 */
export function buildTree<T extends FlatNode>(nodes: T[], compare?: (a: T, b: T) => number): TreeNode<T>[] {
  const index = childrenIndex(nodes)
  const visit = (parent: string | null, depth: number, seen: Set<string>): TreeNode<T>[] => {
    const kids = [...(index.get(parent) ?? [])]
    if (compare) kids.sort(compare)
    return kids
      .filter((k) => !seen.has(k.id))
      .map((k) => {
        seen.add(k.id)
        return { node: k, depth, children: visit(k.id, depth + 1, seen) }
      })
  }
  return visit(null, 0, new Set())
}

/** Ids of every descendant of `id` (not including `id`). */
export function descendants<T extends FlatNode>(id: string, nodes: T[]): string[] {
  const index = childrenIndex(nodes)
  const out: string[] = []
  const seen = new Set<string>([id])
  const stack = [...(index.get(id) ?? [])]
  while (stack.length) {
    const n = stack.pop()!
    if (seen.has(n.id)) continue
    seen.add(n.id)
    out.push(n.id)
    stack.push(...(index.get(n.id) ?? []))
  }
  return out
}

/** Root → `id` (inclusive). Empty if `id` is unknown. */
export function pathTo<T extends FlatNode>(id: string, nodes: T[]): T[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const out: T[] = []
  const seen = new Set<string>()
  let cur = byId.get(id)
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    out.unshift(cur)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return out
}

/** Ids of every node that has at least one child. */
export function parentIds<T extends FlatNode>(nodes: T[]): string[] {
  const index = childrenIndex(nodes)
  return [...index.keys()].filter((k): k is string => k !== null)
}

/** Depth-first walk of a built forest. */
export function walk<T extends FlatNode>(forest: TreeNode<T>[], fn: (t: TreeNode<T>) => void): void {
  for (const t of forest) {
    fn(t)
    walk(t.children, fn)
  }
}

/** Number of nodes under `t` (all levels). */
export function countDescendants<T extends FlatNode>(t: TreeNode<T>): number {
  return t.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0)
}

/**
 * Keeps nodes that pass `keep`; a dropped node's children re-attach to its nearest kept ancestor
 * (so hiding an inactive department doesn't orphan its active sub-departments).
 */
export function filterFlat<T extends FlatNode>(nodes: T[], keep: (n: T) => boolean): T[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const kept = nodes.filter(keep)
  const keptIds = new Set(kept.map((n) => n.id))
  return kept.map((n) => {
    let p = n.parentId
    const seen = new Set<string>()
    while (p && !keptIds.has(p) && !seen.has(p)) {
      seen.add(p)
      p = byId.get(p)?.parentId ?? null
    }
    const parentId = p && keptIds.has(p) ? p : null
    return parentId === n.parentId ? n : { ...n, parentId }
  })
}

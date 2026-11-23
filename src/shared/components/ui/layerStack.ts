/**
 * Open overlay layers (modals, drawers, menus), in the order they opened. Escape closes only the
 * topmost one: a modal opened from a drawer closes on its own, and the drawer stays open.
 */
const stack: symbol[] = []

/** Registers an open layer; returns a remover. */
export function pushLayer(): { id: symbol; remove: () => void } {
  const id = Symbol('layer')
  stack.push(id)
  return {
    id,
    remove: () => {
      const i = stack.lastIndexOf(id)
      if (i >= 0) stack.splice(i, 1)
    },
  }
}

/** True when `id` is the most recently opened layer still open. */
export const isTopLayer = (id: symbol): boolean => stack[stack.length - 1] === id

/**
 * Listens for Escape on the document and calls `onEscape` only when this layer is on top. Lower
 * layers see the same key event but ignore it: the top layer is still in the stack while every
 * listener runs (it is removed when its component unmounts, after the event).
 */
export function onTopEscape(onEscape: () => void): () => void {
  const layer = pushLayer()
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !isTopLayer(layer.id)) return
    onEscape()
  }
  document.addEventListener('keydown', onKey)
  return () => {
    document.removeEventListener('keydown', onKey)
    layer.remove()
  }
}

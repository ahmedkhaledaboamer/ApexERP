import { describe, expect, it } from 'vitest'
import { isTopLayer, pushLayer } from './layerStack'

/** Escape goes to the topmost open overlay only (modal over drawer, menu over modal). */
describe('layer stack', () => {
  it('tracks the topmost layer as layers open and close in any order', () => {
    const drawer = pushLayer()
    expect(isTopLayer(drawer.id)).toBe(true)
    const modal = pushLayer()
    expect(isTopLayer(modal.id)).toBe(true)
    expect(isTopLayer(drawer.id)).toBe(false)
    modal.remove()
    expect(isTopLayer(drawer.id)).toBe(true)
    // Closing a lower layer first keeps the upper one on top.
    const menu = pushLayer()
    drawer.remove()
    expect(isTopLayer(menu.id)).toBe(true)
    menu.remove()
    menu.remove() // idempotent
    expect(isTopLayer(menu.id)).toBe(false)
  })
})

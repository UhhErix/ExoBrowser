import { useLayoutEffect, type RefObject } from 'react'

/*
 * The light of Exo's Liquid Glass (styles/glass.css, DESIGN.md › Glass): a press lights the glass from within where
 * it lands, one listener for every glass on the page. The glass used to bend what is behind it at its edge (a
 * displacement map per size, Snell refraction through a squircle bezel); at 1080p that edge read as bent inward and
 * stepped, and one side lit brighter than the other. Its liquid look is the inside alone now, frosted, inside one even
 * line all the way round.
 */

// Light from the press: glass lights from within where it is pressed (glass.css › ::after).
function followPresses() {
  document.addEventListener('pointerdown', event => {
    const glass = (event.target as Element | null)?.closest?.<HTMLElement>('.exo-glass')
    if (!glass) return
    const box = glass.getBoundingClientRect()
    glass.style.setProperty('--glass-x', `${event.clientX - box.left}px`)
    glass.style.setProperty('--glass-y', `${event.clientY - box.top}px`)
  }, { capture: true, passive: true })
}

let following = false

/**
 * Glass that lights where it is pressed: the element carries `exo-glass`. (Its name and arguments are the lens's it
 * once also gave; every glass calls it.)
 */
export function useLens(_ref: RefObject<HTMLElement | null>, _mounted = true) {
  useLayoutEffect(() => {
    if (following) return
    following = true
    followPresses()
  }, [])
}

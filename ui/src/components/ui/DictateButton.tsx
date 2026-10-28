import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { Mic, Stop } from '../../brand/icons'
import { onDictationLevel, toggleDictation, useDictation, type DictationField } from '../../lib/dictation'
import { shouldReduceMotion } from '../../lib/motionPreference'
import { cn } from '../../lib/utils'
import { Spinner } from './Spinner'

/** What an overlaid mic keeps of a bare input's right edge: itself (24px) and its inset (4px). */
const RESERVE = 28

/**
 * Dictation's mic (Settings › General › Dictation), for the text box `target`: press it and talk, press Stop and what
 * you said goes in at the caret; Escape drops the take. While it listens the box shows a voice line of the mic's level;
 * while the speech model is still coming or the take is being transcribed, Exo's ring. Drawn only while dictation is on
 * and this PC runs it.
 * place: "inline" sits where it is put (the end of a field that is a row: a search label, Ctrl+K's bar, the Discord
 * composer's tools); "overlay" goes inside a bare input's right edge and keeps that much of the input's padding, from the
 * start, so the words never move when it shows or changes.
 */
export function DictateButton({ target, place = 'inline', className }: {
  target: RefObject<DictationField | null>
  place?: 'inline' | 'overlay'
  className?: string
}) {
  const { state, field, phase } = useDictation()
  const anchor = `--exo-dictate-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const shown = state?.on === true && state.available
  const [foot, setFoot] = useState(false)

  // Over a bare input: the input is its anchor and keeps room for it.
  useLayoutEffect(() => {
    const el = target.current
    if (!el || !shown || place !== 'overlay') return
    const before = el.style.paddingInlineEnd
    el.style.paddingInlineEnd = `${(parseFloat(getComputedStyle(el).paddingInlineEnd) || 0) + RESERVE}px`
    el.style.setProperty('anchor-name', anchor)
    setFoot(el instanceof HTMLTextAreaElement)
    return () => {
      el.style.paddingInlineEnd = before
      el.style.removeProperty('anchor-name')
    }
  }, [target, shown, place, anchor])

  if (!shown) return null
  const mine = field !== null && field === target.current
  const listening = mine && phase === 'listening'
  const waiting = mine && (phase === 'waiting' || phase === 'transcribing')
  return (
    <>
      <button
        type="button"
        className={cn('exo-dictate', place === 'overlay' && 'is-overlay', foot && 'is-foot', className)}
        style={{ '--exo-dictate-anchor': anchor } as CSSProperties}
        aria-label={listening ? 'Stop dictating' : 'Dictate'}
        aria-pressed={listening || waiting}
        // The text box keeps focus and its caret while the mic is pressed with the pointer.
        onPointerDown={event => { if (event.button === 0) event.preventDefault() }}
        onClick={() => { if (target.current) void toggleDictation(target.current) }}
      >
        {waiting ? <Spinner size={14} label={phase === 'waiting' ? 'Dictation getting ready' : 'Transcribing'} />
          : listening ? <Stop size={14} /> : <Mic size={16} />}
      </button>
      {listening && field ? <VoiceLine field={field} anchor={anchor} /> : null}
    </>
  )
}

/**
 * The take's voice line over its text box: a wave in the ink that rises with the mic's level over a fainter one that
 * runs against it, across the box while it's empty (its placeholder makes way) and along its foot under words already
 * typed; it ripples a little while you're quiet, so it reads as listening. Canvas, redrawn each frame only while it
 * listens. Under Reduce motion, a still bar whose height follows the level.
 */
function VoiceLine({ field, anchor }: { field: DictationField; anchor: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)

  // The box is the line's anchor (an overlaid mic made it one already); its placeholder makes way for the line.
  useLayoutEffect(() => {
    const anchored = field.style.getPropertyValue('anchor-name') !== ''
    if (!anchored) field.style.setProperty('anchor-name', anchor)
    const placeholder = field.placeholder
    field.placeholder = ''
    return () => {
      if (!anchored) field.style.removeProperty('anchor-name')
      field.placeholder = placeholder
    }
  }, [field, anchor])

  useEffect(() => {
    const el = canvas.current
    const context = el?.getContext('2d')
    if (!el || !context) return
    const reduce = shouldReduceMotion()
    const ink = getComputedStyle(el).color
    let target = 0
    let level = 0
    let wave = 0
    let last = performance.now()
    let frame = 0
    const draw = () => {
      const ratio = window.devicePixelRatio || 1
      const width = el.clientWidth
      const height = el.clientHeight
      if (el.width !== Math.round(width * ratio) || el.height !== Math.round(height * ratio)) {
        el.width = Math.round(width * ratio)
        el.height = Math.round(height * ratio)
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)
      const empty = field.value.length === 0
      // Empty: across the middle, up to nearly half the box; with words: a strip along the foot, never over them.
      const middle = empty ? height / 2 : height - 5
      const most = empty ? height * 0.44 : 4
      // Quiet still ripples (a fifth of the way); a voice takes it the rest.
      const reach = most * (0.2 + 0.8 * level)
      const left = 12
      const span = Math.max(0, width - left * 2)
      context.strokeStyle = ink
      context.fillStyle = ink
      if (reduce) {
        const thick = 2.5 + most * level
        context.beginPath()
        context.roundRect(left, middle - thick / 2, span, thick, thick / 2)
        context.fill()
        return
      }
      context.lineCap = 'round'
      context.lineJoin = 'round'
      const stroke = (thickness: number, alpha: number, phase: number, scale: number) => {
        context.globalAlpha = alpha
        context.lineWidth = thickness
        context.beginPath()
        for (let x = 0; x <= span; x += 2) {
          const t = span ? x / span : 0
          const envelope = Math.sin(Math.PI * t) ** 1.5
          const y = middle + reach * scale * envelope * (0.6 * Math.sin(t * 6 * Math.PI - phase) + 0.4 * Math.sin(t * 10.6 * Math.PI + phase * 1.3))
          if (x === 0) context.moveTo(left + x, y)
          else context.lineTo(left + x, y)
        }
        context.stroke()
      }
      // The fainter wave runs the other way, so the pair reads as a voice and not a line.
      stroke(1.75, 0.4, -wave * 0.8 + 1.7, 0.7)
      stroke(2.5, 1, wave, 1)
      context.globalAlpha = 1
    }
    const tick = (now: number) => {
      // Up at once with the voice, down a little slower, so the line breathes rather than flickers.
      level += (target - level) * (target > level ? 0.35 : 0.12)
      wave += (now - last) * 0.006
      last = now
      draw()
      frame = requestAnimationFrame(tick)
    }
    const off = onDictationLevel(value => {
      target = value
      if (reduce) { level = value; draw() }
    })
    if (reduce) draw()
    else frame = requestAnimationFrame(tick)
    return () => {
      off()
      cancelAnimationFrame(frame)
    }
  }, [field])

  return <canvas ref={canvas} className="exo-dictate-line" style={{ '--exo-dictate-anchor': anchor } as CSSProperties} aria-hidden="true" />
}

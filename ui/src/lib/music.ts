import { host } from './host'
export type MusicService = 'spotify' | 'apple' | 'youtube'
const serviceKey = 'exo.musicWebService'

export function savedMusicService(): MusicService {
  try {
    const saved = localStorage.getItem(serviceKey)
    // Cider is no longer a service; Apple Music is what it played.
    if (saved === 'cider') return 'apple'
    return saved === 'apple' || saved === 'youtube' ? saved : 'spotify'
  } catch {
    return 'spotify'
  }
}

export function saveMusicService(service: MusicService) {
  try {
    localStorage.setItem(serviceKey, service)
  } catch {
    // Service selection still works when local preferences are unavailable.
  }
  window.dispatchEvent(new CustomEvent('exo-music-service', { detail: service }))
}

// Cache-first: whether this service was signed in last time Exo's room saw it.
const signedInKey = (service: MusicService) => `exo.music.signedIn.${service}`
export function rememberSignedIn(service: MusicService, signedIn: boolean) {
  try {
    if (signedIn) localStorage.setItem(signedInKey(service), '1')
    else localStorage.removeItem(signedInKey(service))
  } catch { /* storage is a convenience */ }
}
export function wasSignedIn(service: MusicService): boolean {
  try { return localStorage.getItem(signedInKey(service)) === '1' } catch { return false }
}

/** A Spotify link opened elsewhere in Exo (a Discord message) waits here for the Music room. */
export const MUSIC_LINK = 'exo-music-link'
let pendingLink: string | null = null
const SPOTIFY_LINK = /^https?:\/\/(open\.spotify\.com|play\.spotify\.com|spotify\.link|spotify\.app\.link|spotify-alternate\.app\.link)\//i

/** A Spotify page or Jam opens in the Music room when Spotify is the signed-in service; anything else, or a link
    Exo can't open there, goes to the browser. */
export function openLink(url: string) {
  const browser = () => void host.openUrl(url).catch(() => { })
  if (!SPOTIFY_LINK.test(url) || savedMusicService() !== 'spotify' || !wasSignedIn('spotify')) return browser()
  void host.spotifyLink(url).then(result => {
    if (!result.ok || !result.uri) return browser()
    pendingLink = result.uri
    window.dispatchEvent(new CustomEvent(MUSIC_LINK))
  }).catch(browser)
}

/** The spotify: URI waiting for the room, once. */
export function takeMusicLink(): string | null {
  const uri = pendingLink
  pendingLink = null
  return uri
}

export type MusicAction = 'play' | 'pause' | 'toggle' | 'previous' | 'next' | 'seek'

/** A song as listen-along matches it across services: its name, its artists as each service writes them, its length. */
export type MatchSong = { title: string; artists: string[]; durationMs?: number | null }

/** The selected provider's song, from its own page or its own Windows media session. */
export type MusicPlayback = {
  /** Host publish order; an older answer never replaces a newer event. */
  seq?: number
  provider: MusicService
  status: 'playing' | 'paused' | 'stopped' | 'none'
  title: string
  artist: string
  artworkDataUrl?: string | null
  positionMs?: number | null
  durationMs?: number | null
  /** How old positionMs was when the host sent it (host monotonic clock). */
  positionAgeMs?: number | null
  /** How fast the position advances: 0 while paused, buffering or in an ad. */
  rate?: number | null
  canPlay: boolean
  canPause: boolean
  canPrev: boolean
  canNext: boolean
  canSeek: boolean
}

export function musicTime(milliseconds: number | null | undefined) {
  if (milliseconds === null || milliseconds === undefined || !Number.isFinite(milliseconds) || milliseconds < 0) return '–:––'
  const value = Math.floor(milliseconds / 1000)
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}

/** Where positionMs was true on this page's monotonic clock (performance.now()). */
export function playbackAnchor(playback: MusicPlayback, receivedAt: number): number {
  const age = playback.positionAgeMs
  return receivedAt - (typeof age === 'number' && Number.isFinite(age) && age > 0 ? age : 0)
}

/** The position now, advanced from the anchor at the provider's own rate and held while paused. */
export function musicPosition(playback: MusicPlayback, anchor: number, now: number): number | null {
  const position = playback.positionMs
  if (position === null || position === undefined || !Number.isFinite(position) || position < 0) return null
  const rate = playback.status === 'playing' && typeof playback.rate === 'number' && playback.rate > 0 ? playback.rate : 0
  const duration = playback.durationMs !== null && playback.durationMs !== undefined && playback.durationMs > 0 ? playback.durationMs : Infinity
  return Math.min(position + Math.max(0, now - anchor) * rate, duration)
}

let warmedAt = 0
/**
 * The pointer is on its way to a music control: thaw an idle, frozen music
 * app now (at most every five seconds), so the click lands on a running app.
 */
export function warmMusic() {
  const now = Date.now()
  if (now - warmedAt < 5000) return
  warmedAt = now
  host.musicWarm().catch(() => { })
}

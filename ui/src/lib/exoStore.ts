/**
 * Exo Store's shapes (ExoLauncher/Services/ExoStore, cloud/store): what the host hands the Store room's Exo section.
 * Art comes as local addresses (Exo's covers host); paths and the store session stay in native code.
 */
import type { StoreFit } from './host'

export type ExoJob = { id: string; phase: 'download' | 'check' | 'unpack' | 'upload' | 'review' | 'done' | 'idle'; done: number; total: number }

/** A game in the catalog, as a card shows it. installed: the version on this PC. */
export type ExoTile = {
  id: string
  title: string
  short: string
  publisher: string
  tags: string[]
  age: number
  cover?: string | null
  version?: string | null
  size?: number | null
  installed?: string | null
  job?: ExoJob | null
}

/** enabled false: no store is set up on this PC, and nothing was contacted. */
export type ExoCatalog = { ok: boolean; enabled: boolean; message?: string; items: ExoTile[] }

export type ExoArtUrls = { cover?: string | null; hero?: string | null; logo?: string | null; shots: string[] }

export type ExoSpec = { label: string; minimum?: string | null; recommended?: string | null; mine?: string | null; meets?: StoreFit | null }

export type ExoListing = {
  ok: boolean
  message?: string
  id: string
  title: string
  short?: string
  about?: string
  publisher: string
  website?: string | null
  tags: string[]
  age: number
  descriptors: string[]
  links?: { website?: string; support?: string } | null
  art?: ExoArtUrls | null
  version?: string | null
  size?: number | null
  released?: string | null
  updated?: string | null
  specs: ExoSpec[]
  fit?: StoreFit | null
  installed?: string | null
  job?: ExoJob | null
}

export type ExoArt = { sha256: string; type: 'png' | 'jpg' | 'webp'; size: number; width: number; height: number }

export type ExoDraft = {
  title: string
  short: string
  about: string
  tags: string[]
  age: number
  descriptors: string[]
  system: Record<string, { minimum?: string; recommended?: string }>
  links: { website?: string; support?: string }
  art: { cover?: ExoArt; hero?: ExoArt; logo?: ExoArt; shots: ExoArt[] }
  price?: 0
}

export type ExoChecks = { ok?: boolean; files?: number; unpacked?: number; problems?: string[] }

export type ExoBuildState = 'uploading' | 'draft' | 'pending' | 'approved' | 'rejected' | 'removed'

export type ExoBuild = {
  id: number
  version: string
  host: 'external' | 'exo'
  size: number
  sha256: string
  launch: string
  state: ExoBuildState
  note: string
  checks: ExoChecks
  created: number
  url?: string
  path?: string
}

export type ExoListingState = 'draft' | 'pending' | 'approved' | 'rejected'

export type ExoMine = { id: string; draft: ExoDraft; live: boolean; state: ExoListingState; note: string; delisted: string; builds: ExoBuild[]; artUrls?: ExoArtUrls | null }

export type ExoProfile = { name: string; website: string; email: string }

/** What a publish action answers; each action fills its own part. */
export type ExoPublishAnswer = {
  ok: boolean
  message?: string
  cancelled?: boolean
  checks?: ExoChecks | null
  exoId?: string
  admin?: boolean
  exoHosting?: boolean
  publisher?: ExoProfile | null
  listings?: ExoMine[]
  draft?: ExoDraft
  artUrls?: ExoArtUrls | null
  art?: ExoArt | null
  url?: string | null
  token?: string
  name?: string
  size?: number
  sha256?: string
  exes?: string[]
  build?: ExoBuild | null
}

export type ExoReviewListing = {
  id: string
  draft: ExoDraft
  live?: ExoDraft & { title: string }
  submitted: number
  publisher: { exoId: string; name: string; website: string; email: string }
  builds: ExoBuild[]
  artUrls?: ExoArtUrls | null
}

export type ExoReport = { id: number; listing: string; reason: string; text: string; contact: string; created: number; delisted?: string | null; title?: string | null }

export type ExoReview = {
  ok: boolean
  message?: string
  listings?: ExoReviewListing[]
  reports?: ExoReport[]
  delisted?: { id: string; delisted: string; title?: string | null }[]
}

/** The store's word lists (cloud/store/src/limits.js), in the words the page shows. */
export const EXO_TAGS = [
  'Action', 'Adventure', 'Arcade', 'Card game', 'Casual', 'Co-op', 'Fighting', 'Horror', 'Indie', 'Multiplayer',
  'Open world', 'Platformer', 'Puzzle', 'Racing', 'Roguelike', 'RPG', 'Sandbox', 'Shooter', 'Simulation',
  'Singleplayer', 'Sports', 'Strategy', 'Survival', 'Visual novel',
]

export const EXO_DESCRIPTORS: Record<string, string> = {
  violence: 'Violence', blood: 'Blood', gore: 'Gore', fear: 'Fear', 'strong-language': 'Strong language',
  'sexual-content': 'Sexual content', nudity: 'Nudity', drugs: 'Drugs', 'alcohol-tobacco': 'Alcohol or tobacco',
  gambling: 'Gambling', 'online-interaction': 'Online interaction', 'in-game-purchases': 'In-game purchases',
}

export const EXO_AGES = [3, 7, 12, 16, 18]

export const EXO_PARTS = ['OS', 'Processor', 'Graphics', 'Memory', 'Storage', 'DirectX', 'Network']

export const EXO_REPORT_REASONS: Record<string, string> = {
  dmca: 'Copyright', malware: 'Malware', illegal: 'Illegal content', misleading: 'Misleading', rating: 'Wrong age rating', other: 'Something else',
}

export const EXO_DELIST_REASONS: Record<string, string> = {
  dmca: 'Copyright notice', malware: 'Malware', illegal: 'Illegal content', publisher: 'Publisher asked', terms: 'Breaks the terms',
}

/** "1.2 GB", "340 MB". */
export function bytesText(size?: number | null): string {
  if (!size) return '—'
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB']
  let value = size
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit++ }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

type WebViewFiles = { chrome?: { webview?: { postMessageWithAdditionalObjects?: (message: string, objects: ArrayLike<File>) => void } } }

/**
 * Hands files the person picked or dropped to the host (WebView2 gives the host each File with its path; the page never
 * reads one) under a one-time token, which the publish call then names.
 */
export function handFiles(files: File[]): string {
  const token = crypto.randomUUID()
  ;(window as unknown as WebViewFiles).chrome?.webview?.postMessageWithAdditionalObjects?.(`exo-store-files:${token}`, files)
  return token
}

import { clsx, type ClassValue } from 'clsx'
import { isPreloaded, type Game, type SortMode } from './host'

/** Joins class names. No Tailwind conflict merging: no call site passes conflicting utilities. */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

/** Null is unknown; a validated zero belongs to the current phase. */
export function visibleInstallPercent(percent: number | null | undefined): number | null {
  return typeof percent === 'number' && Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : null
}

/** Download bytes cannot be used as installation/verification progress. */
export function transferPercent(progress: {
  phase?: string | null
  percent?: number | null
  bytesDownloaded?: number | null
  bytesToDownload?: number | null
} | null | undefined): number | null {
  const direct = visibleInstallPercent(progress?.percent)
  if (direct != null) return direct
  if (progress?.phase && progress.phase.toLowerCase() !== 'downloading') return null
  const done = progress?.bytesDownloaded
  const total = progress?.bytesToDownload
  if (done == null || total == null || !Number.isFinite(done) || !Number.isFinite(total) || total <= 0 || done < 0 || done > total) return null
  return visibleInstallPercent((100 * done) / total)
}

/** Live byte counters for the install button, e.g. "1.2 GB / 2.6 GB". */
function formatTransferLine(progress: {
  bytesDownloaded?: number | null
  bytesToDownload?: number | null
} | null | undefined): string | null {
  const done = progress?.bytesDownloaded
  const total = progress?.bytesToDownload
  if (total == null || total <= 0) return null
  if (done != null && done > 0) return `${formatSize(done)} / ${formatSize(total)}`
  return formatSize(total)
}

/**
 * Secondary line under a transfer label: the byte counter (unless the label
 * above already carries it), else the store's status once bytes are moving,
 * then the live speed.
 */
export function transferMetaLine(
  progress: {
    status?: string | null
    bytesDownloaded?: number | null
    bytesToDownload?: number | null
    bytesPerSecond?: number | null
  } | null | undefined,
  includeBytes = true,
): string {
  if (!progress) return ''
  const bytes = formatTransferLine(progress)
  const status = progress.status && !/waiting|starting|requesting/i.test(progress.status) ? progress.status : null
  const detail = bytes ? (includeBytes ? bytes : null) : status
  const speed = progress.bytesPerSecond == null ? null : formatSpeed(progress.bytesPerSecond)
  return [detail, speed].filter(Boolean).join(' · ')
}

export function installProgressLabel(
  progress: {
    phase?: string | null
    status?: string | null
    bytesDownloaded?: number | null
    bytesToDownload?: number | null
  } | null | undefined,
  action: 'install' | 'update' | 'download',
): string {
  const bytes = formatTransferLine(progress)
  const phase = (progress?.phase ?? '').toLowerCase()
  const verb =
    phase === 'finalizing'
      ? 'Finalizing'
      : phase === 'installing'
        ? action === 'update'
          ? 'Applying'
          : 'Installing'
        : action === 'update'
          ? 'Updating'
          : action === 'download'
            ? 'Downloading'
            : 'Installing'
  if (bytes) return `${verb}… ${bytes}`

  const status = (progress?.status ?? '').toLowerCase()
  if (/starting|waiting|requesting|queued|preparing/.test(status)) return 'Waiting…'
  if (phase === 'preparing') return 'Starting…'
  if (phase === 'installing') return action === 'update' ? 'Applying…' : 'Installing…'
  if (phase === 'finalizing') return 'Finalizing…'
  return `${verb}…`
}

/** The work a transfer is doing in one word ("Updating", "Applying", "Waiting"), for a working word's moving dots. */
export function installVerb(
  progress: { phase?: string | null; status?: string | null } | null | undefined,
  action: 'install' | 'update' | 'download',
): string {
  return installProgressLabel(progress && { phase: progress.phase, status: progress.status }, action).replace(/….*$/, '')
}

/**
 * Title normalization deliberately treats punctuation, spacing, and accents as
 * cosmetic so the same game folds together across stores.
 */
function normalizeSearchText(value: string): string {
  const decomposed = value.normalize('NFD').toLowerCase()
  let output = ''
  let lastWasSpace = true
  for (const char of decomposed) {
    if (/\p{Mark}/u.test(char)) continue
    if (/\p{Letter}|\p{Number}/u.test(char)) {
      output += char
      lastWasSpace = false
    } else if (!lastWasSpace) {
      output += ' '
      lastWasSpace = true
    }
  }
  return output.trim()
}

/** Same-game fold across stores. */
export function titleIdentity(value: string): string {
  return normalizeSearchText(value).replace(/ /g, '')
}

/** Time played as the game page says it: "45 min", "14 hr 12 min", or a dash. */
export function formatPlayed(minutes: number | null | undefined): string {
  if (minutes == null || minutes <= 0) return '—'
  // No-break spaces keep each number with its unit when a narrow column wraps.
  if (minutes < 60) return `${minutes}\u00a0min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `${hours}\u00a0hr ${rest}\u00a0min` : `${hours}\u00a0hr`
}

/** When it was last played, in the same words as time played: "5 min ago", "3 hr ago", "2 days ago". */
export function formatRelativeLastPlayed(iso?: string | null): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const diff = Date.now() - t
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.round(hours / 24)
  if (days < 14) return days === 1 ? 'Yesterday' : `${days} days ago`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function formatSize(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return '—'
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1) return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`
  const mb = bytes / (1024 * 1024)
  return `${Math.round(mb)} MB`
}

export function formatSpeed(bps: number | null | undefined): string {
  if (bps == null || bps <= 0) return ''
  const mb = bps / (1024 * 1024)
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`
  const kb = bps / 1024
  return `${Math.round(kb)} KB/s`
}

export function storeLabel(store: string): string {
  const map: Record<string, string> = {
    local: 'Local',
    steam: 'Steam',
    epic: 'Epic',
    gog: 'GOG',
    riot: 'Riot',
    xbox: 'Xbox',
    ea: 'EA',
    ubisoft: 'Ubisoft',
    battlenet: 'Battle.net',
    amazon: 'Amazon',
    rockstar: 'Rockstar',
    itch: 'itch.io',
    minecraft: 'Minecraft',
    roblox: 'Roblox',
    paradox: 'Paradox',
    wargaming: 'Wargaming',
    discord: 'Discord',
  }
  return map[store.toLowerCase()] ?? store
}

const libraryTitleCollator = new Intl.Collator(undefined, { sensitivity: 'base' })

export function sortGames(games: Game[], mode: SortMode | string, recent: string[] = []): Game[] {
  const rest = games.filter((g) => !g.isAddPortable && g.id !== 'local:add')
  const cmpTitle = (a: Game, b: Game) => libraryTitleCollator.compare(a.title, b.title)

  let ordered: Game[]
  switch (mode) {
    case 'recent': {
      // The newest launch first, from Exo or from the game's own store app: the host's
      // lastPlayedUtc already carries Exo's own launch stamps. Exo's launch order only
      // breaks ties, so a game played outside Exo is not held behind an older Exo launch.
      const rank = new Map(recent.map((id, i) => [id.toLowerCase(), i]))
      // Each game's stamp is parsed once: inside the comparator it would be parsed per comparison (~log n × more).
      const keyOf = new Map(rest.map((g) => [g, {
        played: g.lastPlayedUtc ? Date.parse(g.lastPlayedUtc) : 0,
        rank: rank.get(g.id.toLowerCase()) ?? 9999,
      }] as const))
      ordered = [...rest].sort((a, b) => {
        const ka = keyOf.get(a)!, kb = keyOf.get(b)!
        if (ka.played !== kb.played) return kb.played - ka.played
        if (ka.rank !== kb.rank) return ka.rank - kb.rank
        return cmpTitle(a, b)
      })
      break
    }
    case 'played':
      ordered = [...rest].sort(
        (a, b) => (b.playtimeMinutes ?? 0) - (a.playtimeMinutes ?? 0) || cmpTitle(a, b),
      )
      break
    case 'size':
      ordered = [...rest].sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0) || cmpTitle(a, b))
      break
    case 'store':
      ordered = [...rest].sort((a, b) => a.store.localeCompare(b.store) || cmpTitle(a, b))
      break
    case 'installed': {
      // What's on this PC first (installed, or preloaded for its release), A to Z; then what you own but haven't installed.
      const here = (game: Game) => Number(game.installed || isPreloaded(game))
      ordered = [...rest].sort((a, b) => here(b) - here(a) || cmpTitle(a, b))
      break
    }
    case 'name':
    default:
      ordered = [...rest].sort(cmpTitle)
      break
  }
  return ordered
}

/** A host message as a status line: trimmed, without its closing full stop. */
export function trimStop(text?: string | null): string {
  return (text ?? '').trim().replace(/\.$/, '')
}

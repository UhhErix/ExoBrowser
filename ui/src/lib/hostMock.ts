import { spotifyMock } from './spotifyMock'
import { mockAdmin, mockAppMessages, mockApps, mockChannels, mockFriends, mockHome, mockMembers, mockMessages, mockProfile } from './discordMock'
/** Browser development fixtures. Dynamically loaded only outside the packaged host. */
import type { Game, GameProperties, LauncherSettings, InstallProgress, InstalledApp, ReplacedApp, RuntimeItem, StoreGift } from './host'
import type { CaptureItem } from './capture'
import type { NoteInfo } from './notes'
import { emitHostEvent } from './host'
const MOCK_GAMES: Game[] = [
  {
    id: 'local:add',
    title: 'Add portable game',
    store: 'local',
    installed: false,
    owned: true,
    canInstall: true,
    primaryAction: 'install',
    status: 'Ready',
    deps: [],
    launchNote: '',
    isAddPortable: true,
  },
  {
    id: 'mock:valorant',
    title: 'VALORANT',
    store: 'riot',
    installed: false,
    owned: true,
    canInstall: true,
    primaryAction: 'install',
    status: 'Demo',
    playtimeMinutes: 0,
    sizeBytes: 30 * 1024 ** 3,
    deps: ['Riot Client', 'Vanguard'],
    launchNote: '',
  },
  {
    id: 'mock:hades',
    title: 'Hades',
    store: 'steam',
    installed: true,
    owned: true,
    primaryAction: 'play',
    status: 'Ready',
    playtimeMinutes: 1240,
    sizeBytes: 15 * 1024 ** 3,
    deps: ['Steam client'],
    launchNote: '',
    lastPlayedUtc: new Date(Date.now() - 26 * 3600_000).toISOString(),
  },
  {
    id: 'mock:eldenring',
    title: 'Elden Ring',
    store: 'steam',
    installed: true,
    owned: true,
    primaryAction: 'play',
    status: 'Ready',
    playtimeMinutes: 4380,
    sizeBytes: 49 * 1024 ** 3,
    deps: [],
    launchNote: '',
    lastPlayedUtc: new Date(Date.now() - 3 * 3600_000).toISOString(),
    isRunning: true,
  },
  {
    id: 'mock:rivals',
    title: 'Marvel Rivals',
    store: 'steam',
    installed: true,
    owned: true,
    primaryAction: 'play',
    status: 'Ready',
    playtimeMinutes: 3125,
    sizeBytes: 74083193346,
    deps: [],
    launchNote: '',
    lastPlayedUtc: new Date(Date.now() - 2 * 86400_000).toISOString(),
  },
  {
    id: 'mock:fortnite',
    title: 'Fortnite',
    store: 'epic',
    installed: true,
    owned: true,
    primaryAction: 'play',
    status: 'Ready',
    playtimeMinutes: 980,
    sizeBytes: 31 * 1024 ** 3,
    deps: [],
    launchNote: '',
  },
  {
    id: 'mock:cyberpunk',
    title: 'Cyberpunk 2077',
    store: 'gog',
    installed: true,
    owned: true,
    primaryAction: 'play',
    status: 'Ready',
    playtimeMinutes: 2210,
    sizeBytes: 70 * 1024 ** 3,
    deps: [],
    launchNote: '',
    updateAvailable: true,
    lastPlayedUtc: new Date(Date.now() - 5 * 86400_000).toISOString(),
  },
  {
    id: 'mock:control',
    title: 'Control',
    store: 'epic',
    installed: false,
    owned: true,
    canInstall: true,
    primaryAction: 'install',
    status: 'Demo',
    playtimeMinutes: 720,
    sizeBytes: 42 * 1024 ** 3,
    deps: [],
    launchNote: '',
  },
  {
    id: 'mock:disco',
    title: 'Disco Elysium',
    store: 'gog',
    installed: false,
    owned: true,
    canInstall: true,
    primaryAction: 'install',
    status: 'Demo',
    playtimeMinutes: 2100,
    sizeBytes: 20 * 1024 ** 3,
    deps: [],
    launchNote: '',
  },
]

/** `?onboarding` in browser dev replays first-run setup against the mock. */
const mockFirstRun = typeof location !== 'undefined' && new URLSearchParams(location.search).has('onboarding')

/** `?shaders` in browser dev: an Exo Shaders engine with two games whose compile time a scan learns. */
const mockShaders = typeof location !== 'undefined' && new URLSearchParams(location.search).has('shaders')
let mockShadersScanned = false
const mockShadersSnapshot = () => ({
  rev: mockShadersScanned ? 2 : 1,
  app: { scanning: false },
  queue: { current: null, waiting: [], finished: [], running: false, paused: false, canStart: false },
  games: [
    { id: 'cyberpunk', name: 'Cyberpunk 2077', statusText: 'Ready to compile', tone: 'primary', inAddAllReady: true, actions: { compile: true }, compileTime: mockShadersScanned ? '1 h 5 min' : undefined },
    { id: 'hogwarts', name: 'Hogwarts Legacy', statusText: 'Ready to compile', tone: 'primary', inAddAllReady: true, actions: { compile: true }, compileTime: mockShadersScanned ? '12 min' : undefined },
  ],
})

/** `?gpu=amd` or `?gpu=intel` in browser dev: System's profile and a game's frame generation for that GPU instead of a GeForce. */
const mockGpu = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('gpu') : null
let mockFrameGen = 'game'
// Best settings' steps stay set once applied, as on a real PC.
const mockApplied = new Set<string>()
const mockApply = (step: string, p?: { action?: unknown }) => { if (p?.action === 'apply') mockApplied.add(step); return mockApplied.has(step) }

/** `?cpu=intel` in browser dev: This PC and Settings' chipset switch for an Intel processor instead of a Ryzen. */
const mockIntelCpu = typeof location !== 'undefined' && new URLSearchParams(location.search).get('cpu') === 'intel'

/**
 * PC › Network in browser dev: an Intel I226-V with Energy-Efficient Ethernet on, which network sets and network-undo
 * puts back. `?net=fine` has nothing to set, `?net=slow` a link held at 100 Mbps by its cable, `?net=wifi` a Wi-Fi
 * adapter (Exo has nothing to set on Wi-Fi; it holds the radio while a game runs).
 */
const mockNet = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('net') : null
let mockNetSet = false
const mockNetItems = (p?: { action?: unknown }) => {
  if (p?.action === 'network') mockNetSet = true
  if (p?.action === 'network-undo') mockNetSet = false
  if (mockNet === 'wifi' || mockNet === 'fine') return []
  const items: Record<string, unknown>[] = [mockNetSet
    ? { key: 'network', label: 'Network', detail: "Exo's settings for games", applied: true, canUndo: true }
    : { key: 'network', label: 'Ethernet', detail: 'Energy-efficient Ethernet on, which can add delay and drop the link. Your connection drops for a few seconds while Exo fixes it.' }]
  if (mockNet === 'slow') items.push({ key: 'netlink', label: 'Ethernet', detail: 'Connected at 100 Mbps, but your adapter does 2.5 Gbps. Try another cable or another port on your router.' })
  return items
}

/**
 * PC › Drives in browser dev: this PC's 990 PRO with flushing off and 132 unsafe shutdowns and a game off DirectStorage's
 * fast path, a worn SATA SSD with bad sectors (the problem case), and a hard drive with games on it. `?drives=fine`
 * shows the same drives with nothing wrong. flush, optimize and all set their row; -undo puts it back.
 */
const mockDrivesFine = typeof location !== 'undefined' && new URLSearchParams(location.search).get('drives') === 'fine'
const mockDriveFixes = { flush: mockDrivesFine, optimize: mockDrivesFine, set: new Set<string>() }
const MOCK_SAMSUNG = { name: 'Samsung', tool: 'Samsung Magician', url: 'https://semiconductor.samsung.com/consumer-storage/support/tools/' }
const MOCK_FIX_ASKS = {
  flush: { key: 'flush', label: 'Write-cache flushing', detail: 'Off on Samsung SSD 990 PRO with Heatsink 2TB, which has shut down without warning 132 times. A power cut can damage files. A restart finishes it.', applied: false, canUndo: false, restart: false },
  optimize: { key: 'optimize', label: 'Weekly optimize', detail: "Windows' Automatic Maintenance is off, so your drives aren't optimized (an SSD retrimmed, a hard drive defragmented).", applied: false, canUndo: false, restart: false },
}
const MOCK_FIX_SET = {
  flush: { key: 'flush', label: 'Write-cache flushing', detail: 'On after a restart', applied: true, canUndo: true, restart: true },
  optimize: { key: 'optimize', label: 'Weekly optimize', detail: 'On', applied: true, canUndo: true, restart: false },
}

/** One fix's row: asking while off, with Undo once the mock set it, none when it was fine to begin with. */
function mockDriveFix(key: 'flush' | 'optimize') {
  if (!mockDriveFixes[key]) return [MOCK_FIX_ASKS[key]]
  return mockDriveFixes.set.has(key) ? [MOCK_FIX_SET[key]] : []
}

/** The three drives with what fills them; `?drives=fine` drops every verdict. */
function mockDriveList() {
  const flushVerdict = { key: 'flush', text: 'Write-cache flushing is off, and it has shut down without warning 132 times: a power cut can damage files.', bad: false }
  return [
    {
      id: '0', model: 'Samsung SSD 990 PRO with Heatsink 2TB', kind: 'NVMe SSD', link: { gen: 4, width: 4, maxGen: 4, maxWidth: 4 }, firmware: '8B2QJXD7', firmwareSlots: 3,
      vendor: MOCK_SAMSUNG, temperature: { now: 36, warn: 82, critical: 85 },
      health: { lifeUsed: 5, spare: 100, writtenTb: 126, hours: 4109, powerCycles: 527, unsafeShutdowns: 132, mediaErrors: 0 },
      volumes: [{ letter: 'C:', totalGb: 1862, freeGb: 308.5 }],
      space: { total: 1862 * GB, free: 308.5 * GB, games: 1180 * GB, caches: 66.1 * GB, oldCaches: 36.6 * GB, exo: 5.9 * GB, leftovers: 12.4 * GB, other: 289.1 * GB },
      games: [
        { id: 'steam:3513350', title: 'Wuchang: Fallen Feathers', bytes: 152 * GB, cacheBytes: 0 },
        { id: 'steam:2515020', title: 'FINAL FANTASY XVI', bytes: 102 * GB, cacheBytes: 2.6 * GB },
        { id: 'steam:2001760', title: 'Beast of Reincarnation', bytes: 98 * GB, cacheBytes: 3.8 * GB },
        { id: 'steam:1501750', title: 'Lords of the Fallen', bytes: 72 * GB, cacheBytes: 6.6 * GB },
        { id: 'steam:2622380', title: 'Stellar Blade', bytes: 70 * GB, cacheBytes: 7.1 * GB },
      ],
      verdicts: [
        ...(mockDriveFixes.flush && !mockDriveFixes.set.has('flush') ? [] : [flushVerdict]),
        { key: 'bypass:steam:2515020', text: "FINAL FANTASY XVI can't load through DirectStorage's fast path: its files are sparse.", bad: false },
      ],
    },
    {
      id: '1', model: 'Samsung SSD 870 EVO 1TB', kind: 'SSD', link: null, firmware: 'SVT02B6Q', firmwareSlots: null,
      vendor: MOCK_SAMSUNG, temperature: { now: 52, warn: 70, critical: 80 },
      health: { lifeUsed: 91, hours: 9120, powerCycles: 1310, unsafeShutdowns: 41, badSectors: 12 },
      volumes: [{ letter: 'D:', totalGb: 931.5, freeGb: 77.4 }],
      space: { total: 931.5 * GB, free: 77.4 * GB, games: 801 * GB, caches: 1.2 * GB, oldCaches: 0.4 * GB, exo: 0, leftovers: 0, other: 51.9 * GB },
      games: [
        { id: 'steam:1174180', title: 'Red Dead Redemption 2', bytes: 121 * GB, cacheBytes: 0.8 * GB },
        { id: 'steam:1091500', title: 'Cyberpunk 2077', bytes: 88 * GB, cacheBytes: 0.4 * GB },
      ],
      verdicts: [
        { key: 'sectors', text: '12 bad sectors. Copy what matters off it.', bad: true },
        { key: 'worn', text: '91% of its rated writes are used.', bad: false },
      ],
    },
    {
      id: '2', model: 'WDC WD40EZAZ-00SF3B0', kind: 'Hard drive', link: null, firmware: '80.00A80', firmwareSlots: null,
      vendor: { name: 'SanDisk', tool: 'SanDisk Dashboard', url: 'https://www.sandisk.com/en-us/topics/upgrades/drive-monitoring-sandisk-dashboard' },
      temperature: { now: 38, warn: null, critical: null },
      health: { hours: 21450, powerCycles: 2104, unsafeShutdowns: 77, badSectors: 0 },
      volumes: [{ letter: 'E:', totalGb: 3726, freeGb: 2410 }],
      space: { total: 3726 * GB, free: 2410 * GB, games: 214 * GB, caches: 0, oldCaches: 0, exo: 0, leftovers: 31 * GB, other: 1071 * GB },
      games: [
        { id: 'steam:1245620', title: 'ELDEN RING', bytes: 49 * GB, cacheBytes: 0 },
        { id: 'steam:367520', title: 'Hollow Knight', bytes: 9 * GB, cacheBytes: 0 },
      ],
      verdicts: [{ key: 'hdd', text: 'ELDEN RING and 1 more game are on this hard drive. Games load much faster from an SSD.', bad: false }],
    },
  ]
}

function mockDrives(p?: { action?: unknown; space?: unknown }) {
  const action = typeof p?.action === 'string' ? p.action : null
  for (const key of ['flush', 'optimize'] as const) {
    if (action === key || action === 'all') { mockDriveFixes[key] = true; mockDriveFixes.set.add(key) }
    if (action === `${key}-undo`) { mockDriveFixes[key] = false; mockDriveFixes.set.delete(key) }
  }
  const space = p?.space === true
  return {
    ok: true,
    fixes: [...mockDriveFix('flush'), ...mockDriveFix('optimize')],
    drives: mockDriveList().map(drive => ({
      ...drive,
      space: space ? drive.space : null,
      games: space ? drive.games : [],
      verdicts: mockDrivesFine ? [] : drive.verdicts.filter(verdict => space || !verdict.key.startsWith('bypass:')),
    })),
  }
}

// ?whatsnew: a user just updated to 3.14.1 from 3.13.2, so the sheet opens over the Library with 3.14.1 and the 3.14.0 they skipped.
const mockWhatsNew = typeof location !== 'undefined' && new URLSearchParams(location.search).has('whatsnew')
// ?update: 3.15.0 is offered as Exo opens (the update sheet), with its What's New.
const mockUpdate = typeof location !== 'undefined' && new URLSearchParams(location.search).has('update')

// ?folders: two Library folders to start with, Hades in both, one sorted by time played.
const mockFolders = typeof location !== 'undefined' && new URLSearchParams(location.search).has('folders')

const mockSettings: LauncherSettings = {
  onboardingComplete: !mockFirstRun,
  appVersion: mockWhatsNew ? '3.14.1' : '1.0.0-dev',
  whatsNewSeen: mockWhatsNew ? '3.13.2' : '1.0.0-dev',
  reduceMotion: false,
  dictation: true,
  framelessPinTop: false,
  framelessPinSide: false,
  textColour: 'white',
  textSize: 'normal',
  sortMode: 'name',
  steamWebApiKeySet: false,
  itchApiKeySet: false,
  riotId: null,
  riotHoursImported: false,
  recent: [],
  showLibraryTools: false,
  hdrForGames: false,
    hdrSdrGamma: true,
    discordNoiseSuppression: true,
    discordQuietWhilePlaying: true,
  igdbTwitchClientIdSet: false,
  igdbTwitchClientSecretSet: false,
  igdbTwitchConnected: false,
  steamGridDbKeySet: false,
  openXblKeySet: false,
  xboxSignInAvailable: false,
  xboxSignedIn: false,
  autoUpdateChipset: true,
  chipset: mockIntelCpu ? 'intel' : 'amd',
  ...(mockFolders ? {
    libraryFolders: [
      { id: 'mockfav', name: 'Favorites', color: 'blue', sort: 'played', games: ['mock:hades', 'mock:eldenring', 'mock:valorant'] },
      { id: 'mockrogue', name: 'Roguelikes', color: 'orange', games: ['mock:hades'] },
    ],
  } : {}),
}

/** The browser mock has no file dialog and no cover cache to copy a picture into. */
const MOCK_NO_PICKER = 'Browser mock — picking a picture needs the Exo host.'

let mockProgress: InstallProgress = {
  gameId: '',
  phase: 'idle',
  status: '',
  canCancel: false,
  isActive: false,
}

type MockHandler = (params?: Record<string, unknown>) => unknown

function mockParamId(params?: Record<string, unknown>): string {
  return String(params?.id ?? '')
}

function mockLibraryGet() {
  return {
    games: MOCK_GAMES,
    count: MOCK_GAMES.length,
    stores: mockStoresMatrix(),
    progress: mockProgress,
    sortMode: mockSettings.sortMode,
    recent: mockSettings.recent,
  }
}

function mockGameGet(params?: Record<string, unknown>) {
  const id = mockParamId(params)
  const game = MOCK_GAMES.find((g) => g.id === id)
  return game ? { ok: true, game } : { ok: false, message: 'Game not found.' }
}

function mockGameInstall(params?: Record<string, unknown>) {
  const id = mockParamId(params)
  mockProgress = {
    gameId: id,
    phase: 'downloading',
    percent: 42,
    bytesPerSecond: 12.5 * 1024 * 1024,
    status: 'Mock progress (host required for real install)',
    canCancel: true,
    isActive: true,
  }
  emitHostEvent('install.progress', mockProgress)
  return {
    ok: false,
    message: 'Browser mock — install only works inside the WinUI host.',
    progress: mockProgress,
  }
}

function mockArtRefresh(reset: boolean): MockHandler {
  return (params) => {
    const id = mockParamId(params)
    const index = MOCK_GAMES.findIndex((game) =>
      game.id === id || game.variants?.some((variant) => variant.id === id),
    )
    if (index < 0) return { ok: false, message: 'Game not found.' }
    const current = MOCK_GAMES[index]
    const next: Game = {
      ...current,
      ...(reset ? { coverUrl: null, coverSource: null } : {}),
      artRevision: (current.artRevision ?? 0) + 1,
    }
    MOCK_GAMES[index] = next
    emitHostEvent('library.updated', { games: [...MOCK_GAMES], count: MOCK_GAMES.length })
    return {
      ok: true,
      message: reset ? 'Cover reset.' : 'Artwork refreshed.',
      game: next,
      artRevision: next.artRevision,
    }
  }
}

/** The host binds the game process a moment after launch and pushes each change. */
function mockRunState(running: boolean): MockHandler {
  return (params) => {
    const id = mockParamId(params)
    const index = MOCK_GAMES.findIndex((game) => game.id === id)
    if (index < 0 || !MOCK_GAMES[index].installed) return { ok: false, message: 'Browser mock — only installed demo games run.' }
    setTimeout(() => {
      MOCK_GAMES[index] = { ...MOCK_GAMES[index], isRunning: running, canStop: running }
      emitHostEvent('game.runState', { id, isRunning: running, canStop: running })
    }, running ? 1200 : 150)
    return { ok: true, message: running ? 'Mock: game started.' : 'Game closed.' }
  }
}

/** Games Update all brought up in this mock session: every file current from then on. */
const mockDlssUpdated = new Set<string>()

/** HelixSR's FSR drop-in: a mod's file, left alone whatever Update all does. */
const mockModFsr = { key: 'amd_fidelityfx_dx12.dll', fileName: 'amd_fidelityfx_dx12.dll', folder: null, displayName: 'FSR 3.1', currentVersion: '3.1.5', latestVersion: '3.1.5', latestRelease: 'fsr-3.1.5', state: 'mod', mod: 'HelixSR', origin: 'shipped', canUpdate: false, canRestore: false }

/** One game ships DLSS in two folders, one copy Exo's and one the game's own, and HelixSR in place of its FSR. */
function mockDlssStatus(params?: Record<string, unknown>) {
  if (mockDlssUpdated.has(String(params?.id))) {
    return { ok: true, items: [{ key: 'nvngx_dlss.dll', fileName: 'nvngx_dlss.dll', folder: null, displayName: 'DLSS Super Resolution', currentVersion: '310.9.1', currentRelease: 'dlss-310.9.1', latestVersion: '310.9.1', latestRelease: 'dlss-310.9.1', state: 'current', origin: 'exo', originalVersion: '310.2.1', originalState: 'saved', canUpdate: false, canRestore: true }, mockModFsr] }
  }
  return {
    ok: true,
    items: [
      { key: 'nvngx_dlss.dll', fileName: 'nvngx_dlss.dll', folder: null, displayName: 'DLSS Super Resolution', currentVersion: '310.9.1', currentRelease: 'dlss-310.9.1', latestVersion: '310.9.1', latestRelease: 'dlss-310.9.1', state: 'current', origin: 'exo', originalVersion: '310.2.1', originalState: 'saved', canUpdate: false, canRestore: true },
      { key: 'Engine/Plugins/DLSS/nvngx_dlss.dll', fileName: 'nvngx_dlss.dll', folder: 'Engine/Plugins/DLSS', displayName: 'DLSS Super Resolution', currentVersion: '310.2.1', latestVersion: '310.9.1', latestRelease: 'dlss-310.9.1', state: 'outdated', origin: 'reverted', originalVersion: '310.2.1', originalState: 'saved', canUpdate: true, canRestore: false },
      mockModFsr,
    ],
  }
}


/** Shaders per demo game, as the Exo Shaders engine would list them. */
function mockShadersStatus(params?: Record<string, unknown>) {
  const id = String(params?.id ?? '')
  if (!mockShaders) return { ok: true, state: 'noApp' }
  switch (id) {
    case 'mock:valorant': return { ok: true, state: 'unsupported', reason: 'Needs a recording, which its anti-cheat blocks.' }
    case 'mock:control': return { ok: true, state: 'warmed', reason: 'Compiled for driver 617.42.', warmed: { at: '2026-10-12T21:04:00-05:00', driver: '617.42' } }
    case 'mock:disco': return { ok: true, state: 'stale', reason: 'Driver changed', engineId: 'disco' }
    default: return { ok: true, state: 'ready', engineId: id.replace(/^mock:/, '') }
  }
}

function mockCancelInstall() {
  mockProgress = { ...mockProgress, phase: 'cancelled', isActive: false, canCancel: false, status: 'Canceled.' }
  return { ok: true, message: 'Cancel requested.' }
}

let MOCK_GIFTS: StoreGift[] = [
  { store: 'steam', id: '237160366753599703', title: 'Hollow Signal', image: null, sender: 'Rocket alt', message: null },
  { store: 'epic', id: 'a1b2c3d4e5f6', title: 'Night Harbor', image: null, sender: 'Mira', message: 'Happy birthday! Saw you wishlisted this.' },
]

const NONE_LEFT = { folders: 0, files: 0, registry: 0, shortcuts: 0, bytes: 0 }
const MOCK_APP = { publisher: null, version: null, installedOn: null, bytes: null, store: false, removable: true, uninstaller: true, care: null, replaces: null } as const
let MOCK_PROGRAMS = [
  { ...MOCK_APP, id: 'HKLM:7-Zip', name: '7-Zip 26.01 (x64)', publisher: 'Igor Pavlov', version: '26.01', bytes: 5_200_000 },
  { ...MOCK_APP, id: 'HKCU:Discord', name: 'Discord', publisher: 'Discord Inc.', bytes: 412_000_000, replaces: 'discord' },
  { ...MOCK_APP, id: 'HKLM:Steam', name: 'Steam', publisher: 'Valve Corporation', bytes: 1_200_000_000, care: 'store' },
  { ...MOCK_APP, id: 'HKLM:Vanguard', name: 'Riot Vanguard', publisher: 'Riot Games, Inc.', bytes: 273_000_000, care: 'anticheat', removable: false },
  { ...MOCK_APP, id: 'HKLM:VC14', name: 'Microsoft Visual C++ v14 Redistributable (x64)', publisher: 'Microsoft Corporation', bytes: 21_000_000, care: 'runtime' },
  { ...MOCK_APP, id: 'store:Clipchamp.Clipchamp_yxz26nhyzhsrt', name: 'Clipchamp', publisher: 'Microsoft Corp.', store: true, installedOn: '2026-10-12', bytes: 160_000_000, replaces: 'clipchamp' },
  { ...MOCK_APP, id: 'HKCU:Broken', name: 'Old Tool', publisher: 'Somebody', uninstaller: false, bytes: 48_000_000 },
] as InstalledApp[]
let MOCK_REPLACED: ReplacedApp[] = [
  { id: 'discord', name: 'Discord', detail: 'Exo has its own Discord: servers, DMs and calls', installed: true, leftovers: 9, bytes: 412_000_000, needsAdmin: false, found: { folders: 4, files: 0, registry: 4, shortcuts: 1, bytes: 412_000_000 }, cleared: null },
  { id: 'snipping', name: 'Snipping Tool', detail: 'Exo snips with Print Screen and edits in Captures', installed: true, leftovers: 0, bytes: 0, needsAdmin: false, found: NONE_LEFT, cleared: null },
  { id: 'photos', name: 'Photos', detail: 'Exo shows and trims your captures', installed: true, leftovers: 0, bytes: 0, needsAdmin: false, found: NONE_LEFT, cleared: null },
  { id: 'gamebar', name: 'Xbox Game Bar', detail: 'Exo records clips and replays', installed: true, leftovers: 0, bytes: 0, needsAdmin: false, found: NONE_LEFT, cleared: null },
  { id: 'clipchamp', name: 'Clipchamp', detail: 'Exo trims and shares your clips', installed: false, leftovers: 0, bytes: 0, needsAdmin: false, found: NONE_LEFT, cleared: { folders: 1, files: 2, registry: 6, shortcuts: 0, bytes: 38_000_000 } },
  { id: 'nvidia', name: 'NVIDIA App and Control Panel', detail: 'Exo updates the driver, sets its profile and your screens; the driver stays', installed: true, leftovers: 6, bytes: 1_300_000_000, needsAdmin: true, found: { folders: 5, files: 0, registry: 1, shortcuts: 0, bytes: 1_300_000_000 }, cleared: null },
]

function mockDepsList() {
  return {
    items: [
      { id: 'vcredist', name: 'Visual C++ Redistributable', status: 'Present', detail: 'Mock', canOfferInstall: true },
      { id: 'directx', name: 'DirectX', status: 'Present', detail: 'Mock', canOfferInstall: true },
      { id: 'dotnet', name: '.NET Desktop Runtime', status: 'Present', detail: 'Mock', canOfferInstall: true },
      { id: 'webview2', name: 'WebView2 Runtime', status: 'Present', detail: 'Mock', canOfferInstall: true },
    ],
  }
}

/** Game runtimes as on a PC that has most of them: two missing, two older, .NET 6 past its support. */
let MOCK_RUNTIMES: RuntimeItem[] = [
  ...(['2005', '2008', '2010', '2012', '2013'] as const).flatMap(year => (['x86', 'x64'] as const).map(arch => ({
    id: `vc${year}-${arch}`, name: `Visual C++ ${year} (${arch})`, group: 'vc' as const, bulk: true,
    installed: year === '2005' && arch === 'x86' ? null : '1.0', latest: '1.0', state: year === '2005' && arch === 'x86' ? 'missing' as const : 'current' as const,
  }))),
  { id: 'vc14-x86', name: 'Visual C++ 2015–2026 (x86)', group: 'vc', installed: '14.44.35211.0', latest: '14.51.36247.0', state: 'outdated', bulk: true },
  { id: 'vc14-x64', name: 'Visual C++ 2015–2026 (x64)', group: 'vc', installed: '14.44.35211.0', latest: '14.51.36247.0', state: 'outdated', bulk: true },
  { id: 'directx', name: 'DirectX (June 2010)', group: 'directx', installed: 'June 2010', latest: 'June 2010', state: 'current', bulk: true },
  { id: 'gameinput', name: 'GameInput', group: 'directx', installed: null, latest: '4.0.302', state: 'missing', bulk: true },
  { id: 'd3d12', name: 'DirectX 12', group: 'directx', installed: null, latest: 'Built into Windows', state: 'info', bulk: false, detail: 'DirectX 12 Ultimate · feature level 12_2 · shader model 6.8 on NVIDIA GeForce RTX 3070' },
  { id: 'directstorage', name: 'DirectStorage', group: 'directx', installed: null, latest: 'Inside the games that use it', state: 'info', bulk: false, detail: 'Games that load with it bring their own copy. Nothing to install.' },
  { id: 'netfx481', name: '.NET Framework 4.8.1', group: 'dotnet', installed: '4.8.1', latest: '4.8.1', state: 'current', bulk: true },
  { id: 'dotnet10-x64', name: '.NET Desktop Runtime 10 (x64)', group: 'dotnet', installed: '10.0.14', latest: '10.0.14', state: 'current', bulk: true },
  { id: 'dotnet6-x64', name: '.NET Desktop Runtime 6 (x64)', group: 'dotnet', installed: null, latest: '6.0.36', state: 'missing', bulk: false, endOfSupport: true },
  { id: 'xna40', name: 'XNA Framework 4.0', group: 'other', installed: '4.0.30901.0', latest: '4.0.30901.0', state: 'current', bulk: true },
  { id: 'vulkan', name: 'Vulkan', group: 'other', installed: '1.4.357.0', latest: 'With your graphics driver', state: 'info', bulk: false },
]

/** runtimes.install in the browser: each download in steps, then the "Windows" run, then all current. */
async function mockRuntimesInstall(params?: Record<string, unknown>) {
  const mode = params?.mode as string
  const ids = params?.ids as string[] | undefined
  const plan = MOCK_RUNTIMES.filter(item => item.state !== 'info' && (ids ? ids.includes(item.id) : mode === 'repair' ? item.group === 'vc' : item.state === 'missing' && item.bulk || mode === 'update' && item.state === 'outdated'))
  const size = 20_000_000
  for (const [at, item] of plan.entries()) {
    for (let bytes = 0; bytes <= size; bytes += size / 5) {
      emitHostEvent('runtimes.progress', { phase: 'download', id: item.id, name: item.name, index: at + 1, count: plan.length, bytes, total: size, doneBytes: at * size + bytes, allBytes: plan.length * size })
      await new Promise(resolve => setTimeout(resolve, 150))
    }
  }
  for (const [at, item] of plan.entries()) {
    emitHostEvent('runtimes.progress', { phase: 'install', id: item.id, name: item.name, index: at + 1, count: plan.length, bytes: 0, total: null, doneBytes: 0, allBytes: 0 })
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  MOCK_RUNTIMES = MOCK_RUNTIMES.map(item => plan.includes(item) ? { ...item, installed: item.latest, state: 'current' } : item)
  return {
    ok: true,
    results: plan.map((item, at) => ({ id: item.id, name: item.name, outcome: at === 0 && mode !== 'repair' ? 'restart' : 'installed', message: at === 0 && mode !== 'repair' ? 'Installed. Restart Windows to finish.' : 'Installed.', code: at === 0 ? 3010 : 0 })),
    items: MOCK_RUNTIMES,
  }
}

function mockStoresCheck() {
  return {
    state: 'complete',
    checkedAtUtc: new Date().toISOString(),
    code: 'local_check_complete',
    stores: [
      {
        store: 'local',
        client: 'missing',
        backend: 'present',
        session: 'present',
        cache: 'present',
        readiness: 'ready',
        code: 'ready',
      },
    ],
  }
}

function mockStoresMatrix() {
  return [
    {
      store: 'local',
      displayName: 'Local',
      agentPresent: true,
      backendPresent: true,
      signedIn: true,
      cachePresent: true,
      detail: 'Ready',
      checkCode: 'checked',
      checkedAtUtc: new Date().toISOString(),
    },
    { store: 'steam', displayName: 'Steam', agentPresent: true, clientPresent: true, backendPresent: true, signedIn: true },
    { store: 'epic', displayName: 'Epic Games', agentPresent: true, clientPresent: true, backendPresent: true, signedIn: false },
    { store: 'gog', displayName: 'GOG', agentPresent: true, clientPresent: false, backendPresent: true, signedIn: false },
    { store: 'riot', displayName: 'Riot Games', agentPresent: true, clientPresent: true, signedIn: true },
  ]
}

function mockAbsorbSecretFlags(next: Record<string, unknown>) {
  if (typeof next.steamWebApiKey === 'string') {
    mockSettings.steamWebApiKeySet = next.steamWebApiKey.trim().length > 0
    delete next.steamWebApiKey
  }
  if (typeof next.itchApiKey === 'string') {
    mockSettings.itchApiKeySet = next.itchApiKey.trim().length > 0
    delete next.itchApiKey
  }
  if (typeof next.igdbTwitchClientId === 'string') {
    mockSettings.igdbTwitchClientIdSet = next.igdbTwitchClientId.trim().length > 0
    delete next.igdbTwitchClientId
  }
  if (typeof next.igdbTwitchClientSecret === 'string') {
    mockSettings.igdbTwitchClientSecretSet = next.igdbTwitchClientSecret.trim().length > 0
    delete next.igdbTwitchClientSecret
  }
  if (typeof next.steamGridDbKey === 'string') {
    mockSettings.steamGridDbKeySet = next.steamGridDbKey.trim().length > 0
    delete next.steamGridDbKey
  }
  if (typeof next.openXblKey === 'string') {
    mockSettings.openXblKeySet = next.openXblKey.trim().length > 0
    delete next.openXblKey
  }
}

function mockAbsorbIdSettings(next: Record<string, unknown>) {
  if (typeof next.riotId === 'string') {
    const trimmed = next.riotId.trim()
    mockSettings.riotId = trimmed.length > 0 ? trimmed : null
    delete next.riotId
  }
}

/** Two captures, so Favorite and its chip can be tried without the add-on. */
const mockCaptures: CaptureItem[] = [
  { id: 'cap0000000000001', kind: 'image', game: 'Desktop', name: 'Snip 1', created: '2026-10-19T16:08:00Z', size: 120_000, favourite: false, url: '', thumb: null },
  { id: 'cap0000000000002', kind: 'video', game: 'Elden Ring', gameId: 'steam:1245620', name: 'Clip 1', created: '2026-10-18T20:00:00Z', size: 48_000_000, durationMs: 60_000, favourite: false, url: '', thumb: null },
]

function mockCaptureItem(params?: Record<string, unknown>) {
  const at = mockCaptures.findIndex(item => item.id === mockParamId(params))
  if (at < 0) return { ok: false, message: 'That capture is gone.' }
  if (params?.action === 'favourite' || params?.action === 'unfavourite') mockCaptures[at] = { ...mockCaptures[at], favourite: params.action === 'favourite' }
  return { ok: true, item: mockCaptures[at] }
}

function mockSettingsSet(params?: Record<string, unknown>) {
  const next = { ...(params ?? {}) } as Record<string, unknown>
  mockAbsorbSecretFlags(next)
  mockAbsorbIdSettings(next)
  Object.assign(mockSettings, next)
  delete (mockSettings as { steamWebApiKey?: string }).steamWebApiKey
  delete (mockSettings as { itchApiKey?: string }).itchApiKey
  if ('dictation' in next) emitHostEvent('dictation.state', mockDictationState())
  return { ...mockSettings }
}

// Dictation in the browser build: a voice line that rises and falls while it "listens", and one sentence back.
let mockDictationLevels: number | undefined
const mockDictationState = () => ({ on: mockSettings.dictation !== false, available: true, ready: true, size: 487_170_055 })
function mockDictationStart() {
  window.clearInterval(mockDictationLevels)
  const started = performance.now()
  mockDictationLevels = window.setInterval(() => {
    const t = (performance.now() - started) / 1000
    emitHostEvent('dictation.level', { level: Math.max(0, Math.sin(t * 2.3) * 0.5 + Math.sin(t * 7.1) * 0.25 + 0.2) })
  }, 50)
  return { ok: true, message: null }
}
function mockDictationStop(params?: Record<string, unknown>) {
  window.clearInterval(mockDictationLevels)
  // Spaced as the host spaces it (Dictation.Join): after a word, a space first.
  const before = typeof params?.before === 'string' ? params.before : ''
  return { ok: true, text: (before && !/[\s([{"'@#/]$/.test(before) ? ' ' : '') + 'This is what you said.', message: null }
}

// Voice messages in the browser build: bars that rise and fall while it "records" (ten a second, as the host's), then a
// take to play back (a soft tone shaped by those levels, as a WAV where the host gives Ogg Opus) and a sent message with it.
let mockVoiceTimer: number | undefined
let mockVoiceTake: { data: string; type: string; duration: number; waveform: string; size: number } | null = null
const mockVoiceLevels: number[] = []
function mockVoiceMessage(params?: Record<string, unknown>) {
  window.clearInterval(mockVoiceTimer)
  if (params?.action === 'start') {
    mockVoiceLevels.length = 0
    mockVoiceTake = null
    const started = performance.now()
    mockVoiceTimer = window.setInterval(() => {
      const t = (performance.now() - started) / 1000
      const level = Math.max(0, Math.min(1, Math.sin(t * 2.1) * 0.45 + Math.sin(t * 6.7) * 0.25 + 0.35))
      mockVoiceLevels.push(level)
      emitHostEvent('discord.voiceMessageLevel', { level, seconds: Math.round(t * 100) / 100 })
    }, 100)
    return { ok: true, message: null }
  }
  if (params?.action === 'stop') {
    if (mockVoiceLevels.length < 10) return { ok: false, message: 'That was too short to send.', take: null }
    mockVoiceTake = { ...mockTone(mockVoiceLevels), type: 'audio/wav', duration: mockVoiceLevels.length / 10, waveform: mockWaveform(mockVoiceLevels) }
    return { ok: true, message: null, take: mockVoiceTake }
  }
  if (params?.action === 'send') {
    const take = mockVoiceTake
    if (!take) return { ok: false, message: 'That voice message is gone. Record it again.' }
    mockVoiceTake = null
    const id = String(BigInt(Date.now() - 1420070400000) << BigInt(22))
    const author = mockMessages.find(m => m.author.id === mockHome.me?.id)?.author ?? mockMessages[0].author
    // Discord's CDN in the real thing; here the page's own blob: (its media-src takes no data: URLs).
    const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(take.data), c => c.charCodeAt(0))], { type: take.type }))
    return { ok: true, message: null, sent: {
      id, channel_id: String(params.channelId), type: 0, author, content: '', timestamp: new Date().toISOString(), embeds: [], mentions: [], flags: 8192,
      attachments: [{ id, filename: 'voice-message.ogg', url, size: take.size, content_type: 'audio/ogg', duration_secs: take.duration, waveform: take.waveform }],
    } }
  }
  mockVoiceTake = null
  return { ok: true }
}
function mockTone(levels: number[]) {
  const rate = 8000
  const samples = levels.length * rate / 10
  const view = new DataView(new ArrayBuffer(44 + samples * 2))
  const text = (at: number, word: string) => [...word].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  text(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples * 2, true)
  for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * 220 * i / rate) * 2500 * levels[Math.floor(i / (rate / 10))]), true)
  const bytes = new Uint8Array(view.buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { data: btoa(binary), size: bytes.length }
}
// Discord's waveform as the host makes it: at most 256 points, each the loudest it covers, 0 to 255.
function mockWaveform(levels: number[]) {
  const points = Math.min(256, levels.length)
  const step = levels.length / points
  const top = Math.max(0.5, ...levels)
  const bytes = Array.from({ length: points }, (_, p) => Math.round(255 * Math.max(...levels.slice(Math.floor(p * step), Math.max(Math.floor(p * step) + 1, Math.floor((p + 1) * step)))) / top))
  return btoa(String.fromCharCode(...bytes))
}

// Discord settings > Voice & Video and the rest, kept for the session so the pages can be clicked through.
let mockDiscordClient: Record<string, unknown> = {
  inputProfile: 'exo', noiseSuppression: true, noiseSuppressionKind: 'ai', othersNoiseSuppression: false, onlyMyVoice: false, myVoiceLearned: false, myVoiceSeconds: 0, evenVoices: true, echoCancellation: true, voiceFocus: true, pushToTalk: false, pttDelay: 20,
  autoSensitivity: true, sensitivity: -60, attenuation: 0, attenuateSelf: false, attenuateOthers: true, keybinds: [], desktopNotifications: true,
  unreadBadge: true, taskbarFlash: true, disabledSounds: [], disableAllSounds: false, selectedChannelSound: false, soundVolume: 60,
}

const mockOk: MockHandler = () => ({ ok: true })
// What the mock has saved for later: bookmarked messages and reminders (message id -> due, ms).
const mockSaved = { bookmarks: new Set<string>(), reminders: new Map<string, number>() }
// Hide Muted Channels in the mock's server, as its menu sets it.
let mockHideMuted = false

const GB = 1024 ** 3
/** Properties as the host builds them: Marvel Rivals' real Steam shape (its High-Resolution Pack switched off), an Epic game's optional content. */
const mockProperties: Record<string, GameProperties> = {}
const STEAM_PROPERTIES: Partial<GameProperties> = {
  verifyLabel: 'Verify files',
  language: 'english',
  languageChoices: [
    { value: 'english', label: 'English', sizeBytes: 0 }, { value: 'french', label: 'French', sizeBytes: 0 },
    { value: 'german', label: 'German', sizeBytes: 0 }, { value: 'japanese', label: 'Japanese', sizeBytes: 0 },
    { value: 'schinese', label: 'Simplified Chinese', sizeBytes: 0 },
  ],
  beta: '',
  betaChoices: [{ value: '', label: 'None' }],
  betaCode: true,
  // A pack with files has a switch; cosmetics (no files) say whether the account holds them, as 007 First Light's do.
  content: [
    { id: '4406010', name: 'Marvel Rivals - High-Resolution Pack', enabled: false, sizeBytes: 22376494559, toggle: true, state: null },
    ...['Day of the Dead (Exclusive Outfit)', 'Desert Explorer (Exclusive Outfit)', 'Gentleman Operator (Exclusive Outfit)',
      'Silent Anchor (Exclusive Outfit)', 'Gleaming Earphones (Gadget Skin)', 'Gleaming Lighter (Gadget Skin)', 'Gleaming Pen (Gadget Skin)',
      'Gleaming Phone (Gadget Skin)', "Agent's Mark (Weapon Skin)", 'Deluxe Edition Upgrade']
      .map((name, index) => ({ id: String(3950810 + index), name, enabled: true, sizeBytes: null, toggle: false, state: 'Owned' })),
    { id: '4707780', name: 'Season Pass', enabled: true, sizeBytes: null, toggle: false, state: 'Not owned' },
  ],
  folder: '0',
  folderChoices: [{ value: '0', label: 'C:', detail: '412 GB free' }, { value: '1', label: 'D:', detail: '1210 GB free' }],
  // Marvel Rivals reads the controller itself: Steam Input stays out, so no Controller in Steam row.
  storeProperties: null,
}
const EPIC_PROPERTIES: Partial<GameProperties> = {
  cloudSync: true,
  contentLabel: 'Optional content',
  content: [
    { id: 'hd_textures', name: 'High Resolution Textures', enabled: true, sizeBytes: 22 * GB, toggle: true, state: null },
    { id: 'stw', name: 'Fortnite Save the World', enabled: false, sizeBytes: 9 * GB, toggle: true, state: null },
  ],
}
function mockPropertiesFor(id: string): GameProperties {
  const game = MOCK_GAMES.find(entry => entry.id === id)
  mockProperties[id] ??= {
    ok: true, store: game?.store ?? 'local', launchOptions: '', sizeBytes: game?.sizeBytes ?? null, verifyLabel: 'Repair',
    canBrowse: true, running: !!game?.isRunning,
    cloudSync: false, language: null, languageChoices: [], beta: null, betaChoices: [], betaCode: false,
    contentLabel: 'DLC', content: null, folder: null, folderChoices: [], moving: null, storeProperties: null,
    ...(game?.store === 'steam' ? STEAM_PROPERTIES : game?.store === 'epic' ? EPIC_PROPERTIES : {}),
  }
  return mockProperties[id]
}

function mockSetProperty(params?: Record<string, unknown>) {
  const id = String(params?.id ?? '')
  const key = String(params?.key ?? '')
  const value = String(params?.value ?? '')
  const current = mockPropertiesFor(id)
  if (key === 'betaCode') return { ok: false, message: 'Steam did not accept that code.' }
  const next: GameProperties = { ...current }
  let message: string | null = null
  if (key === 'content') {
    const [itemId, state] = value.split(':')
    next.content = (current.content ?? []).map(item => item.id === itemId ? { ...item, enabled: state === 'on' } : item)
    message = state === 'on' ? 'Steam is downloading it.' : 'Steam is removing its files.'
  } else if (key === 'launchOptions') next.launchOptions = value
  else if (key === 'language') { next.language = value; message = 'Steam is updating the game.' }
  else if (key === 'storeProperties') message = "Opened in Steam. Its Properties are under the gear on the game's page."
  mockProperties[id] = next
  return { ok: true, message, properties: next }
}

// Go Live's picker in the browser: a game, two windows and two screens, drawn as gradients.
const goLivePicture = (from: string, to: string) => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/></svg>`)}`
const mockFavoriteEmojis = ['heart', 'fire', '968812152267866172']
const mockFavoriteStickers = ['749054660769218631']

const mockGoLive = [
  { id: 'screen:1', kind: 'screen', title: 'Screen 1', app: 'Screen', thumb: goLivePicture('#1d2b64', '#f8cdda') },
  { id: 'screen:2', kind: 'screen', title: 'Screen 2', app: 'Screen', thumb: goLivePicture('#0f2027', '#2c5364') },
  { id: 'window:1', kind: 'window', title: 'VALORANT', app: 'VALORANT', thumb: goLivePicture('#ff4655', '#0f1923'), game: 'VALORANT' },
  { id: 'window:2', kind: 'window', title: 'Exo Launcher - GitHub - Google Chrome', app: 'Google Chrome', thumb: goLivePicture('#232526', '#414345') },
  { id: 'window:3', kind: 'window', title: 'notes.txt - Notepad', app: 'Notepad', thumb: null },
]
const mockGoLiveHandler: MockHandler = (params?: { action?: string; source?: string }) => {
  if (params?.action === 'sources') return { ok: true, sources: mockGoLive }
  if (params?.action === 'preview') return { ok: true, thumb: (mockGoLive.find(s => s.id === params.source) ?? mockGoLive[0]).thumb }
  if (params?.action === 'start') {
    const title = mockGoLive.find(s => s.id === params.source)?.title ?? null
    setTimeout(() => emitHostEvent('discord.golive', { state: 'live', title }), 400)
    setTimeout(() => emitHostEvent('discord.golive.stats', { width: 1920, height: 1080, fps: 60, bitrate: 8_100_000 }), 1400)
    return { ok: true }
  }
  if (params?.action === 'stop') setTimeout(() => emitHostEvent('discord.golive', { state: 'off' }), 50)
  return { ok: true }
}

const mockCaptureState = {
  present: true, running: true, buffering: true, recording: false, recordingMs: 0, codec: 'HEVC',
  encoder: 'NVIDIA HEVC Encoder MFT', hdr: false, hotkeys: { saveReplay: true, record: true, snip: true, printScreen: true },
}
const mockCaptureSettings: Record<string, unknown> = {
  quality: 50, replaySeconds: 60, maxFps: 60, replayMode: 'games',
  cursor: true, saveReplayKeys: 'Ctrl+Alt+F10', recordKeys: 'Ctrl+Alt+F9', snipKeys: 'Ctrl+Alt+F8', printScreen: false,
  folder: 'C:\\Users\\Player\\Videos\\Exo Captures', keepGb: 0, keepDays: 0,
}

/** Exo Notes in the browser: notes kept in memory, one to start from. */
const mockNotes = new Map<string, { info: NoteInfo; text: string }>()
const mockNote = (id: string, text: string, kind: NoteInfo['kind'] = 'text') => {
  const [title = 'New note', ...rest] = text.split('\n').map(line => line.replace(/^[#\s-]*(\[[ x]\] )?/, '').trim()).filter(Boolean)
  const info: NoteInfo = {
    id, title, snippet: rest.join(' ').slice(0, 140), kind, name: `${title}.${kind === 'markdown' ? 'md' : 'txt'}`, edited: new Date().toISOString(),
    size: text.length, pinned: mockNotes.get(id)?.info.pinned ?? false, external: false, unsaved: false, gameId: null, encoding: 'utf-8', eol: 'crlf', spelling: true,
  }
  mockNotes.set(id, { info, text })
  return info
}
mockNote('mock-raid', '# Raid night\n- [x] Repair gear\n- [ ] Bring potions\n\nBoss two: **stack** at the pillar.', 'markdown')

/** One Store game with Steam's longest kind of page (a long description and requirements), to lay the game page out against. */
const MOCK_STORE_TILE = { appId: '1091500', name: 'Cyberpunk 2077', final: 2999, initial: 5999, discount: 50, currency: 'USD', priceText: '$29.99', wasText: '$59.99' }
function mockStoreGame() {
  const art = (file: string) => `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1091500/${file}`
  return {
    ok: true, ...MOCK_STORE_TILE, comingSoon: false, released: 'Dec 9, 2020', free: false,
    description: 'Cyberpunk 2077 is an open-world, action-adventure RPG set in the dark future of Night City — a dangerous megalopolis obsessed with power, glamor, and ceaseless body modification. Play as V, a cyberpunk mercenary, and take on the most powerful forces of the city in a fight for glory and survival. Explore a vast city of the future where your choices shape the story and the world around you, with a branching narrative, deep character customization, and the Phantom Liberty expansion.',
    developers: ['CD PROJEKT RED'], publishers: ['CD PROJEKT RED'], genres: ['RPG'], metacritic: 86,
    reviewWord: 'Very Positive', reviewPercent: 88, reviewCount: 812345,
    tags: ['Cyberpunk', 'Open World', 'RPG', 'Sci-fi', 'Singleplayer', 'Story Rich', 'Atmospheric'],
    controller: 'full', playStation: true, drm: null, account: null,
    languages: ['English', 'French', 'Italian', 'German', 'Spanish - Spain', 'Japanese', 'Korean', 'Polish', 'Portuguese - Brazil', 'Russian', 'Simplified Chinese'],
    offers: [{ store: '1', name: 'Steam', final: 2999, initial: 5999, discount: 50, currency: 'USD', priceText: '$29.99', wasText: '$59.99', url: 'https://store.steampowered.com/app/1091500' }],
    media: [],
    screenshots: Array.from({ length: 10 }, (_, i) => `${art(i % 2 ? 'library_hero.jpg' : 'header.jpg')}?${i}`),
    specs: [
      { label: 'OS', minimum: 'Windows 10', recommended: 'Windows 10', mine: 'Windows 11', meets: 'recommended' },
      { label: 'Processor', minimum: 'i7-6700 · Ryzen 5 1600', recommended: 'i7-12700 · Ryzen 7 7800X3D', mine: 'Ryzen 7 9800X3D', meets: 'recommended' },
      { label: 'Graphics', minimum: 'GTX 1060 · RX 580 · Arc A380', recommended: 'RTX 2060 Super · RX 5700 XT · Arc A770', mine: 'RTX 4080 Super', meets: 'recommended' },
      { label: 'Memory', minimum: '12 GB', recommended: '16 GB', mine: '32 GB', meets: 'recommended' },
      { label: 'Storage', minimum: '70 GB SSD', recommended: '70 GB SSD', mine: '412 GB free', meets: 'recommended' },
      { label: 'DirectX', minimum: 'DirectX 12', recommended: 'DirectX 12', mine: null, meets: null },
    ],
    fit: 'recommended',
  }
}

/** Exo Mouse's CPU core, through the relay: a test that offers CPU 6 after its 10 s; `?mousecore` starts after the restart, measured again. */
const MOCK_MOUSE_BEFORE = { rate: 1000, checked: 9951, missed: 40, longest: 2.1, p999: 2, refresh: true, cpu: 0 }
const MOCK_MOUSE_AFTER = { rate: 1000, checked: 9963, missed: 2, longest: 1.6, p999: 1.1, refresh: false, cpu: 6 }
let mockMouseStage: 'none' | 'restart' | 'set' = typeof location !== 'undefined' && new URLSearchParams(location.search).has('mousecore') ? 'set' : 'none'
let mockMouseTested = false

async function mockMouseCore(params?: Record<string, unknown>) {
  if (params?.action === 'measure') {
    await new Promise(resolve => setTimeout(resolve, 10_000))
    mockMouseTested = true
  }
  if (params?.action === 'apply') mockMouseStage = 'restart'
  if (params?.action === 'undo') mockMouseStage = 'none'
  const set = mockMouseStage === 'set'
  return {
    ok: true,
    stage: mockMouseStage,
    detail: mockMouseStage === 'restart' ? "CPU 6 takes your mouse's input after you restart Windows."
      : set ? "Fewer late reports since CPU 6 took your mouse's input." : null,
    cpu: mockMouseStage === 'none' ? null : 6,
    better: set ? true : null,
    canUndo: mockMouseStage !== 'none',
    before: mockMouseStage === 'none' ? null : MOCK_MOUSE_BEFORE,
    after: set ? MOCK_MOUSE_AFTER : null,
    test: !mockMouseTested ? null : set
      ? { verdict: 'fine', detail: '1000 Hz, 2 of 9,963 reports late, the longest 1.6 ms. Too few to matter, so nothing to change.', offer: null, result: MOCK_MOUSE_AFTER }
      : { verdict: 'fix', detail: "1000 Hz, 40 of 9,951 reports late, the longest 2.1 ms. They come with your screen's refresh. Its input lands on CPU 0, where Windows and most drivers go first. CPU 6 is quiet.", offer: 6, result: MOCK_MOUSE_BEFORE },
  }
}

const MOCK_HANDLERS: Record<string, MockHandler> = {
  ...spotifyMock,
  'library.get': mockLibraryGet,
  'library.refresh': mockLibraryGet,
  'game.get': mockGameGet,
  'game.launch': mockRunState(true),
  'game.stop': mockRunState(false),
  'game.install': mockGameInstall,
  'game.update': mockGameInstall,
  'game.resumeDownload': () => ({ ok: false, message: 'Browser mock — saved downloads resume only inside the Exo host.' }),
  'game.uninstall': () => ({ ok: false, message: 'Browser mock.' }),
  'game.openFolder': mockOk,
  'game.properties': (params) => mockPropertiesFor(String(params?.id ?? '')),
  'game.properties.set': mockSetProperty,
  'art.replace': () => ({ ok: false, cancelled: false, message: MOCK_NO_PICKER }),
  'art.reset': mockArtRefresh(true),
  'art.refetch': mockArtRefresh(false),
  // No cover cache here: the picture comes back as itself.
  'library.folderArt': (params) => ({ ok: true, art: `data:image/png;base64,${String(params?.image ?? '')}` }),
  'library.refreshAll': () => ({ ok: true, achievements: 0, covers: 0 }),
  'game.repair': () => ({ ok: true, queued: false, message: 'Mock: would verify files.' }),
  'game.extras': () => ({ ok: true, achievementsUnlocked: 23, achievementsTotal: 50, driveHeat: { peak: 79, warn: 82, slowedSeconds: 40 } }),
  'game.cancelInstall': mockCancelInstall,
  'game.dequeue': mockOk,
  'game.progress': () => mockProgress,
  'stores.auth': () => ({ ok: false, message: 'Browser mock — auth requires host.', requiresUserAction: true }),
  'stores.outages': () => ({ ok: true, outages: [] }),
  'stores.playOffline': () => ({ ok: false, message: 'Mock: offline mode needs the Exo host.' }),
  'playtime.refresh': () => ({ ok: false, message: 'Hours are read in the app only.' }),
  'xbox.signIn': () => ({ ok: false, message: 'Xbox sign-in runs in the app only.' }),
  'xbox.signOut': () => ({ ...mockSettings, xboxSignedIn: false }),
  'playtime.riotRefresh': () => ({
    ok: false,
    profilePrivate: true,
    message:
      'This tracker.gg profile is private. Sign in with Riot on tracker.gg once so the profile is public.',
    profileUrl: 'https://tracker.gg/valorant',
  }),
  'web.preferences.get': () => ({ microphone: 'ask', camera: 'ask', clipboard: 'ask', notifications: 'ask' }),
  // The state the engine left when it last exited (rev 0), shown until the board is on screen and the engine runs.
  'shaders.addon': () => ({ ok: true, present: mockShaders, snapshot: mockShaders ? { ...mockShadersSnapshot(), rev: 0 } : undefined }),
  'capture.status': () => ({ ok: true, state: mockCaptureState, settings: mockCaptureSettings }),
  'capture.settings': (params) => {
    Object.assign(mockCaptureSettings, params)
    return { ok: true, state: mockCaptureState, settings: mockCaptureSettings }
  },
  'capture.act': () => ({ ok: true, state: mockCaptureState }),
  'capture.list': () => ({ ok: true, items: mockCaptures }),
  'capture.item': mockCaptureItem,
  'capture.edit': () => ({ ok: false, message: 'Mock: no capture add-on.' }),
  'capture.saveImage': () => ({ ok: false, message: 'Mock: no capture add-on.' }),
  'notes.list': (params) => {
    const query = typeof params?.query === 'string' ? params.query.toLowerCase() : ''
    return { ok: true, notes: [...mockNotes.values()].filter(note => !query || note.text.toLowerCase().includes(query)).map(note => note.info), tabs: [], active: null }
  },
  'notes.read': (params) => {
    const note = mockNotes.get(String(params?.id))
    return note ? { ok: true, text: note.text, note: note.info } : { ok: false, message: 'That note is gone.' }
  },
  'notes.save': (params) => {
    const id = typeof params?.id === 'string' ? params.id : `mock-${mockNotes.size + 1}`
    const kind = params?.markdown === true ? 'markdown' : mockNotes.get(id)?.info.kind ?? 'text'
    return { ok: true, note: mockNote(id, String(params?.text ?? ''), kind) }
  },
  'notes.act': (params) => {
    const id = String(params?.id)
    const note = mockNotes.get(id)
    if (params?.action === 'delete') { mockNotes.delete(id); return { ok: true } }
    if (!note) return { ok: params?.action === 'folder' }
    if (params?.action === 'pin' || params?.action === 'unpin') note.info = { ...note.info, pinned: params.action === 'pin' }
    if (params?.action === 'markdown' || params?.action === 'text') note.info = { ...note.info, kind: params.action }
    return { ok: true, note: note.info }
  },
  'notes.session': () => ({ ok: true }),
  'notes.open': () => ({ ok: false, cancelled: true }),
  'notes.saveAs': () => ({ ok: false, message: 'Mock: no save dialog in the browser.' }),
  'notes.pending': () => ({ id: null }),
  'notes.spell': (params) => ({ ok: true, wrong: params?.word === 'teh', suggestions: params?.word === 'teh' ? ['the', 'tech'] : [] }),
  'notes.textFiles': () => ({ ok: true, offered: false, isDefault: false }),
  'shell.pickProgram': () => ({ ok: false, cancelled: true }),
  'shaders.call': (params) => {
    if (!mockShaders) return { ok: false, message: 'Mock: no shader add-on.' }
    if (params?.method === 'scan') mockShadersScanned = true
    return { ok: true, result: params?.method === 'snapshot' ? mockShadersSnapshot() : {} }
  },
  'shaders.estimates': () => ({ ok: true, seconds: {} }),
  'friends.badge': () => ({ count: 0 }),
  'desktopClients.status': () => ({
    ok: true,
    apps: [
      { id: 'discord', title: 'Discord', state: 'installed' },
      { id: 'spotify', title: 'Spotify', state: 'notInstalled' },
    ],
  }),
  'desktopClients.install': mockOk,
  'discord.status': () => ({ state: 'ready', signedIn: true }),
  'discord.signIn': mockOk,
  'discord.signOut': mockOk,
  'discord.home': () => mockHome,
  'discord.channels': () => ({ ...mockChannels, hideMuted: mockHideMuted }),
  'discord.admin': mockAdmin,
  'discord.messages': (params?: { before?: string }) => ({ ok: true, messages: params?.before ? [] : [...mockMessages, ...mockAppMessages].reverse() }),
  'discord.apps': (params?: { action?: string }) => params?.action === 'commands' ? mockApps : { ok: true, nonce: '900000000000000001' },
  'discord.send': mockOk,
  'discord.edit': mockOk,
  'discord.delete': mockOk,
  'discord.ack': mockOk,
  'discord.thread': () => ({ ok: true, thread: { id: '600000000000000003', name: 'New post' } }),
  'discord.typing': mockOk,
  'discord.upload': () => ({ ok: true, uploadId: 'mock' }),
  'discord.voiceMessage': mockVoiceMessage,
  'discord.react': mockOk,
  'discord.emojis': () => ({ premium: false, guilds: [{ id: '200000000000000001', name: 'Exo Lab', icon: null, emojis: [{ id: '968812152267866172', name: 'Troll', animated: false, native: true }, { id: '968812607832203274', name: 'Yoshi', animated: false, native: false }] }] }),
  'discord.emojiFavorites': (p?: { action?: string; emoji?: string }) => {
    if (p?.emoji && p.action === 'add' && !mockFavoriteEmojis.includes(p.emoji)) mockFavoriteEmojis.push(p.emoji)
    if (p?.emoji && p.action === 'remove') mockFavoriteEmojis.splice(mockFavoriteEmojis.indexOf(p.emoji), 1)
    return { ok: true, favorites: [...mockFavoriteEmojis], frequent: ['joy', 'thumbsup', 'fire', '968812152267866172', 'heart', 'skull', 'sob', 'eyes', 'pray', 'copyright'], reactions: ['thumbsup', 'joy', 'heart'] }
  },
  'discord.view': mockOk,
  // Watching a stream in the mock: always taken (no pictures arrive), so its view, controls and menus can be seen.
  'discord.stream': () => ({ ok: true }),
  'discord.voice': (params?: { action?: string; guildId?: string; channelId?: string }) => ({ ok: true, voice: params?.action === 'join' ? { state: 'connected', guildId: params.guildId ?? null, channelId: params.channelId ?? null, muted: false, deafened: false, e2ee: true } : { state: 'off', guildId: null, channelId: null, muted: false, deafened: false, e2ee: false } }),
  'discord.ring': mockOk,
  'discord.golive': mockGoLiveHandler,
  'discord.friends': () => ({ friends: mockFriends, restricted: { blocked: [{ id: '100000000000000009', name: 'Spammy', username: 'spammy.bot', avatar: null }], ignored: [{ id: '100000000000000008', name: 'Loud Larry', username: 'larry', avatar: null }] } }),
  'discord.friend': mockOk,
  'discord.callSongs': () => ({ songs: [] }),
  'discord.markRead': mockOk,
  'discord.channel': () => ({ ok: true, muted: true, url: 'https://discord.gg/exo' }),
  'discord.mentions': () => ({ ok: true, messages: mockMessages.filter(m => m.mentions.length), places: { '400000000000000002': { name: 'general', guildId: '300000000000000001', guild: 'Exo Squad', parentId: null } } }),
  'discord.forYou': () => ({ ok: true, hasMore: false, items: [
    { id: '1300000000000000000', type: 'friend_request_accepted', body: '**Kai** accepted your friend request.', acked: false, other_user: mockMessages[2].author },
    { id: '1290000000000000000', type: 'scheduled_guild_event_started', body: '**Scrim night** is starting in **Exo Squad**.', acked: true, deeplink: 'https://discord.com/channels/300000000000000001/400000000000000002' },
  ] }),
  'discord.unreads': () => ({ channels: [
    { channelId: '400000000000000002', name: 'general', guildId: '300000000000000001', guild: 'Exo Squad', icon: null, parentId: null, lastRead: '500000000000000008', lastMessage: '500000000000000012', mentions: 1 },
  ] }),
  'discord.reactors': () => ({ ok: true, canRemove: true, users: mockMessages.slice(0, 3).map(m => m.author) }),
  'discord.fileText': () => ({ ok: true, left: 0, text: 'sensitivity "0.42"\nm_yaw "0.022"\nfps_max "0"\ncl_crosshairsize "2"\ncl_crosshairgap "-2"\ncl_crosshaircolor "1"\nbind "mouse4" "+voicerecord"\nbind "f" "+lookatweapon"\nhost_writeconfig\n' }),
  'discord.audio': () => ({ inputs: [{ id: 'mic', name: 'Microphone' }], outputs: [{ id: 'spk', name: 'Speakers' }], input: null, output: null, inputVolume: 100, outputVolume: 100, soundboardVolume: 100, soundboardMuted: false }),
  'discord.userSettings': (params?: { changes?: Record<string, unknown> }) => ({ ok: true, values: params?.changes ?? {} }),
  'discord.account': (params?: { action?: string }) => params?.action === 'tags'
    ? { ok: true, mine: null, servers: [{ id: '200000000000000001', name: 'Exo Lab', tag: 'EXO', badge: null }] }
    : params?.action === 'setTag' ? { ok: true }
    : params?.action === 'me'
    ? { ok: true, me: { id: '1', username: 'exo', globalName: 'Exo', avatar: null, banner: null, accentColor: null, bio: '', pronouns: '', email: 'e***@example.com', phone: null, verified: true, mfa: false, nsfwAllowed: true, premium: false } }
    : { ok: true, data: params?.action === 'consent' ? { usageStatistics: true, personalization: true } : [] },
  'discord.clientSettings': (params?: Record<string, unknown>) => (mockDiscordClient = { ...mockDiscordClient, ...params }),
  'discord.micTest': mockOk,
  'discord.micMonitor': () => ({ ok: true, on: false, onHead: true }),
  'discord.voiceTune': () => ({ ok: false, message: 'Voice Tune needs Exo.' }),
  'discord.sound': mockOk,
  'discord.server': (p?: { action?: string; invite?: string; hideMuted?: boolean }) => p?.action === 'notify' && p.hideMuted !== undefined
    ? (mockHideMuted = p.hideMuted, { ok: true })
    : p?.action === 'profile'
    ? { ok: true, profile: { id: '200000000000000001', name: 'Exo Lab', icon_hash: null, description: 'Where Exo gets built.', member_count: 1204, online_count: 312, tag: 'EXO', traits: [{ label: 'Gaming', emoji_name: '🎮', position: 0 }] } }
    : p?.action === 'invite'
    ? p.invite === 'expired' ? { ok: false, invalid: true, message: 'Discord: Unknown Invite' }
      : { ok: true, invite: p.invite === 'exo'
        ? { guildId: '300000000000000001', channelId: '400000000000000002', name: 'Exo Squad', icon: null, verified: false, partnered: false, online: 12, members: 48, joined: true }
        : { guildId: '300000000000000009', channelId: '400000000000000090', name: 'VALORANT', icon: 'https://cdn.discordapp.com/embed/avatars/0.png', verified: true, partnered: false, online: 182340, members: 1204512, joined: false } }
    : p?.action === 'members'
    ? { ok: true, roles: { '300000000000000001': { name: 'Mods', color: '#e91e63', position: 2 } }, members: { total_result_count: 1, members: [{ member: { user: { id: '100000000000000002', username: 'ada', global_name: 'Ada' }, roles: ['300000000000000001'], joined_at: '2026-09-01T12:00:00Z' }, source_invite_code: 'exo' }] } }
    : p?.action === 'events'
    ? { ok: true, events: [{ interested: false, event: { id: '700000000000000001', name: 'Ranked night', scheduled_start_time: '2026-10-20T01:00:00Z', status: 1, user_count: 6, entity_metadata: { location: 'Voice' } } }] }
    : p?.action === 'guide'
      ? { ok: true, guide: { welcome_message: { message: 'Read the rules, grab a role, say hi.' }, new_member_actions: [{ channel_id: '400000000000000001', title: 'Say hi', description: 'Introduce yourself', emoji: { name: '👋' } }], resource_channels: [] }, resources: [{ channelId: '400000000000000002', title: 'Rules', description: 'Read before posting' }] }
      : { ok: true },
  'discord.profile': (p?: { mutualFriends?: boolean; note?: string }) => p?.mutualFriends ? { ok: true, friends: [{ id: '100000000000000003', username: 'kai', global_name: 'Kai' }] } : p?.note !== undefined ? mockOk() : mockProfile,
  'discord.threads': () => ({ ok: true, threads: [{ id: '600000000000000001', name: 'Best crosshair codes?', parent_id: '400000000000000007', message_count: 42 }, { id: '600000000000000002', name: 'Patch 9.2 tier list', parent_id: '400000000000000007', message_count: 7 }] }),
  'discord.stickers': (p?: { action?: string; stickerId?: string }) => {
    if (p?.stickerId && p.action === 'add' && !mockFavoriteStickers.includes(p.stickerId)) mockFavoriteStickers.push(p.stickerId)
    if (p?.stickerId && p.action === 'remove') mockFavoriteStickers.splice(mockFavoriteStickers.indexOf(p.stickerId), 1)
    return { premium: false, favorites: [...mockFavoriteStickers], groups: [
      { id: 'pack:847199849233514549', name: 'Wumpus Beyond', icon: null, usable: true, stickers: [{ id: '749054660769218631', name: 'Wave', format: 1 }, { id: '749052944682582036', name: 'Lurk', format: 1 }] },
      { id: '300000000000000002', name: 'Frame Pacing Club', icon: null, usable: false, stickers: [{ id: '749043879713767424', name: 'Hi', format: 1 }] },
    ] }
  },
  'discord.sticker': mockOk,
  'discord.pins': () => ({ ok: true, messages: [] }),
  'discord.search': (p?: { filters?: { offset?: number } }) => ({ ok: true, result: { messages: mockMessages.slice(0, 4).map(m => [m]), total_results: 87 }, places: {}, offset: p?.filters?.offset }),
  'discord.gifs': () => ({ ok: true, gifs: [] }),
  'discord.members': () => mockMembers,
  'discord.saved': (p?: { action?: string; messageId?: string; dueAt?: number }) => {
    if (p?.action === 'save') { if (p.dueAt) mockSaved.reminders.set(p.messageId ?? '', p.dueAt); else mockSaved.bookmarks.add(p.messageId ?? ''); return { ok: true } }
    if (p?.action === 'remove') { mockSaved.reminders.delete(p.messageId ?? ''); mockSaved.bookmarks.delete(p.messageId ?? ''); return { ok: true } }
    const saved = (id: string, due?: number) => ({ message: mockMessages.find(m => m.id === id) ?? null, save_data: { channel_id: '400000000000000002', message_id: id, saved_at: new Date().toISOString(), due_at: due ? new Date(due).toISOString() : null } })
    if (p?.action === 'bookmarks') return { ok: true, results: [...mockSaved.bookmarks].map(id => saved(id)), hasMore: false, places: {} }
    return { ok: true, reminders: [...mockSaved.reminders].map(([id, due]) => saved(id, due)), bookmarkIds: [...mockSaved.bookmarks], places: {} }
  },
  'discord.mentionable': (p?: { query?: string; channels?: boolean }) => {
    const q = (p?.query ?? '').toLowerCase()
    if (p?.channels) return { users: [], channels: mockChannels.channels.filter(c => c.kind !== 'category' && c.name.includes(q)).map(c => ({ id: c.id, name: c.name, type: c.type, kind: c.kind, category: 'Text channels' })) }
    return {
      users: mockMessages.map(m => m.author).filter((u, i, all) => all.findIndex(x => x.id === u.id) === i && u.username.startsWith(q)),
      roles: [{ id: '700000000000000001', name: 'Moderators', color: '#3498db' }, { id: '700000000000000002', name: 'Members', color: null }].filter(r => r.name.toLowerCase().includes(q)),
    }
  },
  'discord.colors': () => ({ colors: { '100000000000000002': '#e91e63', '100000000000000004': '#3498db' }, icons: { '100000000000000002': { name: 'Admins', emoji: '🛡️' } } }),
  'discord.setStatus': mockOk,
  'web.preferences.set': (p) => ({ microphone: 'ask', camera: 'ask', clipboard: 'ask', notifications: 'ask', ...p }),
  'shell.prepare': () => ({ ok: true }),
  'shell.painted': () => ({ ok: true }),
  'music.playback': () => ({ ok: true, playback: null }),
  'music.setBounds': mockOk,
  'music.install': mockOk,
  'music.open': mockOk,
  'music.volume': () => ({ ok: false, message: 'Open Exo to adjust music volume.' }),
  'music.control': () => ({ ok: false, message: 'Open Exo to control music.' }),
  'deps.list': mockDepsList,
  'replaced.scan': () => ({ ok: true, cleared: 2, apps: MOCK_REPLACED }),
  'apps.list': () => ({ ok: true, programs: MOCK_PROGRAMS, cleared: [{ name: 'Discord', summary: { folders: 3, files: 0, registry: 3, shortcuts: 2, bytes: 20_600_000 } }] }),
  'apps.icons': () => ({ ok: true, icons: {} }),
  'apps.uninstall': (p) => {
    const id = (p as { id?: string } | undefined)?.id
    const name = MOCK_PROGRAMS.find(app => app.id === id)?.name ?? 'App'
    MOCK_PROGRAMS = MOCK_PROGRAMS.filter(app => app.id !== id)
    return {
      ok: true, token: 'mock', name,
      items: [
        { id: 0, kind: 'folder', path: `C:\\Program Files\\${name}`, bytes: 4_100_000, likely: false, machine: true },
        { id: 1, kind: 'registry', path: `HKCU\\Software\\Classes\\${name}.file`, bytes: 0, likely: false, machine: false },
        { id: 2, kind: 'shortcut', path: `C:\\Users\\You\\Desktop\\${name}.lnk`, bytes: 1_200, likely: false, machine: false },
        { id: 3, kind: 'folder', path: `C:\\Users\\You\\AppData\\Roaming\\${name}`, bytes: 820_000, likely: true, machine: false },
      ],
      sure: { folders: 1, files: 0, registry: 1, shortcuts: 1, bytes: 4_101_200 },
      likely: { folders: 1, files: 0, registry: 0, shortcuts: 0, bytes: 820_000 },
    }
  },
  'apps.scan': () => ({ ok: false, message: 'Mock: nothing to scan.' }),
  'apps.clean': () => ({ ok: true, cleared: { folders: 1, files: 0, registry: 1, shortcuts: 1, bytes: 4_101_200 }, left: 0 }),
  'apps.allowEdge': () => ({ ok: true }),
  'replaced.remove': (p) => {
    const id = (p as { id?: string } | undefined)?.id
    MOCK_REPLACED = MOCK_REPLACED.map(app => app.id === id ? { ...app, installed: false, leftovers: 0, bytes: 0, needsAdmin: false, found: NONE_LEFT, cleared: { ...app.found, registry: app.found.registry + 7 } } : app)
    return { ok: true, removed: 9, left: 0, apps: MOCK_REPLACED }
  },
  'deps.offerInstall': () => ({ ok: true, message: 'Mock: would open official installer page.' }),
  'deps.cancelInstall': () => ({ ok: true, message: 'Download canceled.' }),
  'runtimes.list': () => ({ ok: true, items: MOCK_RUNTIMES }),
  'runtimes.install': mockRuntimesInstall,
  'runtimes.cancel': () => ({ ok: true, message: 'Stopping the downloads.' }),
  'stores.check': mockStoresCheck,
  'stores.matrix': mockStoresMatrix,
  'settings.get': () => ({ ...mockSettings }),
  'settings.set': mockSettingsSet,
  'gifts.list': () => ({ ok: true, steamSignedIn: true, gifts: MOCK_GIFTS }),
  'gifts.answer': (params) => {
    const id = (params as { id?: string } | undefined)?.id
    MOCK_GIFTS = MOCK_GIFTS.filter(gift => gift.id !== id)
    return { ok: true, message: (params as { accept?: boolean } | undefined)?.accept ? 'Added to your library.' : 'Declined.' }
  },
  'gifts.steamSignIn': () => ({ ok: true, message: "Signed in to Steam's website." }),
  'gifts.steamSignOut': () => ({ ok: true, message: "Signed out of Steam's website." }),
  'accounts.list': () => ({
    ok: true,
    steam: {
      current: 'Player One',
      accounts: [
        { key: 'mock-steam-main', name: 'Player One', current: true, remembered: true },
        { key: 'mock-steam-alt', name: 'Rocket alt', current: false, remembered: true },
        { key: 'mock-steam-old', name: 'Old login', current: false, remembered: false },
      ],
    },
    riot: {
      current: 'PlayerOne#NA1',
      accounts: [
        { key: 'mock-riot-main', name: 'PlayerOne#NA1', current: true, saved: true, lastIn: [] },
        { key: 'mock-riot-val', name: 'Smurf#VAL', current: false, saved: true, lastIn: ['VALORANT'] },
      ],
    },
    epic: { signedIn: true, name: 'PlayerOne', launcherDiffers: true, canImport: true, added: [{ key: 'mock-epic-alt', name: 'RocketAlt' }] },
    gog: { signedIn: true, canSignOut: true },
    amazon: { signedIn: false, name: null },
  }),
  'accounts.switch': () => ({ ok: false, message: 'Mock: switching accounts needs the Exo host.' }),
  'accounts.signOut': () => ({ ok: false, message: 'Mock: signing out needs the Exo host.' }),
  'accounts.add': () => ({ ok: false, message: 'Mock: adding an account needs the Exo host.' }),
  'accounts.remove': () => ({ ok: false, message: 'Mock: removing an account needs the Exo host.' }),
  'accounts.epicImport': () => ({ ok: false, message: 'Mock: needs the Exo host.' }),
  'accounts.epicAdd': () => ({ ok: false, message: 'Mock: needs the Exo host.' }),
  'accounts.epicRemove': () => ({ ok: false, message: 'Mock: needs the Exo host.' }),
  'shell.minimize': mockOk,
  'shell.maximize': mockOk,
  'shell.windowState': mockOk,
  'shell.close': mockOk,
  'shell.openUrl': mockOk,
  'app.repairCache': mockOk,
  'shell.showStore': mockOk,
  'shell.setChromeLayout': mockOk,
  'music.warm': mockOk,
  'music.reload': mockOk,
  'app.version': () => ({ version: '1.0.0-dev' }),
  'app.checkUpdate': () => mockUpdate
    ? { ok: true, updateAvailable: true, offerOnOpen: true, latest: '3.15.0', message: 'Version 3.15.0 is available.', current: '1.0.0-dev', upcoming: { version: '3.15.0', items: [
        { icon: 'Download', title: "See what's coming", detail: "What's New shows the next version's changes before you install it." },
        { icon: 'Sparkle', title: 'Catch up on what you missed', detail: "Skip a few versions and What's New shows every one you missed." },
      ] } }
    : { ok: true, alreadyLatest: true, updateAvailable: false, message: 'Up to date.', current: '1.0.0-dev' },
  'app.log': mockOk,
  'app.openLogs': () => ({ ok: false, message: 'No logs folder in the browser mock.' }),
  'app.installUpdate': () => ({
    ok: true,
    alreadyLatest: true,
    updateAvailable: false,
    message: 'Already up to date.',
    current: '1.0.0-dev',
  }),
  'dlss.status': mockDlssStatus,
  'dlss.updateAll': (params) => { mockDlssUpdated.add(String(params?.id)); return { ok: true, updated: 1, failed: 0 } },
  'dlss.restore': () => ({ ok: false, message: 'Mock: no upscaler files.' }),
  'dlss.consent': () => ({ ok: false, message: 'Mock: no anti-cheat game.' }),
  'dlss.indicator': (params) => ({ ok: true, available: true, on: params?.on === true }),
  'shaders.status': mockShadersStatus,
  lucid: (p) => ({
    ok: true, found: true, version: '6.0.3', running: true, voiceOn: false, startWithExo: p?.action === 'set' ? p.on === true : false, devices: true,
    settings: {
      headphone: { id: 'lucid_iems', name: 'Lucid IEMs', chosen: true }, favorites: [], gameMode: true, keepOnAltTab: false,
      onlyWhileGaming: false,
      nightShift: false, nightStart: '21:00', nightEnd: '06:00', nightSync: false, notifications: false, discord: false,
      hotkey: { modifiers: 0, key: 122 }, eqOn: true,
    },
    eq: { on: 'Headphones (High Definition Audio Device)', playing: 'Headphones (High Definition Audio Device)', covered: true },
  }),
  'devices.image': () => ({ ok: false, url: null }),
  'devices.openApp': mockOk,
  'lucid.update': () => ({ version: null }),
  'dictation.state': mockDictationState,
  'dictation.prepare': mockOk,
  'dictation.start': mockDictationStart,
  'dictation.stop': mockDictationStop,
  'dictation.cancel': () => { window.clearInterval(mockDictationLevels); return { ok: true } },
  'devices.list': () => ({
    ok: true,
    devices: [
      { id: 'usb-361d-0300-747353800033', kind: 'mouse', name: 'StarlightX Dongle', maker: 'Finalmouse', model: null, connection: 'wireless', role: null, battery: null, color: null, layout: null },
      { id: 'usb-31e3-1342-95be6909a013', kind: 'keyboard', name: 'Wooting 60HE v2', maker: 'Wooting', model: '60', connection: 'usb', role: null, battery: null, color: null, layout: 'ansi-split',
        port: { where: 'chipset', chips: 1, hubs: 0, interrupts: 'msi', better: 'free' }, app: { id: 'wootility', name: 'Wootility', where: 'web' } },
      { id: 'usb-054c-0df2-5f24d70ab9bc', kind: 'controller', name: 'DualSense Edge Wireless Controller', maker: 'Sony', model: 'dualsense-edge', connection: 'usb', role: null, battery: null, color: 'Midnight Black', layout: null },
      { id: '{0.0.0.00000000}.{9709e4ab-6969-4817-ad38-1704eab1c079}', kind: 'audio', name: 'Headphones', maker: null, model: 'headphones', connection: 'jack', role: 'output', battery: null, color: null, layout: null },
      { id: '{0.0.1.00000000}.{0deb347c-90b6-43d6-b549-63e63b1b23a9}', kind: 'audio', name: 'fifine Microphone', maker: 'Fifine', model: 'microphone', connection: 'usb', role: 'input', battery: null, color: null, layout: null },
    ],
    cpuPorts: { free: 2, total: 4, freeTypeC: false },
  }),
  'lucid.headphones': () => ({
    ok: true,
    headphones: [
      { id: 'lucid_iems', model: 'Lucid IEMs', brand: 'tekkusai', category: 'In-Ear Monitors', grade: 'Excellent', keywords: '' },
      { id: 'astro_a50_x', model: 'A50 X', brand: 'Astro', category: 'Gaming Headsets', grade: 'Good', keywords: 'a50x' },
    ],
  }),
  'gpu.profile': (p) => mockGpu === 'intel' || mockGpu === 'amd' ? {
    ok: true, vendor: mockGpu, gpu: mockGpu === 'intel' ? 'Arc B580' : 'Radeon RX 9070 XT', series: 0, screen: { name: 'VG27AQ', hz: 165, vrr: true },
    status: mockApply('profile', p) ? 'applied' : 'ready', gsync: false, canUndo: mockApplied.has('profile'), driverUpdated: false, items: [],
    lowLatency: mockGpu === 'intel' ? p?.lowLatency ?? 'on' : null,
    summary: mockGpu === 'intel'
      ? "Adaptive Sync on, frames capped at 157 fps, Low latency on, Intel's prebuilt shaders; Endurance Gaming and sharpening off"
      : 'FreeSync on, frames capped at 157 fps, Anti-Lag on; Chill, Boost and Image Sharpening off',
  } : {
    ok: true, vendor: 'nvidia', gpu: 'RTX 3070', series: 30, screen: { name: 'VG248', hz: 165, vrr: false },
    status: mockApply('profile', p) ? 'applied' : 'ready', gsync: p?.action === 'apply' && p.gsync === true,
    canUndo: mockApplied.has('profile'), driverUpdated: false, items: [],
  },
  'system.about': () => ({
    name: 'Erix-PC', processor: mockIntelCpu ? 'Intel Core i7-14700K' : 'AMD Ryzen 5 5600X', cores: mockIntelCpu ? 20 : 6, threads: mockIntelCpu ? 28 : 12,
    graphics: 'NVIDIA GeForce RTX 3070', videoMemoryGb: 8, directX: '12 Ultimate', resizableBar: true,
    memoryGb: 16, memoryType: 'DDR4', memorySpeed: 3600, memoryRated: 3600, memorySlotsUsed: 2, memorySlots: 4,
    motherboard: 'ASUS ROG STRIX B550-F GAMING WIFI II', bios: '3636', biosDate: '2026-01-04',
    windows: 'Windows 11 Pro', windowsVersion: '26H2', build: '26300.9711', secureBoot: true, tpm: '2.0', memoryIntegrity: false,
    ...(mockNet === 'wifi'
      ? { network: 'Wi-Fi', networkMbps: 1201, networkAdapter: 'Intel Wi-Fi 6E AX211 160MHz' }
      : { network: 'Ethernet', networkMbps: mockNet === 'slow' ? 100 : 2500, networkAdapter: 'Intel Ethernet Controller I226-V' }),
  }),
  'system.health': (p) => {
    const cpu = mockIntelCpu ? 'Core i7-14700K' : 'Ryzen 5 5600X'
    const [label, from, to, drop] = mockIntelCpu
      ? ['Intel chipset driver', '10.1.19867.8574', '10.1.20658.8883', 'Devices may reset']
      : ['AMD chipset driver', '8.08.12.551', '8.09.28.1124', 'USB and sound may drop']
    return {
      ok: true,
      items: [
        mockApply('power', p)
          ? { key: 'power', label: 'Power plan', detail: "Exo's plan", applied: true, canUndo: true, cpu }
          : { key: 'power', label: 'Power plan', detail: `Your PC uses “Nexus LiteOS Power Plan”. Exo's plan is tuned for your ${cpu}.`, cpu },
        p?.action === 'chipset'
          ? { key: 'chipset', label, detail: `Updating to ${to}. ${drop} for a moment`, busy: true }
          : { key: 'chipset', label, detail: `${from} installed · ${to} installs while you're away` },
        ...mockNetItems(p),
      ],
    }
  },
  'system.interrupts': (p) => {
    const applied = p?.action === 'apply'
    return {
      ok: true, restart: applied, result: null, canUndo: applied,
      devices: [
        { id: 'a1', name: 'NVIDIA GeForce RTX 3070', kind: 'graphics card', mode: 'line', plan: applied ? 'restart' : 'change', reason: applied ? 'Switches to MSI mode after a restart' : 'Uses a shared line. Exo will switch it to MSI mode', changed: applied },
        { id: 'a2', name: 'AMD USB 3.10 eXtensible Host Controller', kind: 'USB controller', mode: 'msi', plan: 'done', reason: 'Uses MSI mode', changed: false },
        { id: 'a3', name: 'Standard NVM Express Controller', kind: 'storage controller', mode: 'msi', plan: 'skip', reason: 'Left alone: Windows starts from the drive behind it', changed: false },
      ],
    }
  },
  'system.mouseCore': mockMouseCore,
  'system.drives': mockDrives,
  'junk.scan': () => ({ ok: true, items: [
    { id: 'temp', name: 'Temporary files', detail: '', bytes: 0.8e9, files: 412 },
    { id: 'shaders', name: 'Old shader caches', detail: '', bytes: 36.6e9, files: 57 },
    { id: 'exo', name: "Exo's old backups", detail: '', bytes: 0.35e9, files: 1 },
  ] }),
  'junk.clean': () => ({ ok: true, bytes: 37.7e9, files: 470 }),
  'stores.quiet': () => ({ ok: true, message: null }),
  'hdr.state': () => ({ supported: true, on: false, name: 'Mock OLED', peakNits: 1000, calibrated: false, verdict: 'great' }),
  'hdr.game': (p) => ({ ok: true, hdr: 'true', mode: typeof p?.mode === 'string' ? p.mode : 'auto' }),
  'game.settings': () => ({ ok: true, supported: false }),
  'gpu.display': (p) => ({
    ok: true,
    pending: p?.action === 'set' ? { display: 'DISPLAY1', seconds: 15 } : null,
    displays: [{
      id: 'DISPLAY1', name: 'VG248', main: true, hdr: false, vendor: 'nvidia', refresh: 144, refreshes: [60, 100, 120, 144],
      color: { format: 'rgb', bpc: 8, full: true }, auto: false,
      supported: ['rgb', '444', '422'].flatMap(format => [6, 8].flatMap(bpc =>
        (format === 'rgb' ? [true, false] : [false]).map(full => ({ format, bpc, full })))),
      best: { refresh: 144, color: { format: 'rgb', bpc: 8, full: true }, why: null, scaling: true, over: true },
      isBest: false,
      scaling: { mode: 'aspect', gpu: false, over: false },
      adjust: {
        nvidia: p?.action === 'adjust' && p.nvidia === true,
        controls: [
          { key: 'brightness', label: 'Brightness', value: 50, min: 0, max: 100, step: 1, normal: 50, unit: '%' },
          { key: 'contrast', label: 'Contrast', value: 50, min: 0, max: 100, step: 1, normal: 50, unit: '%' },
          { key: 'gamma', label: 'Gamma', value: 100, min: 30, max: 280, step: 1, normal: 100, unit: '' },
          { key: 'vibrance', label: 'Digital vibrance', value: 50, min: 0, max: 100, step: 1, normal: 50, unit: '%' },
          { key: 'hue', label: 'Hue', value: 0, min: 0, max: 359, step: 1, normal: 0, unit: '°' },
        ],
      },
    }],
  }),
  'gpu.import': () => ({ ok: false, cancelled: true, undo: null }),
  // An RTX 3070 at work, drifting so the PC room's readings move.
  'gpu.sensors': () => {
    const wave = Math.sin(Date.now() / 20_000)
    return {
      ok: true, temperature: 62 + wave * 8, watts: 150 + wave * 60, clock: 1800 + wave * 120, usage: 70 + wave * 25,
      vramUsed: 5600 + wave * 600, vramTotal: 8192, fan: 1500 + wave * 300, limit: { on: 'temperature', warn: 83, bad: 93 },
    }
  },
  'gpu.driver': () => ({ ok: true, vendor: 'nvidia', card: 'RTX 3070', installed: '581.42', update: true, latest: { version: '581.57', size: 900_000_000, released: '2026-10-14', kind: 'game' } }),
  'gpu.game': (p) => {
    if (mockGpu === 'intel' && typeof p?.frameGen === 'string') mockFrameGen = p.frameGen
    return mockGpu === 'intel' ? { ok: true, vendor: 'intel', supported: true, frameGen: mockFrameGen }
      // ?gpu=amd: an RX 6600 as Exo decides (Helpers/FluidMotionFrames.cs): off for competitive games and Cyberpunk's own frame generation.
      : { ok: true, vendor: 'amd', supported: mockGpu === 'amd', afmf: !/valorant|rivals|fortnite|cyberpunk/.test(String(p?.id)), amdSoftware: true }
  },
  'store.home': () => ({ ok: true, at: new Date().toISOString(), hero: [], shelves: [{ id: 'mock', title: 'Top sellers', items: [MOCK_STORE_TILE] }] }),
  'store.calendar': () => ({
    ok: true, at: new Date().toISOString(), interests: ['Roguelike', 'Co-op'],
    days: [{ date: new Date().toISOString().slice(0, 10), entries: [{ tile: MOCK_STORE_TILE, wished: true, owned: false, earlyAccess: false, why: ['On your wishlist', 'Like Roguelike and Co-op'] }] }],
  }),
  'store.search': () => ({ ok: true, items: [] }),
  'store.open': () => ({ ok: true }),
  'store.gameOffers': () => ({ ok: true, offers: [
    { store: '25', name: 'Epic Games Store', final: 2999, initial: 5999, discount: 50, currency: 'USD', url: 'https://store.epicgames.com/' },
    { store: '7', name: 'GOG', final: 2999, initial: 5999, discount: 50, currency: 'USD', url: 'https://www.gog.com/' },
  ], lowest: { final: 1979, at: '2026-06-25T17:00:00Z' } }),
  'store.gameReviews': () => ({ ok: true, word: 'Mostly Positive', percent: 78, count: 1025 }),
  'store.game': mockStoreGame,
  'store.wishlist': () => ({ ok: true, items: [] }),
  'store.exo.catalog': () => ({ ok: true, enabled: false, items: [] }),
  'twitch.connect': () => ({ ok: false, message: 'Twitch sign-in is not available in the browser mock.' }),
  'keys.preview': () => ({ ok: true, looksLikeKey: false, store: 'unknown', key: '' }),
  'keys.activate': () => ({ ok: true, message: 'Mock key.' }),
}

export async function mockCall<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  await new Promise((r) => setTimeout(r, 40))
  const handler = MOCK_HANDLERS[method]

  if (!handler) throw new Error(`Unknown mock method: ${method}`)
  return handler(params) as T
}

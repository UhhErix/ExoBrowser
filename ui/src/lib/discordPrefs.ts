import { useSyncExternalStore, type CSSProperties } from 'react'
import { host, onHostEvent } from './host'
import { onTextScale, textScale } from './exoTheme'

/**
 * Discord settings as Exo's Discord client applies them. Two kinds, as in Discord:
 * - The account's own settings (Discord keeps them, every Discord app shares them): read from
 *   PreloadedUserSettings through the host, changed there, and kept current when another Discord
 *   app changes them (discord.userSettings).
 * - Settings Discord keeps per device (Accessibility, Streamer Mode, the camera): kept on this PC.
 */

/** The account's settings by Discord's own field names (Discord's defaults until they're read). */
export type AccountSettings = {
  streamNotificationsEnabled: boolean
  renderSpoilers: 'ON_CLICK' | 'ALWAYS' | 'IF_MODERATOR'
  viewImageDescriptions: boolean
  inlineAttachmentMedia: boolean
  inlineEmbedMedia: boolean
  gifAutoPlay: boolean
  renderEmbeds: boolean
  renderReactions: boolean
  animateEmoji: boolean
  /** 0 always, 1 on interaction, 2 never. */
  animateStickers: number
  enableTtsCommand: boolean
  messageDisplayCompact: boolean
  explicitContentFilter: number
  viewNsfwGuilds: boolean
  convertEmoticons: boolean
  viewNsfwCommands: boolean
  /** 0 unset, 1 off, 2 non-friends, 3 everyone. */
  dmSpamFilterV2: number
  includeStickersInAutocomplete: boolean
  /** 0 unset, 1 show, 2 blur, 3 block. */
  explicitContentGuilds: number
  explicitContentFriendDm: number
  explicitContentNonFriendDm: number
  goreContentGuilds: number
  goreContentFriendDm: number
  goreContentNonFriendDm: number
  includeGameMentionsInAutocomplete: boolean
  displayCompactAvatars: boolean
  /** 0 all messages, 1 only DMs, 2 never. */
  reactionNotifications: number
  enableFriendOnlineNotifications: boolean
  enableFriendAnniversaryNotifications: boolean
  enableProfileUpdatesNotifications: boolean
  notifyFriendsOnProfileUpdate: boolean
  notifyFriendsOnComeOnline: boolean
  notifyServerMembersOnGoLive: boolean
  allowActivityPartyPrivacyFriends: boolean
  allowActivityPartyPrivacyVoiceChannel: boolean
  restrictedGuildIds: string[]
  defaultGuildsRestricted: boolean
  /** Bits: 2 friends of friends, 4 server members, 8 everyone (14 all). */
  friendSourceFlags: number
  defaultGuildsActivityRestricted: number
  messageRequestRestrictedGuildIds: string[]
  /** Servers where your activity status isn't shared, and where people can't join your activity. */
  activityRestrictedGuildIds: string[]
  activityJoiningRestrictedGuildIds: string[]
  defaultMessageRequestRestricted: boolean
  dropsOptedOut: boolean
  allowGameFriendDmsInDiscord: boolean
  defaultGuildsRestrictedV2: boolean | null
  /** 0 unset, 1 share in all servers, 2 only in servers of 200 or fewer, 3 in none. */
  defaultGuildsActivityRestrictedV2: number
  quests3pDataOptedOut: boolean
  /** Your messages in Discoverable channels kept off Discord's server web pages (Data & Privacy). */
  swpMessagePromotionOptedOut: boolean
  /** When a status chosen for a while goes back to Online (ms since 1970); null when it's for good. */
  statusExpiresAtMs: number | null
  /** 0 unset (friends and all servers), 1 friends only, 2 friends and small servers, 3 friends and all servers. */
  profileVisibility: number
  hideFriendRequestNotes: boolean
  showCurrentGame: boolean
  locale: string
  developerMode: boolean
  /** 0 auto, 1 12-hour, 2 24-hour. */
  timestampHourCycle: number
  /** User Volume (0-200, 100 as they send) and Mute in calls, for each person changed from that. */
  audioUsers: Record<string, AudioUser>
  /** Stream Volume and Mute for each person's Go Live sound changed from 100 and unmuted. */
  audioStreams: Record<string, AudioUser>
  /** The custom status (null: none), until expiresAtMs when it clears itself. */
  customStatus: CustomStatus | null
}

/** A custom status as Discord keeps it: its words, an emoji (a server one's id with its name, or a Unicode one). */
export type CustomStatus = { text: string; emojiId: string | null; emojiName: string | null; expiresAtMs: number | null }

export type AudioUser = { muted: boolean; volume: number }

/** The account as My Account and Profiles show it (the email and phone number come masked). */
export type DiscordAccount = {
  id: string
  username: string | null
  globalName: string | null
  avatar: string | null
  banner: string | null
  accentColor: number | null
  bio: string
  pronouns: string
  email: string | null
  phone: string | null
  verified: boolean
  mfa: boolean
  nsfwAllowed: boolean
  premium: boolean
}

export type DiscordAccountAction = 'me' | 'name' | 'profile' | 'avatar' | 'banner' | 'consent' | 'setConsent' | 'sessions' | 'logoutSessions' | 'apps' | 'deauthorize' | 'connections' | 'tags' | 'setTag'

/** What Exo keeps for its Discord client (Voice & Video, Keybinds, Notifications, Sounds). */
export type DiscordClientSettings = {
  inputProfile: 'exo' | 'custom'
  noiseSuppression: boolean
  noiseSuppressionKind?: 'exo' | 'ai' | 'standard'
  /** The same on everyone else's voice in a call, each their own; off by default. */
  othersNoiseSuppression: boolean
  /** Only My Voice: voices that aren't the learned one are held back in calls (needs myVoiceLearned). */
  onlyMyVoice: boolean
  /** Whether Exo has learned this user's voice (from the live meter); read-only. */
  myVoiceLearned?: boolean
  /** How many seconds of the user's speech the voiceprint is from: the teach, then what calls added. */
  myVoiceSeconds?: number
  /** Each person's voice in a call brought toward one speaking level, for you; on by default. */
  evenVoices: boolean
  /** Exo's echo cancellation, which runs only on speakers that aren't on your head. */
  echoCancellation: boolean
  /** Exo's own gate, leveler and limiter after noise suppression (Custom; Voice Isolation always has it). */
  voiceFocus: boolean
  pushToTalk: boolean
  pttDelay: number
  autoSensitivity: boolean
  sensitivity: number
  attenuation: number
  attenuateSelf: boolean
  attenuateOthers: boolean
  keybinds: DiscordKeybind[]
  desktopNotifications: boolean
  unreadBadge: boolean
  taskbarFlash: boolean
  disabledSounds: string[]
  disableAllSounds: boolean
  selectedChannelSound: boolean
  /** How loud all of Discord's sounds play, 0-100%. */
  soundVolume: number
}

/** One keybind: an action and the Windows virtual-key codes held together. */
export type DiscordKeybind = { action: string; keys: number[] }

export type DiscordSession = { idHash: string | null; os: string | null; platform: string | null; location: string | null; lastUsed: string | null; current: boolean }
export type DiscordAuthorizedApp = { id: string; name: string | null; description: string | null; icon: string | null; scopes: string[] }
export type DiscordConnection = { type: string | null; name: string | null; verified: boolean; revoked: boolean; visible: boolean }

const ACCOUNT_DEFAULTS: AccountSettings = {
  streamNotificationsEnabled: true, renderSpoilers: 'ON_CLICK', viewImageDescriptions: false, inlineAttachmentMedia: true,
  inlineEmbedMedia: true, gifAutoPlay: true, renderEmbeds: true, renderReactions: true, animateEmoji: true, animateStickers: 0,
  enableTtsCommand: true, messageDisplayCompact: false, explicitContentFilter: 1, viewNsfwGuilds: false, convertEmoticons: true,
  viewNsfwCommands: false, dmSpamFilterV2: 0, includeStickersInAutocomplete: false, explicitContentGuilds: 0,
  explicitContentFriendDm: 0, explicitContentNonFriendDm: 0, goreContentGuilds: 0, goreContentFriendDm: 0,
  goreContentNonFriendDm: 0, includeGameMentionsInAutocomplete: true, displayCompactAvatars: false, reactionNotifications: 0,
  enableFriendOnlineNotifications: true, enableFriendAnniversaryNotifications: true, enableProfileUpdatesNotifications: true,
  notifyFriendsOnProfileUpdate: true, notifyFriendsOnComeOnline: true, notifyServerMembersOnGoLive: true,
  allowActivityPartyPrivacyFriends: true, allowActivityPartyPrivacyVoiceChannel: true, restrictedGuildIds: [],
  defaultGuildsRestricted: false, friendSourceFlags: 14, defaultGuildsActivityRestricted: 0, messageRequestRestrictedGuildIds: [],
  activityRestrictedGuildIds: [], activityJoiningRestrictedGuildIds: [],
  defaultMessageRequestRestricted: false, dropsOptedOut: false, allowGameFriendDmsInDiscord: true, defaultGuildsRestrictedV2: null,
  defaultGuildsActivityRestrictedV2: 0, quests3pDataOptedOut: false, swpMessagePromotionOptedOut: false, statusExpiresAtMs: null, profileVisibility: 0, hideFriendRequestNotes: false,
  showCurrentGame: true, locale: '', developerMode: false, timestampHourCycle: 0, audioUsers: {}, audioStreams: {}, customStatus: null,
}

let account: AccountSettings = ACCOUNT_DEFAULTS
const accountListeners = new Set<() => void>()
// Changes still being saved: what Discord sends meanwhile doesn't flip them back on screen.
const savingAccount = new Set<Partial<AccountSettings>>()

function setAccount(values: Partial<AccountSettings> | null | undefined) {
  if (!values) return
  account = Object.assign({ ...ACCOUNT_DEFAULTS, ...values }, ...savingAccount) as AccountSettings
  accountListeners.forEach(listener => listener())
}

/** Reads the account's settings from Discord (once per room, and when Discord settings opens). */
export function loadAccountSettings() {
  void host.discordUserSettings().then(result => { if (result.ok) setAccount(result.values) }).catch(() => { })
}

/** Keeps the settings current when another Discord app changes them; returns the unsubscribe. */
export function watchAccountSettings() {
  return onHostEvent('discord.userSettings', values => setAccount(values as Partial<AccountSettings>))
}

/** A person's User Volume or Mute in calls: heard and on screen at once; Exo saves it to the account as Discord does. */
export function setAudioUser(userId: string, change: Partial<AudioUser>, stream = false) {
  const key = stream ? 'audioStreams' : 'audioUsers'
  const was = account[key][userId] ?? { muted: false, volume: 100 }
  account = { ...account, [key]: { ...account[key], [userId]: { ...was, ...change } } }
  accountListeners.forEach(listener => listener())
  void host.discordVoice('user', { userId, ...change, ...(stream ? { stream } : {}) }).catch(() => { })
}

/** Saves account settings: on screen at once, then as Discord saved them (or back, with Discord's reason). */
export async function changeAccountSettings(changes: Partial<AccountSettings>): Promise<string | null> {
  // Only this change's own settings go back if it fails, never another one's.
  const before = Object.fromEntries(Object.keys(changes).map(key => [key, account[key as keyof AccountSettings]])) as Partial<AccountSettings>
  savingAccount.add(changes)
  account = { ...account, ...changes }
  accountListeners.forEach(listener => listener())
  let message: string
  try {
    const result = await host.discordUserSettings(changes)
    savingAccount.delete(changes)
    if (result.ok) { setAccount(result.values); return null }
    message = result.message ?? "Discord didn't save that. Try again."
  } catch {
    savingAccount.delete(changes)
    message = "Discord didn't save that. Try again."
  }
  // A newer change to the same setting, still saving, stays on screen.
  account = Object.assign({ ...account, ...before }, ...savingAccount) as AccountSettings
  accountListeners.forEach(listener => listener())
  return message
}

function subscribeAccount(listener: () => void) {
  accountListeners.add(listener)
  return () => { accountListeners.delete(listener) }
}

/** The account's settings, live. */
export function useAccountSettings(): AccountSettings {
  return useSyncExternalStore(subscribeAccount, () => account)
}

/** One of the account's settings, live: only a change to it redraws (a User Volume dragged in a call left every message
    in the chat redrawing on each step). */
export function useAccountSetting<K extends keyof AccountSettings>(key: K): AccountSettings[K] {
  return useSyncExternalStore(subscribeAccount, () => account[key])
}

/** The account's settings now, for code that draws without a hook (markdown); the message around it re-renders on change. */
export function accountSettings(): AccountSettings {
  return account
}

/** Settings Discord keeps per device, kept on this PC. */
export type DiscordPrefs = {
  /** Text size in chat, px (Discord's 12, 14, 15, 16, 18, 20, 24). */
  fontSize: number
  /** Space Between Message Groups, px (0, 4, 8, 16, 24); null is Discord's default for the display (16 cozy, 0 compact), drawn as Exo draws it. */
  groupSpacing: number | null
  /** Zoom level, percent (Discord's 50 to 200). */
  zoom: number
  /** Saturation, 0 to 1. */
  saturation: number
  desaturateUserColors: boolean
  roleStyle: 'username' | 'dot' | 'hidden'
  underlineLinks: boolean
  ttsRate: number
  streamerMode: boolean
  streamerHidePersonal: boolean
  streamerHideInvites: boolean
  streamerDisableSounds: boolean
  streamerDisableNotifications: boolean
  /** The camera for video calls (a browser device id), or the default. */
  cameraId: string | null
}

const PREFS_DEFAULTS: DiscordPrefs = {
  fontSize: 16, groupSpacing: null, zoom: 100, saturation: 1, desaturateUserColors: false, roleStyle: 'username',
  underlineLinks: false, ttsRate: 1, streamerMode: false, streamerHidePersonal: true, streamerHideInvites: true,
  streamerDisableSounds: true, streamerDisableNotifications: true, cameraId: null,
}

const PREFS_KEY = 'exo.discordPrefs'
const prefsListeners = new Set<() => void>()
let prefs: DiscordPrefs = readPrefs()

function readPrefs(): DiscordPrefs {
  try { return { ...PREFS_DEFAULTS, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<DiscordPrefs>) } } catch { return PREFS_DEFAULTS }
}

export function discordPrefs(): DiscordPrefs {
  return prefs
}

export function setDiscordPrefs(change: Partial<DiscordPrefs>) {
  prefs = { ...prefs, ...change }
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* this session only */ }
  prefsListeners.forEach(listener => listener())
  if (Object.keys(change).some(key => key.startsWith('streamer'))) syncStreamerMode()
}

function subscribePrefs(listener: () => void) {
  prefsListeners.add(listener)
  return () => { prefsListeners.delete(listener) }
}

export function useDiscordPrefs(): DiscordPrefs {
  return useSyncExternalStore(subscribePrefs, discordPrefs)
}

function subscribeLook(listener: () => void) {
  const offPrefs = subscribePrefs(listener)
  const offAccount = subscribeAccount(listener)
  const offScale = onTextScale(listener)
  return () => { offPrefs(); offAccount(); offScale() }
}

let look: { key: string; value: RoomLook } | null = null
type RoomLook = { style: CSSProperties } & Record<`data-${string}`, string | undefined>

// The room's look as attributes and variables (discord-settings.css applies them), the same object while nothing changed.
function roomLook(): RoomLook {
  const a = account
  const p = prefs
  const key = [a.messageDisplayCompact, a.displayCompactAvatars, p.zoom, p.fontSize, p.groupSpacing, p.saturation, p.desaturateUserColors, p.roleStyle, p.underlineLinks, textScale()].join()
  if (look?.key === key) return look.value
  const value: RoomLook = {
    style: {
      zoom: p.zoom === 100 ? undefined : p.zoom / 100,
      '--exo-dc-chat-scale': textScale() * (p.fontSize / 16),
      '--exo-dc-group-gap': p.groupSpacing === null ? undefined : `${p.groupSpacing}px`,
      '--exo-dc-saturation': p.saturation,
    } as CSSProperties,
    'data-compact': a.messageDisplayCompact ? (a.displayCompactAvatars ? 'avatars' : 'true') : undefined,
    'data-saturation': p.saturation < 1 ? (p.desaturateUserColors ? 'all' : 'ui') : undefined,
    'data-role-style': p.roleStyle === 'username' ? undefined : p.roleStyle,
    'data-underline-links': p.underlineLinks ? 'true' : undefined,
  }
  look = { key, value }
  return value
}

/** The Discord room's attributes for Accessibility and Appearance: compact messages, chat text size, spacing, zoom, saturation, role colors, link underlines. */
export function useRoomLook(): RoomLook {
  return useSyncExternalStore(subscribeLook, roomLook)
}

/** Streamer Mode as it applies right now: whether to hide personal information and invite links. */
export function useStreamerHides(): { personal: boolean; invites: boolean } {
  const p = useDiscordPrefs()
  return { personal: p.streamerMode && p.streamerHidePersonal, invites: p.streamerMode && p.streamerHideInvites }
}

// The host shows notifications and plays Discord's sounds, so it hears what Streamer Mode silences.
function syncStreamerMode() {
  void host.discordClientSettings({
    streamerQuiet: prefs.streamerMode && prefs.streamerDisableNotifications,
    streamerSilent: prefs.streamerMode && prefs.streamerDisableSounds,
  }).catch(() => { })
}

/**
 * What the room does for Discord settings while it's open: keeps the account's settings current,
 * tells the host about Streamer Mode and reads /tts messages out. Returns the cleanup.
 */
export function startDiscordSettings() {
  loadAccountSettings()
  syncStreamerMode()
  const offs = [
    watchAccountSettings(),
    onHostEvent('discord.tts', event => speak(event.name, event.text)),
  ]
  return () => offs.forEach(off => off())
}

/**
 * What Discord does wherever you are in Exo (the shell's, always mounted, so it goes on outside the room): Camera On
 * and Off, and the Toggle Streamer Mode keybind. Returns the cleanup.
 */
export function startDiscordShell() {
  // Saved Streamer Mode reaches the host at start, not only once the Discord room has been opened.
  syncStreamerMode()
  const offs = [
    onHostEvent('discord.camera', event => {
      if (event.state === 'live' || event.state === 'off') void host.discordSound(event.state === 'live' ? 'camera_on' : 'camera_off').catch(() => { })
    }),
    onHostEvent('discord.keybind', event => { if (event.action === 'TOGGLE_STREAMER_MODE') setDiscordPrefs({ streamerMode: !prefs.streamerMode }) }),
    // Everyone's User Volume and Mute show on the Exo Island's call faces too.
    watchAccountSettings(),
  ]
  return () => offs.forEach(off => off())
}

/** How chat shows an attachment or embed: as it is, blurred until clicked, or not at all. */
export type MediaFilter = 'show' | 'blur' | 'block'
type MediaPlace = 'guild' | 'friendDm' | 'dm'

// Discord's flags on a scanned attachment or embed (MessageAttachmentFlags, October 2026).
const EXPLICIT_MEDIA = 16, GORE_CONTENT = 64
const FILTERS: MediaFilter[] = ['show', 'show', 'blur', 'block']
const STRICTNESS: Record<MediaFilter, number> = { show: 0, blur: 1, block: 2 }

// One of Discord's sensitive media settings (0 unset, 1 show, 2 blur, 3 block); unset is Discord's own default for an
// adult account: shown in servers and from friends, blocked in other DMs.
function filterOf(value: number, where: MediaPlace): MediaFilter {
  if (value >= 1 && value <= 3) return FILTERS[value]
  return where === 'dm' ? 'block' : 'show'
}

/**
 * Settings > Content & Social's sensitive media filters as they apply to one attachment or embed: its Discord flags
 * (explicit media, gore) against Mature and Graphic content for where it was posted (a server, a friend's DM, another
 * DM). The stricter filter wins when both flags are set; unflagged media always shows.
 */
export function mediaFilter(flags: number | null | undefined, where: MediaPlace, settings: AccountSettings = account): MediaFilter {
  const f = flags ?? 0
  const explicit = (f & EXPLICIT_MEDIA) === 0 ? 'show' : filterOf(
    where === 'guild' ? settings.explicitContentGuilds : where === 'friendDm' ? settings.explicitContentFriendDm : settings.explicitContentNonFriendDm, where)
  const gore = (f & GORE_CONTENT) === 0 ? 'show' : filterOf(
    where === 'guild' ? settings.goreContentGuilds : where === 'friendDm' ? settings.goreContentFriendDm : settings.goreContentNonFriendDm, where)
  return STRICTNESS[gore] > STRICTNESS[explicit] ? gore : explicit
}

// A /tts message in the conversation on screen, read out as Discord does ("name said text"), at the chosen rate.
function speak(name: string, text: string) {
  if (!account.enableTtsCommand || !text || (prefs.streamerMode && prefs.streamerDisableSounds) || !('speechSynthesis' in window)) return
  const utterance = new SpeechSynthesisUtterance(`${name} said ${text}`)
  utterance.rate = prefs.ttsRate
  window.speechSynthesis.speak(utterance)
}

/** Discord's emoticons (its own list) and the emoji each becomes when Automatically convert emoticons is on. */
const EMOTICONS: Record<string, string> = {
  '😠': '>:( >:-( >=( >=-(', '😊': ':") :-") =") =-")', '💔': '</3 <\\3', '😕': ':-\\ :-/ =-\\ =-/',
  '😢': ":'( :'-( :,( :,-( ='( ='-( =,( =,-(", '🙁': ':( :-( =( =-(', '❤️': '<3 ♡', '👿': ']:( ]:-( ]=( ]=-(',
  '😇': 'o:) O:) o:-) O:-) 0:) 0:-) o=) O=) o=-) O=-) 0=) 0=-)', '😂': ":'D :'-D :,D :,-D ='D ='-D =,D =,-D",
  '😗': ':* :-* =* =-*', '😆': 'x-) X-)', '😐': ':| :-| =| =-|', '😮': ':o :-o :O :-O =o =-o =O =-O', '😡': ':@ :-@ =@ =-@',
  '😄': ':D :-D =D =-D', '🥲': ":') :'-) :,) :,-) =') ='-) =,) =,-)", '🙂': ':) :-) =) =-)', '😈': ']:) ]:-) ]=) ]=-)',
  '😭': ":,'( :,'-( ;( ;-( =,'( =,'-(", '😛': ':P :-P =P =-P', '😎': '8-) B-)', '😓': ',:( ,:-( ,=( ,=-(',
  '😅': ',:) ,:-) ,=) ,=-)', '😒': ':s :-S :z :-Z :$ :-$ =s =-S =z =-Z =$ =-$', '😉': ';) ;-)',
}
const EMOTICON = new Map(Object.entries(EMOTICONS).flatMap(([emoji, list]) => list.split(' ').map(text => [text, emoji] as const)))

/** A message with its emoticons turned into emoji, Discord's way: only whole words, never inside code. */
export function convertEmoticons(text: string): string {
  if (text.includes('`')) return text
  return text.split(/(\s+)/).map(word => EMOTICON.get(word) ?? word).join('')
}

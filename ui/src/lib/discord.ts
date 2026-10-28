/** Exo's own Discord client: what the host's DiscordSession hands the room. Messages are Discord's own shape. */
import type { AppComponent } from './discordApps'

export type DiscordState = 'off' | 'signedOut' | 'connecting' | 'ready' | 'error'
export type DiscordStatus = { state: DiscordState; message?: string | null; signedIn: boolean }
export type DiscordSignInStep = {
  state: 'waiting' | 'scanned' | 'done' | 'error' | 'expired' | 'cancelled'
  url?: string | null
  user?: string | null
  message?: string | null
}

/** A message saved for later (Discord's saved messages): the message, and when it was saved and (a reminder) is due. */
export type DiscordSavedMessage = {
  message: DiscordMessage | null
  save_data: { channel_id: string; message_id: string; saved_at: string; due_at?: string | null; author_summary?: string | null; channel_summary?: string | null; message_summary?: string | null }
}

/** A role's icon beside a name: its picture, or a Unicode emoji, and the role's name. */
export type DiscordRoleIcon = { name: string; url?: string | null; emoji?: string | null }

/** Someone you blocked or ignored, for Ignore & Block. */
export type DiscordRestricted = { id: string; name: string; username?: string | null; avatar?: string | null }

/** call: who is in the DM's call now, when one is on. */
export type DiscordDmMember = { id: string; name: string; username?: string | null; avatar: string | null; status: string }
export type DiscordDm = { id: string; name: string; avatar: string | null; look?: DiscordLook | null; group: boolean; ownerId?: string | null; members?: DiscordDmMember[] | null; unread: boolean; mentions: number; muted?: boolean; mutedUntil?: number | null; status?: string | null; userId?: string | null; username?: string | null; recipients?: string[]; subtitle?: string | null; call?: DiscordVoiceMember[] | null
  /** A message request (from someone you aren't friends with), or one Discord filed as spam: under Message Requests until accepted. */
  request?: boolean
  spam?: boolean
}
export type DiscordGuild = {
  id: string; name: string; icon: string | null; muted: boolean; unread: boolean; mentions: number
  /** How many people are in its voice channels you can see. */
  inVoice?: number
  /** When a timed mute ends (ms). */
  mutedUntil?: number | null
  /** Notification Settings: 0 all messages, 1 only @mentions, 2 nothing. */
  notify?: number
  suppressEveryone?: boolean
  suppressRoles?: boolean
  /** Notification Settings' Suppress Highlights, Mute New Events and Mobile Push Notifications. */
  suppressHighlights?: boolean
  muteEvents?: boolean
  mobilePush?: boolean
  /** You own it: no Leave Server. */
  owner?: boolean
}
/**
 * One item of the server list, as Discord keeps it (guild_folders): a folder (id set, its color an RGB number), or one
 * server alone (no id). The host leaves out what is null, so a missing field reads as null.
 */
export type DiscordRailItem = { id?: string | null; name?: string | null; color?: number | null; guildIds: string[] }
export type DiscordHome = { me: { id: string; name: string; avatar: string | null; status?: string | null; look?: DiscordLook | null } | null; dms: DiscordDm[]; guilds: DiscordGuild[]; rail?: DiscordRailItem[]; blocked?: string[]; ignored?: string[] }

/**
 * Where a dragged server or folder lands in the rail, as Discord's SortedGuildStore moves it: before an item (a server
 * in a folder too), after the last one, or into one (a folder, or a server alone, which becomes a new folder of both).
 * Node keys are server ids and `folder:<id>`.
 */
export type RailDrop = { kind: 'before' | 'after' | 'into'; target: string }

/** The server list after a drop; null when Discord wouldn't take it (a folder into a folder, onto a server, or onto itself). */
export function moveInRail(rail: DiscordRailItem[], source: string, drop: RailDrop): DiscordRailItem[] | null {
  const next = rail.map(item => ({ ...item, guildIds: [...item.guildIds] }))
  const isFolder = (key: string) => key.startsWith('folder:')
  const holder = (key: string) => next.find(item => isFolder(key) ? item.id === key.slice(7) : item.guildIds.includes(key))
  const from = holder(source)
  const to = holder(drop.target)
  if (!from || !to || source === drop.target) return null
  const inFolder = !isFolder(drop.target) && to.id != null
  if ((isFolder(source) || drop.kind === 'into') && inFolder) return null
  if (isFolder(source) && drop.kind === 'into') return null
  // Lift the source out: a folder whole, or a server alone or out of its folder (a folder left empty goes).
  let lifted = from
  if (isFolder(source)) next.splice(next.indexOf(from), 1)
  else {
    from.guildIds.splice(from.guildIds.indexOf(source), 1)
    lifted = { id: null, name: null, color: null, guildIds: [source] }
  }
  const after = drop.kind === 'after' ? 1 : 0
  if (drop.kind === 'into') {
    // Onto a server alone: it becomes a folder of both, as Discord's convertToFolder makes one.
    if (to.id == null) to.id = newFolderId(rail)
    to.guildIds.push(source)
  } else if (inFolder) to.guildIds.splice(to.guildIds.indexOf(drop.target) + after, 0, source)
  else next.splice(next.indexOf(to) + after, 0, lifted)
  return next.filter(item => item.guildIds.length > 0)
}

/** Move to's places for a server: the top or foot of its folder or of the list, or out of its folder (just after it). */
export type ServerMove = 'folderFirst' | 'folderLast' | 'listFirst' | 'listLast' | 'noFolder'

/** The server list with a server moved by Move to, or null when it is there already. */
export function moveServer(rail: DiscordRailItem[], guildId: string, to: ServerMove): DiscordRailItem[] | null {
  const folder = rail.find(item => item.id != null && item.guildIds.includes(guildId))
  const keyOf = (item: DiscordRailItem) => item.id != null ? `folder:${item.id}` : item.guildIds[0]
  const drop: RailDrop | null = to === 'listFirst' && rail.length ? { kind: 'before', target: keyOf(rail[0]) }
    : to === 'listLast' && rail.length ? { kind: 'after', target: keyOf(rail[rail.length - 1]) }
    : to === 'folderFirst' && folder ? { kind: 'before', target: folder.guildIds[0] }
    : to === 'folderLast' && folder ? { kind: 'after', target: folder.guildIds[folder.guildIds.length - 1] }
    : to === 'noFolder' && folder ? { kind: 'after', target: `folder:${folder.id}` }
    : null
  const next = drop ? moveInRail(rail, guildId, drop) : null
  return next && railShape(next) !== railShape(rail) ? next : null
}

/** The list's order and folders alone, to tell whether a drop changes anything. */
export const railShape = (rail: DiscordRailItem[]) => JSON.stringify(rail.map(item => [item.id ?? null, item.guildIds]))

// Discord's new folder id: a random 32-bit number no other folder has.
function newFolderId(rail: DiscordRailItem[]) {
  let id: string
  do id = String(Math.floor(Math.random() * 0x100000000)); while (rail.some(item => item.id === id))
  return id
}

export type DiscordChannel = {
  id: string
  name: string
  type: number
  kind: 'text' | 'voice' | 'forum' | 'category'
  topic?: string | null
  /** Seconds between your messages (0 or absent: none, or you're exempt). */
  slowmode?: number
  canRead?: boolean
  canSend?: boolean
  muted?: boolean
  /** When a timed mute ends (ms). */
  mutedUntil?: number | null
  /** Its own notification setting (0 all, 1 mentions, 2 nothing; null: as its category or server), and what that level above is. */
  notify?: number | null
  notifyDefault?: number
  unread?: boolean
  mentions?: number
  canConnect?: boolean
  /** Moderation here: delete others' messages, pin, and Edit Channel. */
  canManageMessages?: boolean
  canPin?: boolean
  canEdit?: boolean
  members?: DiscordVoiceMember[] | null
  /** A voice channel's user limit (absent: none). */
  userLimit?: number | null
  /** A voice channel's status (Set Channel Status), and whether you may set it once in the channel. */
  status?: string | null
  canSetStatus?: boolean
  /** A category the user collapsed (kept in their Discord settings). */
  collapsed?: boolean
  /** A Server Guide resource (Discord lists it in the guide, not the channel lists). */
  resource?: boolean
  /** A DM: the other person, as its header and profile panel show them. */
  dm?: { userId: string | null; avatar: string | null; status: string | null; username: string | null; group: boolean; request?: boolean; spam?: boolean
    /** A group's owner and members (you aside). */
    ownerId?: string | null; members?: DiscordDmMember[] | null }
  /** The server's rules channel (Discord gives it its own icon). */
  rules?: boolean
  /** Followed in Browse Channels (itself or its category). */
  optedIn?: boolean
  /** @everyone can't view it: opt-in mode always lists it. */
  private?: boolean
  /** The server's AFK channel. */
  afk?: boolean
  /** Discord's lock on its icon: @everyone can't view it (or, for voice, can't join it). */
  locked?: boolean
  /** When its last message was sent (ms). */
  active?: number | null
}
export type DiscordVoiceMember = { id: string; name: string; avatar: string | null; look?: DiscordLook | null; mute: boolean; deaf: boolean; video?: boolean; stream?: boolean; serverMute?: boolean; serverDeaf?: boolean }
/** message: why the call ended on its own (a join Discord never answered, a connection that gave up). */
export type DiscordVoice = { state: 'off' | 'connecting' | 'connected'; guildId: string | null; channelId: string | null; muted: boolean; deafened: boolean; e2ee: boolean; micSilent?: boolean
  /** Only My Voice held back the user's own speech and stopped holding back for this call. */
  myVoiceStopped?: boolean; message?: string | null; ringing?: string | null; recorded?: boolean }
export type DiscordChannels = {
  name: string | null
  channels: DiscordChannel[]
  icon?: string | null
  /** Manage Channels: the + on categories. */
  canManage?: boolean
  canManageEvents?: boolean
  /** Scheduled events not over yet. */
  events?: number
  /** Hide Muted Channels: the sidebar leaves muted channels out. */
  hideMuted?: boolean
  /** Discord's feature flags (COMMUNITY, GUILD_SERVER_GUIDE, ...). */
  features?: string[]
  /** Opt-in mode: the sidebar lists only followed channels. */
  optIn?: boolean
  /** The server's banner hash, over the top of the channel list. */
  banner?: string | null
  /** Discord's rows over the channels this server has. */
  rows?: { guide: boolean; events: boolean; browse: boolean; members: boolean }
  /** What this user may do in Server Settings and to members. */
  moderation?: DiscordModeration
  /** Threads Exo knows here: a notification or a jump to one opens it in its channel. */
  threads?: { id: string; name: string; parentId: string; locked: boolean; joined?: boolean; archived?: boolean; unread?: boolean; mentions?: number; muted?: boolean }[]
  /** The server's roles by id, for role mentions. */
  roles?: Record<string, { name: string; color: string | null }>
}
/** Where a message is: its channel's name, its server, and a thread's parent channel. */
export type DiscordPlace = { name: string; guildId: string | null; guild: string | null; parentId: string | null }
export type DiscordModeration = {
  kick: boolean; ban: boolean; manageGuild: boolean; auditLog: boolean; manageRoles: boolean; timeout: boolean
  manageChannels: boolean; manageExpressions: boolean; manageWebhooks: boolean; manageNicknames: boolean; prune: boolean; owner: boolean
  /** Administrator (owners too): Server Discovery on or off. */
  administrator?: boolean
  /** View Server Insights. */
  insights?: boolean
  /** The account itself has 2FA on (an owner needs it to require 2FA of moderators). */
  mfa: boolean
}
/** An invite as a message's invite card shows it: the server (name only for a group DM), its counts, and whether you're in it. */
export type DiscordInvite = {
  guildId: string | null
  channelId: string | null
  name: string | null
  icon: string | null
  verified: boolean
  partnered: boolean
  online: number | null
  members: number | null
  joined: boolean
}

export type DiscordGuide = {
  welcome_message?: { message?: string } | null
  new_member_actions?: { channel_id: string; title: string; description?: string; emoji?: { name?: string | null } | null }[]
  resource_channels?: { channel_id: string; title: string; description?: string; emoji?: { name?: string | null } | null }[]
}
export type DiscordMemberRow = {
  member: { user: DiscordUser; nick?: string | null; roles: string[]; joined_at: string }
  join_source_type?: number
  source_invite_code?: string | null
}
export type DiscordResource = { channelId: string; title: string | null; description?: string | null; icon?: string | null; preview?: DiscordMessage | null }
export type DiscordMemberSearch = { members: DiscordMemberRow[]; total_result_count?: number }
export type DiscordRole = { name: string; color: string | null; position: number }
export type DiscordEvent = {
  id: string
  channel_id?: string | null
  name: string
  description?: string | null
  scheduled_start_time: string
  scheduled_end_time?: string | null
  status: number
  user_count?: number
  entity_metadata?: { location?: string } | null
}

/** Discord's own collectible fields on a user or server member. */
export type DiscordCollectibleFields = {
  avatar_decoration_data?: { asset: string; sku_id?: string | null } | null
  collectibles?: { nameplate?: { sku_id: string; asset?: string | null; palette?: string | null } | null } | null
  display_name_styles?: { font_id: number; effect_id: number; colors: number[] } | null
  /** Their server tag: the server they chose to represent, while its identity is on. */
  primary_guild?: { identity_guild_id: string | null; identity_enabled: boolean | null; tag: string | null; badge: string | null } | null
}
/** A server's public profile, as Discord's tag card shows it (GET guilds/{id}/profile). */
export type DiscordGuildProfile = {
  id: string
  name: string
  icon_hash?: string | null
  description?: string | null
  member_count?: number | null
  online_count?: number | null
  tag?: string | null
  badge_hash?: string | null
  traits?: { emoji_id?: string | null; emoji_name?: string | null; label: string; position: number }[] | null
}
/** Someone's collectibles as the room draws them: the host's look on its lists, or lookOf a user and member. */
export type DiscordLook = {
  decoration?: { asset: string; skuId?: string | null } | null
  nameplate?: { skuId: string; asset?: string | null; palette?: string | null } | null
  nameStyle?: { font: number; effect: number; colors: number[] } | null
  /** Their server tag and badge, beside their name as Discord shows it. */
  tag?: { guildId: string; tag: string; badge: string | null } | null
}
/** A profile effect's item in Discord's Shop (camelCase, as Discord sends it): its layers, timed in ms on a 450 px wide canvas. */
export type DiscordEffectItem = {
  type: 1
  sku_id: string
  title?: string
  accessibilityLabel?: string | null
  reducedMotionSrc?: string | null
  thumbnailPreviewSrc?: string | null
  staticFrameSrc?: string | null
  animationType?: number
  effects: { src: string; loop: boolean; start: number; duration: number; loopDelay: number; zIndex?: number; position?: { x: number; y: number } | null; randomizedSources?: { src: string }[] | null }[]
}

/** A price in Discord's Shop (amount in the currency's smallest unit). Prices are keyed by premium type: 0 without Nitro, 2 with. */
export type DiscordShopPrices = Record<string, { country_prices: { country_code: string; prices: { amount: number; currency: string; exponent: number }[] } }>
/** One collectible in a product: a decoration (0), profile effect (1), nameplate (2) or profile frame (3). */
export type DiscordShopItem = { type: number; sku_id: string; asset?: string; label?: string; palette?: string } & Partial<Omit<DiscordEffectItem, 'type' | 'sku_id'>>
/** A product in Discord's Shop, or one the account owns (purchased_at, expires_at). Type 1000 is a bundle; 2000 has variants. */
export type DiscordShopProduct = {
  sku_id: string; name: string; summary?: string; type: number; premium_type?: number; prices?: DiscordShopPrices; items?: DiscordShopItem[]
  bundled_products?: DiscordShopProduct[]; variants?: DiscordShopProduct[]; purchased_at?: string | null; expires_at?: string | null
  /** Discord's backdrop for it: two colors, top to bottom, behind its preview. */
  styles?: { background_colors?: number[] } | null
}
export type DiscordShopCategory = { sku_id: string; name: string; summary?: string; products: DiscordShopProduct[]; logo?: string; banner?: string; unpublished_at?: string | null }
export type DiscordShopCatalog = { categories: DiscordShopCategory[] }
/** A payment method saved on the account, as the checkout lists it; usable: a valid card Exo can pay with. */
export type DiscordPaymentChoice = { id: string; label: string; expires: string | null; default: boolean; usable: boolean }
/** Discord's price for buying a SKU with a payment method (smallest unit of the currency), tax included in amount. */
export type DiscordShopPrice = { amount: number | null; subtotal: number | null; tax: number | null; currency: string | null; taxInclusive: boolean }

export type DiscordUser = { id: string; username: string; global_name?: string | null; avatar?: string | null; bot?: boolean } & DiscordCollectibleFields
export type DiscordAttachment = {
  id: string
  filename: string
  /** Its image description (alt text), when the sender wrote one. */
  description?: string | null
  url: string
  proxy_url?: string
  size: number
  width?: number | null
  height?: number | null
  content_type?: string
  /** Discord's attachment flags: 8 marks a spoiler, 16 explicit content Discord detected. */
  flags?: number
  /** A voice message: its length and Discord's waveform (base64, one byte per sample). */
  duration_secs?: number
  waveform?: string
}
type EmbedMedia = { url?: string; proxy_url?: string; width?: number; height?: number }
export type DiscordEmbed = {
  type?: string
  title?: string
  description?: string
  url?: string
  color?: number
  author?: { name?: string; url?: string; icon_url?: string; proxy_icon_url?: string }
  provider?: { name?: string }
  footer?: { text?: string; icon_url?: string; proxy_icon_url?: string }
  /** When the embed says it's from (shown after its footer). */
  timestamp?: string
  fields?: { name: string; value: string; inline?: boolean }[]
  image?: EmbedMedia
  thumbnail?: EmbedMedia
  video?: EmbedMedia
  /** Exo's, not Discord's: the pictures of the embeds sharing this one's link (a post with several), merged as Discord does. */
  images?: EmbedMedia[]
}
export type DiscordPoll = {
  question: { text?: string }
  answers: { answer_id: number; poll_media: { text?: string; emoji?: { id?: string | null; name?: string | null } } }[]
  expiry?: string | null
  allow_multiselect?: boolean
  results?: { is_finalized?: boolean; answer_counts?: { id: number; count: number; me_voted: boolean }[] }
}

/** A poll with one vote added or taken back (someone's, or yours). */
export function applyPollVote(poll: DiscordPoll, answerId: number, add: boolean, me: boolean): DiscordPoll {
  const counts = [...(poll.results?.answer_counts ?? [])]
  const at = counts.findIndex(c => c.id === answerId)
  const was = at >= 0 ? counts[at] : { id: answerId, count: 0, me_voted: false }
  const next = { ...was, count: Math.max(0, was.count + (add ? 1 : -1)), me_voted: me ? add : was.me_voted }
  if (at >= 0) counts[at] = next
  else counts.push(next)
  return { ...poll, results: { ...poll.results, answer_counts: counts } }
}

export type DiscordMessage = {
  id: string
  channel_id: string
  type: number
  author: DiscordUser
  member?: { nick?: string | null } & DiscordCollectibleFields
  content: string
  timestamp: string
  edited_timestamp?: string | null
  attachments: DiscordAttachment[]
  embeds: DiscordEmbed[]
  sticker_items?: { id: string; name: string; format_type: number }[]
  /** A poll: its question and answers, when it ends, and the counts (with your own votes). */
  poll?: DiscordPoll | null
  /** A call's message: who joined and when it ended. */
  call?: { participants: string[]; ended_timestamp?: string | null } | null
  mentions: DiscordUser[]
  mention_everyone?: boolean
  mention_roles?: string[]
  referenced_message?: DiscordMessage | null
  /** The message this one points to (a reply's, a poll result's poll; type 1 is a forward's source). */
  message_reference?: { type?: number; message_id?: string; channel_id?: string; guild_id?: string | null } | null
  /** A forward: the message as it was when forwarded. */
  message_snapshots?: { message: Pick<DiscordMessage, 'content' | 'timestamp' | 'edited_timestamp' | 'sticker_items' | 'flags'> & { attachments?: DiscordAttachment[]; embeds?: DiscordEmbed[] } }[]
  /** An app's answer to a command: who used which (interaction is the older shape). */
  interaction_metadata?: { name?: string; user?: DiscordUser } | null
  interaction?: { name?: string; user?: DiscordUser } | null
  /** A thread started from this message. */
  thread?: { id: string; name: string; message_count?: number } | null
  /** Discord's message flags: 4 hides the link previews; 64 only you can see it; 128 the app is still thinking; 4096 sent with @silent; 32768 its components are the message. */
  flags?: number
  /** An app's buttons, selects and layout under (or as) the message. */
  components?: AppComponent[]
  /** The app that sent it (an answer to a command or a press). */
  application_id?: string
  reactions?: DiscordReaction[]
  pinned?: boolean
  /** Set by the room on a message it sent and is waiting for. */
  pending?: boolean
  /** A message waiting for its files: their names and sizes, and how far the upload is (0 to 1). */
  uploading?: PendingUpload
  /** Set by the room on a message Discord didn't take: why, shown under it with Retry and Delete. */
  failed?: string
}
export type PendingUpload = { files: { name: string; size: number }[]; progress: number }

export type DiscordUnread = { channelId: string; guildId: string | null; unread: boolean; mentions: number; guildUnread: boolean; guildMentions: number }
/** A message that notifies while Exo is in front (the host applies Discord's rules): who, where (a channel or group and the server; neither for a DM) and the message shortened. parentId: a thread's channel. */
export type DiscordNotice = { messageId: string; channelId: string; guildId?: string; parentId?: string; authorId: string; author: string; avatar?: string; place?: string; server?: string; body: string }
/** An unread channel for the Inbox's Unreads: where it is, where reading stopped, and its mentions. */
export type DiscordUnreadChannel = {
  channelId: string; name: string; guildId: string; guild: string; icon: string | null
  parentId: string | null; lastRead: string | null; lastMessage: string | null; mentions: number
}
/** One of For You's notifications (Discord's notification center): its line (markdown), picture, link and whether it was seen. */
export type DiscordForYouItem = {
  id: string; type: string; body?: string | null; icon_url?: string | null; deeplink?: string | null; acked?: boolean
  other_user?: DiscordUser | null; guild_id?: string | null
}
/** What the search bar sends: its words, each filter's answers (ids, has: and authorType: values, - for not), the sort and the page. */
export type DiscordSearchFilters = {
  content?: string; authorIds?: string[]; mentions?: string[]; has?: string[]; channelIds?: string[]; authorTypes?: string[]
  pinned?: boolean; minId?: string; maxId?: string; sort?: 'newest' | 'oldest' | 'relevance'; offset?: number
}
export type DiscordMessageEvent ={ kind: 'create' | 'update' | 'delete'; channelId: string; message?: DiscordMessage; id?: string }

export function displayName(message: Pick<DiscordMessage, 'author' | 'member'>): string {
  return message.member?.nick || message.author.global_name || message.author.username
}

/** Discord's CDN size for a picture shown at size px: a power of two with room for a 2x screen, never under 128. */
export function cdnSize(size: number): number {
  return Math.min(4096, 2 ** Math.ceil(Math.log2(Math.max(128, size * Math.max(2, window.devicePixelRatio || 1)))))
}

// The sizes Discord's CDN serves (Discord's own list).
const CDN_STEPS = [16, 20, 22, 24, 28, 32, 40, 44, 48, 56, 60, 64, 80, 96, 100, 128, 160, 240, 256, 300, 320, 480, 512, 600, 640, 1024, 1280, 1536, 2048, 3072, 4096]

/** The smallest CDN size covering this many CSS pixels at the screen's density, as Discord's client picks one. */
export function cdnStep(px: number): number {
  const want = px * (window.devicePixelRatio || 1)
  return CDN_STEPS.find(step => step >= want) ?? 4096
}

/** A server's banner as Discord's channel list asks for it: 360 px wide at the screen's density, moving (a_) only when motion is allowed. */
export function guildBannerUrl(guildId: string, hash: string, moving: boolean): string {
  return `https://cdn.discordapp.com/banners/${guildId}/${hash}.webp?size=${cdnStep(360)}${moving && hash.startsWith('a_') ? '&animated=true' : ''}`
}

/** A Discord CDN picture at the size it is drawn: the host's lists link one size (256) for every place, which a 32px
 * row decoded four times over. Any other link is left as it is. */
export function cdnSized(url: string, size: number): string {
  return url.startsWith('https://cdn.discordapp.com/') ? url.replace(/([?&]size=)\d+/, `$1${cdnSize(size)}`) : url
}

/** The picture hash in a Discord avatar link (the room's lists carry links; a message's author carries the hash). */
export function avatarHashOf(url: string | null | undefined): string | null {
  return url ? /\/avatars\/\d+\/([^.?/]+)/.exec(url)?.[1] ?? null : null
}

/** A person's picture at full quality: lossless, at least twice the size it shows. */
export function avatarUrl(user: DiscordUser, size = 80): string {
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=${cdnSize(size)}&quality=lossless`
  const index = Number((BigInt(user.id) >> 22n) % 6n)
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`
}


export type DiscordEmoji = { id: string | null; name: string | null; animated?: boolean }
/** A reaction as Discord sends it: normal and super (burst) counts apart, whether you gave each, and a super reaction's colors. */
export type DiscordReaction = {
  count: number; me: boolean; emoji: DiscordEmoji
  count_details?: { normal: number; burst: number }
  me_burst?: boolean
  burst_colors?: string[]
}
export type DiscordReactionEvent = { channelId: string; messageId: string; add: boolean; me: boolean; emoji: DiscordEmoji; userId?: string | null; burst?: boolean; burstColors?: string[] }
export type DiscordGuildEmoji = { id: string; name: string; animated: boolean; native: boolean }
export type DiscordEmojis = { premium: boolean; guilds: { id: string; name: string; icon: string | null; emojis: DiscordGuildEmoji[] }[] }

/** The key the API takes for a reaction: a Unicode emoji itself, or name:id. */
export function reactionKey(emoji: DiscordEmoji): string {
  return emoji.id ? `${emoji.name ?? 'emoji'}:${emoji.id}` : emoji.name ?? ''
}

/** A reaction's normal and super counts (Discord's count_details; an old message has only count). */
export function reactionCounts(r: DiscordReaction): { normal: number; burst: number } {
  return r.count_details ?? { normal: r.count, burst: 0 }
}

/** A reaction list with one person's reaction (normal or super) added or taken away. */
export function applyReaction(list: DiscordReaction[] | undefined, event: Pick<DiscordReactionEvent, 'add' | 'me' | 'emoji' | 'burst' | 'burstColors'>): DiscordReaction[] {
  const key = reactionKey(event.emoji)
  const current = list ?? []
  const at = current.findIndex(r => reactionKey(r.emoji) === key)
  const burst = event.burst === true
  const step = (r: DiscordReaction | null): DiscordReaction => {
    const counts = r ? reactionCounts(r) : { normal: 0, burst: 0 }
    const delta = event.add ? 1 : -1
    const next = burst ? { normal: counts.normal, burst: Math.max(0, counts.burst + delta) } : { normal: Math.max(0, counts.normal + delta), burst: counts.burst }
    const mine = event.me ? event.add : null
    return {
      emoji: r?.emoji ?? event.emoji,
      count: next.normal + next.burst,
      count_details: next,
      me: !burst && mine !== null ? mine : r?.me ?? false,
      me_burst: burst && mine !== null ? mine : r?.me_burst ?? false,
      burst_colors: burst && event.burstColors?.length ? event.burstColors : r?.burst_colors ?? [],
    }
  }
  if (at < 0) return event.add ? [...current, step(null)] : current
  const next = step(current[at])
  return next.count <= 0 ? current.filter((_, i) => i !== at) : current.map((r, i) => i === at ? next : r)
}

// A clicked notification for a room that hasn't mounted yet: the client opens it on mount.
// A thread names its parent channel (and its own name) when the opener knows them.
// outside: false for an open from inside the room (a #channel, a search result), which keeps the sidebar as it is.
export type OpenTarget = { guildId: string | null; channelId: string | null; parentId?: string | null; name?: string | null; outside?: boolean }
let pendingOpen: OpenTarget | null = null
export function setPendingOpen(open: OpenTarget | null) { pendingOpen = open }
/** Opens a DM, a channel, or a server at its last channel (Ctrl+K), mounted or not. */
export function openDiscord(target: OpenTarget) {
  pendingOpen = target
  window.dispatchEvent(new Event('exo-discord-open'))
}
export function takePendingOpen() { const open = pendingOpen; pendingOpen = null; return open }

let pendingJump: { channelId: string; messageId: string } | null = null
/** Opens a message's conversation and shows the message there: search, pins, the Inbox and reply quotes. */
export function jumpToMessage(target: OpenTarget & { channelId: string; messageId: string }) {
  pendingJump = { channelId: target.channelId, messageId: target.messageId }
  openDiscord({ outside: false, ...target })
}
/** The message to show in this conversation, once (null when the jump is to somewhere else). */
export function takeJump(channelId: string): string | null {
  if (pendingJump?.channelId !== channelId) return null
  const id = pendingJump.messageId
  pendingJump = null
  return id
}
export const hasJump = (channelId: string) => pendingJump?.channelId === channelId

type SettingsSection = 'account' | 'profiles' | 'voice' | 'notifications'
let pendingSettings: SettingsSection | null = null
/** Opens Discord's own settings in the Discord room, from anywhere (the room may not have mounted yet). */
export function requestDiscordSettings(section: SettingsSection = 'account') {
  pendingSettings = section
  window.dispatchEvent(new CustomEvent('exo-discord-settings', { detail: section }))
}
export function takePendingSettings() { const section = pendingSettings; pendingSettings = null; return section }

let pendingServerProfile: string | null = null
/** Edit Per-server Profile: Discord settings open on Profiles' Per-server profiles, on this server. */
export function requestServerProfile(guildId: string) {
  pendingServerProfile = guildId
  window.dispatchEvent(new CustomEvent('exo-dc-server-profile', { detail: guildId }))
  requestDiscordSettings('profiles')
}
export function takeServerProfile() { const id = pendingServerProfile; pendingServerProfile = null; return id }

export type DiscordFriend = {
  id: string
  name: string
  username?: string | null
  avatar: string | null
  look?: DiscordLook | null
  kind: 'friend' | 'incoming' | 'outgoing'
  status: string
  activity?: string | null
  /** The activity's type for its icon: 0 playing, 1 streaming, 2 listening, 3 watching, 4 custom status, 5 competing. */
  activityType?: number | null
  rich?: DiscordRich | null
  dmId?: string | null
}
/** An activity as Discord's Active Now shows it. */
/** end: when it ends (a song); url: a stream's page; syncId: Spotify's track; album: the big picture's words (Spotify's album). */
export type DiscordRich = { type: number; name: string; details?: string | null; state?: string | null; start?: number | null; image?: string | null
  end?: number | null; url?: string | null; syncId?: string | null; album?: string | null }
export type DiscordMemberItem =
  | { group: string; count: number }
  | { id: string; name: string; avatar: string | null; color: string | null; bot: boolean; status: string; activity?: string | null; look?: DiscordLook | null; owner?: boolean; boosting?: string | null
    /** The voice channel they're in on this server (Discord's "In voice"). */
    inVoice?: string | null
    roleIcon?: DiscordRoleIcon | null }
/** items: each row at Discord's index, null where Discord hasn't sent it yet; rows: every row the list has (groups and members). */
export type DiscordMemberList = { items: (DiscordMemberItem | null)[]; online: number; total: number; rows?: number }
export type DiscordGif = { id: string; title?: string; url: string; src: string; gif_src?: string; width: number; height: number; preview?: string }
export type DiscordThread = {
  id: string; name: string; parent_id: string; message_count?: number; last_message_id?: string | null; applied_tags?: string[]
  owner?: { nick?: string | null; user?: DiscordUser } | null
  thread_metadata?: { archive_timestamp?: string; create_timestamp?: string; locked?: boolean; archived?: boolean }
}
export type DiscordForumTag = { id: string; name: string; emojiId: string | null; emojiName: string | null }
/** A thread or forum post as its menu shows it: what it is, and what you may change (manage: Manage Threads; mine: you started it). */
export type DiscordThreadState = {
  id: string; name: string; parentId: string | null; guildId: string
  joined: boolean; archived: boolean; locked: boolean; pinned: boolean; muted: boolean; mutedUntil: number | null
  /** 0 all messages, 1 only @mentions, 2 nothing; null as its channel. */
  notify: 0 | 1 | 2 | null
  unread: boolean; mine: boolean; manage: boolean; forum: boolean
  tags: DiscordForumTag[] | null; applied: string[]
}
export type DiscordSticker = { id: string; name: string; format: number }
/** A server's stickers in the picker; usable is false for another server's without Nitro. */
export type DiscordStickerGroup = { id: string; name: string; icon: string | null; usable: boolean; stickers: DiscordSticker[] }
export type DiscordBadge = { id: string; description: string; icon: string; link?: string }
export type DiscordConnection = { type: string; id: string; name: string; verified: boolean; metadata?: Record<string, string> }
export type DiscordProfile = {
  user: {
    id: string; username: string; global_name?: string | null; avatar?: string | null; bio?: string; accent_color?: number | null; banner?: string | null; bot?: boolean
  } & DiscordCollectibleFields
  user_profile?: { bio?: string; pronouns?: string; accent_color?: number | null; banner?: string | null; theme_colors?: number[] | null; collectibles?: { sku_id: string; type: number }[] | null }
  guild_member?: { nick?: string | null; roles?: string[]; joined_at?: string; avatar?: string | null; banner?: string | null; bio?: string | null } & DiscordCollectibleFields
  guild_member_profile?: { pronouns?: string; bio?: string; banner?: string | null; accent_color?: number | null; theme_colors?: number[] | null; collectibles?: { sku_id: string; type: number }[] | null } | null
  badges?: DiscordBadge[]
  guild_badges?: DiscordBadge[]
  connected_accounts?: DiscordConnection[]
  mutual_guilds?: { id: string; nick?: string | null }[]
  mutual_friends_count?: number
  legacy_username?: string | null
  premium_since?: string | null
}
/** What Exo adds to Discord's profile: the member's roles on this server (highest first), what they're doing now. */
export type DiscordProfileExtras = {
  roles: { id: string; name: string; color: string | null }[]
  presence: { status: string; activity?: string | null; activityType?: number | null; rich?: DiscordRich | null; activities?: DiscordRich[] | null } | null
  /** The voice channel they're in on a server you share. */
  voice?: { guildId: string; guild: string; channelId: string; channel: string; count: number } | null
  /** Discord's relationship with you: 0 none, 1 friends, 2 blocked, 3 their friend request, 4 yours. */
  relationship?: number
}
export type DiscordPresence = { userId: string; status: string; activity?: string | null; activityType?: number | null; rich?: DiscordRich | null }

/** The id just before this one: Mark Unread reads up to it. */
export function idBefore(id: string): string {
  return (BigInt(id) - 1n).toString()
}

/** The first id Discord could have made at a time (ms since 1970): search's before:, during: and after:. */
export function idAt(ms: number): string {
  return (BigInt(Math.max(0, Math.floor(ms) - 1420070400000)) << 22n).toString()
}

/** When Discord made this id (a user's account, a server): milliseconds since 1970. */
export function snowflakeTime(id: string) {
  return Number(BigInt(id) >> 22n) + 1420070400000
}

const PERFORMANCE = 'exo.discordPerformance'
const performanceListeners = new Set<() => void>()
/** Discord's Performance mode (Discord settings > Appearance): GIFs still until pointed at, nothing animates or moves. Kept on this PC. */
export function performanceMode(): boolean {
  try { return localStorage.getItem(PERFORMANCE) === '1' } catch { return false }
}
export function setPerformanceMode(on: boolean) {
  try { localStorage.setItem(PERFORMANCE, on ? '1' : '0') } catch { /* this session only */ }
  performanceListeners.forEach(listener => listener())
}
/** Called when Performance mode or the emoji style changes. */
export function onPerformanceMode(listener: () => void) {
  performanceListeners.add(listener)
  return () => { performanceListeners.delete(listener) }
}

/** One of the account's favorite GIFs: its page URL (the key Discord keeps), the media and size; format 2 is a video, 1 an image. */
export type DiscordFavoriteGif = { url: string; src: string; format: number; width: number; height: number }


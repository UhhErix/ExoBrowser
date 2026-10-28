import type { DiscordChannels, DiscordFriend, DiscordHome, DiscordMemberList, DiscordMessage } from './discord'

/** Made-up people and servers for the dev preview of Exo's own Discord client (never real accounts). */
const me = { id: '100000000000000001', username: 'you', global_name: 'You' }
const ada = { id: '100000000000000002', username: 'ada', global_name: 'Ada', primary_guild: { identity_guild_id: '200000000000000001', identity_enabled: true, tag: 'EXO', badge: null } }
const kai = { id: '100000000000000003', username: 'kai', global_name: 'Kai' }
const bot = { id: '100000000000000004', username: 'scrim-bot', global_name: 'Scrim Bot', bot: true }

export const mockHome: DiscordHome = {
  me: { id: me.id, name: 'You', avatar: null, status: 'online' },
  dms: [
    { id: '200000000000000001', name: 'Ada', avatar: null, group: false, unread: true, mentions: 2, userId: '100000000000000002', status: 'online' },
    { id: '200000000000000002', name: 'Kai, Ada', avatar: null, group: true, unread: false, mentions: 0, ownerId: '100000000000000001',
      members: [{ id: '100000000000000002', name: 'Ada', username: 'ada', avatar: null, status: 'online' }, { id: '100000000000000003', name: 'Kai', username: 'kai', avatar: null, status: 'idle' }] },
    { id: '200000000000000003', name: 'Rook', avatar: null, group: false, unread: true, mentions: 0, userId: '100000000000000007', request: true },
    { id: '200000000000000004', name: 'free-nitro-bot', avatar: null, group: false, unread: true, mentions: 0, userId: '100000000000000008', request: true, spam: true },
  ],
  guilds: [
    { id: '300000000000000001', name: 'Night Raid', icon: null, muted: false, unread: true, mentions: 1 },
    { id: '300000000000000002', name: 'Frame Pacing Club', icon: null, muted: false, unread: false, mentions: 0 },
    { id: '300000000000000003', name: 'Speedrun Lab', icon: null, muted: true, unread: false, mentions: 0 },
  ],
  // As the host sends it: what is null is left out.
  rail: [
    { guildIds: ['300000000000000001'] },
    { id: '1', name: 'Gaming', color: 0x5865f2, guildIds: ['300000000000000002', '300000000000000003'] },
  ],
}

export const mockChannels: DiscordChannels = {
  name: 'Night Raid',
  channels: [
    { id: '400000000000000001', name: 'welcome', type: 0, kind: 'text', canRead: true, canSend: false },
    { id: '400000000000000009', name: 'Text', type: 4, kind: 'category' },
    { id: '400000000000000002', name: 'general', type: 0, kind: 'text', topic: 'Talk about anything. Be kind.', canRead: true, canSend: true, unread: true, mentions: 1, canManageMessages: true, canPin: true, canEdit: true },
    { id: '400000000000000003', name: 'mod-chat', type: 0, kind: 'text', canRead: true, canSend: true, private: true, locked: true },
    { id: '400000000000000004', name: 'patch-notes', type: 5, kind: 'text', canRead: true, canSend: false, muted: true },
    { id: '400000000000000007', name: 'strategies', type: 15, kind: 'forum', canRead: true, canSend: true },
    { id: '400000000000000008', name: 'Voice', type: 4, kind: 'category' },
    { id: '400000000000000005', name: 'Lobby', type: 2, kind: 'voice', canConnect: true, userLimit: 10, status: 'Ranked night <:Troll:968812152267866172>', canSetStatus: true, canEdit: true,
      members: [{ id: ada.id, name: 'Ada', avatar: null, mute: false, deaf: false, video: true, stream: true }, { id: kai.id, name: 'Kai', avatar: null, mute: true, deaf: false, serverMute: true }] },
    { id: '400000000000000006', name: 'Scrims', type: 2, kind: 'voice', canConnect: true, locked: true },
  ],
  canManage: true,
  canManageEvents: true,
  moderation: { kick: true, ban: true, manageGuild: true, auditLog: true, manageRoles: true, timeout: true, manageChannels: true, manageExpressions: true, manageWebhooks: true, manageNicknames: true, prune: true, owner: true, mfa: true },
}

const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
const msg = (id: number, author: typeof me, content: string, minutes: number, extra: Partial<DiscordMessage> = {}): DiscordMessage => ({
  id: `5000000000000000${String(id).padStart(2, '0')}`, channel_id: '400000000000000002', type: 0, author, content, timestamp: at(minutes),
  attachments: [], embeds: [], mentions: [], ...extra,
})

export const mockMessages: DiscordMessage[] = [
  msg(1, ada, 'anyone up for ranked tonight?', 95),
  msg(2, ada, 'I can do **9pm**, maybe earlier', 94, { flags: 4096 }),
  msg(3, kai, 'same. new patch broke my sens though 😭', 60, { reactions: [{ count: 2, me: true, emoji: { id: null, name: '😭' } }] }),
  msg(4, me, 'turn off mouse acceleration in Windows, then `400 dpi × 1.2` is what I use', 58, { edited_timestamp: at(57) }),
  msg(5, bot, '', 40, { embeds: [{ title: 'Scrim tonight', description: 'Starts <t:1792800000:R>. Sign up in #general.', color: 0x5865f2, fields: [{ name: 'Map', value: 'Ascent', inline: true }, { name: 'Slots', value: '3 of 10', inline: true }] }] }),
  msg(6, kai, '<@100000000000000001> are you in?', 12, { mentions: [me] }),
  msg(7, ada, '> are you in?\nhe always is', 11, { reactions: [{ count: 3, me: false, emoji: { id: null, name: '😂' } }, { count: 1, me: true, emoji: { id: null, name: '🔥' } }] }),
  msg(8, kai, '||I bought the battle pass||', 3),
  msg(9, ada, '', 2, {
    message_reference: { type: 1, channel_id: '400000000000000002', message_id: '500000000000000001' },
    message_snapshots: [{ message: { content: 'patch notes are out:\n- sens fix\n- new map', timestamp: at(30) } }],
  }),
  msg(10, bot, 'Queued **3** players for Ascent.', 1, { type: 20, interaction_metadata: { name: 'scrim join', user: kai }, thread: { id: '600000000000000004', name: 'Scrim lineup', message_count: 4 } }),
  msg(11, ada, 'crosshair spots', 1, { attachments: [{ id: '700000000000000001', filename: 'clip1.png', url: 'https://cdn.discordapp.com/embed/avatars/1.png', size: 48213, width: 640, height: 360, content_type: 'image/png' }, { id: '700000000000000002', filename: 'clip2.png', url: 'https://cdn.discordapp.com/embed/avatars/2.png', size: 48213, width: 640, height: 360, content_type: 'image/png' }, { id: '700000000000000003', filename: 'clip3.png', url: 'https://cdn.discordapp.com/embed/avatars/3.png', size: 48213, width: 640, height: 360, content_type: 'image/png' }, { id: '700000000000000004', filename: 'clip4.png', url: 'https://cdn.discordapp.com/embed/avatars/4.png', size: 48213, width: 640, height: 360, content_type: 'image/png' }, { id: '700000000000000005', filename: 'clip5.png', url: 'https://cdn.discordapp.com/embed/avatars/5.png', size: 48213, width: 640, height: 360, content_type: 'image/png', description: 'The A site from heaven' }],
    reactions: [{ count: 4, me: false, emoji: { id: null, name: '🔥' }, count_details: { normal: 2, burst: 2 }, me_burst: false, burst_colors: ['#ff7a1a', '#ffd23f'] }, { count: 1, me: true, emoji: { id: null, name: '👀' } }] }),
  msg(13, kai, 'https://spotify.link/VmIbCrLn56b', 0.5),
  msg(15, ada, 'https://discord.gg/exo', 0.4),
  msg(16, kai, 'come scrim with us https://discord.gg/valorant', 0.3),
  msg(17, me, 'https://discord.gg/expired', 0.2),
  msg(18, ada, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 0.15, { embeds: [{ type: 'video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Rick Astley - Never Gonna Give You Up', color: 0xff0000,
    provider: { name: 'YouTube' }, author: { name: 'Rick Astley', url: 'https://www.youtube.com/@RickAstleyYT' },
    thumbnail: { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', width: 480, height: 360 }, video: { url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', width: 1280, height: 720 } }] }),
  msg(19, kai, 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', 0.1, { embeds: [{ type: 'link', url: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', title: 'Never Gonna Give You Up', provider: { name: 'Spotify' }, description: 'Rick Astley · Song · 1987' }] }),
  msg(20, kai, 'https://x.com/valorant/status/1', 0.05, { embeds: [1, 2, 3, 4].map(n => ({ type: 'rich', url: 'https://x.com/valorant/status/1',
    ...(n === 1 ? { description: 'New agent drops next week. Four looks at the kit:', author: { name: 'VALORANT (@VALORANT)' }, footer: { text: 'X' }, color: 0x1d9bf0 } : {}),
    image: { url: `https://cdn.discordapp.com/embed/avatars/${n}.png`, width: 640, height: 360 } })) }),
  msg(12, me, 'my config', 0, { attachments: [
    { id: '710000000000000001', filename: 'autoexec.cfg', url: 'https://cdn.discordapp.com/attachments/1/2/autoexec.cfg', size: 2311, content_type: 'text/plain' },
    { id: '710000000000000002', filename: 'patch-notes.pdf', url: 'https://cdn.discordapp.com/attachments/1/2/patch-notes.pdf', size: 1843200, content_type: 'application/pdf' },
  ] }),
]

// An app's answers for the dev preview: buttons and a select, a Components V2 card, one only you see, one still thinking.
export const mockAppMessages: DiscordMessage[] = [
  msg(31, bot, 'Pick your role for the scrim:', 0.9, {
    application_id: bot.id, interaction_metadata: { name: 'scrim roles', user: me },
    components: [
      { type: 1, components: [
        { type: 2, style: 1, label: 'Duelist', custom_id: 'role:duelist' },
        { type: 2, style: 2, label: 'Support', custom_id: 'role:support', emoji: { id: null, name: '🛡️' } },
        { type: 2, style: 3, label: 'Ready', custom_id: 'ready' },
        { type: 2, style: 4, label: 'Leave', custom_id: 'leave' },
        { type: 2, style: 5, label: 'Rules', url: 'https://example.com/rules' },
        { type: 2, style: 2, label: 'Full', custom_id: 'full', disabled: true },
      ] },
      { type: 1, components: [{ type: 3, custom_id: 'map', placeholder: 'Choose a map', options: [{ label: 'Ascent', value: 'ascent', description: 'Mid control' }, { label: 'Bind', value: 'bind' }, { label: 'Haven', value: 'haven' }] }] },
    ],
  }),
  msg(32, bot, '', 0.6, {
    application_id: bot.id, flags: 32768,
    components: [{ type: 17, accent_color: 0xffffff, components: [
      { type: 9, components: [{ type: 10, content: '## Scrim tonight\nAscent at **9pm**. 3 of 10 slots left.' }], accessory: { type: 2, style: 1, label: 'Join', custom_id: 'join' } },
      { type: 14, divider: true, spacing: 1 },
      { type: 10, content: '-# Hosted by Scrim Bot' },
    ] }],
  }),
  msg(33, bot, 'Your sign-up is saved. Only you see this.', 0.3, { application_id: bot.id, flags: 64, interaction_metadata: { name: 'scrim join', user: me } }),
  msg(34, bot, '', 0.1, { application_id: bot.id, flags: 128, interaction_metadata: { name: 'scrim stats', user: me } }),
]

/** The commands the dev preview offers on /. */
export const mockApps = {
  ok: true,
  applications: [{ id: bot.id, name: 'Scrim Bot', icon: null }],
  commands: [
    { id: '800000000000000001', application_id: bot.id, type: 1, name: 'scrim', description: 'Scrims', options: [
      { type: 1, name: 'join', description: 'Join tonight\'s scrim', options: [
        { type: 3, name: 'role', description: 'Your role', required: true, choices: [{ name: 'Duelist', value: 'duelist' }, { name: 'Support', value: 'support' }] },
        { type: 5, name: 'sub', description: 'Join as a sub' },
      ] },
      { type: 1, name: 'stats', description: 'Your stats', options: [{ type: 6, name: 'player', description: 'Whose stats' }] },
    ] },
    { id: '800000000000000002', application_id: bot.id, type: 1, name: 'remind', description: 'Remind you later', options: [
      { type: 3, name: 'what', description: 'What to remind you of', required: true, max_length: 100 },
      { type: 4, name: 'minutes', description: 'In how many minutes', min_value: 1, max_value: 1440 },
    ] },
    { id: '800000000000000003', application_id: bot.id, type: 2, name: 'Scrim stats' },
    { id: '800000000000000004', application_id: bot.id, type: 3, name: 'Save to notes' },
  ],
}

export const mockFriends: DiscordFriend[] = [
  { id: ada.id, name: 'Ada', username: 'ada', avatar: null, kind: 'friend', status: 'online', activity: 'Playing VALORANT', dmId: '200000000000000001' },
  { id: kai.id, name: 'Kai', username: 'kai', avatar: null, kind: 'friend', status: 'idle', activity: 'Daft Punk', activityType: 2,
    rich: { type: 2, name: 'Spotify', details: 'Get Lucky', state: 'Daft Punk; Pharrell Williams; Nile Rodgers', start: Date.now() - 60_000, end: Date.now() + 309_000,
      syncId: '69kOkLUCkxIZYexIgSG8rq', album: 'Random Access Memories' } },
  { id: '100000000000000005', name: 'Mira', username: 'mira', avatar: null, kind: 'friend', status: 'offline' },
  { id: '100000000000000006', name: 'Theo', username: 'theo', avatar: null, kind: 'incoming', status: 'online' },
]

export const mockMembers: DiscordMemberList = {
  online: 3,
  total: 4,
  items: [
    { group: 'Admins', count: 1 },
    { id: ada.id, name: 'Ada', avatar: null, color: '#e91e63', bot: false, status: 'online', activity: 'VALORANT', owner: true, roleIcon: { name: 'Admins', emoji: '🛡️' } },
    { group: 'Online', count: 2 },
    { id: kai.id, name: 'Kai', avatar: null, color: null, bot: false, status: 'idle', boosting: '2026-03-14T18:00:00.000000+00:00', inVoice: 'Lobby' },
    { id: bot.id, name: 'Scrim Bot', avatar: null, color: '#3498db', bot: true, status: 'online' },
    { group: 'Offline', count: 1 },
    { id: '100000000000000005', name: 'Mira', avatar: null, color: null, bot: false, status: 'offline' },
  ],
}

/** A profile with every part Discord sends (badges, connections, mutuals, a server member) and what Exo adds. */
export const mockProfile = {
  ok: true,
  note: 'Met in ranked',
  profile: {
    user: { ...ada, bio: 'Duelist main. **Ranked** grinder.', accent_color: 0xe91e63 },
    user_profile: { pronouns: 'she/her', accent_color: 0xe91e63, bio: 'Duelist main. **Ranked** grinder.' },
    guild_member: { nick: null, roles: ['300000000000000001'], joined_at: '2025-03-14T18:00:00Z' },
    badges: [
      { id: 'premium_tenure_60_month_v2', description: 'Earned 3/2/21. 5 years: Ruby', icon: 'cd5e2cfd9d7f27a8cdcd3e8a8d5dc9f4', link: 'https://discord.com/settings/premium' },
      { id: 'hypesquad_house_3', description: 'HypeSquad Balance', icon: '3aa41de486fa12454c3761e8e223442e' },
      { id: 'guild_booster_lvl9', description: 'Server boosting since 1/16/26', icon: 'ec92202290b48d0879b7413d2dde3bab', link: 'https://discord.com/settings/guild-boosting' },
      { id: 'legacy_username', description: 'Originally known as ada#0001', icon: '6de6d34650760ba5551a79732e98ed60' },
      { id: 'quest_completed', description: 'Completed a Quest', icon: '7d9ae358c8c5e118768335dbe68b4fb8', link: 'https://discord.com/discovery/quests' },
    ],
    connected_accounts: [
      { type: 'twitch', id: '1', name: 'ada_plays', verified: true },
      { type: 'github', id: '2', name: 'ada', verified: true },
      { type: 'spotify', id: 'ada', name: 'Ada', verified: true },
      { type: 'xbox', id: '3', name: 'Ada', verified: false },
      { type: 'steam', id: '76561197960287930', name: 'ada', verified: true },
      { type: 'bluesky', id: 'did:plc:ada', name: 'ada.bsky.social', verified: true },
      { type: 'domain', id: 'ada.dev', name: 'ada.dev', verified: true },
      { type: 'amazon-music', id: '4', name: 'Ada', verified: false },
    ],
    mutual_guilds: [{ id: '300000000000000001', nick: null }, { id: '300000000000000002', nick: 'ada (FPC)' }],
    mutual_friends_count: 1,
  },
  extras: {
    roles: [{ id: '300000000000000001', name: 'Mods', color: '#e91e63' }, { id: '300000000000000009', name: 'Ranked', color: null }],
    presence: { status: 'online', activity: 'VALORANT', activityType: 0, rich: { type: 0, name: 'VALORANT', details: 'Competitive', state: 'Ascent · 7-5', start: Date.now() - 23 * 60_000, image: null },
      activities: [
        { type: 0, name: 'VALORANT', details: 'Competitive', state: 'Ascent · 7-5', start: Date.now() - 23 * 60_000, image: null },
        { type: 2, name: 'Spotify', details: 'Never Gonna Give You Up', state: 'Rick Astley', album: 'Whenever You Need Somebody', start: Date.now() - 64_000, end: Date.now() + 149_000, syncId: '4cOdK2wGLETKBW3PvgPWqT', image: 'https://i.scdn.co/image/ab67616d0000b2735755e164993798e0c9ef7d7a' },
      ] },
    voice: { guildId: '300000000000000001', guild: 'Night Raid', channelId: '400000000000000005', channel: 'Lobby', count: 2 },
    relationship: 0,
  },
}

// Server Settings, Edit Channel and the person menu (discord.admin) for the dev preview: made-up roles, invites and logs.
const guildId = '300000000000000001'
const roles = [
  { id: guildId, name: '@everyone', color: 0, position: 0, hoist: false, mentionable: false, managed: false, permissions: String(1024 + 2048 + 65536 + 1048576 + 2097152) },
  { id: '900000000000000001', name: 'Admins', color: 0xe91e63, position: 3, hoist: true, mentionable: false, managed: false, permissions: '8' },
  { id: '900000000000000002', name: 'Mods', color: 0x3498db, position: 2, hoist: true, mentionable: true, managed: false, permissions: String(2 + 4 + 8192) },
  { id: '900000000000000003', name: 'Scrim Bot', color: 0, position: 1, hoist: false, mentionable: false, managed: true, permissions: '0' },
]
const people: Record<string, { name: string; username: string; roles: string[] }> = {
  [me.id]: { name: 'You', username: me.username, roles: ['900000000000000001'] },
  [ada.id]: { name: 'Ada', username: ada.username, roles: ['900000000000000002'] },
  [kai.id]: { name: 'Kai', username: kai.username, roles: [] },
}

// Discord's step-up: the owner's 2FA switch and Delete Server wait for a code (123456 passes in the mock).
const mockAsk = { id: '0123456789abcdef0123456789abcdef', methods: ['totp', 'sms', 'backup', 'password'] }
function mockStepUp(params: Record<string, unknown>): unknown {
  if (params.action !== 'mfa') return { ok: false, message: 'Discord wants to check it’s really you.', mfa: mockAsk }
  if (params.step === 'cancel') return { ok: true }
  if (params.step === 'sms') return { ok: true, data: { phone: '*******1234' } }
  return params.code === '123456' ? { ok: true, data: { level: 0 } } : { ok: false, message: 'Discord: Invalid two-factor code', mfa: mockAsk }
}

// Server Settings pages' reads.
const mockPages: Record<string, unknown> = {
  profile: { tag: 'NR', badge: 0, badge_color_primary: '#ff1c90', badge_color_secondary: '#ff7fc0', badge_hash: null, visibility: 1 },
  sounds: { items: [{ sound_id: '640000000000000001', name: 'gg', volume: 1, emoji_name: '🎉', user: ada }] },
  templates: [],
  widget: { enabled: false, channel_id: null },
  verification: { form_fields: [{ field_type: 'TERMS', values: ['Be kind.', 'No spam.'] }] },
  welcome: { description: 'Ranked nights and scrims.', welcome_channels: [{ channel_id: '400000000000000002', description: 'Say hi' }] },
  pending: { total: 3 },
  onboarding: {
    onboarding: {
      default_channel_ids: ['400000000000000001', '400000000000000002'], enabled: true, mode: 0,
      prompts: [{ id: '1100000000000000001', title: 'What brings you here?', single_select: false, required: true, in_onboarding: true, options: [
        { id: '1100000000000000011', title: 'Ranked', description: 'Climb with us', channel_ids: ['400000000000000007'], role_ids: [], emoji: { id: null, name: '🏆', animated: false } },
        { id: '1100000000000000012', title: 'Scrims', description: '', channel_ids: [], role_ids: ['900000000000000002'], emoji: null },
      ] }],
    },
    guide: {
      welcome_message: { author_ids: ['100000000000000001'], message: 'Hi [@username]! Welcome to Night Raid.' }, enabled: false,
      new_member_actions: [{ channel_id: '400000000000000002', action_type: 1, title: 'Say hi in general', description: '', emoji: { name: '👋' } }],
      resource_channels: [{ channel_id: '400000000000000001', title: 'Rules', description: 'Read before posting', emoji: null }],
    },
    seen: ['400000000000000001', '400000000000000009', '400000000000000002', '400000000000000004', '400000000000000007', '400000000000000008', '400000000000000005'],
    chats: ['400000000000000002', '400000000000000007'],
    me: '100000000000000001',
  },
  roleLinks: [[{ connection_type: 'steam', connection_metadata_field: null, operator: null, value: null }, { connection_type: 'steam', connection_metadata_field: 'game_count', operator: 4, value: '9' }]],
  // Two made-up badges in the shape Exo's host reads Discord's art into.
  badgeArt: { badges: [0, 7].map(id => ({ id, nodes: [{ tag: 'path', attrs: { d: 'M2 2h12v12H2z', fill: '#000' } }, { tag: 'path', attrs: { d: 'M3 3h10v10H3z', fill: { p: 1 } } }, { tag: 'path', attrs: { d: 'M6 6h4v4H6z', fill: { s: 0 } } }],
    primary: { lum: [0.2, 0.5], weights: [{ base: 1, tint: 1 }, { base: 1, tint: 1 }] }, secondary: { lum: [0.7], weights: [{ base: 1, tint: 1 }] } })) },
  discovery: {
    requirements: { safe_environment: true, size: false, minimum_size: 1000, age: true, minimum_age: 56, healthy: false, health_score_pending: true, protected: true, sufficient: false, nsfw_properties: {} },
    metadata: { primary_category_id: 1, keywords: ['ranked'], emoji_discoverability_enabled: true },
    categories: [{ id: 1, name: 'Gaming', is_primary: true }, { id: 2, name: 'Music', is_primary: true }, { id: 3, name: 'Esports', is_primary: false }],
  },
  insights: { small: false, engagement: [{ visitors: 120, communicators: 40 }, { visitors: 100, communicators: 44 }], growth: [{ new_members: 12 }, { new_members: 9 }], retention: [{ pct_retained: 42.5 }, { pct_retained: 40 }] },
}

// The step-up check's actions and the pages' reads, before the rest.
function mockPreset(params: Record<string, unknown>): unknown {
  const action = String(params.action)
  if (['mfa', 'guildMfa', 'deleteGuild', 'transfer'].includes(action)) return mockStepUp(params)
  return action in mockPages ? { ok: true, data: mockPages[action] } : undefined
}

export function mockAdmin(params?: Record<string, unknown>): unknown {
  const ok = (data: unknown) => ({ ok: true, data })
  const preset = mockPreset(params ?? {})
  if (preset !== undefined) return preset
  switch (params?.action) {
    case 'guild': return ok({ id: guildId, name: 'Night Raid', icon: null, banner: null, description: 'Ranked nights and scrims.', owner_id: me.id, afk_channel_id: null, afk_timeout: 300,
      system_channel_id: '400000000000000002', system_channel_flags: 4, verification_level: 1, default_message_notifications: 1, explicit_content_filter: 2, mfa_level: 1, premium_tier: 1, features: ['COMMUNITY'], approximate_member_count: 1204 })
    case 'roles': return ok({ roles, counts: { '900000000000000001': 1, '900000000000000002': 1, '900000000000000003': 1 }, top: 2147483647 })
    case 'roleMembers': case 'searchMembers': return ok({ members: [{ member: { user: ada, nick: null, roles: people[ada.id].roles } }, { member: { user: kai, nick: null, roles: [] } }] })
    case 'emojis': return ok([{ id: '600000000000000001', name: 'gg', roles: [], user: ada }])
    case 'stickers': return ok([])
    case 'invites': return ok([{ code: 'nightraid', uses: 12, max_uses: 0, expires_at: null, inviter: ada, channel: { id: '400000000000000002', name: 'general' } }])
    case 'integrations': return ok({ webhooks: [{ id: '610000000000000001', name: 'Patch notes', channel_id: '400000000000000004', user: kai }],
      integrations: [{ id: '620000000000000001', name: 'Scrim Bot', type: 'discord', user: ada,
        application: { id: '630000000000000001', name: 'Scrim Bot', bot: { id: '630000000000000001', username: 'Scrim Bot', avatar: null }, role_connections_verification_url: 'https://scrims.example/verify' },
        role_connections_metadata: [{ key: 'scrims_won', name: 'Scrims won', description: 'Scrims won with a team', type: 2 }, { key: 'captain', name: 'Captain', description: 'Leads a team', type: 7 }] }] })
    case 'automod': return ok([{ id: '700000000000000001', name: 'Block Mention Spam', event_type: 1, trigger_type: 5, trigger_metadata: { mention_total_limit: 20, mention_raid_protection_enabled: true },
      actions: [{ type: 1, metadata: {} }], enabled: true, exempt_roles: [], exempt_channels: [] }])
    case 'audit': return ok({ users: [me, ada, kai], audit_log_entries: [
      { id: '1430000000000000001', action_type: 25, user_id: ada.id, target_id: kai.id, reason: 'Helping with scrims', changes: [{ key: '$add', new_value: [{ id: '900000000000000002', name: 'Mods' }] }] },
      { id: '1420000000000000001', action_type: 10, user_id: me.id, target_id: '400000000000000003', changes: [{ key: 'name', new_value: 'clips' }, { key: 'type', new_value: 0 }] },
    ] })
    case 'bans': return ok([{ user: { id: '100000000000000009', username: 'spam-account' }, reason: 'Spam links in every channel' }])
    case 'person': return ok(mockPerson(String(params.userId)))
    case 'channelSettings': return ok({ id: params.channelId, guildId, name: 'general', type: 0, topic: 'Talk about anything. Be kind.', nsfw: false, rateLimit: 0, userLimit: 0, bitrate: 64000,
      canManage: true, canPermissions: true, maxBitrate: 128000,
      overwrites: [{ id: guildId, type: 0, allow: '0', deny: '0' }, { id: '900000000000000002', type: 0, allow: '8192', deny: '0' }],
      roles: roles.map(r => ({ id: r.id, name: r.name, color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : null })), members: [] })
    case 'createWebhook': return ok({ id: '610000000000000009', type: 1, name: 'Captain Hook', channel_id: '400000000000000002', user: me })
    case 'createRole': return ok({ ...roles[2], id: '900000000000000099', name: 'new role', position: 1 })
    default: return ok(null)
  }
}

function mockPerson(userId: string) {
  const person = people[userId] ?? { name: 'Someone', username: 'someone', roles: [] }
  const mine = userId === me.id
  return {
    ok: true, known: true, me: mine, owner: mine, outranks: !mine, timedOut: userId === ada.id, nick: null, name: person.name, username: person.username, roles: person.roles,
    choices: roles.filter(r => r.id !== guildId).sort((a, b) => b.position - a.position)
      .map(r => ({ id: r.id, name: r.name, color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : null, assignable: !r.managed })),
    mfa: true,
    can: { roles: true, nick: true, timeout: !mine, kick: !mine, ban: !mine, transfer: !mine, mute: userId === ada.id, deafen: userId === ada.id, move: userId === ada.id },
    voice: userId === ada.id ? { channelId: '400000000000000005', mute: false, deaf: false } : null,
    moveTo: [{ id: '400000000000000006', name: 'Scrims' }],
  }
}

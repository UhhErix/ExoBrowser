import type { CSSProperties } from 'react'
import { CompanyLogo } from './CompanyLogo'
import { TABLER } from './tabler'

/** `filled`: the glyph solid, for a toggle that is on (a starred capture, a liked song). `current`: the glyph solid
    too, for the place you are (the current room). */
export type IconProps = { size?: number; className?: string; filled?: boolean; current?: boolean }

type Glyph = keyof typeof TABLER

/*
 * Exo's icons are Tabler's (tabler.io/icons, MIT), one family everywhere: Exo, Exo Mouse, setup and first run, the
 * drawn-in checks too. Brand marks (stores, Discord, Spotify, Apple Music, YouTube Music) stay their own.
 * scripts/icons.mjs writes the glyphs named here into tabler.ts.
 * - Tabler's line on its 24 grid at 1.875 instead of 2, so 1.25 px at 16 px: 1 px reads gray beside Exo's labels
 *   on black and 1.33 heavy, and 1.25 matches the words beside it as Apple asks.
 * - Play, pause, stop and skip are solid, as every player draws them. A toggle that is on (liked, starred, pinned)
 *   and the current room show the glyph's -filled where Tabler draws one.
 * - One glyph per meaning: two things that mean different things never share a glyph, anywhere in Exo.
 */

const LINE = 1.875

const classes = (name: string, filled: boolean | undefined, className: string | undefined, current?: boolean) =>
  ['exo-glyph', 'is-' + name, filled && 'is-filled', current && 'is-current', className].filter(Boolean).join(' ')

const block: CSSProperties = { display: 'block', flexShrink: 0 }

/** The glyph's solid form, where Tabler draws one. */
const solid = (glyph: Glyph) => (`${glyph}-filled` in TABLER ? `${glyph}-filled` : glyph) as Glyph

function Svg({ glyph, size, className, style = block }: { glyph: Glyph; size: number; className?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={LINE} strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" className={className} style={style}>
      {TABLER[glyph].map(([kind, d], i) => <path key={i} d={d} fill={kind ? 'currentColor' : undefined} stroke={kind === 1 ? 'none' : undefined} />)}
    </svg>
  )
}

function icon(name: string, glyph: Glyph) {
  function ExoIcon({ size = 16, className, filled, current }: IconProps) {
    return <Svg glyph={filled || current ? solid(glyph) : glyph} size={size} className={classes(name, filled, className, current)} />
  }
  ExoIcon.displayName = name
  return ExoIcon
}

// The glyph cleared in a circle at its corner, where the badge sits.
const corner = `url("data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' fill='white'/><circle cx='19.5' cy='19.5' r='6.5' fill='black'/></svg>")}")`

/** A glyph with a small solid badge at its corner (a private channel's lock), the glyph cleared under it. */
function marked(name: string, glyph: Glyph, badge: Glyph) {
  function ExoIcon({ size = 16, className }: IconProps) {
    return (
      <span aria-hidden="true" className={classes(name, false, className)} style={{ ...block, position: 'relative', width: size, height: size }}>
        <Svg glyph={glyph} size={size} style={{ position: 'absolute', inset: 0, maskImage: corner, maskSize: '100% 100%' }} />
        <Svg glyph={badge} size={size * 0.5} style={{ position: 'absolute', right: -size * 0.06, bottom: -size * 0.06 }} />
      </span>
    )
  }
  ExoIcon.displayName = name
  return ExoIcon
}

function brand(name: string) {
  return function Glyph({ size = 16, className }: IconProps) {
    return <CompanyLogo company={name} size={size} className={['exo-glyph', `is-${name}`, className].filter(Boolean).join(' ')} />
  }
}

// ── The window and the Bar ──────────────────────────────────────────────────────────────
export const Minus = icon('minus', 'minus')
export const Maximize = icon('maximize', 'square')
export const Restore = icon('restore', 'box-multiple')
export const Close = icon('close', 'x')
export const Search = icon('search', 'search')
export const Settings = icon('settings', 'settings')
export const Library = icon('library', 'layout-grid')
export const StoreBag = icon('store', 'shopping-bag')
/** The Discord room. */
export const Chats = icon('chats', 'messages')
/** The Music room, and music without its art. */
export const MusicNotes = icon('music', 'music')
/** The PC room. */
export const Gpu = icon('gpu', 'gauge')
/** Your graphics card. */
export const GraphicsCard = icon('graphics-card', 'gpu')
/** This PC: the PC room's Overview. */
export const Cpu = icon('cpu', 'cpu')
/** The PC room's Performance: what makes this PC faster. */
export const Rocket = icon('rocket', 'rocket')
/** Exo's own update. */
export const AppUpdate = icon('app-update', 'circle-arrow-down')
/** The Devices room: your mouse. */
export const Mouse = icon('mouse', 'mouse')
export const Home = icon('home', 'home')
/** A gift waiting on a store, in the Library. */
export const Gift = icon('gift', 'gift')

// ── Actions ─────────────────────────────────────────────────────────────────────────────
export const Plus = icon('plus', 'plus')
export const Check = icon('check', 'check')
export const ChevronDown = icon('chevron-down', 'chevron-down')
export const ChevronUp = icon('chevron-up', 'chevron-up')
export const ChevronLeft = icon('chevron-left', 'chevron-left')
export const ChevronRight = icon('chevron-right', 'chevron-right')
export const More = icon('more', 'dots')
export const Download = icon('download', 'download')
export const Refresh = icon('refresh', 'refresh')
export const Undo = icon('undo', 'arrow-back-up')
export const Trash = icon('trash', 'trash')
export const Copy = icon('copy', 'copy')
export const ExternalLink = icon('external', 'external-link')
export const ArrowUpRight = icon('arrow-up-right', 'arrow-up-right')
export const LinkIcon = icon('link', 'link')
export const Pin = icon('pin', 'pin')
export const Star = icon('star', 'star')
export const Heart = icon('heart', 'heart')
export const ThumbsDown = icon('thumbs-down', 'thumb-down')
/** A Store game on your wishlist. */
export const Bookmark = icon('bookmark', 'bookmark')
export const Key = icon('key', 'key')
export const Folder = icon('folder', 'folder')
export const FolderOpen = icon('folder-open', 'folder-open')
export const FolderPlus = icon('folder-plus', 'folder-plus')
export const ImageUpload = icon('image-upload', 'photo-up')
export const SaveImage = icon('save-image', 'photo-down')
export const FileIcon = icon('file', 'file')
export const Upload = icon('upload', 'file-upload')
/** A game's Properties. */
export const Sliders = icon('sliders', 'adjustments-horizontal')
/** Music's Sound panel. */
export const Equalizer = icon('equalizer', 'adjustments')
export const Explore = icon('explore', 'compass')
/** Music's New page: new releases. */
export const New = icon('new', 'sparkles')
export const Radio = icon('radio', 'radio')
/** A camera in a call. */
export const Video = icon('video', 'video')
/** A song's music video. */
export const Movie = icon('movie', 'movie')
/** Where Spotify plays (Spotify Connect). */
export const Devices = icon('devices', 'device-speaker')
export const FullScreen = icon('full-screen', 'arrows-maximize')
export const ExitFullScreen = icon('exit-full-screen', 'arrows-minimize')
/** Exo's Appearance: Light, Dark or Void. */
export const Appearance = icon('appearance', 'sun-moon')
/** A game's cover art. */
export const Cover = icon('cover', 'photo')
/** Exo Shaders: a game's shaders compiled ahead. */
export const Shaders = icon('shaders', 'bolt')

// ── Music ───────────────────────────────────────────────────────────────────────────────
export const Play = icon('play', 'player-play-filled')
export const Pause = icon('pause', 'player-pause-filled')
export const Stop = icon('stop', 'player-stop-filled')
export const Next = icon('next', 'player-skip-forward-filled')
export const Previous = icon('previous', 'player-skip-back-filled')
export const Shuffle = icon('shuffle', 'arrows-shuffle')
export const Repeat = icon('repeat', 'repeat')
export const RepeatOne = icon('repeat-one', 'repeat-once')
export const Queue = icon('queue', 'list-numbers')
/** Your saved songs. */
export const Songs = icon('songs', 'playlist')
export const NowPlaying = icon('now-playing', 'wave-sine')
/** Spotify Jam: listening together. */
export const Jam = icon('jam', 'broadcast')
export const Headphones = icon('headphones', 'headphones')
export const HeadphonesOff = icon('headphones-off', 'headphones-off')
export const Volume = icon('volume', 'volume')
export const VolumeOff = icon('volume-off', 'volume-off')
export const Mic = icon('mic', 'microphone')
export const MicOff = icon('mic-off', 'microphone-off')

// ── People and messages ─────────────────────────────────────────────────────────────────
export const UserPlus = icon('user-plus', 'user-plus')
export const UserCircle = icon('user-circle', 'user-circle')
/** Your friends. */
export const Users = icon('users', 'users')
/** A server's members. */
export const Members = icon('members', 'users-group')
/** One person, with no picture. */
export const Person = icon('person', 'user')
/** People (the emoji picker's first category). */
export const Smiley = icon('smiley', 'mood-happy')
export const FriendAccepted = icon('friend-accepted', 'user-check')
export const MessageCircle = icon('message', 'message-circle')
export const MessagePlus = icon('message-plus', 'message-plus')
export const Unread = icon('unread', 'notification')
export const Forum = icon('forum', 'layout-list')
export const Reply = icon('reply', 'corner-up-left')
export const Forward = icon('forward', 'corner-up-right')
export const At = icon('at', 'at')
export const Hash = icon('hash', 'hash')
export const Phone = icon('phone', 'phone')
export const PhoneDown = icon('phone-down', 'phone-off')
export const Pencil = icon('pencil', 'pencil')
export const Smile = icon('smile', 'mood-smile')
export const SmilePlus = icon('smile-plus', 'mood-plus')
export const ViewReactions = icon('view-reactions', 'mood-search')
export const Megaphone = icon('megaphone', 'speakerphone')
export const Soundboard = icon('soundboard', 'piano')
export const Bell = icon('bell', 'bell')
export const BellOff = icon('bell-off', 'bell-off')
export const Inbox = icon('inbox', 'inbox')
export const Leave = icon('leave', 'door-exit')
export const Grip = icon('grip', 'grip-vertical')
export const Eye = icon('eye', 'eye')
export const EyeOff = icon('eye-off', 'eye-off')
/** Copy an ID (developer mode). */
export const Id = icon('id', 'id')
export const Lock = icon('lock', 'lock')
export const Clock = icon('clock', 'clock')
/** Something went wrong. */
export const Alert = icon('alert', 'alert-circle')
/** Exo Capture: the Bar's button, and the add-on. */
export const Capture = icon('capture', 'capture')
/** Exo Capture: the replay it keeps. */
export const History = icon('history', 'history')
/** Your captures. */
export const Gallery = icon('gallery', 'photo-video')
export const Hourglass = icon('hourglass', 'hourglass')
export const Calendar = icon('calendar', 'calendar')
export const Book = icon('book', 'book')
export const Rules = icon('rules', 'list-check')
/** Browse Channels. */
export const ListSearch = icon('list-search', 'list-search')
export const Apps = icon('apps', 'apps')
/** Discord's Shop. */
export const Shop = icon('shop', 'building-store')
/** A Nitro price. */
export const Nitro = icon('nitro', 'diamond')
// A server's owner (the crown beside their name) and someone boosting the server (Discord's boost gem).
export const Crown = icon('crown', 'crown')
// Message requests: DMs from people you aren't friends with, waiting for Accept.
export const Mail = icon('mail', 'mail')
export const Boost = icon('boost', 'diamonds')
export const Poll = icon('poll', 'chart-bar')
export const Award = icon('award', 'award')
export const Trophy = icon('trophy', 'trophy')
export const Gamepad = icon('gamepad', 'device-gamepad-2')
export const Tv = icon('tv', 'device-tv')
export const Disc = icon('disc', 'disc')
export const Live = icon('live', 'screen-share')
export const Monitor = icon('monitor', 'device-desktop')
export const AppWindow = icon('app-window', 'app-window')
export const Flag = icon('flag', 'flag')
export const Leaf = icon('leaf', 'leaf')
export const Pizza = icon('pizza', 'pizza')
export const Car = icon('car', 'car')
export const Lightbulb = icon('lightbulb', 'bulb')
export const Symbols = icon('symbols', 'icons')
export const BadgeCheck = icon('badge-check', 'rosette-discount-check')
/** A super reaction. */
export const Burst = icon('burst', 'sparkle-highlight')
export const AddCircle = icon('add-circle', 'circle-plus')
export const HashLock = marked('hash-lock', 'hash', 'lock-filled')
export const VolumeLock = marked('volume-lock', 'volume', 'lock-filled')
export const ZoomIn = icon('zoom-in', 'zoom-in')
export const Speaker = icon('speaker', 'speakerphone')
export const ZoomOut = icon('zoom-out', 'zoom-out')

// ── Capture and the snip editor ─────────────────────────────────────────────────────────
export const Record = icon('record', 'player-record')
export const Scissors = icon('scissors', 'scissors')
export const Crop = icon('crop', 'crop')
export const Highlighter = icon('highlighter', 'highlight')
export const TextIcon = icon('text', 'typography')

// ── Exo Notes ───────────────────────────────────────────────────────────────────────────
export const Notes = icon('notes', 'notes')
export const FileText = icon('file-text', 'file-text')
export const SaveFile = icon('save', 'device-floppy')
export const Bold = icon('bold', 'bold')
export const Italic = icon('italic', 'italic')
export const Strike = icon('strike', 'strikethrough')
export const Heading = icon('heading', 'heading')
export const BulletList = icon('bullet-list', 'list')
export const Checklist = icon('checklist', 'checkbox')
export const CodeIcon = icon('code', 'code')
export const ReplaceIcon = icon('replace', 'replace')
export const ArrowUp = icon('arrow-up', 'arrow-up')
export const ArrowDown = icon('arrow-down', 'arrow-down')

/** A check that draws itself in (tokens.css › .exo-motion-check): Tabler's check, as a line to animate. */
export const CHECK_PATH = 'M5 12l5 5l10 -10'

// ── Discord's own marks ─────────────────────────────────────────────────────────────────
/** A thread, as Discord draws it (its web client's ThreadIcon, solid on the same 24 grid): Tabler has no thread. */
export function Threads({ size = 16, className }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={classes('threads', false, className)} style={block}>
    <path d="M12 2.81a1 1 0 0 1 0-1.41l.36-.36a1 1 0 0 1 1.41 0l9.2 9.2a1 1 0 0 1 0 1.4l-.7.7a1 1 0 0 1-1.3.13l-9.54-6.72a1 1 0 0 1-.08-1.58l1-1L12 2.8ZM12 21.2a1 1 0 0 1 0 1.41l-.35.35a1 1 0 0 1-1.41 0l-9.2-9.19a1 1 0 0 1 0-1.41l.7-.7a1 1 0 0 1 1.3-.12l9.54 6.72a1 1 0 0 1 .07 1.58l-1 1 .35.36ZM15.66 16.8a1 1 0 0 1-1.38.28l-8.49-5.66A1 1 0 1 1 6.9 9.76l8.49 5.65a1 1 0 0 1 .27 1.39ZM17.1 14.25a1 1 0 1 0 1.11-1.66L9.73 6.93a1 1 0 0 0-1.11 1.66l8.49 5.66Z" />
  </svg>
}

// ── Brand marks ─────────────────────────────────────────────────────────────────────────
export const Spotify = brand('spotify')
export const AppleMusic = brand('apple-music')
/** Official YouTube Music mark, from music.youtube.com/img/on_platform_logo_dark.svg. */
export function YouTube({ size = 16, className }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden="true" className={className} style={block}>
    <path d="m13 26c7.176 0 13-5.824 13-13s-5.824-13-13-13-13 5.824-13 13 5.824 13 13 13z" fill="#f03" />
    <path d="m20.5 13c0 4.1439-3.3561 7.5-7.5 7.5-4.14386 0-7.5-3.3561-7.5-7.5 0-4.14386 3.35614-7.5 7.5-7.5 4.1439 0 7.5 3.35614 7.5 7.5z" stroke="#fff" />
    <path d="m17.75 13-7.5-4.25v8.5z" fill="#fff" />
  </svg>
}

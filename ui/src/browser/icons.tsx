import type { CSSProperties } from 'react'
import { GLYPHS } from './glyphs'

/*
 * Exo Browser's icons: Exo's family and Exo's rules (brand/icons.tsx): Tabler at a 1.875 line on its 24 grid,
 * 16 px by default, the -filled glyph for a toggle that is on. scripts/browser-icons.mjs writes the glyphs named
 * here into glyphs.ts.
 */
type Name = keyof typeof GLYPHS
export type IconProps = { size?: number; className?: string; filled?: boolean }

const LINE = 1.875
const block: CSSProperties = { display: 'block', flexShrink: 0 }

function glyph(name: string, tabler: Name) {
  function ExoIcon({ size = 16, className, filled }: IconProps) {
    const solid = `${tabler}-filled` as Name
    const drawn = filled && solid in GLYPHS ? solid : tabler
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={LINE} strokeLinecap="round"
        strokeLinejoin="round" aria-hidden="true" className={['exo-glyph', `is-${name}`, className].filter(Boolean).join(' ')} style={block}>
        {GLYPHS[drawn].map(([kind, d], i) => <path key={i} d={d} fill={kind ? 'currentColor' : undefined} stroke={kind === 1 ? 'none' : undefined} />)}
      </svg>
    )
  }
  ExoIcon.displayName = name
  return ExoIcon
}

export type Icon = ReturnType<typeof glyph>

// The window and the Bar
export const Back = glyph('back', 'arrow-left')
export const Forward = glyph('forward', 'arrow-right')
export const Reload = glyph('reload', 'refresh')
export const Close = glyph('close', 'x')
export const Minus = glyph('minus', 'minus')
export const Maximize = glyph('maximize', 'square')
export const Restore = glyph('restore', 'box-multiple')
export const Settings = glyph('settings', 'settings')
export const Plus = glyph('plus', 'plus')
export const Search = glyph('search', 'search')
export const Lock = glyph('lock', 'lock')
export const Globe = glyph('globe', 'world')
export const Star = glyph('star', 'star')
export const Puzzle = glyph('puzzle', 'puzzle')
export const Download = glyph('download', 'download')
export const Grid = glyph('grid', 'layout-grid')
export const ChevronUp = glyph('chevron-up', 'chevron-up')
export const ChevronDown = glyph('chevron-down', 'chevron-down')

// Tabs and menus
export const Volume = glyph('volume', 'volume')
export const VolumeOff = glyph('volume-off', 'volume-off')
export const Pin = glyph('pin', 'pin')
export const Sleep = glyph('sleep', 'zzz')
export const Archive = glyph('archive', 'archive')
export const Sparkles = glyph('sparkles', 'sparkles')
export const Copy = glyph('copy', 'copy')
export const Undo = glyph('undo', 'arrow-back-up')
export const PictureInPicture = glyph('pip', 'picture-in-picture')
export const SideTabs = glyph('side-tabs', 'layout-sidebar')
export const TopTabs = glyph('top-tabs', 'layout-navbar')
export const ExternalLink = glyph('external', 'external-link')
export const History = glyph('history', 'history')
export const Shield = glyph('shield', 'shield-check')
// Exo Vault's.
export const Vault = glyph('vault', 'shield-lock')
export const Key = glyph('key', 'key')
export const Card = glyph('card', 'credit-card')
export const Note = glyph('note', 'notes')
export const Identity = glyph('identity', 'id')
export const Eye = glyph('eye', 'eye')
export const EyeOff = glyph('eye-off', 'eye-off')
export const Fingerprint = glyph('fingerprint', 'fingerprint')
export const Alert = glyph('alert', 'alert-circle')
export const Dice = glyph('dice', 'dice-5')
export const Pencil = glyph('pencil', 'pencil')
export const Check = glyph('check', 'check')
export const Upload = glyph('upload', 'upload')
export const LockOpen = glyph('lock-open', 'lock-open')
export const Clock = glyph('clock', 'clock')
export const Import = glyph('import', 'file-import')
export const FileDown = glyph('file-down', 'file-download')
export const FolderOpen = glyph('folder-open', 'folder-open')
export const Folder = glyph('folder', 'folder')
export const FolderPlus = glyph('folder-plus', 'folder-plus')
export const ChevronRight = glyph('chevron-right', 'chevron-right')
export const Rss = glyph('rss', 'rss')
export const Private = glyph('private', 'spy')
export const Trash = glyph('trash', 'trash')
export const Grip = glyph('grip', 'grip-vertical')
// Solid, as every player draws them (Exo's rule).
export const Play = glyph('play', 'player-play-filled')
export const Pause = glyph('pause', 'player-pause-filled')
// Spaces, split view and Glance.
export const Home = glyph('home', 'home')
export const Briefcase = glyph('briefcase', 'briefcase')
export const Code = glyph('code', 'code')
export const School = glyph('school', 'school')
export const Heart = glyph('heart', 'heart')
export const Music = glyph('music', 'music')
export const Gamepad = glyph('gamepad', 'device-gamepad-2')
export const Cart = glyph('cart', 'shopping-cart')
export const Plane = glyph('plane', 'plane')
export const Palette = glyph('palette', 'palette')
export const Flask = glyph('flask', 'flask')
export const Coffee = glyph('coffee', 'coffee')
export const Planet = glyph('planet', 'planet')
export const Columns = glyph('columns', 'layout-columns')
export const Expand = glyph('expand', 'arrows-diagonal')
export const Link = glyph('link', 'link')
export const Zap = glyph('zap', 'bolt')
export const Brush = glyph('brush', 'brush')
// A page's right-click menu (pageMenu.ts): the engine's commands, in Exo's glyphs where Exo has the meaning.
export const Redo = glyph('redo', 'arrow-forward-up')
export const Cut = glyph('cut', 'cut')
export const Paste = glyph('paste', 'clipboard')
export const SelectAll = glyph('select-all', 'select-all')
export const Printer = glyph('printer', 'printer')
export const Save = glyph('save', 'device-floppy')
export const Photo = glyph('photo', 'photo')
export const SaveImage = glyph('save-image', 'photo-down')
export const Video = glyph('video', 'video')
export const Repeat = glyph('repeat', 'repeat')
export const Smile = glyph('smile', 'mood-smile')
export const Qr = glyph('qr', 'qrcode')
export const Language = glyph('language', 'language')
export const ExitFullScreen = glyph('exit-full-screen', 'arrows-minimize')
// A notice's own glyph (Exo's NoticeStack).
export const Bell = glyph('bell', 'bell')

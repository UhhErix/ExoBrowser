import spotify from '../assets/logos/spotify.svg'
import appleMusic from '../assets/logos/apple-music.png'
import discord from '../assets/logos/discord.svg'
import steam from '../assets/logos/steam.svg'
import epic from '../assets/logos/epic.svg'
import gog from '../assets/logos/gog.svg'
import riot from '../assets/logos/riot.png'
import xbox from '../assets/logos/xbox.svg'
import ea from '../assets/logos/ea.svg'
import ubisoft from '../assets/logos/ubisoft.svg'
import battlenet from '../assets/logos/battlenet.svg'
import amazon from '../assets/logos/amazon.svg'
import rockstar from '../assets/logos/rockstar.svg'
import itch from '../assets/logos/itch.svg'
import paradox from '../assets/logos/paradox.svg'
import youtube from '../assets/logos/youtube.svg'
import microsoft from '../assets/logos/microsoft.svg'
import wargaming from '../assets/logos/wargaming.ico'
import roblox from '../assets/logos/roblox.svg'

const logos: Readonly<Record<string, string>> = {
  spotify,
  'apple-music': appleMusic,
  discord,
  steam,
  epic,
  gog,
  riot,
  xbox, ea, ubisoft, battlenet, amazon, rockstar, itch, paradox, wargaming, roblox,
  youtube, 'youtube-music': youtube, 'microsoft-store': microsoft,
}

/** Single-color vendor marks sit on their brand color, the way each store
    ships its own app tile; the mark itself is drawn white or black on it. */
const tiles: Readonly<Record<string, { bg: string; ink: 'white' | 'black' }>> = {
  xbox: { bg: '#107c10', ink: 'white' },
  ea: { bg: '#ff4747', ink: 'white' },
  ubisoft: { bg: '#0f7dff', ink: 'white' },
  battlenet: { bg: '#148eff', ink: 'white' },
  amazon: { bg: '#ff9900', ink: 'black' },
  rockstar: { bg: '#fcaf17', ink: 'black' },
  itch: { bg: '#fa5c5c', ink: 'white' },
  paradox: { bg: '#2b4c7e', ink: 'white' },
  gog: { bg: '#86328a', ink: 'white' },
  youtube: { bg: '#ff0000', ink: 'white' },
  'youtube-music': { bg: '#ff0000', ink: 'white' },
  'microsoft-store': { bg: '#0078d4', ink: 'white' },
}

/** Bundled vendor artwork, with original colors and proportions. */
export function CompanyLogo({
  company,
  size = 24,
  className,
}: {
  company: string
  size?: number
  className?: string
}) {
  const src = logos[company]
  if (!src) return null
  const tile = tiles[company]
  const image = (
    <img
      src={src}
      alt=""
      aria-hidden
      width={tile ? Math.round(size * 0.62) : size}
      height={tile ? Math.round(size * 0.62) : size}
      draggable={false}
      decoding="async"
      className={tile ? undefined : ['exo-company-logo', className].filter(Boolean).join(' ')}
      style={{
        display: 'block',
        flexShrink: 0,
        objectFit: 'contain',
        filter: tile?.ink === 'white' ? 'brightness(0) invert(1)' : tile ? 'brightness(0)' : undefined,
      }}
    />
  )
  if (!tile) return image
  return (
    <span
      aria-hidden
      className={['exo-company-logo', className].filter(Boolean).join(' ')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        background: tile.bg,
      }}
    >
      {image}
    </span>
  )
}

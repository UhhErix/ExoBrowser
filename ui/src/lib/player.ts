/**
 * Shapes Exo's own music player receives from a service's adapter
 * (Helpers/SpotifyNative.cs, Helpers/YouTubeMusicNative.cs, Helpers/AppleMusicNative.cs). Ids (`uri`) are
 * the service's own and opaque to the player: it only hands them back.
 */
export type PlayerKind = 'playlist' | 'album' | 'artist' | 'track' | 'show' | 'episode' | 'folder' | 'collection' | string
/** url: the item's own share link, where the service gives one; pinned and owned: Your library's own flags (Spotify), for its menus. */
export type PlayerCard = { uri: string; kind: PlayerKind; title: string; subtitle: string; image: string; url?: string; pinned?: boolean; owned?: boolean }
export type PlayerArtist = { uri: string; name: string }
/** A page a shelf or list opens (its More). */
export type PlayerLink = { uri: string; kind: PlayerKind }
export type PlayerTrack = {
  uri: string
  uid: string
  title: string
  artists: PlayerArtist[]
  album: { uri: string; name: string } | null
  image: string
  durationMs: number
  explicit: boolean
  playable: boolean
  /** In your liked songs, where the service says so per song (Spotify, YouTube Music, Apple Music's Favorites). */
  liked?: boolean
  /** You asked for less like it (Apple Music's Suggest less). */
  disliked?: boolean
  /** In your library, where the service says so per song. */
  inLibrary?: boolean
  /** The song's own share link. */
  url?: string
  /** An episode: its release day (yyyy-mm-dd), whether you finished it, and how far you got. */
  date?: string
  played?: boolean
  progressMs?: number
}
export type PlayerHeader = {
  uri: string
  title: string
  subtitle: string
  image: string
  banner?: string
  description?: string
  artists?: PlayerArtist[]
  saved?: boolean
  /** Your own playlist: its songs can be removed. */
  editable?: boolean
  /** The page's own share link. */
  url?: string
  /** Formats the album comes in (Dolby Atmos, Lossless), as facts about it, never what is playing. */
  badges?: string[]
  /** The artist's biography, whole. */
  about?: string
  /** One-line facts: an album's release date, length, label and copyright; an artist's origin and genre. */
  facts?: string[]
  /** The artist's station, played from the page. */
  station?: string
  /** Your own playlist's privacy: PUBLIC, UNLISTED or PRIVATE (YouTube Music). */
  privacy?: string
  /** The page can start a radio of its own (YouTube Music's Start mix). */
  radio?: boolean
  /** Spotify: a playlist you made (its details, privacy and collaborators are yours to change). */
  owned?: boolean
  public?: boolean
  collaborative?: boolean
  /** Downloaded for offline listening; 'downloading' while it is; null when the service does not say. */
  downloaded?: boolean | 'downloading' | null
  /** An album: its release day, label, copyright lines and length. */
  date?: string
  label?: string
  copyright?: string[]
  durationMs?: number
}
/** An artist's About. */
export type ArtistAbout = {
  bio: string
  followers: number
  listeners: number
  rank: number
  image: string
  cities: Array<{ city: string; country: string; listeners: number }>
  links: Array<{ name: string; url: string }>
}
export type Concert = { title: string; date: string; place: string; venue: string; uri: string }
/** A song's credits by role; roles: what each person did, where the service says (Apple Music). */
export type Credits = { title: string; groups: Array<{ role: string; people: Array<{ name: string; uri: string; roles?: string }> }>; sources: string }
/** A library filter or sort order, named by the service itself. */
export type PlayerOption = { id: string; name: string }
/** notPremium: signed in on an account the room can't play on (Spotify Free). storeEdition: only
    Spotify's Microsoft Store edition is installed, which Exo can't host. */
export type PlayerRoomState = 'loading' | 'notInstalled' | 'storeEdition' | 'signedOut' | 'notPremium' | 'running' | 'error'
export type PlayerView = 'home' | 'search' | 'library' | 'songs' | 'collection' | 'playlist' | 'album' | 'artist' | 'show' | 'queue' | 'devices' | 'player'
  | 'lyrics' | 'friends' | 'jam' | 'recent' | 'playlists' | 'audio' | 'explore' | 'browse' | 'radio' | 'history' | 'credits' | 'related' | 'discography'
export type PlayerAction = 'play' | 'enqueue' | 'skipTo' | 'like' | 'shuffle' | 'repeat' | 'transfer' | 'addToPlaylist' | 'removeFromPlaylist'
  | 'jamStart' | 'jamLeave' | 'jamEnd' | 'jamRemove' | 'audio' | 'playNext' | 'dequeue' | 'queueMove' | 'clearQueue'
  | 'station' | 'library' | 'suggestLess' | 'createPlaylist' | 'editPlaylist' | 'deletePlaylist' | 'movePlaylistTrack' | 'autoplay'
  | 'dislike' | 'radio' | 'shufflePlay' | 'video'
  | 'createFolder' | 'renameFolder' | 'deleteFolder' | 'moveToFolder' | 'playlistImage'
  | 'privacy' | 'collaborative' | 'pin' | 'played' | 'download' | 'speed' | 'jamJoin' | 'jamGuestsPlay' | 'jamGuestVolume'
/** uri: the page or folder (Songs: a genre or mood chip); query: search text, a library "filter|sort", or the Songs page's "sort|filter"; offset: rows already shown. */
export type PlayerViewOptions = { uri?: string; query?: string; offset?: number }
/**
 * query: the Songs page's "sort|filter" a song plays in; name: a new name, a Spotify move ("before|uri|uid") or a Jam token;
 * description: a playlist's; privacy: a playlist's (YouTube Music: PUBLIC, UNLISTED or PRIVATE); image: a new cover as a JPEG
 * data URL; text: typed words as JSON for the web services (a move in a playlist: from, to and the row it goes before).
 */
export type PlayerActOptions = {
  uri?: string; context?: string; index?: number; on?: boolean; uid?: string; query?: string
  name?: string; description?: string; privacy?: string; image?: string; text?: string
}
export type PlayerDevice ={ id: string; name: string; type: string; active: boolean; local: boolean }
export type PlayerState = {
  trackUri: string
  contextUri: string
  shuffle: boolean
  /** 0 off, 1 the context, 2 the track. */
  repeat: number
  liked: boolean
  canShuffle: boolean
  canRepeat: boolean
  /** YouTube Music: the song is thumbed down; the song has a music video, and it is what plays. */
  disliked?: boolean
  canVideo?: boolean
  video?: boolean
  /** Playback speed (podcasts and audiobooks), 1 at normal. */
  speed?: number
  /** The playing song at full size, for the now playing panel. */
  image?: string
  title?: string
  artists?: PlayerArtist[]
  /** Autoplay: similar music plays on when the queue ends. */
  autoplay?: boolean
}
export type PlayerFriend = {
  user: { uri: string; name: string; image: string }
  track: { uri: string; title: string; image: string; artist: PlayerArtist | null; context: { uri: string; name: string } | null }
  /** When the song started (ms since the epoch). */
  at: number
}
export type JamSession = {
  owner: boolean
  link: string
  canRemove: boolean
  members: Array<{ id: string; name: string; image: string; me: boolean; host: boolean }>
  /** The host's switches: guests change what plays; guests change the volume (null where Spotify offers no such switch). */
  guestsPlay?: boolean
  guestVolume?: boolean | null
}
/** words: the line word by word, where the service times each word. */
/**
 * A lyric line: when it starts, its words (Apple's word-timed lyrics; bg: a background vocal, sung under the line), and
 * who sings it (agent, "v1", "v2": a duet's other singer is drawn from the right).
 */
export type LyricsLine = { start: number; text: string; words?: Array<{ start: number; end: number; text: string; bg?: boolean }>; agent?: string }

/** One answer shape for every view; each view fills its own fields. */
export type PlayerViewData = {
  greeting?: string
  /** more: the shelf's whole list (its More), where the service has one. */
  sections?: Array<{ title: string; more?: PlayerLink; items: PlayerCard[] }>
  /** An artist's songs as one list (YouTube Music's Top songs). */
  more?: PlayerLink
  items?: PlayerCard[]
  top?: PlayerCard[]
  artists?: PlayerCard[]
  albums?: PlayerCard[]
  playlists?: PlayerCard[]
  shows?: PlayerCard[]
  audiobooks?: PlayerCard[]
  episodes?: PlayerTrack[]
  singles?: PlayerCard[]
  related?: PlayerCard[]
  compilations?: PlayerCard[]
  appearsOn?: PlayerCard[]
  featuring?: PlayerCard[]
  discoveredOn?: PlayerCard[]
  about?: ArtistAbout
  concerts?: Concert[]
  /** Liked Songs' genre and mood chips (Spotify). */
  tags?: PlayerOption[]
  /** Song or artist radio: the playlist to open. */
  uri?: string
  header?: PlayerHeader | null
  contextUri?: string
  tracks?: PlayerTrack[]
  offset?: number
  total?: number
  current?: PlayerTrack | null
  queued?: PlayerTrack[]
  next?: PlayerTrack[]
  /** What Autoplay adds after the queue (Apple Music; YouTube Music's are its next). */
  autoplayed?: PlayerTrack[]
  stations?: PlayerCard[]
  videos?: PlayerCard[]
  devices?: PlayerDevice[]
  filters?: PlayerOption[]
  filter?: string
  sorts?: PlayerOption[]
  sort?: string
  folder?: { uri: string; title: string; parent: string } | null
  friends?: PlayerFriend[]
  /** Jam: PREMIUM, FREE or NONE. */
  experience?: string
  session?: JamSession | null
  lines?: LyricsLine[]
  synced?: boolean
  /** The service's audio quality choices, as its own settings name them; detail says what one streams. */
  qualities?: Array<PlayerOption & { detail?: string }>
  quality?: string
} & Partial<PlayerState> & Partial<Credits>

export function trackLength(ms: number) {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

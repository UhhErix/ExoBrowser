// DESIGN.md's type scale for scripts/css-design.mjs (hover rules need no settings).
const scaled = (px) => `calc(${px}px * var(--exo-scale, 1))`

export default {
  // Title 20, body and controls 13, small 12.
  sizes: [20, 13, 12],
  // Exo's one slider (components/ui/Slider.tsx); tokens.css only adds its forced-colors fallback.
  sliderFiles: ['src/styles/chrome.css', 'src/tokens.css'],
  // Discord's Nitro name and profile effects keep Discord's own timings and curves (DESIGN.md › Motion › In the background).
  motionExempt: ['src/styles/discord-collectibles.css'],
  // Each exception is one selector on one surface, at one exact value.
  exceptions: [
    { selector: ':root', value: scaled(16), why: 'The rem base Tailwind spacing is measured in, not a text size on a surface' },
    { selector: '.exo-game-title', value: scaled(28), why: 'Game sheet: the game title' },
    { selector: '.exo-music-header h2', value: scaled(28), why: 'Music: a playlist, album or artist page title beside its cover, as on the game sheet' },
    { selector: '.exo-pc-about-name', value: scaled(28), why: "PC: this PC's name as the room's hero, a page title as on the game sheet" },
    { selector: '.exo-ob-title', value: scaled(32), why: 'First run: the step title' },
    { selector: '.exo-dc-picker-char', value: '30px', why: 'Discord emoji picker: a Unicode emoji drawn the 32px a server emoji\'s picture is, not text' },
    { selector: '.exo-dc-picker-foot .exo-dc-picker-char', value: '26px', why: 'Discord emoji picker footer: the emoji pointed at, the 28px of a picture there' },
    { selector: '.exo-cover-mono > span', value: 'clamp(14px, 16cqi, 30px)', why: 'Library card with no art: the title drawn as the cover, sized to the card' },
  ],
}

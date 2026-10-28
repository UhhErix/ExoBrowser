// Exo UI lint. Complexity is enforced app-wide: every function in src/ must
// stay under the same cyclomatic budget. Push logic into lib/ helpers or
// smaller components instead of raising the budget.
// React Compiler runs at build (oxc-transform-react). Compiler-only lint rules
// stay off: this app mirrors props into refs on purpose.
import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export const COMPLEXITY_BUDGET = 20

// DESIGN.md rules for markup and Tailwind classes (CSS files: scripts/css-design.mjs).
const inClasses = (pattern, message) => [
  { selector: `Literal[value=${pattern}]`, message },
  { selector: `TemplateElement[value.raw=${pattern}]`, message },
]
// Vite's minifier turned a BigInt literal inside JSX into void 0 (BigInt(id) >> void 0 crashed the Discord room):
// BigInt math lives in lib/discord.ts, whose helpers compile right.
const BIGINT_RULE = { selector: 'Literal[bigint]', message: 'Use the snowflake helpers in lib/discord.ts; inline BigInt literals were miscompiled.' }

const DESIGN_RULES = [
  {
    // Lowercase only, and never <iframe>, whose title is its accessible name. A component's own `title` prop (Panel, Row) is a heading, not a tooltip.
    // <Button> forwards attributes to <button>, so its props type omits `title`.
    selector: "JSXOpeningElement[name.name=/^[a-z]/]:not([name.name='iframe']) > JSXAttribute[name.name='title']",
    message: 'No native title= tooltips (DESIGN.md). Name the control with aria-label.',
  },
  {
    selector: "JSXAttribute[name.name='style'] Property[key.name='fontSize']",
    message: 'Font size lives in CSS on the type scale (exo/type-scale in scripts/css-design.mjs), not inline.',
  },
  ...inClasses(String.raw`/hover:bg-(white|\[(#fff|rgba?\(255|hsla?\(0))/`,
    'A hover background is never see-through white: use hover:bg-(--hover-fill).'),
  ...inClasses(String.raw`/hover:opacity-(?!100(?![\w.]))/`,
    'Hover never fades: change colour or use the hover fill instead of hover:opacity-*.'),
  ...inClasses(String.raw`/(^|[\s:])text-(xs|sm|base|lg|xl|[2-9]xl)(?![\w-])/`,
    'Tailwind text sizes are off the type scale: use text-[length:calc(12|13|20px*var(--exo-scale,1))].'),
  ...inClasses(String.raw`/text-\[(?!length:calc\((12|13|20)px\*var\(--exo-scale,1\)\)\])(length:)?[^\]]*\d(px|rem|em)/`,
    'Off the type scale: use text-[length:calc(12|13|20px*var(--exo-scale,1))].'),
]

// One control per job (DESIGN.md › Controls): Exo's Switch is the only on/off control, and buttons come from one set.
const inClassNames = (pattern, message) => [
  { selector: `JSXAttribute[name.name=/[cC]lassName$/] Literal[value=${pattern}]`, message },
  { selector: `JSXAttribute[name.name=/[cC]lassName$/] TemplateElement[value.raw=${pattern}]`, message },
]
const SWITCH_RULES = [
  { selector: "JSXOpeningElement[name.name='input'] > JSXAttribute[name.name='type'][value.value=/^(checkbox|radio)$/]",
    message: 'No native checkbox or radio: an on/off is components/Switch.tsx, one of a few is a segmented pill (.exo-shelf-chips) or a menu.' },
  { selector: "JSXAttribute[name.name='role'][value.value=/^(switch|checkbox)$/]",
    message: 'An on/off is components/Switch.tsx, never a hand-made role="switch" or role="checkbox".' },
]
const BUTTON_RULES = inClassNames(String.raw`/(^|\s)(button(--[a-z-]*)?|exo-ghost-btn|exo-cta|exo-capture-chip|exo-set-chip)(\s|$)/`,
  'Buttons come from one set: .exo-set-btn (.is-primary, .is-danger, .is-compact) for every button, <Button variant="primary"> for a page\'s lone primary and <Button variant="ghost"> for a quiet one (DESIGN.md › Controls).')

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', '../ExoLauncher/wwwroot/**', 'vite.chunks.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.es2023 },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      complexity: ['error', { max: COMPLEXITY_BUDGET }],
      'max-depth': ['error', 4],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'prefer-const': 'error',
      'no-restricted-syntax': ['error', ...DESIGN_RULES, ...SWITCH_RULES, ...BUTTON_RULES, BIGINT_RULE],
      'no-useless-escape': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  // lib/discord.ts holds the snowflake math (BigInt), which compiles right there.
  { files: ['src/lib/discord.ts'], rules: { 'no-restricted-syntax': ['error', ...DESIGN_RULES] } },
  // The two components that own what the control rules keep everywhere else.
  { files: ['src/components/Switch.tsx'], rules: { 'no-restricted-syntax': ['error', ...DESIGN_RULES, ...BUTTON_RULES, BIGINT_RULE] } },
  { files: ['src/components/ui/Button.tsx'], rules: { 'no-restricted-syntax': ['error', ...DESIGN_RULES, ...SWITCH_RULES, BIGINT_RULE] } },
)


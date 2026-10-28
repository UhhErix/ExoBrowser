import { useBrowserValue } from '../host'
import { DEFAULT_RECIPE } from './generate'

/** Generated passwords follow Vault settings: their length, and whether they use symbols. Its own module, so the fill
 *  menu (always loaded) doesn't load the item editor with it. */
export function useRecipe() {
  const length = useBrowserValue(b => b.settings.vaultLength), symbols = useBrowserValue(b => b.settings.vaultSymbols)
  return { ...DEFAULT_RECIPE, length: Number(length || DEFAULT_RECIPE.length), symbols: (symbols || 'on') === 'on' }
}

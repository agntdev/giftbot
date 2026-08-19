// AGNTDEV bot toolkit — main-menu registry.
//
// The platform's bots are BUTTON-FIRST: non-technical owners want users who
// operate the bot by TAPPING, not by memorising slash commands. This registry is
// how a feature becomes reachable from the /start main menu WITHOUT minting a new
// slash command and WITHOUT editing a shared file (so concurrent feature PRs never
// conflict): each `src/handlers/<slug>.ts` calls `registerMainMenuItem(...)` at
// module load, and the shipped `/start` handler renders the aggregate keyboard.
//
// Pure + dependency-free (no grammY import) so it stays unit-testable and the test
// harness can assert against the exact keyboard a /start produces.

import {
  inlineButton,
  inlineKeyboard,
  type InlineKeyboardMarkup,
} from "./keyboard.js";

/** One top-level main-menu button. */
export interface MainMenuItem {
  /** Button text the user sees (keep it short; ≤1 emoji). */
  label: string;
  /** `callback_data` the button sends; route it with `.callbackQuery(data, ...)`. */
  data: string;
  /** Sort key (ascending; default 100). Lower shows first. */
  order?: number;
}

const registry: MainMenuItem[] = [];

/**
 * Register a top-level main-menu button. Call this at module load from a feature
 * handler so `/start` lists it — this is how a feature becomes reachable by a TAP
 * instead of a slash command. Idempotent per `data` (re-registering replaces).
 */
export function registerMainMenuItem(item: MainMenuItem): void {
  const at = registry.findIndex((i) => i.data === item.data);
  if (at >= 0) registry[at] = item;
  else registry.push(item);
}

/** Registered items, sorted by `order` then label. (Snapshot — safe to mutate.) */
export function mainMenuItems(): MainMenuItem[] {
  return [...registry].sort(
    (a, b) => (a.order ?? 100) - (b.order ?? 100) || a.label.localeCompare(b.label),
  );
}

/**
 * Build the main-menu inline keyboard from every registered item, `columns` per
 * row, with a Help button (`menu:help`) always appended last. Render this from
 * the `/start` handler and from a "back to menu" action.
 */
export function mainMenuKeyboard(columns = 2): InlineKeyboardMarkup {
  const cols = Math.max(1, Math.floor(columns));
  const items = mainMenuItems();
  const rows = [];
  for (let i = 0; i < items.length; i += cols) {
    rows.push(items.slice(i, i + cols).map((it) => inlineButton(it.label, it.data)));
  }
  rows.push([inlineButton("❓ Help", "menu:help")]);
  return inlineKeyboard(rows);
}

/** Clear the registry. Test-only hook; never call from bot code. */
export function _resetMainMenu(): void {
  registry.length = 0;
}

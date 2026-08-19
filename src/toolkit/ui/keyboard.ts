// AGNTDEV bot toolkit — inline-keyboard UI-kit.
//
// Pure builders that return plain Telegram InlineKeyboardMarkup-shaped objects.
// Kept dependency-free (no grammY import) so the UI-kit is fully unit-testable
// without a running bot — and so the test harness (M0-10) can assert against the
// exact outgoing-call payloads a bot produces.

/** A callback button: tapping it sends `callback_data` back to the bot. */
export interface CallbackButton {
  text: string;
  callback_data: string;
}

/** A url button: tapping it opens `url`. */
export interface UrlButton {
  text: string;
  url: string;
}

/** A single inline keyboard button. Discriminated so the markup is structurally
 *  assignable to grammY's `reply_markup` while staying dependency-free. */
export type InlineButton = CallbackButton | UrlButton;

/** Telegram InlineKeyboardMarkup shape. */
export interface InlineKeyboardMarkup {
  inline_keyboard: InlineButton[][];
}

/** A callback button: tapping it sends `callbackData` back to the bot. */
export function inlineButton(text: string, callbackData: string): CallbackButton {
  return { text, callback_data: callbackData };
}

/** A url button: tapping it opens `url`. */
export function urlButton(text: string, url: string): UrlButton {
  return { text, url };
}

/** Wrap rows of buttons into an InlineKeyboardMarkup. */
export function inlineKeyboard(rows: InlineButton[][]): InlineKeyboardMarkup {
  return { inline_keyboard: rows };
}

/** A menu: one callback button per item, laid out in `columns` per row. */
export function menuKeyboard(
  items: ReadonlyArray<{ text: string; data: string }>,
  columns = 1,
): InlineKeyboardMarkup {
  const cols = Math.max(1, Math.floor(columns));
  const rows: InlineButton[][] = [];
  for (let i = 0; i < items.length; i += cols) {
    rows.push(items.slice(i, i + cols).map((it) => inlineButton(it.text, it.data)));
  }
  return inlineKeyboard(rows);
}

/** A yes/no confirmation. Callbacks are `<actionPrefix>:yes` / `<actionPrefix>:no`. */
export function confirmKeyboard(
  actionPrefix: string,
  opts?: { yes?: string; no?: string },
): InlineKeyboardMarkup {
  return inlineKeyboard([
    [
      inlineButton(opts?.yes ?? "✅ Yes", `${actionPrefix}:yes`),
      inlineButton(opts?.no ?? "❌ No", `${actionPrefix}:no`),
    ],
  ]);
}

export interface PaginateOptions {
  /** 0-based requested page (clamped into range). */
  page: number;
  perPage: number;
  /** Callback prefix for the prev/next controls; default "page". */
  callbackPrefix?: string;
  prevLabel?: string;
  nextLabel?: string;
}

export interface Paginated<T> {
  /** Clamped 0-based page actually shown. */
  page: number;
  totalPages: number;
  pageItems: T[];
  /** Prev/Next control row (empty inline_keyboard when a single page). */
  controls: InlineKeyboardMarkup;
}

/**
 * Slice `items` into a page and build prev/next controls. Controls carry the
 * target page index in their callback data: `<prefix>:prev:<n>` / `<prefix>:next:<n>`.
 */
export function paginate<T>(items: ReadonlyArray<T>, opts: PaginateOptions): Paginated<T> {
  const perPage = Math.max(1, Math.floor(opts.perPage));
  const totalPages = Math.max(1, Math.ceil(items.length / perPage));
  const page = Math.min(Math.max(0, Math.floor(opts.page)), totalPages - 1);
  const start = page * perPage;
  const pageItems = items.slice(start, start + perPage);

  const prefix = opts.callbackPrefix ?? "page";
  const row: InlineButton[] = [];
  if (page > 0) {
    row.push(inlineButton(opts.prevLabel ?? "« Prev", `${prefix}:prev:${page - 1}`));
  }
  if (page < totalPages - 1) {
    row.push(inlineButton(opts.nextLabel ?? "Next »", `${prefix}:next:${page + 1}`));
  }
  const controls: InlineKeyboardMarkup = {
    inline_keyboard: row.length > 0 ? [row] : [],
  };

  return { page, totalPages, pageItems, controls };
}

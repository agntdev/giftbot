import { describe, expect, it } from "vitest";
import {
  confirmKeyboard,
  type InlineButton,
  inlineButton,
  inlineKeyboard,
  menuKeyboard,
  paginate,
  urlButton,
} from "../src/toolkit/ui/keyboard";

// Narrow a button to its callback_data (undefined for url buttons).
const cbData = (b: InlineButton): string | undefined =>
  "callback_data" in b ? b.callback_data : undefined;

describe("inlineButton / urlButton", () => {
  it("builds a callback button", () => {
    expect(inlineButton("Yes", "confirm:1")).toEqual({ text: "Yes", callback_data: "confirm:1" });
  });
  it("builds a url button", () => {
    expect(urlButton("Docs", "https://x.io")).toEqual({ text: "Docs", url: "https://x.io" });
  });
});

describe("inlineKeyboard", () => {
  it("wraps rows into InlineKeyboardMarkup shape", () => {
    const kb = inlineKeyboard([
      [inlineButton("A", "a"), inlineButton("B", "b")],
      [inlineButton("C", "c")],
    ]);
    expect(kb).toEqual({
      inline_keyboard: [
        [{ text: "A", callback_data: "a" }, { text: "B", callback_data: "b" }],
        [{ text: "C", callback_data: "c" }],
      ],
    });
  });
});

describe("menuKeyboard", () => {
  it("lays out one button per row by default", () => {
    const kb = menuKeyboard([
      { text: "One", data: "1" },
      { text: "Two", data: "2" },
    ]);
    expect(kb.inline_keyboard.length).toBe(2);
  });
  it("respects a column count", () => {
    const kb = menuKeyboard(
      [
        { text: "1", data: "1" },
        { text: "2", data: "2" },
        { text: "3", data: "3" },
      ],
      2,
    );
    expect(kb.inline_keyboard.length).toBe(2);
    expect(kb.inline_keyboard[0]?.length).toBe(2);
    expect(kb.inline_keyboard[1]?.length).toBe(1);
  });
});

describe("confirmKeyboard", () => {
  it("emits yes/no callbacks under the action prefix", () => {
    const kb = confirmKeyboard("delete:42");
    const row = kb.inline_keyboard[0] ?? [];
    expect(row.some((b) => cbData(b) === "delete:42:yes")).toBe(true);
    expect(row.some((b) => cbData(b) === "delete:42:no")).toBe(true);
  });
});

describe("paginate", () => {
  const items = ["i0", "i1", "i2", "i3", "i4"];

  it("returns the requested page slice and total pages", () => {
    const p = paginate(items, { page: 0, perPage: 2 });
    expect(p.pageItems).toEqual(["i0", "i1"]);
    expect(p.totalPages).toBe(3);
    expect(p.page).toBe(0);
  });

  it("shows only Next on the first page", () => {
    const p = paginate(items, { page: 0, perPage: 2, callbackPrefix: "pg" });
    const row = p.controls.inline_keyboard[0] ?? [];
    expect(row.some((b) => cbData(b) === "pg:next:1")).toBe(true);
    expect(row.some((b) => cbData(b)?.startsWith("pg:prev"))).toBe(false);
  });

  it("shows only Prev on the last page", () => {
    const p = paginate(items, { page: 2, perPage: 2, callbackPrefix: "pg" });
    expect(p.pageItems).toEqual(["i4"]);
    const row = p.controls.inline_keyboard[0] ?? [];
    expect(row.some((b) => cbData(b) === "pg:prev:1")).toBe(true);
    expect(row.some((b) => cbData(b)?.startsWith("pg:next"))).toBe(false);
  });

  it("clamps an out-of-range page to the last page", () => {
    const p = paginate(items, { page: 99, perPage: 2 });
    expect(p.page).toBe(2);
    expect(p.pageItems).toEqual(["i4"]);
  });
});

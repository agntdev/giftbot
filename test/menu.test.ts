import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetMainMenu,
  mainMenuItems,
  mainMenuKeyboard,
  registerMainMenuItem,
} from "../src/toolkit/ui/menu";

describe("main-menu registry", () => {
  beforeEach(() => _resetMainMenu());

  it("registers items and sorts by order then label", () => {
    registerMainMenuItem({ label: "Bravo", data: "b", order: 20 });
    registerMainMenuItem({ label: "Alpha", data: "a", order: 10 });
    registerMainMenuItem({ label: "Carol", data: "c" }); // default order 100
    expect(mainMenuItems().map((i) => i.data)).toEqual(["a", "b", "c"]);
  });

  it("is idempotent per data (re-register replaces)", () => {
    registerMainMenuItem({ label: "Old", data: "x" });
    registerMainMenuItem({ label: "New", data: "x" });
    const items = mainMenuItems();
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe("New");
  });

  it("builds a keyboard with the items plus a trailing Help button", () => {
    registerMainMenuItem({ label: "One", data: "one" });
    registerMainMenuItem({ label: "Two", data: "two" });
    const kb = mainMenuKeyboard(2);
    // row 0 = the two items; last row = Help
    expect(kb.inline_keyboard[0]).toEqual([
      { text: "One", callback_data: "one" },
      { text: "Two", callback_data: "two" },
    ]);
    const last = kb.inline_keyboard[kb.inline_keyboard.length - 1];
    expect(last).toEqual([{ text: "❓ Help", callback_data: "menu:help" }]);
  });

  it("respects the columns argument", () => {
    for (const d of ["a", "b", "c"]) registerMainMenuItem({ label: d, data: d });
    const kb = mainMenuKeyboard(1);
    // 3 single-button rows + 1 Help row
    expect(kb.inline_keyboard).toHaveLength(4);
    expect(kb.inline_keyboard[0]).toHaveLength(1);
  });
});

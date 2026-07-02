// Catalog: IC-* (icon factory). Pins the distinct "shield" glyph used by the
// collapsed puck and the rail's session indicator — it must not be the same
// markup as the "whitelist" shield-check, so the two shields never read as the
// same control.
import { describe, expect, test } from "bun:test";

import { createIcon } from "../../entrypoints/content/icons.ts";

describe("createIcon shield glyph", () => {
  test("IC-01 returns an svg with a shield glyph distinct from the whitelist shield-check", () => {
    const shield = createIcon("shield");

    expect(shield.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(shield.getAttribute("aria-hidden")).toBe("true");
    expect(shield.innerHTML.length).toBeGreaterThan(0);
    expect(shield.innerHTML).not.toBe(createIcon("whitelist").innerHTML);
  });

  test("IC-02 honours the requested size", () => {
    const shield = createIcon("shield", 22);

    expect(shield.getAttribute("width")).toBe("22");
    expect(shield.getAttribute("height")).toBe("22");
  });
});

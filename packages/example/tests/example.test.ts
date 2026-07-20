import { describe, expect, test } from "bun:test";
import { greet } from "../index";

describe("example package", () => {
  test("greets through the public entry point", () => {
    expect(greet("ada  lovelace")).toBe("Hello, Ada Lovelace!");
  });
});

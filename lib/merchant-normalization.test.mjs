import assert from "node:assert/strict";
import test from "node:test";

import { normalizeMerchantKey } from "./merchant-normalization.ts";

test("normalizes case, surrounding whitespace, repeated spaces, and conservative separators", () => {
  assert.equal(normalizeMerchantKey("  TOKO   Contoh_Jakarta  "), "toko contoh jakarta");
  assert.equal(normalizeMerchantKey("Toko/Contoh"), "toko contoh");
});

test("preserves meaningful merchant tokens", () => {
  assert.equal(normalizeMerchantKey("A&B + Mart's"), "a&b + mart's");
});

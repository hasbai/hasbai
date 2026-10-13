import { expect, it } from "vitest";
import { hasPermission, tokenHasPermission } from "@hasbai/auth/config";

it("requires an exact permission from an array and rejects malformed claims", () => {
  for (const claims of [null, undefined, "tavern.all:all", {}, { permissions: "tavern.all:all" },
    { permissions: { "tavern.all:all": true } }, { permissions: ["tavern.all:all:other"] }]) {
    expect(hasPermission(claims, "tavern.all:all")).toBe(false);
  }
  expect(hasPermission({ permissions: ["tavern.all:all"] }, "tavern.all:all")).toBe(true);
  for (const token of [undefined, "", "invalid", "e30.bad.signature"]) {
    expect(tokenHasPermission(token, "tavern.all:all")).toBe(false);
  }
});

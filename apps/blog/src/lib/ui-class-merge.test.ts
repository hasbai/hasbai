import { expect, it } from "vitest";
import { cn } from "@hasbai/ui/utils";

it("keeps empty and conditional class values compatible", () => {
  expect(cn()).toBe("");
  expect(cn(null, undefined, false, " ")).toBe("");
  expect(cn(["p-2", [false, "p-4"]], { hidden: false, block: true })).toBe("p-4 block");
});

it("keeps caller size and spacing overrides without dropping other axes", () => {
  expect(cn("p-4 text-sm font-medium", "px-2 text-xs")).toBe("p-4 font-medium px-2 text-xs");
  expect(cn("size-9 rounded-4xl", "size-6 rounded-xl")).toBe("size-6 rounded-xl");
  expect(cn("px-2 py-3", "p-0")).toBe("p-0");
});

it("preserves independent modifiers and replaces matching arbitrary variants", () => {
  expect(cn("hover:bg-muted dark:bg-black text-sm", "hover:bg-red-500 text-white")).toBe("dark:bg-black text-sm hover:bg-red-500 text-white");
  expect(cn("[&_svg]:size-4 [&_svg]:shrink-0", "[&_svg]:size-6")).toBe("[&_svg]:shrink-0 [&_svg]:size-6");
  expect(cn("p-2! hover:p-1", "p-4! hover:p-3")).toBe("p-4! hover:p-3");
});

import { describe, expect, it } from "vitest";
import { loadLoadoutProductsFromSource } from "@/lib/loadout-catalog-loader";

describe("Loadout catalog freeze leftover loader gates", () => {
  it("refuses CommonJS require and side-effect import forms instead of executing them", () => {
    expect(() =>
      loadLoadoutProductsFromSource(`
const fs = require("fs");
export const PRODUCTS = [{ id: "ks-sbd-5mm" }];
`),
    ).toThrow();

    expect(() =>
      loadLoadoutProductsFromSource(`
import fs from "fs";
export const PRODUCTS = [{ id: "ks-sbd-5mm" }];
`),
    ).toThrow(/runtime imports/);

    expect(() =>
      loadLoadoutProductsFromSource(`
import "./side-effects";
export const PRODUCTS = [{ id: "ks-sbd-5mm" }];
`),
    ).toThrow(/runtime imports/);
  });

  it("refuses PRODUCTS exported as a number or string instead of an array", () => {
    expect(() =>
      loadLoadoutProductsFromSource(`
export const PRODUCTS = 12;
`),
    ).toThrow(/PRODUCTS array/);

    expect(() =>
      loadLoadoutProductsFromSource(`
export const PRODUCTS = "ks-sbd-5mm";
`),
    ).toThrow(/PRODUCTS array/);
  });
});

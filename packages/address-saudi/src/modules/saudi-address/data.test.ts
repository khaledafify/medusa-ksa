import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { DATASET_COUNTS, GEO_DATA_PACKAGE } from "./constants.js";
import { loadSaudiGeoDataset } from "./data.js";

describe("loadSaudiGeoDataset", () => {
  it("loads the GPL geography dependency without network and normalizes seed rows", () => {
    const dataset = loadSaudiGeoDataset();

    expect(dataset.regions).toHaveLength(DATASET_COUNTS.REGIONS);
    expect(dataset.cities).toHaveLength(DATASET_COUNTS.CITIES);
    expect(dataset.districts).toHaveLength(DATASET_COUNTS.DISTRICTS);
    expect(dataset.source).toEqual({
      packageName: GEO_DATA_PACKAGE,
      license: "GPL-2.0",
      repository:
        "https://github.com/homaily/Saudi-Arabia-Regions-Cities-and-Districts",
    });
  });

  it("pins Riyadh identifiers by constants-ready codes", () => {
    const dataset = loadSaudiGeoDataset();

    expect(dataset.regions[0]).toMatchObject({
      code: "RD",
      name_en: "Riyadh",
      name_ar: "منطقة الرياض",
      sort_weight: -1,
    });
    expect(dataset.cities.find((city) => city.code === "3")).toMatchObject({
      region_code: "RD",
      name_en: "Riyadh",
      name_ar: "الرياض",
      sort_weight: -1,
    });
  });

  it("resolves data from node_modules rather than the plugin src tree", () => {
    const resolver = createRequire(import.meta.url);
    const regionsPath = resolver.resolve(`${GEO_DATA_PACKAGE}/json/regions_lite.json`);

    expect(regionsPath).toContain("node_modules");
    expect(regionsPath).not.toContain("packages/address-saudi/src");
  });
});

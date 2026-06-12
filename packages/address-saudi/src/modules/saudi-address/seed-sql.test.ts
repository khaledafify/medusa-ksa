import { describe, expect, it } from "vitest";

import { DATASET_COUNTS, TABLE } from "./constants.js";
import { loadSaudiGeoDataset } from "./data.js";
import { buildSaudiGeoSeedSql } from "./seed-sql.js";

describe("buildSaudiGeoSeedSql", () => {
  it("creates deterministic seed inserts for every geography table", () => {
    const sql = buildSaudiGeoSeedSql(loadSaudiGeoDataset());

    expect(sql.length).toBeGreaterThan(1);
    expect(sql.join("\n")).toContain(`insert into "${TABLE.REGION}"`);
    expect(sql.join("\n")).toContain(`insert into "${TABLE.CITY}"`);
    expect(sql.join("\n")).toContain(`insert into "${TABLE.DISTRICT}"`);
    expect(sql.join("\n")).toContain("on conflict (\"id\") do update");
  });

  it("covers the expected upstream seed counts", () => {
    const dataset = loadSaudiGeoDataset();

    expect(dataset.regions.length).toBe(DATASET_COUNTS.REGIONS);
    expect(dataset.cities.length).toBe(DATASET_COUNTS.CITIES);
    expect(dataset.districts.length).toBe(DATASET_COUNTS.DISTRICTS);
  });

  it("escapes quotes in names before building SQL", () => {
    const dataset = loadSaudiGeoDataset();
    const sql = buildSaudiGeoSeedSql({
      ...dataset,
      regions: [
        {
          ...dataset.regions[0]!,
          name_en: "Riyadh's Region",
        },
      ],
      cities: [],
      districts: [],
    }).join("\n");

    expect(sql).toContain("Riyadh''s Region");
  });
});

import { SEED_CHUNK_SIZE, TABLE } from "./constants.js";
import type {
  SaudiCitySeed,
  SaudiDistrictSeed,
  SaudiGeoDataset,
  SaudiRegionSeed,
} from "./types.js";

type SeedRow = SaudiRegionSeed | SaudiCitySeed | SaudiDistrictSeed;
type SqlValue = string | number | null;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteValue(value: string | number | null): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "number") {
    return String(value);
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function chunkRows<Row>(rows: Row[], size: number): Row[][] {
  const chunks: Row[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function rowValue(row: SeedRow, column: string): SqlValue {
  const record = row as unknown as Record<string, SqlValue>;
  return record[column] ?? null;
}

function buildInsert<Row extends SeedRow>(
  table: string,
  columns: (keyof Row & string)[],
  rows: Row[],
): string {
  const columnSql = columns.map(quoteIdentifier).join(", ");
  const valuesSql = rows
    .map((row) => {
      const values = columns.map((column) => quoteValue(rowValue(row, column)));
      return `(${values.join(", ")})`;
    })
    .join(", ");
  const updateSql = columns
    .filter((column) => column !== "id")
    .map((column) => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`)
    .join(", ");

  return (
    `insert into ${quoteIdentifier(table)} (${columnSql}) values ${valuesSql} ` +
    `on conflict (${quoteIdentifier("id")}) do update set ${updateSql};`
  );
}

function buildRegionSeedSql(rows: SaudiRegionSeed[]): string[] {
  return chunkRows(rows, SEED_CHUNK_SIZE).map((chunk) =>
    buildInsert(TABLE.REGION, [
      "id",
      "code",
      "name_ar",
      "name_en",
      "sort_weight",
      "capital_city_code",
      "population",
    ], chunk),
  );
}

function buildCitySeedSql(rows: SaudiCitySeed[]): string[] {
  return chunkRows(rows, SEED_CHUNK_SIZE).map((chunk) =>
    buildInsert(TABLE.CITY, [
      "id",
      "code",
      "region_code",
      "name_ar",
      "name_en",
      "sort_weight",
    ], chunk),
  );
}

function buildDistrictSeedSql(rows: SaudiDistrictSeed[]): string[] {
  return chunkRows(rows, SEED_CHUNK_SIZE).map((chunk) =>
    buildInsert(TABLE.DISTRICT, [
      "id",
      "code",
      "city_code",
      "region_code",
      "name_ar",
      "name_en",
      "sort_weight",
    ], chunk),
  );
}

/** Build deterministic, idempotent seed SQL for the offline geography tables. */
export function buildSaudiGeoSeedSql(dataset: SaudiGeoDataset): string[] {
  return [
    ...buildRegionSeedSql(dataset.regions),
    ...buildCitySeedSql(dataset.cities),
    ...buildDistrictSeedSql(dataset.districts),
  ];
}

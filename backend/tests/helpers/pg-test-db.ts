/**
 * PostgreSQL 测试数据库 helper
 *
 * 无 TEST_PG_DATABASE_URL 时返回 null，测试应 skip。
 * 有 TEST_PG_DATABASE_URL 时连接并初始化 schema。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const PG_URL = process.env.TEST_PG_DATABASE_URL;

export async function getPgPool() {
  if (!PG_URL) return null;
  const { Pool } = await import("pg");
  return new Pool({ connectionString: PG_URL });
}

export async function initPgSchema(pool: import("pg").Pool) {
  const schemaPath = join(__dirname, "..", "..", "src", "db", "postgres", "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");
  await pool.query(schema);
}

export async function cleanTable(pool: import("pg").Pool, table: string) {
  await pool.query(`DELETE FROM ${table}`);
}

export async function closePgPool(pool: import("pg").Pool) {
  await pool.end();
}

export const hasPg = !!PG_URL;

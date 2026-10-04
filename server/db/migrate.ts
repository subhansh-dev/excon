// `npm run db:migrate` — applies server/db/schema.sql to DATABASE_URL.
import { readFileSync } from "fs";
import { resolve } from "path";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Nothing to migrate (JSONL mode needs no migration).");
  process.exit(1);
}

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: url });
await client.connect();
const sql = readFileSync(resolve("server/db/schema.sql"), "utf8");
await client.query(sql);
console.log("schema applied OK");
await client.end();
process.exit(0);

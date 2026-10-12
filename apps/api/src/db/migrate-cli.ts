import { loadEnv } from "../env.js";
import { openDatabase } from "./client.js";
import { runMigrations } from "./migrate.js";

const { sqlite, db } = openDatabase(loadEnv().DATABASE_PATH);
runMigrations(db);
sqlite.close();
console.log("Migrations applied");

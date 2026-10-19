// Manage staff accounts from the server's shell (there is no sign-up page by design).
//   pnpm --filter @hamtning/api employee add <username> <name> [--admin]
//   pnpm --filter @hamtning/api employee reset-password <username>
//   pnpm --filter @hamtning/api employee list
//   pnpm --filter @hamtning/api employee remove <username>
import type { EMPLOYEE_ROLES } from "@hamtning/shared";
import { asc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { generatePassword, hashPassword } from "../src/auth/passwords.js";
import { openDatabase } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { employees, sessions } from "../src/db/schema.js";
import { loadEnv } from "../src/env.js";

const [command, ...args] = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));

const { sqlite, db } = openDatabase(loadEnv().DATABASE_PATH);
runMigrations(db);

function fail(message: string): never {
  console.error(message);
  sqlite.close();
  process.exit(1);
}

const findByUsername = (username: string) =>
  db.select().from(employees).where(eq(employees.username, username.toLowerCase())).get();

function printPassword(username: string, password: string) {
  console.log(`\n  Användarnamn: ${username}\n  Lösenord:     ${password}\n`);
  console.log("The password is shown only once. Hand it over in person or another safe channel.");
}

switch (command) {
  case "add": {
    const [username, ...nameParts] = positional;
    const name = nameParts.join(" ");
    if (!username || !name) fail("usage: employee add <username> <name> [--admin]");
    if (!/^[a-z0-9._-]{3,32}$/i.test(username))
      fail("Username must be 3-32 characters: letters, digits, '.', '_' or '-'");
    if (findByUsername(username)) fail(`${username} already exists. Use reset-password instead.`);
    const role: (typeof EMPLOYEE_ROLES)[number] = flags.has("--admin") ? "admin" : "staff";
    const password = generatePassword();
    db.insert(employees)
      .values({
        id: ulid(),
        username: username.toLowerCase(),
        name,
        role,
        passwordHash: await hashPassword(password),
        createdAt: new Date().toISOString(),
      })
      .run();
    console.log(`Created ${role} ${name}.`);
    printPassword(username.toLowerCase(), password);
    break;
  }
  case "reset-password": {
    const [username] = positional;
    if (!username) fail("usage: employee reset-password <username>");
    const employee = findByUsername(username) ?? fail(`No employee called ${username}`);
    const password = generatePassword();
    db.update(employees)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(employees.id, employee.id))
      .run();
    // Log out every device using the old password.
    db.delete(sessions).where(eq(sessions.employeeId, employee.id)).run();
    console.log(`New password for ${employee.name}; existing sessions were logged out.`);
    printPassword(employee.username, password);
    break;
  }
  case "list": {
    const rows = db.select().from(employees).orderBy(asc(employees.name)).all();
    if (rows.length === 0)
      console.log("No employees yet. Add one with: employee add <username> <name> --admin");
    for (const e of rows) console.log(`${e.role.padEnd(6)} ${e.username.padEnd(32)} ${e.name}`);
    break;
  }
  case "remove": {
    const [username] = positional;
    if (!username) fail("usage: employee remove <username>");
    const employee = findByUsername(username) ?? fail(`No employee called ${username}`);
    // Sessions cascade; their past actions in request history keep the event but lose the name.
    db.delete(employees).where(eq(employees.id, employee.id)).run();
    console.log(`Removed ${employee.name}.`);
    break;
  }
  default:
    fail("usage: employee add|reset-password|list|remove ...");
}
sqlite.close();

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema_migration.ts",
  dialect: "mysql",
  dbCredentials: {
    host: "127.0.0.1",
    user: "root",
    password: "",
    database: "exeat1",
    port: 3306,
  },
});

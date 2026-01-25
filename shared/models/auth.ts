import { sql } from "drizzle-orm";
import { index, json, mysqlTable, timestamp, varchar, bigint } from "drizzle-orm/mysql-core";

// Session storage table.
// Renamed to comm_sessions to avoid conflicts and follow convention
export const sessions = mysqlTable(
  "comm_sessions",
  {
    sid: varchar("sid", { length: 255 }).primaryKey(),
    sess: json("sess").notNull(),
    expire: timestamp("expire").notNull(),
  }
);

// User storage table for Replit Auth / App Auth
// Renamed to comm_auth_users to avoid conflict with existing 'users' table
export const users = mysqlTable("comm_auth_users", {
  id: varchar("id", { length: 255 }).primaryKey(), // Replit ID is a string
  email: varchar("email", { length: 255 }).unique(),
  firstName: varchar("first_name", { length: 255 }),
  lastName: varchar("last_name", { length: 255 }),
  profileImageUrl: varchar("profile_image_url", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

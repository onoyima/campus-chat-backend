import { mysqlTable, varchar, text, int, boolean, datetime, json, bigint } from "drizzle-orm/mysql-core";

// Import Auth models to ensure they are included in migrations
export * from "./models/auth";

// Only export the NEW tables we want Drizzle to manage/create
// Prefixing with 'comm_' as requested to avoid conflicts with existing tables

export const chatIdentities = mysqlTable("comm_chat_identities", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  userId: varchar("user_id", { length: 255 }), 
  email: varchar("email", { length: 255 }).notNull(),
  entityType: varchar("entity_type", { length: 50 }).notNull(), 
  entityId: bigint("entity_id", { mode: "number" }).notNull(), 
  displayName: varchar("display_name", { length: 255 }).notNull(),
  role: varchar("role", { length: 50 }).notNull(), 
  departmentId: bigint("department_id", { mode: "number" }),
  facultyId: bigint("faculty_id", { mode: "number" }),
  isOnline: boolean("is_online").default(false),
  lastSeen: datetime("last_seen").default(new Date()),
  streakCount: int("streak_count").default(0),
  lastStatusAt: datetime("last_status_at"),
});

export const conversations = mysqlTable("comm_conversations", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  type: varchar("type", { length: 50 }).notNull(),
  scope: varchar("scope", { length: 50 }), 
  referenceId: int("reference_id"), 
  name: varchar("name", { length: 255 }), 
  createdAt: datetime("created_at").default(new Date()),
  updatedAt: datetime("updated_at").default(new Date()),
});

export const participants = mysqlTable("comm_participants", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  conversationId: bigint("conversation_id", { mode: "number" }).references(() => conversations.id).notNull(),
  identityId: bigint("identity_id", { mode: "number" }).references(() => chatIdentities.id).notNull(),
  role: varchar("role", { length: 50 }).default("member"), 
  joinedAt: datetime("joined_at").default(new Date()),
  addedByIdentityId: bigint("added_by_identity_id", { mode: "number" }).references(() => chatIdentities.id),
});

export const messages = mysqlTable("comm_messages", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  conversationId: bigint("conversation_id", { mode: "number" }).references(() => conversations.id).notNull(),
  senderIdentityId: bigint("sender_identity_id", { mode: "number" }).references(() => chatIdentities.id).notNull(),
  content: text("content").notNull(),
  type: varchar("type", { length: 50 }).default("text"), 
  metadata: json("metadata"), 
  createdAt: datetime("created_at").default(new Date()),
});

export const messageStatuses = mysqlTable("comm_message_statuses", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  messageId: bigint("message_id", { mode: "number" }).references(() => messages.id).notNull(),
  identityId: bigint("identity_id", { mode: "number" }).references(() => chatIdentities.id).notNull(),
  status: varchar("status", { length: 50 }).notNull(), 
  updatedAt: datetime("updated_at").default(new Date()),
});

export const notifications = mysqlTable("comm_notifications", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  identityId: bigint("identity_id", { mode: "number" }).references(() => chatIdentities.id).notNull(),
  type: varchar("type", { length: 50 }).notNull(), 
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content").notNull(),
  isRead: boolean("is_read").default(false),
  referenceId: int("reference_id"), 
  createdAt: datetime("created_at").default(new Date()),
});

export const statusUpdates = mysqlTable("comm_status_updates", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  identityId: bigint("identity_id", { mode: "number" }).references(() => chatIdentities.id).notNull(),
  content: text("content"),
  mediaUrl: text("media_url"),
  expiresAt: datetime("expires_at").notNull(),
  createdAt: datetime("created_at").default(new Date()),
});

export const calls = mysqlTable("comm_calls", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  initiatorIdentityId: bigint("initiator_identity_id", { mode: "number" }).references(() => chatIdentities.id).notNull(),
  targetIdentityId: bigint("target_identity_id", { mode: "number" }).references(() => chatIdentities.id), 
  conversationId: bigint("conversation_id", { mode: "number" }).references(() => conversations.id), 
  type: varchar("type", { length: 50 }).notNull(), 
  status: varchar("status", { length: 50 }).notNull(), 
  startTime: datetime("start_time").default(new Date()),
  endTime: datetime("end_time"),
});

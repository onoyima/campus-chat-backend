import { mysqlTable, serial, varchar, text, int, boolean, datetime, json, bigint, customType, index } from "drizzle-orm/mysql-core";
import { relations, sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
export * from "./models/auth";

// --- Existing Tables (Mapped from exeat1 DB) ---

export const users = mysqlTable("users", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  fname: varchar("fname", { length: 255 }),
  lname: varchar("lname", { length: 255 }),
  email: varchar("email", { length: 255 }),
  password: varchar("password", { length: 255 }),
  userType: int("user_type"),
});

export const students = mysqlTable("students", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  userId: bigint("user_id", { mode: "number" }),
  fname: varchar("fname", { length: 255 }),
  lname: varchar("lname", { length: 255 }),
  email: varchar("email", { length: 255 }),
  password: varchar("password", { length: 255 }),
  matricNo: varchar("username", { length: 100 }),
  passport: customType<{ data: Buffer }>({
    dataType: () => "longblob",
  })("passport"),
});

export const staff = mysqlTable("staff", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  fname: varchar("fname", { length: 50 }),
  lname: varchar("lname", { length: 50 }),
  email: varchar("email", { length: 255 }),
  password: varchar("password", { length: 255 }),
  userType: int("user_type"),
  passport: customType<{ data: Buffer }>({
    dataType: () => "longblob",
  })("passport"),
});

export const faculties = mysqlTable("faculties", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  name: varchar("name", { length: 255 }),
  code: varchar("abb", { length: 255 }),
});

export const departments = mysqlTable("departments", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  name: varchar("name", { length: 255 }),
  code: varchar("abb", { length: 255 }),
});

// --- Communication Layer Tables (New tables with 'comm_' prefix) ---

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
  isSuspended: boolean("is_suspended").default(false),
  lastSeen: datetime("last_seen").default(new Date()),
  streakCount: int("streak_count").default(0),
  lastStatusAt: datetime("last_status_at"),
}, (table) => {
  return [
    index("identity_email_idx").on(table.email),
    index("identity_user_idx").on(table.userId),
  ];
});

export const conversations = mysqlTable("comm_conversations", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  type: varchar("type", { length: 50 }).notNull(),
  scope: varchar("scope", { length: 50 }),
  referenceId: int("reference_id"),
  name: varchar("name", { length: 255 }),
  createdAt: datetime("created_at").default(new Date()),
  updatedAt: datetime("updated_at").default(new Date()),
  icon: text("icon"), // Group Icon URL or Base64
}, (table) => {
  return [
    index("conv_updated_idx").on(table.updatedAt),
  ];
});

export const participants = mysqlTable("comm_participants", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  conversationId: bigint("conversation_id", { mode: "number" }).references(() => conversations.id).notNull(),
  identityId: bigint("identity_id", { mode: "number" }).references(() => chatIdentities.id).notNull(),
  role: varchar("role", { length: 50 }).default("member"),
  joinedAt: datetime("joined_at").default(new Date()),
  addedByIdentityId: bigint("added_by_identity_id", { mode: "number" }).references(() => chatIdentities.id),
}, (table) => {
  return [
    index("part_conv_idx").on(table.conversationId),
    index("part_identity_idx").on(table.identityId),
  ];
});

export const messages = mysqlTable("comm_messages", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  conversationId: bigint("conversation_id", { mode: "number" }).references(() => conversations.id).notNull(),
  senderIdentityId: bigint("sender_identity_id", { mode: "number" }).references(() => chatIdentities.id).notNull(),
  content: text("content").notNull(),
  type: varchar("type", { length: 50 }).default("text"),
  metadata: json("metadata"),
  isEdited: boolean("is_edited").default(false),
  createdAt: datetime("created_at").default(sql`CURRENT_TIMESTAMP`),
}, (table) => {
  return [
    index("msg_conv_idx").on(table.conversationId),
    index("msg_created_idx").on(table.createdAt),
  ];
});

export const messageStatuses = mysqlTable("comm_message_statuses", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  messageId: bigint("message_id", { mode: "number" }).references(() => messages.id).notNull(),
  identityId: bigint("identity_id", { mode: "number" }).references(() => chatIdentities.id).notNull(),
  status: varchar("status", { length: 50 }).notNull(),
  updatedAt: datetime("updated_at").default(new Date()),
}, (table) => {
  return [
    index("status_msg_idx").on(table.messageId),
    index("status_identity_idx").on(table.identityId),
  ];
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

export const announcements = mysqlTable("comm_announcements", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content").notNull(),
  authorIdentityId: bigint("author_identity_id", { mode: "number" }).references(() => chatIdentities.id).notNull(),
  isFeatured: boolean("is_featured").default(false),
  createdAt: datetime("created_at").default(new Date()),
});

// --- Relations ---

export const conversationsRelations = relations(conversations, ({ many }) => ({
  participants: many(participants),
  messages: many(messages),
}));

export const participantsRelations = relations(participants, ({ one }) => ({
  conversation: one(conversations, {
    fields: [participants.conversationId],
    references: [conversations.id],
  }),
  identity: one(chatIdentities, {
    fields: [participants.identityId],
    references: [chatIdentities.id],
  }),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  sender: one(chatIdentities, {
    fields: [messages.senderIdentityId],
    references: [chatIdentities.id],
  }),
  statuses: many(messageStatuses),
}));

export const chatIdentitiesRelations = relations(chatIdentities, ({ many }) => ({
  participants: many(participants),
  messages: many(messages),
  notifications: many(notifications),
  statusUpdates: many(statusUpdates),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  identity: one(chatIdentities, {
    fields: [notifications.identityId],
    references: [chatIdentities.id],
  }),
}));

export const statusUpdatesRelations = relations(statusUpdates, ({ one }) => ({
  identity: one(chatIdentities, {
    fields: [statusUpdates.identityId],
    references: [chatIdentities.id],
  }),
}));

export const announcementsRelations = relations(announcements, ({ one }) => ({
  author: one(chatIdentities, {
    fields: [announcements.authorIdentityId],
    references: [chatIdentities.id],
  }),
}));


// --- Schemas & Types ---

export const insertChatIdentitySchema = createInsertSchema(chatIdentities).omit({ id: true, lastSeen: true, streakCount: true, lastStatusAt: true });
export const insertConversationSchema = createInsertSchema(conversations).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true, createdAt: true, isRead: true });
export const insertStatusUpdateSchema = createInsertSchema(statusUpdates).omit({ id: true, createdAt: true });
export const insertCallSchema = createInsertSchema(calls).omit({ id: true, startTime: true, endTime: true });
export const insertAnnouncementSchema = createInsertSchema(announcements).omit({ id: true, createdAt: true });

// Export Insert Types
export type InsertChatIdentity = z.infer<typeof insertChatIdentitySchema>;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type InsertStatusUpdate = z.infer<typeof insertStatusUpdateSchema>;
export type InsertCall = z.infer<typeof insertCallSchema>;
export type InsertAnnouncement = z.infer<typeof insertAnnouncementSchema>;

// Explicit Types
export type Faculty = typeof faculties.$inferSelect;
export type Department = typeof departments.$inferSelect;
export type Student = typeof students.$inferSelect;
export type Staff = typeof staff.$inferSelect;
export type User = typeof users.$inferSelect;

export type ChatIdentity = typeof chatIdentities.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Participant = typeof participants.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type MessageStatus = typeof messageStatuses.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type StatusUpdate = typeof statusUpdates.$inferSelect;
export type Call = typeof calls.$inferSelect;
export type Announcement = typeof announcements.$inferSelect;

export const studentAcademics = mysqlTable("student_academics", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  studentId: bigint("student_id", { mode: "number" }).references(() => students.id).notNull(),
  level: varchar("level", { length: 255 }).notNull(),
  matricNo: varchar("mat_no", { length: 255 }),
  programmeId: bigint("programme_id", { mode: "number" }),
});

export const studentAcademicsRelations = relations(studentAcademics, ({ one }) => ({
  student: one(students, {
    fields: [studentAcademics.studentId],
    references: [students.id],
  }),
}));

export const studentsRelations = relations(students, ({ one }) => ({
  academic: one(studentAcademics, {
    fields: [students.id],
    references: [studentAcademics.studentId]
  })
}));

export const insertStudentAcademicSchema = createInsertSchema(studentAcademics).omit({ id: true });
export type InsertStudentAcademic = z.infer<typeof insertStudentAcademicSchema>;
export type StudentAcademic = typeof studentAcademics.$inferSelect;

// For API
export type CreateMessageRequest = {
  conversationId: number;
  content: string;
  type?: "text" | "file" | "voice_note";
  metadata?: any;
};

export type CreateDirectChatRequest = {
  targetIdentityId: number;
};

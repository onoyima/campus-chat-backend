import { db } from "./db";
import { eq, like, or, and, desc, asc, inArray, gt, sql } from "drizzle-orm";
import {
    chatIdentities, conversations, participants, messages, messageStatuses,
    notifications, statusUpdates, calls, announcements,
    faculties, departments, staff, students, users, studentAcademics,
    type ChatIdentity, type Conversation, type Message, type Participant, type MessageStatus,
    type Notification, type StatusUpdate, type Call,
    type Faculty, type Department, type Staff, type Student,
    type InsertChatIdentity, type InsertConversation, type InsertMessage,
    type InsertNotification, type InsertStatusUpdate, type InsertCall,
    type Announcement, type InsertAnnouncement, type StudentAcademic, type InsertStudentAcademic
} from "@shared/schema";

export interface IStorage {
    // Identity
    getIdentity(id: number): Promise<ChatIdentity | undefined>;
    getIdentityByUserId(userId: string): Promise<ChatIdentity | undefined>;
    getIdentities(search?: string, role?: string, departmentId?: number): Promise<ChatIdentity[]>;
    createIdentity(identity: InsertChatIdentity): Promise<ChatIdentity>;
    updateIdentityStreak(id: number, streakCount: number): Promise<void>;

    // Conversations
    getConversations(identityId: number): Promise<(Conversation & { lastMessage?: Message, unreadCount: number, participants: Participant[] })[]>;
    getConversation(id: number): Promise<Conversation | undefined>;
    createConversation(conversation: InsertConversation): Promise<Conversation>;

    // Participants
    addParticipant(conversationId: number, identityId: number, role?: string): Promise<Participant>;
    getParticipants(conversationId: number): Promise<(Participant & { identity: ChatIdentity })[]>;
    getParticipant(conversationId: number, identityId: number): Promise<Participant | undefined>;

    // Messages
    getMessages(conversationId: number, limit?: number, cursor?: number): Promise<Message[]>;
    createMessage(message: InsertMessage): Promise<Message>;
    deleteMessage(messageId: number): Promise<void>;
    updateMessage(messageId: number, content: string): Promise<void>;
    markConversationAsRead(conversationId: number, identityId: number): Promise<void>;
    getMessageStatuses(messageId: number): Promise<MessageStatus[]>;

    // Notifications
    getNotifications(identityId: number): Promise<Notification[]>;
    createNotification(notification: InsertNotification): Promise<Notification>;
    markNotificationRead(id: number): Promise<void>;

    // Status Updates
    getStatusUpdates(): Promise<(StatusUpdate & { identity: ChatIdentity })[]>;
    createStatusUpdate(status: InsertStatusUpdate): Promise<StatusUpdate>;

    // Announcements
    createAnnouncement(announcement: InsertAnnouncement): Promise<Announcement>;
    getAnnouncements(): Promise<Announcement[]>;

    // Calls
    createCall(call: InsertCall): Promise<Call>;
    getCalls(identityId: number): Promise<Call[]>;

    // Admin
    getAllUsers(): Promise<ChatIdentity[]>;
    updateUserRole(identityId: number, role: string): Promise<void>;
    toggleUserSuspension(identityId: number, isSuspended: boolean): Promise<void>;
    getAdminStats(): Promise<any>;
    getAllGroups(): Promise<any[]>;
    deleteGroup(id: number): Promise<void>;

    // Academic Data (Seed/Read)
    createFaculty(faculty: any): Promise<Faculty>;
    createDepartment(dept: any): Promise<Department>;
    createAcademicStaff(staffData: any): Promise<Staff>;
    createStudent(student: any): Promise<Student>;

    // Helpers
    findDirectConversation(identityA: number, identityB: number): Promise<Conversation | undefined>;
    getMessage(messageId: number): Promise<Message | undefined>;
    getUserAvatar(entityType: string, entityId: number): Promise<any | undefined>;
    searchGlobalUsers(query: string): Promise<any[]>;
    updateParticipantRole(conversationId: number, identityId: number, role: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
    // --- Identity ---
    async getIdentity(id: number): Promise<ChatIdentity | undefined> {
        const [identity] = await db.select().from(chatIdentities).where(eq(chatIdentities.id, id));
        return identity;
    }

    async getIdentityByUserId(userId: string): Promise<ChatIdentity | undefined> {
        const [identity] = await db.select().from(chatIdentities).where(eq(chatIdentities.userId, userId));
        return identity;
    }

    async ensureIdentity(entityType: string, entityId: number): Promise<number> {
        // 1. Check existence
        const [existing] = await db.select().from(chatIdentities).where(and(
            eq(chatIdentities.entityType, entityType),
            eq(chatIdentities.entityId, entityId)
        ));
        if (existing) return existing.id;

        // 2. Fetch source details
        let displayName = "Unknown User";
        let email = "";
        let userId = String(entityId); // Fallback
        let role = "MEMBER";

        if (entityType === 'student') {
            const [student] = await db.select().from(students).where(eq(students.id, entityId));
            if (!student) throw new Error("Student not found");
            displayName = `${student.fname} ${student.lname}`;
            email = student.email || "";
            userId = String(student.userId || student.id);
            role = 'STUDENT';
        } else if (entityType === 'staff') {
            const [staffMember] = await db.select().from(staff).where(eq(staff.id, entityId));
            if (!staffMember) throw new Error("Staff not found");
            displayName = `${staffMember.fname} ${staffMember.lname}`;
            email = staffMember.email || "";
            userId = String(staffMember.id);
            role = 'STAFF';
        }

        // 3. Create Identity
        const [newIdentity] = await db.insert(chatIdentities).values({
            userId,
            entityType,
            entityId,
            displayName,
            email,
            role,
            isOnline: false
        });

        // In MySQL, insert returns [ResultSetHeader], we need insertId
        // Drizzle with MySQL2 driver: [result] where result.insertId
        return newIdentity.insertId;
    }

    async getIdentities(search?: string, role?: string, departmentId?: number): Promise<ChatIdentity[]> {
        if (!search) return []; // Don't return everyone if no search

        const searchLower = search.toLowerCase();

        // 1. Search existing Chat Identities
        let conditions = [
            or(
                like(chatIdentities.displayName, `%${search}%`),
                like(chatIdentities.email, `%${search}%`)
            )
        ];
        if (role) conditions.push(eq(chatIdentities.role, role));
        if (departmentId) conditions.push(eq(chatIdentities.departmentId, departmentId));

        const existingIdentities = await db.select().from(chatIdentities)
            .where(and(...conditions))
            .limit(20);

        // 2. Search Students (if role filter allows or is unset)
        let potentialStudents: any[] = [];
        if (!role || role === 'STUDENT') {
            potentialStudents = await db.select().from(students)
                .where(or(
                    like(students.fname, `%${search}%`),
                    like(students.lname, `%${search}%`),
                    like(students.matricNo, `%${search}%`),
                    like(students.email, `%${search}%`)
                ))
                .limit(20);
        }

        // 3. Search Staff (if role filter allows or is unset)
        let potentialStaff: any[] = [];
        if (!role || role !== 'STUDENT') {
            potentialStaff = await db.select().from(staff)
                .where(or(
                    like(staff.fname, `%${search}%`),
                    like(staff.lname, `%${search}%`),
                    like(staff.email, `%${search}%`)
                ))
                .limit(20);
        }

        // 4. Merge results
        // We need to map students/staff to ChatIdentity structure.
        // If they already exist in existingIdentities, skip them.

        const existingEntityMap = new Set(existingIdentities.map(i => `${i.entityType}:${i.entityId}`));
        const results: ChatIdentity[] = [...existingIdentities];

        for (const s of potentialStudents) {
            if (!existingEntityMap.has(`student:${s.id}`)) {
                results.push({
                    id: -s.id, // Negative ID indicates "Virtual/Potential"
                    userId: String(s.userId || s.id),
                    email: s.email || "",
                    entityType: 'student',
                    entityId: s.id,
                    displayName: `${s.fname} ${s.lname}`,
                    role: 'STUDENT',
                    departmentId: null,
                    facultyId: null,
                    isOnline: false,
                    isSuspended: false,
                    lastSeen: null,
                    streakCount: 0,
                    lastStatusAt: null
                });
                existingEntityMap.add(`student:${s.id}`);
            }
        }

        for (const s of potentialStaff) {
            if (!existingEntityMap.has(`staff:${s.id}`)) {
                results.push({
                    id: -s.id - 100000, // Offset to avoid collision with students
                    userId: String(s.id),
                    email: s.email || "",
                    entityType: 'staff',
                    entityId: s.id,
                    displayName: `${s.fname} ${s.lname}`,
                    role: 'STAFF', // Default role, might be HOD/etc in real app
                    departmentId: null,
                    facultyId: null,
                    isOnline: false,
                    isSuspended: false,
                    lastSeen: null,
                    streakCount: 0,
                    lastStatusAt: null
                });
                existingEntityMap.add(`staff:${s.id}`);
            }
        }

        return results.slice(0, 50);
    }

    async createIdentity(identity: InsertChatIdentity): Promise<ChatIdentity> {
        const [result] = await db.insert(chatIdentities).values(identity);
        const [newIdentity] = await db.select().from(chatIdentities).where(eq(chatIdentities.id, result.insertId));
        return newIdentity;
    }

    async updateIdentityStreak(id: number, streakCount: number): Promise<void> {
        await db.update(chatIdentities)
            .set({ streakCount, lastStatusAt: new Date() })
            .where(eq(chatIdentities.id, id));
    }

    async updateIdentityStatus(id: number, isOnline: boolean): Promise<void> {
        await db.update(chatIdentities)
            .set({ isOnline, lastSeen: new Date() })
            .where(eq(chatIdentities.id, id));
    }

    // --- Conversations ---
    async getConversations(identityId: number): Promise<(Conversation & { lastMessage?: Message, unreadCount: number, participants: Participant[] })[]> {
        const myParticipations = await db.select().from(participants).where(eq(participants.identityId, identityId));
        const conversationIds = myParticipations.map(p => p.conversationId);

        if (conversationIds.length === 0) return [];

        const chats = await db.select().from(conversations)
            .where(inArray(conversations.id, conversationIds))
            .orderBy(desc(conversations.updatedAt));

        // 1. Fetch all last messages in bulk
        const lastMessages = await db.select().from(messages)
            .where(inArray(messages.id,
                db.select({ id: sql<number>`MAX(id)` })
                    .from(messages)
                    .where(inArray(messages.conversationId, conversationIds))
                    .groupBy(messages.conversationId)
            ));

        // 2. Fetch all unread counts in bulk
        const unreadCountsResults = await db.select({
            conversationId: messages.conversationId,
            count: sql<number>`count(*)`
        })
            .from(messages)
            .leftJoin(messageStatuses, and(
                eq(messages.id, messageStatuses.messageId),
                eq(messageStatuses.identityId, identityId)
            ))
            .where(and(
                inArray(messages.conversationId, conversationIds),
                sql`${messages.senderIdentityId} != ${identityId}`,
                or(
                    sql`${messageStatuses.status} IS NULL`,
                    sql`${messageStatuses.status} != 'read'`
                )
            ))
            .groupBy(messages.conversationId);

        // 3. Fetch all participants in bulk with their identities
        const allParticipantsJoined = await db.select()
            .from(participants)
            .innerJoin(chatIdentities, eq(participants.identityId, chatIdentities.id))
            .where(inArray(participants.conversationId, conversationIds));

        // Map everything together
        return chats.map(chat => {
            const lastMsg = lastMessages.find(m => m.conversationId === chat.id);
            const unreadData = unreadCountsResults.find(u => u.conversationId === chat.id);
            const chatParts = allParticipantsJoined
                .filter(p => p.comm_participants.conversationId === chat.id)
                .map(p => ({
                    ...p.comm_participants,
                    identity: p.comm_chat_identities
                }));

            return {
                ...chat,
                lastMessage: lastMsg,
                unreadCount: Number(unreadData?.count || 0),
                participants: chatParts
            };
        });
    }

    async markConversationAsRead(conversationId: number, identityId: number): Promise<void> {
        // Find all messages in this conversation not sent by this user
        const unreadMessages = await db.select({ id: messages.id })
            .from(messages)
            .leftJoin(messageStatuses, and(
                eq(messages.id, messageStatuses.messageId),
                eq(messageStatuses.identityId, identityId)
            ))
            .where(and(
                eq(messages.conversationId, conversationId),
                sql`${messages.senderIdentityId} != ${identityId}`,
                or(
                    sql`${messageStatuses.status} IS NULL`,
                    sql`${messageStatuses.status} != 'read'`
                )
            ));

        for (const msg of unreadMessages) {
            // Upsert status to read
            const [existing] = await db.select().from(messageStatuses)
                .where(and(
                    eq(messageStatuses.messageId, msg.id),
                    eq(messageStatuses.identityId, identityId)
                ));

            if (existing) {
                await db.update(messageStatuses)
                    .set({ status: 'read', updatedAt: new Date() })
                    .where(eq(messageStatuses.id, existing.id));
            } else {
                await db.insert(messageStatuses).values({
                    messageId: msg.id,
                    identityId: identityId,
                    status: 'read'
                });
            }
        }
    }

    async getMessageStatuses(messageId: number): Promise<MessageStatus[]> {
        return await db.select().from(messageStatuses).where(eq(messageStatuses.messageId, messageId));
    }

    async getConversation(id: number): Promise<Conversation | undefined> {
        const [chat] = await db.select().from(conversations).where(eq(conversations.id, id));
        return chat;
    }

    async createConversation(conversation: InsertConversation): Promise<Conversation> {
        const [result] = await db.insert(conversations).values(conversation);
        const [chat] = await db.select().from(conversations).where(eq(conversations.id, result.insertId));
        return chat;
    }

    async findDirectConversation(identityA: number, identityB: number): Promise<Conversation | undefined> {
        const participationsA = await db.select({ convId: participants.conversationId })
            .from(participants)
            .innerJoin(conversations, eq(participants.conversationId, conversations.id))
            .where(and(
                eq(participants.identityId, identityA),
                eq(conversations.type, 'DIRECT')
            ));

        const convIdsA = participationsA.map(p => p.convId);
        if (convIdsA.length === 0) return undefined;

        const [match] = await db.select().from(participants)
            .where(and(
                inArray(participants.conversationId, convIdsA),
                eq(participants.identityId, identityB)
            ))
            .limit(1);

        if (match) {
            return this.getConversation(match.conversationId);
        }
        return undefined;
    }

    // --- Participants ---
    async addParticipant(conversationId: number, identityId: number, role: string = 'member', addedByIdentityId?: number): Promise<Participant> {
        const [participant] = await db.insert(participants).values({
            conversationId,
            identityId,
            role,
            addedByIdentityId
        });
        // Return the inserted participant
        const [newParticipant] = await db.select().from(participants).where(and(
            eq(participants.conversationId, conversationId),
            eq(participants.identityId, identityId)
        ));
        return newParticipant;
    }

    async getParticipants(conversationId: number): Promise<(Participant & { identity: ChatIdentity })[]> {
        const result = await db.select()
            .from(participants)
            .innerJoin(chatIdentities, eq(participants.identityId, chatIdentities.id))
            .where(eq(participants.conversationId, conversationId));

        return result.map(r => ({
            ...r.comm_participants,
            identity: r.comm_chat_identities
        }));
    }

    async removeParticipant(conversationId: number, identityId: number): Promise<void> {
        await db.delete(participants).where(and(
            eq(participants.conversationId, conversationId),
            eq(participants.identityId, identityId)
        ));
    }

    async getParticipant(conversationId: number, identityId: number): Promise<Participant | undefined> {
        const [participant] = await db.select().from(participants).where(and(
            eq(participants.conversationId, conversationId),
            eq(participants.identityId, identityId)
        ));
        return participant;
    }


    // --- Messages ---
    async getMessages(conversationId: number, limit: number = 50, cursor?: number): Promise<any[]> {
        const conditions = [eq(messages.conversationId, conversationId)];
        const msgs = await db.select().from(messages)
            .where(and(...conditions))
            .orderBy(asc(messages.createdAt))
            .limit(limit);

        if (msgs.length === 0) return [];

        // Fetch all statuses for these messages in one go
        const messageIds = msgs.map(m => m.id);
        const allStatuses = await db.select().from(messageStatuses)
            .where(inArray(messageStatuses.messageId, messageIds));

        // Map statuses to messages
        return msgs.map(msg => ({
            ...msg,
            statuses: allStatuses.filter(s => s.messageId === msg.id)
        }));
    }

    async deleteMessage(messageId: number): Promise<void> {
        await db.delete(messages).where(eq(messages.id, messageId));
    }

    async updateMessage(messageId: number, content: string): Promise<void> {
        await db.update(messages)
            .set({ content, isEdited: true })
            .where(eq(messages.id, messageId));
    }

    async searchMessages(query: string, identityId: number): Promise<(Message & { conversationId: number })[]> {
        // Find all conversations this user is part of
        const myParticipations = await db.select().from(participants).where(eq(participants.identityId, identityId));
        const conversationIds = myParticipations.map(p => p.conversationId);

        if (conversationIds.length === 0) return [];

        // Search messages within those conversations
        return await db.select().from(messages)
            .where(and(
                inArray(messages.conversationId, conversationIds),
                like(messages.content, `%${query}%`)
            ))
            .orderBy(desc(messages.createdAt))
            .limit(20);
    }

    async createMessage(message: InsertMessage): Promise<Message> {
        const [result] = await db.insert(messages).values({
            ...message,
            createdAt: new Date()
        });
        const [msg] = await db.select().from(messages).where(eq(messages.id, result.insertId));

        await db.update(conversations)
            .set({ updatedAt: new Date() })
            .where(eq(conversations.id, message.conversationId));
        return msg;
    }

    // --- Notifications ---
    async getNotifications(identityId: number): Promise<Notification[]> {
        return await db.select().from(notifications)
            .where(eq(notifications.identityId, identityId))
            .orderBy(desc(notifications.createdAt))
            .limit(20);
    }

    async createNotification(notification: InsertNotification): Promise<Notification> {
        const [result] = await db.insert(notifications).values(notification);
        const [n] = await db.select().from(notifications).where(eq(notifications.id, result.insertId));
        return n;
    }

    async markNotificationRead(id: number): Promise<void> {
        await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, id));
    }

    // --- Status Updates ---
    async getStatusUpdates(): Promise<(StatusUpdate & { identity: ChatIdentity })[]> {
        // Get all active statuses (expiredAt > now)
        const results = await db.select()
            .from(statusUpdates)
            .innerJoin(chatIdentities, eq(statusUpdates.identityId, chatIdentities.id))
            .where(gt(statusUpdates.expiresAt, new Date()))
            .orderBy(desc(statusUpdates.createdAt));

        return results.map(r => ({
            ...r.comm_status_updates,
            identity: r.comm_chat_identities
        }));
    }

    async createStatusUpdate(status: InsertStatusUpdate): Promise<StatusUpdate> {
        const [result] = await db.insert(statusUpdates).values(status);
        const [s] = await db.select().from(statusUpdates).where(eq(statusUpdates.id, result.insertId));
        return s;
    }

    // --- Announcements ---
    async createAnnouncement(announcement: InsertAnnouncement): Promise<Announcement> {
        const [result] = await db.insert(announcements).values(announcement);
        const [created] = await db.select().from(announcements).where(eq(announcements.id, result.insertId));
        return created;
    }

    async getAnnouncements(): Promise<Announcement[]> {
        return await db.select().from(announcements).orderBy(desc(announcements.createdAt));
    }

    // --- Calls ---
    async createCall(call: InsertCall): Promise<Call> {
        const [result] = await db.insert(calls).values(call);
        const [c] = await db.select().from(calls).where(eq(calls.id, result.insertId));
        return c;
    }

    async getCalls(identityId: number): Promise<Call[]> {
        return await db.select().from(calls)
            .where(or(
                eq(calls.initiatorIdentityId, identityId),
                eq(calls.targetIdentityId, identityId)
            ))
            .orderBy(desc(calls.startTime))
            .limit(20);
    }

    async getMessage(messageId: number): Promise<Message | undefined> {
        const [msg] = await db.select().from(messages).where(eq(messages.id, messageId));
        return msg;
    }

    async getUserAvatar(entityType: string, entityId: number): Promise<any | undefined> {
        if (entityType === 'student') {
            const [student] = await db.select({ passport: students.passport }).from(students).where(eq(students.id, entityId));
            return student?.passport || undefined;
        } else if (entityType === 'staff') {
            const [staffMember] = await db.select({ passport: staff.passport }).from(staff).where(eq(staff.id, entityId));
            return staffMember?.passport || undefined;
        }
        return undefined;
    }

    // --- Admin ---
    async getAllUsers(): Promise<ChatIdentity[]> {
        return await db.select().from(chatIdentities);
    }

    async searchGlobalUsers(query: string): Promise<any[]> {
        const results: any[] = [];

        const foundStudents = await db.select().from(students)
            .where(or(
                like(students.fname, `%${query}%`),
                like(students.lname, `%${query}%`),
                like(students.email, `%${query}%`),
                like(students.matricNo, `%${query}%`)
            ))
            .limit(20);

        const foundStaff = await db.select().from(staff)
            .where(or(
                like(staff.fname, `%${query}%`),
                like(staff.lname, `%${query}%`),
                like(staff.email, `%${query}%`)
            ))
            .limit(20);

        // Helper to check if they are registered
        const checkRegistration = async (email: string) => {
            const [identity] = await db.select().from(chatIdentities).where(eq(chatIdentities.email, email));
            return identity;
        };

        for (const s of foundStudents) {
            const identity = await checkRegistration(s.email || "");
            results.push({
                ...s,
                entityType: 'student',
                displayName: `${s.fname} ${s.lname}`,
                // If registered, include ChatIdentity details
                chatId: identity?.id,
                role: identity?.role,
                isSuspended: identity?.isSuspended
            });
        }

        for (const s of foundStaff) {
            const identity = await checkRegistration(s.email || "");
            results.push({
                ...s,
                entityType: 'staff',
                displayName: `${s.fname} ${s.lname}`,
                chatId: identity?.id,
                role: identity?.role,
                isSuspended: identity?.isSuspended
            });
        }

        return results;
    }

    async updateParticipantRole(conversationId: number, identityId: number, role: string): Promise<void> {
        await db.update(participants)
            .set({ role })
            .where(and(
                eq(participants.conversationId, conversationId),
                eq(participants.identityId, identityId)
            ));
    }

    async updateUserRole(identityId: number, role: string): Promise<void> {
        await db.update(chatIdentities)
            .set({ role })
            .where(eq(chatIdentities.id, identityId));
    }

    async toggleUserSuspension(identityId: number, isSuspended: boolean): Promise<void> {
        await db.update(chatIdentities)
            .set({ isSuspended })
            .where(eq(chatIdentities.id, identityId));
    }

    async getAdminStats(): Promise<any> {
        const [usersCount] = await db.select({ count: sql<number>`count(*)` }).from(chatIdentities);
        const [msgsCount] = await db.select({ count: sql<number>`count(*)` }).from(messages);
        const [groupsCount] = await db.select({ count: sql<number>`count(*)` }).from(conversations).where(eq(conversations.type, 'GROUP'));

        // Active users (last 24h)
        const oneDayAgo = new Date();
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);
        const [activeCount] = await db.select({ count: sql<number>`count(*)` }).from(chatIdentities).where(gt(chatIdentities.lastSeen, oneDayAgo));

        return {
            totalUsers: usersCount.count,
            totalMessages: msgsCount.count,
            totalGroups: groupsCount.count,
            activeUsers: activeCount.count
        };
    }

    async getAllGroups(): Promise<any[]> {
        const groups = await db.select().from(conversations)
            .where(eq(conversations.type, 'GROUP'))
            .orderBy(desc(conversations.createdAt));

        const results = [];
        for (const g of groups) {
            const [memberCount] = await db.select({ count: sql<number>`count(*)` }).from(participants).where(eq(participants.conversationId, g.id));
            results.push({
                ...g,
                memberCount: memberCount.count
            });
        }
        return results;
    }

    async deleteGroup(id: number): Promise<void> {
        // Manual cascade if needed, but foreign keys usually handle it or simple delete
        await db.delete(messages).where(eq(messages.conversationId, id));
        await db.delete(participants).where(eq(participants.conversationId, id));
        await db.delete(conversations).where(eq(conversations.id, id));
    }

    // --- Academic Data ---
    async createFaculty(data: any) {
        const [result] = await db.insert(faculties).values(data);
        const [r] = await db.select().from(faculties).where(eq(faculties.id, result.insertId));
        return r;
    }
    async createDepartment(data: any) {
        const [result] = await db.insert(departments).values(data);
        const [r] = await db.select().from(departments).where(eq(departments.id, result.insertId));
        return r;
    }
    async createAcademicStaff(data: any) {
        const [result] = await db.insert(staff).values(data);
        const [r] = await db.select().from(staff).where(eq(staff.id, result.insertId));
        return r;
    }
    async createStudent(data: any) {
        const [result] = await db.insert(students).values(data);
        const [r] = await db.select().from(students).where(eq(students.id, result.insertId));
        return r;
    }
}

export const storage = new DatabaseStorage();

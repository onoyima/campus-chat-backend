import type { Express } from "express";
import type { Server } from "http";
import { setupAuthSystem } from "./auth_system";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { insertAnnouncementSchema, students, staff, chatIdentities } from "@shared/schema";
import { z } from "zod";
import { notifyList } from "./websocket";
import multer from "multer";
import path from "path";
import fs from "fs";
import express from "express";
import { generateToken, verifyToken } from "./jwt";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { eq } from "drizzle-orm";

export async function registerRoutes(
    httpServer: Server,
    app: Express
): Promise<Server> {

    // Initialize new Auth System (Passport Local with MySQL)
    setupAuthSystem(app);

    // Root Landing Page
    app.get("/", (_req, res) => {
        res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Campus Chat Backend</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; color: #0f172a; }
          .card { text-align: center; padding: 3rem; background: white; border-radius: 16px; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); max-width: 400px; width: 90%; }
          h1 { margin: 0 0 1rem; color: #020617; font-size: 1.5rem; font-weight: 700; }
          .badge { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem; background: #dcfce7; color: #166534; border-radius: 9999px; font-weight: 600; font-size: 0.875rem; margin-bottom: 1.5rem; }
          .dot { width: 8px; height: 8px; background-color: #22c55e; border-radius: 50%; }
          p { margin: 0; color: #64748b; font-size: 0.875rem; line-height: 1.5; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Campus Chat Server</h1>
          <div class="badge"><div class="dot"></div>System Operational</div>
          <p>The backend API is running successfully.<br>Ready to accept connections.</p>
        </div>
      </body>
      </html>
    `);
    });

    // JWT-based Login Endpoint (for cross-origin deployments)
    app.post("/api/auth/token", async (req, res) => {
        try {
            const { email, password } = req.body;

            if (!email || !password) {
                return res.status(400).json({ message: "Email and password are required" });
            }

            // Check Student Table
            const [student] = await db.select().from(students).where(eq(students.email, email));

            let identity = null;
            let userPassword = null;

            if (student) {
                userPassword = student.password;
                const [existingIdentity] = await db.select().from(chatIdentities).where(eq(chatIdentities.email, email));
                identity = existingIdentity;
            } else {
                // Check Staff Table
                const [staffMember] = await db.select().from(staff).where(eq(staff.email, email));

                if (staffMember) {
                    userPassword = staffMember.password;
                    const [existingIdentity] = await db.select().from(chatIdentities).where(eq(chatIdentities.email, email));
                    identity = existingIdentity;
                }
            }

            if (!userPassword || !identity) {
                return res.status(401).json({ message: "Invalid credentials" });
            }

            // Verify password
            const isMatch = await bcrypt.compare(password, userPassword);
            if (!isMatch) {
                return res.status(401).json({ message: "Invalid credentials" });
            }

            // Generate JWT token
            const token = generateToken({
                identityId: identity.id,
                email: identity.email,
                role: identity.role
            });

            res.json({
                message: "Logged in successfully",
                token,
                user: identity
            });
        } catch (error) {
            console.error('[JWT Login Error]', error);
            res.status(500).json({ message: "Internal server error" });
        }
    });

    const getContextIdentity = async (req: any) => {
        // Try JWT first
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            const payload = verifyToken(token);
            if (payload) {
                return await storage.getIdentity(payload.identityId);
            }
        }

        // Fallback to session-based auth
        if (!req.isAuthenticated()) return null;
        return req.user;
    };

    const getMe = async (req: any) => {
        // @ts-ignore
        const switchedId = req.session?.switchedIdentityId;
        if (switchedId) return await storage.getIdentity(switchedId);
        return await getContextIdentity(req);
    };

    // --- API Routes ---

    // 1. Identity
    app.get(api.identity.me.path, async (req, res) => {
        const identity = await getMe(req);
        if (!identity) return res.status(401).json({ message: "Not authenticated" });
        res.json(identity);
    });

    // Profile Viewing Rules
    app.get("/api/users/:id/profile", async (req, res) => {
        const me = await getMe(req);
        if (!me) return res.status(401).json({ message: "Unauthorized" });
        const targetId = Number(req.params.id);

        const targetIdentity = await storage.getIdentity(targetId);
        if (!targetIdentity) return res.status(404).json({ message: "User not found" });

        // 1. Super Admin -> OK
        if (me.role === 'SUPER_ADMIN') {
            return res.json(targetIdentity);
        }

        // 2. Self -> OK
        if (me.id === targetId) {
            return res.json(targetIdentity);
        }

        // 3. Chatting together?
        // Get all conversation IDs for me
        const myConvs = await storage.getConversations(me.id);
        const myConvIds = new Set(myConvs.map(c => c.id));

        // Get all participants for target (inefficient but works for now)
        // Better: storage.checkCommonConversation(id1, id2)
        // For now, let's implement a quick check loop
        let hasCommon = false;
        for (const conv of myConvs) {
            const parts = await storage.getParticipants(conv.id);
            if (parts.some(p => p.identityId === targetId)) {
                hasCommon = true;
                break;
            }
        }

        if (hasCommon) {
            return res.json(targetIdentity);
        }

        return res.status(403).json({ message: "You can only view profiles of people you share a chat with." });
    });

    // Avatar
    app.get("/api/users/:id/avatar", async (req, res) => {
        const identity = await storage.getIdentity(Number(req.params.id));
        if (!identity) return res.status(404).json({ message: "Not found" });

        const avatar = await storage.getUserAvatar(identity.entityType, identity.entityId);
        res.json({ avatar: avatar || null });
    });

    // Avatar (Generic)
    app.get("/api/avatar", async (req, res) => {
        const { type, id } = req.query;
        if (!type || !id) return res.status(400).send("Missing type or id");

        const avatar = await storage.getUserAvatar(String(type), Number(id));
        res.json({ avatar: avatar || null });
    });

    app.get(api.identity.list.path, async (req, res) => {
        const { search, role, departmentId } = req.query;
        const identities = await storage.getIdentities(
            search as string,
            role as string,
            departmentId ? Number(departmentId) : undefined
        );
        res.json(identities);
    });

    // 2. Conversations

    // Helper to ensure Identity Exists (JIT Provisioning)
    const ensureIdentity = async (identityId: number): Promise<number> => {
        if (identityId > 0) return identityId;

        // Handle negative ID (Potential Identity)
        // ID scheme: Student = -id, Staff = -id - 100000
        let entityType = '';
        let entityId = 0;

        if (identityId <= -100000) {
            entityType = 'staff';
            entityId = Math.abs(identityId + 100000);
        } else {
            entityType = 'student';
            entityId = Math.abs(identityId);
        }

        // Check if already exists (race condition check)
        // We need to fetch details to create it.
        // Since we don't have a direct "createIdentityFromEntity" method in storage that takes ID only,
        // we need to query the source table first.

        // But wait, auth_system.ts handles login creation. Here we are provisioning for chat.
        // We should reuse logic or query db directly.

        // Let's implement a quick lookup.
        // We need to know email/name to create the identity record.

        // Import db and schema here? Or add method to storage?
        // Adding method to storage is cleaner.
        return await storage.ensureIdentity(entityType, entityId);
    };

    // Create Group Chat
    app.post("/api/conversations/group", async (req, res) => {
        const me = await getMe(req);
        if (!me) return res.status(401).json({ message: "Unauthorized" });

        const { name, participantIds } = z.object({
            name: z.string(),
            participantIds: z.array(z.number())
        }).parse(req.body);

        // Create Conversation
        const conversation = await storage.createConversation({
            type: 'GROUP',
            scope: 'PRIVATE',
            name
        });

        // Add Creator (Admin)
        await storage.addParticipant(conversation.id, me.id, 'admin', me.id);

        // Add Participants
        for (const pid of participantIds) {
            try {
                const realId = await ensureIdentity(pid);
                // Validation: If me is Student, can I add this person?
                // Default rule: Students can create groups and add students.

                // If we just provisioned them, we need to check their role.
                // But 'addParticipant' doesn't check role.
                // We should check role if me is student.

                if (me.role === 'STUDENT') {
                    const target = await storage.getIdentity(realId);
                    if (target && target.role !== 'STUDENT') {
                        // Skip adding non-students if student is creator
                        // Or throw error? Let's skip silently or log.
                        console.log(`Skipping adding ${target.displayName} (Role: ${target.role}) to student group.`);
                        continue;
                    }
                }

                await storage.addParticipant(conversation.id, realId, 'member', me.id);
            } catch (err) {
                console.error(`Failed to add participant ${pid}:`, err);
            }
        }

        res.status(201).json(conversation);
    });

    // Add Participant to Group
    app.post("/api/conversations/:id/participants", async (req, res) => {
        const me = await getMe(req);
        if (!me) return res.status(401).json({ message: "Unauthorized" });
        const conversationId = Number(req.params.id);
        const { identityId } = z.object({ identityId: z.number() }).parse(req.body);

        const conversation = await storage.getConversation(conversationId);
        if (!conversation) return res.status(404).json({ message: "Not found" });
        if (conversation.type !== 'GROUP') return res.status(400).json({ message: "Not a group chat" });

        // Check if me is admin or creator? Or just member?
        const meParticipant = await storage.getParticipant(conversationId, me.id);
        if (!meParticipant) return res.status(403).json({ message: "Not a member" });

        const realId = await ensureIdentity(identityId);

        // Validation: Students can ONLY add students
        if (me.role === 'STUDENT') {
            const targetIdentity = await storage.getIdentity(realId);
            if (!targetIdentity) return res.status(404).json({ message: "User not found" });

            if (targetIdentity.role !== 'STUDENT') {
                return res.status(403).json({
                    message: "Permission Denied: Students can only add other students to groups."
                });
            }
        }

        // Add
        await storage.addParticipant(conversationId, realId, 'member', me.id);

        res.json({ success: true });
    });

    // Leave Group / Remove Participant
    app.delete("/api/conversations/:id/participants/:identityId", async (req, res) => {
        const me = await getMe(req);
        if (!me) return res.status(401).json({ message: "Unauthorized" });
        const conversationId = Number(req.params.id);
        const targetId = Number(req.params.identityId);

        const conversation = await storage.getConversation(conversationId);
        if (!conversation) return res.status(404).json({ message: "Not found" });

        const targetParticipant = await storage.getParticipant(conversationId, targetId);
        if (!targetParticipant) return res.status(404).json({ message: "Participant not found" });

        // Case 1: Self-leaving
        if (me.id === targetId) {
            // CHECK RESTRICTION: "If a student is added to a group by a staff member, that student cannot leave the group on their own."
            if (me.role === 'STUDENT') {
                // Check who added them
                if (targetParticipant.addedByIdentityId) {
                    const adder = await storage.getIdentity(targetParticipant.addedByIdentityId);
                    if (adder && (adder.role === 'STAFF' || adder.role === 'ADMIN' || adder.role === 'HOD')) {
                        return res.status(403).json({
                            message: "Permission Denied: You were added by a Staff member and cannot leave this group. Contact an admin or the staff member."
                        });
                    }
                }
            }
        } else {
            // Case 2: Removing someone else
            // Only Admin or Group Creator or Staff (if they created it)
            // Updated Logic: Admins (VC, DEAN, HOD, SUPER_ADMIN) can remove ANYONE from ANY group.

            const isAdmin = ['SUPER_ADMIN', 'VC', 'DEAN', 'HOD', 'REGISTRAR'].includes(me.role);

            if (isAdmin) {
                // Allow removal
            } else {
                const meParticipant = await storage.getParticipant(conversationId, me.id);
                if (!meParticipant || meParticipant.role !== 'admin') {
                    // Basic check: Only group admins can remove others
                    return res.status(403).json({ message: "Only group admins can remove participants" });
                }
            }
        }

        await storage.removeParticipant(conversationId, targetId);
        res.json({ success: true });
    });

    app.get(api.conversations.list.path, async (req, res) => {
        const me = await getMe(req);
        if (!me) return res.status(401).json({ message: "Unauthorized" });

        const conversations = await storage.getConversations(me.id);
        res.json(conversations);
    });

    app.get(api.conversations.get.path, async (req, res) => {
        const convId = Number(req.params.id);
        const conversation = await storage.getConversation(convId);
        if (!conversation) return res.status(404).json({ message: "Not found" });

        const participants = await storage.getParticipants(convId);
        res.json({
            conversation,
            participants: participants.map(p => p.identity)
        });
    });

    app.post(api.conversations.createDirect.path, async (req, res) => {
        const me = await getMe(req);
        if (!me) return res.status(401).json({ message: "Unauthorized" });

        const { targetIdentityId } = api.conversations.createDirect.input.parse(req.body);

        const realId = await ensureIdentity(targetIdentityId);
        const target = await storage.getIdentity(realId);

        if (!target) return res.status(404).json({ message: "Target user not found" });

        if (me.role === 'STUDENT') {
            const forbiddenRoles = ['VC', 'DEAN', 'HOD', 'REGISTRAR'];
            if (forbiddenRoles.includes(target.role)) {
                return res.status(403).json({
                    message: `Permission Denied: Students cannot initiate direct chats with ${target.role}.`
                });
            }
        }

        let conversation = await storage.findDirectConversation(me.id, target.id);
        if (!conversation) {
            conversation = await storage.createConversation({
                type: 'DIRECT',
                scope: 'PRIVATE',
            });
            await storage.addParticipant(conversation.id, me.id, 'member');
            await storage.addParticipant(conversation.id, target.id, 'member');
        }
        res.status(201).json(conversation);
    });

    // 3. Messages
    app.get(api.messages.list.path, async (req, res) => {
        const conversationId = Number(req.params.id);
        const messages = await storage.getMessages(conversationId);
        res.json(messages);
    });

    app.get("/api/messages/search", async (req, res) => {
        const me = await getMe(req);
        if (!me) return res.status(401).json({ message: "Unauthorized" });
        const { q } = req.query;
        if (!q || typeof q !== 'string') return res.status(400).json({ message: "Query required" });

        const results = await storage.searchMessages(q, me.id);
        res.json(results);
    });

    app.post(api.messages.create.path, async (req, res) => {
        const me = await getMe(req);
        if (!me) return res.status(401).json({ message: "Unauthorized" });

        const conversationId = Number(req.params.id);
        const { content, type, metadata } = api.messages.create.input.parse(req.body);

        const participant = await storage.getParticipant(conversationId, me.id);
        if (!participant) return res.status(403).json({ message: "You are not a member of this chat" });

        const message = await storage.createMessage({
            conversationId,
            senderIdentityId: me.id,
            content,
            type,
            metadata
        });

        // Broadcast to all participants
        const participants = await storage.getParticipants(conversationId);
        const recipientIds = participants.map(p => p.identityId); // Include self for confirmation/optimistic update sync

        notifyList(recipientIds, {
            type: 'new_message',
            message: {
                ...message,
                sender: me // Include sender info for UI
            }
        });

        res.status(201).json(message);
    });

    // Admin Global Search
    app.get("/api/admin/global-search", async (req, res) => {
        const me = await getMe(req);
        if (!me || (me.role !== 'SUPER_ADMIN' && me.role !== 'VC')) {
            return res.status(403).json({ message: "Admin access required" });
        }

        const { q } = req.query;
        if (!q || typeof q !== 'string') return res.status(400).json({ message: "Query required" });

        const results = await storage.searchGlobalUsers(q);
        res.json(results);
    });

    // Avatar Endpoint
    app.get("/api/users/:type/:id/avatar", async (req, res) => {
        const { type, id } = req.params;
        try {
            const avatarBuffer = await storage.getUserAvatar(type, Number(id));

            if (!avatarBuffer) {
                return res.status(404).send("No avatar");
            }

            // Debugging log
            // console.log('Avatar type:', typeof avatarBuffer, Buffer.isBuffer(avatarBuffer));

            let finalBuffer: Buffer | null = null;
            let contentType = 'image/jpeg'; // Default

            // Helper to check if buffer is actually a base64 string
            const isBase64Buffer = (buf: Buffer) => {
                // Check first few bytes for common Base64 signatures
                // JPEG: /9j/ -> 0x2f 0x39 0x6a 0x2f
                // PNG: iVBOR -> 0x69 0x56 0x42 0x4f 0x52
                // GIF: R0lGOD -> 0x52 0x30 0x6c 0x47 0x4f 0x44
                // Data URI: data: -> 0x64 0x61 0x74 0x61 0x3a
                const prefix = buf.subarray(0, 10).toString('utf-8');
                return prefix.startsWith('/9j/') ||
                    prefix.startsWith('iVBOR') ||
                    prefix.startsWith('R0lGOD') ||
                    prefix.startsWith('data:');
            };

            if (Buffer.isBuffer(avatarBuffer)) {
                if (isBase64Buffer(avatarBuffer)) {
                    // It's a Base64 string stored as a Buffer
                    const str = avatarBuffer.toString('utf-8');

                    // Check for data URI prefix
                    const matches = str.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
                    if (matches && matches.length === 3) {
                        contentType = matches[1];
                        finalBuffer = Buffer.from(matches[2], 'base64');
                    } else {
                        // Raw Base64 string
                        finalBuffer = Buffer.from(str, 'base64');
                    }
                } else {
                    // Assume raw binary
                    finalBuffer = avatarBuffer;
                }
            } else if (typeof avatarBuffer === 'string') {
                // Check for Base64 Data URI
                const matches = (avatarBuffer as string).match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
                if (matches && matches.length === 3) {
                    contentType = matches[1];
                    finalBuffer = Buffer.from(matches[2], 'base64');
                } else {
                    // Try treating as raw base64 string
                    try {
                        finalBuffer = Buffer.from(avatarBuffer, 'base64');
                    } catch (e) {
                        // Maybe it's a URL?
                        return res.redirect(avatarBuffer);
                    }
                }
            } else if (typeof avatarBuffer === 'object' && (avatarBuffer as any).type === 'Buffer' && Array.isArray((avatarBuffer as any).data)) {
                // Handle JSON-serialized Buffer: { type: 'Buffer', data: [ ... ] }
                finalBuffer = Buffer.from((avatarBuffer as any).data);
            } else if (typeof avatarBuffer === 'object' && (avatarBuffer as any).data) {
                // Handle wrapped object: { data: Buffer }
                if (Buffer.isBuffer((avatarBuffer as any).data)) {
                    finalBuffer = (avatarBuffer as any).data;
                } else if (Array.isArray((avatarBuffer as any).data)) {
                    finalBuffer = Buffer.from((avatarBuffer as any).data);
                }
            }

            if (finalBuffer) {
                res.setHeader('Content-Type', contentType);
                res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
                res.send(finalBuffer);
            } else {
                // Fallback or error
                console.log("Could not process avatar buffer format:", avatarBuffer);
                res.status(422).send("Invalid avatar format");
            }

        } catch (err) {
            console.error(err);
            res.status(500).send("Error fetching avatar");
        }
    });

    // Update Participant Role (Co-Admin)
    app.patch("/api/conversations/:id/participants/:identityId/role", async (req, res) => {
        const me = await getMe(req);
        if (!me) return res.status(401).json({ message: "Unauthorized" });

        const conversationId = Number(req.params.id);
        const targetIdentityId = Number(req.params.identityId);
        const { role } = z.object({ role: z.string() }).parse(req.body); // 'admin' or 'member'

        const conversation = await storage.getConversation(conversationId);
        if (!conversation || conversation.type !== 'GROUP') {
            return res.status(400).json({ message: "Invalid group" });
        }

        // Check if me is admin
        const meParticipant = await storage.getParticipant(conversationId, me.id);
        if (!meParticipant || meParticipant.role !== 'admin') {
            return res.status(403).json({ message: "Only group admins can change roles" });
        }

        await storage.updateParticipantRole(conversationId, targetIdentityId, role);
        res.json({ success: true });
    });

    // Admin Message Control
    app.delete("/api/messages/:id", async (req, res) => {
        const me = await getMe(req);
        if (!me) return res.status(401).json({ message: "Unauthorized" });

        const messageId = Number(req.params.id);
        const message = await storage.getMessage(messageId);
        if (!message) return res.status(404).json({ message: "Message not found" });

        // Permissions:
        // 1. System Admins (Super Admin, VC, etc.) -> Can delete anything
        const isSystemAdmin = ['ADMIN', 'SUPER_ADMIN', 'HOD', 'DEAN', 'VC'].includes(me.role);

        // 2. Sender -> Can delete their own
        const isSender = message.senderIdentityId === me.id;

        // 3. Group Admin/Co-Admin -> Can delete in their group
        let isGroupAdmin = false;
        const participant = await storage.getParticipant(message.conversationId, me.id);
        if (participant && ['admin', 'co-admin'].includes(participant.role || '')) {
            isGroupAdmin = true;
        }

        if (isSystemAdmin || isSender || isGroupAdmin) {
            await storage.deleteMessage(messageId);
            return res.json({ success: true });
        }

        return res.status(403).json({ message: "Permission Denied" });
    });

    app.patch("/api/messages/:id", async (req, res) => {
        const me = await getMe(req);
        if (!me) return res.status(401).json({ message: "Unauthorized" });

        const messageId = Number(req.params.id);
        const { content } = z.object({ content: z.string() }).parse(req.body);
        const message = await storage.getMessage(messageId);
        if (!message) return res.status(404).json({ message: "Message not found" });

        const isSender = message.senderIdentityId === me.id;

        // Rule: ONLY Sender can edit within 15 minutes. 
        // Admins CANNOT edit (per user request), only delete.

        if (isSender) {
            const now = new Date();
            const created = new Date(message.createdAt || now);
            const diffMins = (now.getTime() - created.getTime()) / 60000;

            if (diffMins > 15) {
                return res.status(403).json({ message: "Edit window (15 min) expired." });
            }

            await storage.updateMessage(messageId, content);
            return res.json({ success: true });
        }

        return res.status(403).json({ message: "Permission Denied: Only the sender can edit this message." });
    });

    // 4. Notifications
    app.get(api.notifications.list.path, async (req, res) => {
        const me = await getMe(req);
        if (!me) return res.status(401).json({ message: "Unauthorized" });
        const notifications = await storage.getNotifications(me.id);
        res.json(notifications);
    });

    app.post(api.notifications.markRead.path, async (req, res) => {
        const id = Number(req.params.id);
        await storage.markNotificationRead(id);
        res.json({ success: true });
    });

    // Mark Messages Read (Conversation)
    app.post("/api/conversations/:id/read", async (req, res) => {
        const me = await getMe(req);
        if (!me) return res.status(401).json({ message: "Unauthorized" });
        const conversationId = Number(req.params.id);

        // In a real app, we update messageStatuses table. 
        // For now, let's assume we broadcast "read_receipt" to the conversation.

        const participants = await storage.getParticipants(conversationId);
        const recipientIds = participants.map(p => p.identityId).filter(id => id !== me.id);

        notifyList(recipientIds, {
            type: 'read_receipt',
            conversationId,
            readerIdentityId: me.id,
            readAt: new Date()
        });

        res.json({ success: true });
    });

    // 5. Status Updates & Streaks
    app.get(api.status.list.path, async (req, res) => {
        const statuses = await storage.getStatusUpdates();
        res.json(statuses);
    });

    app.post(api.status.create.path, async (req, res) => {
        const me = await getMe(req);
        if (!me) return res.status(401).json({ message: "Unauthorized" });

        const { content, mediaUrl } = api.status.create.input.parse(req.body);
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 6); // 6 Hours Expiry

        const status = await storage.createStatusUpdate({
            identityId: me.id,
            content,
            mediaUrl,
            expiresAt
        });

        // Update streak
        await storage.updateIdentityStreak(me.id, (me.streakCount || 0) + 1);

        res.status(201).json(status);
    });

    // 6. Calls (Basic signaling support)
    app.post(api.calls.initiate.path, async (req, res) => {
        const me = await getMe(req);
        if (!me) return res.status(401).json({ message: "Unauthorized" });

        const { targetIdentityId, type } = api.calls.initiate.input.parse(req.body);

        const call = await storage.createCall({
            initiatorIdentityId: me.id,
            targetIdentityId,
            type,
            status: 'ongoing'
        });

        // Mock notification for target
        await storage.createNotification({
            identityId: targetIdentityId,
            type: 'call_incoming',
            title: `Incoming ${type} Call`,
            content: `${me.displayName} is calling you`,
            referenceId: call.id
        });

        res.status(201).json(call);
    });

    app.get(api.calls.list.path, async (req, res) => {
        const me = await getMe(req);
        if (!me) return res.status(401).json({ message: "Unauthorized" });
        const calls = await storage.getCalls(me.id);
        res.json(calls);
    });

    // 7. Admin
    app.get(api.admin.users.path, async (req, res) => {
        const me = await getMe(req);
        if (!me || (me.role !== 'SUPER_ADMIN' && me.role !== 'VC')) {
            // Allow VC to view for demo if SUPER_ADMIN not seeded
            if (me?.role !== 'VC') return res.status(403).json({ message: "Admin access required" });
        }

        const users = await storage.getAllUsers();
        res.json(users);
    });

    app.post("/api/admin/users/:id/role", async (req, res) => {
        const me = await getMe(req);
        // Strict Admin Check
        if (!me || (me.role !== 'SUPER_ADMIN' && me.role !== 'VC')) {
            return res.status(403).json({ message: "Admin access required" });
        }

        const identityId = Number(req.params.id);
        const { role } = z.object({ role: z.string() }).parse(req.body);

        await storage.updateUserRole(identityId, role);
        res.json({ success: true });
    });

    app.post("/api/admin/users/:id/suspend", async (req, res) => {
        const me = await getMe(req);
        if (!me || (me.role !== 'SUPER_ADMIN' && me.role !== 'VC')) {
            return res.status(403).json({ message: "Admin access required" });
        }

        const identityId = Number(req.params.id);
        const { isSuspended } = z.object({ isSuspended: z.boolean() }).parse(req.body);

        await storage.toggleUserSuspension(identityId, isSuspended);
        res.json({ success: true });
    });

    // Admin Dashboard Search
    app.get("/api/admin/search", async (req, res) => {
        const me = await getMe(req);
        if (!me) return res.status(401).json({ message: "Unauthorized" });

        const { q } = req.query;
        if (!q || typeof q !== 'string') return res.status(400).json({ message: "Query required" });

        const results = await storage.searchGlobalUsers(q);
        res.json(results);
    });

    app.post("/api/admin/users/provision", async (req, res) => {
        const me = await getMe(req);
        if (!me || (me.role !== 'SUPER_ADMIN' && me.role !== 'VC')) {
            return res.status(403).json({ message: "Admin access required" });
        }
        const { entityType, entityId } = z.object({
            entityType: z.enum(['student', 'staff']),
            entityId: z.number()
        }).parse(req.body);

        const id = await storage.ensureIdentity(entityType, entityId);
        res.json({ id });
    });

    app.get("/api/admin/stats", async (req, res) => {
        const me = await getMe(req);
        if (!me || (me.role !== 'SUPER_ADMIN' && me.role !== 'VC')) return res.status(403).send("Forbidden");
        const stats = await storage.getAdminStats();
        res.json(stats);
    });

    app.get("/api/admin/groups", async (req, res) => {
        const me = await getMe(req);
        if (!me || (me.role !== 'SUPER_ADMIN' && me.role !== 'VC')) return res.status(403).send("Forbidden");
        const groups = await storage.getAllGroups();
        res.json(groups);
    });

    app.delete("/api/admin/groups/:id", async (req, res) => {
        const me = await getMe(req);
        if (!me || (me.role !== 'SUPER_ADMIN' && me.role !== 'VC')) return res.status(403).send("Forbidden");
        await storage.deleteGroup(Number(req.params.id));
        res.json({ success: true });
    });

    // Group Admin: Assign Co-Admin / Role Change
    app.patch("/api/conversations/:id/participants/:identityId", async (req, res) => {
        const me = await getMe(req);
        if (!me) return res.status(401).json({ message: "Unauthorized" });

        const conversationId = Number(req.params.id);
        const targetId = Number(req.params.identityId);
        const { role } = z.object({ role: z.enum(['admin', 'co-admin', 'member']) }).parse(req.body);

        // Permissions:
        // 1. System Admins -> OK
        // 2. Group Creator (Admin) -> OK

        const isSystemAdmin = ['ADMIN', 'SUPER_ADMIN', 'HOD', 'DEAN', 'VC'].includes(me.role);
        let isGroupAdmin = false;

        if (!isSystemAdmin) {
            const meParticipant = await storage.getParticipant(conversationId, me.id);
            // Only 'admin' (creator) can assign co-admins. Co-admins cannot assign other co-admins (usually).
            // Let's allow co-admin to assign member but not admin?
            // Requirement: "Group Admin can assign any group participant a Co-Admin"
            if (meParticipant?.role === 'admin') {
                isGroupAdmin = true;
            }
        }

        if (isSystemAdmin || isGroupAdmin) {
            await storage.updateParticipantRole(conversationId, targetId, role);
            return res.json({ success: true });
        }

        return res.status(403).json({ message: "Only Group Admins can change roles." });
    });

    // Debug
    app.post(api.debug.switchIdentity.path, async (req, res) => {
        const { identityId } = api.debug.switchIdentity.input.parse(req.body);
        const identity = await storage.getIdentity(identityId);
        if (!identity) return res.status(404).json({ message: "Identity not found" });
        // @ts-ignore
        if (req.session) req.session.switchedIdentityId = identityId;
        res.json({ success: true });
    });

    // --- Announcements ---

    app.get("/api/announcements", async (req, res) => {
        try {
            const all = await storage.getAnnouncements();
            // Enhance with author info? 
            // Ideally perform join in storage, but here we can fetch identities if needed.
            // For now, let's just return.
            res.json(all);
        } catch (err) {
            console.error(err);
            res.status(500).send("Error fetching announcements");
        }
    });

    app.post("/api/announcements", async (req, res) => {
        // Admin check
        // For demo, assume any authenticated staff/admin can post? 
        // Or check role.
        // const user = req.user; // If we had passport
        // For now, allow open or basic check if we had session context here.

        const parsed = insertAnnouncementSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json(parsed.error);

        try {
            const created = await storage.createAnnouncement(parsed.data);

            // Notify all?
            // Not implemented: Push notification to all users.

            res.status(201).json(created);
        } catch (err) {
            console.error(err);
            res.status(500).send("Error creating announcement");
        }
    });

    // --- File Upload (Multer) ---

    // Ensure upload directory exists
    const uploadDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }

    const storageMulter = multer.diskStorage({
        destination: function (req, file, cb) {
            cb(null, uploadDir)
        },
        filename: function (req, file, cb) {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
            cb(null, uniqueSuffix + '-' + file.originalname)
        }
    });

    const upload = multer({ storage: storageMulter });

    app.post('/api/upload', upload.single('file'), (req, res) => {
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });

        // Return relative URL (we need to serve this static folder)
        const url = `/uploads/${req.file.filename}`;
        res.json({ url });
    });

    // Serve static files from uploads
    app.use('/uploads', express.static(uploadDir));

    return httpServer;
}

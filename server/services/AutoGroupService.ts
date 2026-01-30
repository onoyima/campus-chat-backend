
import { db } from "../db";
import {
    students, studentAcademics, users, chatIdentities,
    conversations, participants, departments, staff
} from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";

export class AutoGroupService {

    // Parse Matric No to get Dept Code
    static getDeptCodeFromMatric(matricNo: string): string | null {
        if (!matricNo) return null;
        const parts = matricNo.split('/');
        // Pattern: VUG/CSC/16/1335
        if (parts.length >= 2) {
            return parts[1].toUpperCase();
        }
        return null;
    }

    // Main sync function for a student
    static async syncStudent(studentId: number) {
        console.log(`Syncing groups for student ${studentId}...`);

        // 1. Fetch Student Data using manual join
        const [studentData] = await db.select({
            id: students.id,
            matricNo: students.matricNo,
            level: studentAcademics.level
        })
            .from(students)
            .leftJoin(studentAcademics, eq(students.id, studentAcademics.studentId))
            .where(eq(students.id, studentId));

        if (!studentData) {
            console.error(`Student ${studentId} not found`);
            return;
        }

        const matricNo = studentData.matricNo;
        const level = studentData.level;

        // 2. Get or Create Chat Identity
        const identityId = await this.ensureIdentity('student', studentId);
        if (!identityId) {
            console.warn(`Could not ensure identity for student ${studentId}`);
            return;
        }

        // Global Student Group (Join this first so it works even if levels are missing)
        await this.ensureGroupAndJoin("All Students", "global", identityId);

        if (!matricNo || !level) {
            console.warn(`Student ${studentId} missing matricNo or level for specific groups`);
            return;
        }

        const deptCode = this.getDeptCodeFromMatric(matricNo);
        let deptName = deptCode; // Default to code if no name found

        // Try to find Department Name from DB
        if (deptCode) {
            const [deptRecord] = await db.select().from(departments).where(eq(departments.code, deptCode));
            if (deptRecord) {
                deptName = deptRecord.name;
            }
        }

        // 3. Define Groups

        // A. Level Group
        const levelGroupName = `${level} Level`;
        await this.ensureGroupAndJoin(levelGroupName, 'level', identityId);

        // B. Department Group
        if (deptName) {
            const deptGroupName = deptCode && deptName !== deptCode
                ? `${deptName} (${deptCode})`
                : deptName;

            await this.ensureGroupAndJoin(deptGroupName, 'department', identityId);

            // C. Combined Group
            const combinedGroupName = `${level} Level ${deptName}`;
            await this.ensureGroupAndJoin(combinedGroupName, 'combined', identityId);
        }
    }

    // Main sync function for a staff member
    static async syncStaff(staffId: number) {
        console.log(`Syncing groups for staff ${staffId}...`);

        // 1. Get or Create Chat Identity
        const identityId = await this.ensureIdentity('staff', staffId);
        if (!identityId) {
            console.warn(`Could not ensure identity for staff ${staffId}`);
            return;
        }

        // 2. Global Staff Group
        await this.ensureGroupAndJoin("All Staff", "global", identityId);
    }

    static async ensureIdentity(entityType: 'student' | 'staff', entityId: number): Promise<number | null> {
        // 1. Check existing
        const [existing] = await db.select().from(chatIdentities).where(and(
            eq(chatIdentities.entityType, entityType),
            eq(chatIdentities.entityId, entityId)
        ));

        if (existing) return existing.id;

        // 2. Provision new
        console.log(`Provisioning identity for ${entityType} ${entityId}`);
        try {
            let displayName = "Unknown";
            let email = "";
            let role = entityType === 'student' ? 'STUDENT' : 'STAFF';
            let userId = String(entityId);

            if (entityType === 'student') {
                const [s] = await db.select().from(students).where(eq(students.id, entityId));
                if (s) {
                    displayName = `${s.fname} ${s.lname}`.trim();
                    email = s.email || "";
                }
            } else {
                const [s] = await db.select().from(staff).where(eq(staff.id, entityId));
                if (s) {
                    displayName = `${s.fname} ${s.lname}`.trim();
                    email = s.email || "";
                }
            }

            const [result] = await db.insert(chatIdentities).values({
                userId,
                entityType,
                entityId,
                displayName,
                email,
                role,
                isOnline: false,
                isSuspended: false
            });

            return result.insertId;
        } catch (err) {
            console.error(`Failed to provision identity for ${entityType} ${entityId}`, err);
            return null;
        }
    }

    static async ensureGroupAndJoin(groupName: string, scope: string, identityId: number) {
        // 1. Find or Create Group
        const [existingConv] = await db.select().from(conversations).where(and(
            eq(conversations.name, groupName),
            eq(conversations.type, 'GROUP'),
            eq(conversations.scope, scope)
        ));

        let conversationId: number;

        if (!existingConv) {
            console.log(`Creating group: ${groupName}`);
            const [result] = await db.insert(conversations).values({
                name: groupName,
                type: 'GROUP',
                scope: scope,
                icon: null,
            });
            conversationId = result.insertId;
        } else {
            conversationId = existingConv.id;
        }

        // 2. Check if member
        const [membership] = await db.select().from(participants).where(and(
            eq(participants.conversationId, conversationId),
            eq(participants.identityId, identityId)
        ));

        if (!membership) {
            console.log(`Adding identity ${identityId} to group ${groupName}`);
            await db.insert(participants).values({
                conversationId: conversationId,
                identityId: identityId,
                role: 'member'
            });
        }
    }
}

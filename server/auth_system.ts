import "dotenv/config";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import MySQLStore from "express-mysql-session";
import { db } from "./db";
import { eq, or } from "drizzle-orm";
import { students, staff, chatIdentities } from "@shared/schema";
import bcrypt from "bcryptjs";

// Define MySQLStore constructor
const MySQLSessionStore = MySQLStore as any;

const sessionTtl = 30 * 24 * 60 * 60 * 1000; // 30 Days (Requirement)

const options = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USERNAME || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_DATABASE || "exeat1",
  expiration: sessionTtl,
  createDatabaseTable: true, // Auto-create session table
  schema: {
    tableName: 'comm_sessions' // Use this table name to avoid conflict with existing 'sessions' table
  }
};

const sessionStore = new MySQLSessionStore(options);

export const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || "dev_secret",
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    maxAge: sessionTtl,
  },
});

export function setupAuthSystem(app: Express) {
  app.use(sessionMiddleware);

  app.use(passport.initialize());
  app.use(passport.session());

  // Local Strategy for Login
  passport.use(new LocalStrategy(
    { usernameField: "email", passReqToCallback: true },
    async (req: any, identifier, password, done) => {
      try {
        console.log(`[auth] login attempt from ${req.ip} :: identifier=${identifier}`);
        let user = null;
        let role = "";
        let entityId = 0;
        let displayName = "";
        let userId = "";
        let userEmail = ""; // To capture email if logged in via matricNo
        console.log(`[auth] Debug: starting login for identifier: ${identifier}`);

        // Helper to check password
        const checkPassword = async (storedPassword: string | null) => {
          if (!storedPassword) return false;
          // 1. Try Bcrypt compare
          const isMatch = await bcrypt.compare(password, storedPassword);
          if (isMatch) return true;
          // 2. Fallback: Plain text compare (for legacy or unhashed data)
          return storedPassword === password;
        };

        // 1. Check Student Table (by Email OR Matric No/Username)
        // Note: students.matricNo maps to 'username' column in DB
        const studentsList = await db.select().from(students).where(
          or(
            eq(students.email, identifier),
            eq(students.matricNo, identifier)
          )
        );
        const student = studentsList[0];
        console.log(`[auth] Debug: student search result: ${student ? 'Found' : 'Not Found'}`);
        if (student) console.log(`[auth] Debug: student details: email=${student.email}, matricNo=${student.matricNo}`);

        if (student) {
          if (await checkPassword(student.password)) {
            user = student;
            role = "STUDENT";
            entityId = student.id;
            displayName = `${student.fname} ${student.lname}`;
            userId = String(student.userId || student.id);
            userEmail = student.email || "";
          } else {
            console.log(`[auth] student password mismatch :: identifier=${identifier}. DB Hash starts with: ${student.password ? student.password.substring(0, 10) : 'null'}`);
            return done(null, false, { message: "Incorrect password for student account" });
          }
        }

        // 2. If not student, Check Staff Table (Only by Email for now, or maybe staff ID?)
        if (!user) {
          const [staffMember] = await db.select().from(staff).where(eq(staff.email, identifier));
          if (staffMember) {
            if (await checkPassword(staffMember.password)) {
              user = staffMember;
              role = "STAFF";
              entityId = staffMember.id;
              displayName = `${staffMember.fname} ${staffMember.lname}`;
              userId = String(staffMember.id);
              userEmail = staffMember.email || "";
            } else {
              console.log(`[auth] staff password mismatch :: identifier=${identifier}`);
              return done(null, false, { message: "Incorrect password for staff account" });
            }
          }
        }

        if (!user) {
          // We checked both tables and found no user
          console.log(`[auth] account not found :: identifier=${identifier}`);
          return done(null, false, { message: "Account not found. Check your Email or Matric No." });
        }

        // 3. User valid - Ensure they have a Chat Identity
        // We use the User's Email to link identity.
        if (!userEmail) {
          console.log(`[auth] user has no email linked :: identifier=${identifier}`);
          return done(null, false, { message: "User account has no email address linked." });
        }

        let [identity] = await db.select().from(chatIdentities).where(eq(chatIdentities.email, userEmail));

        // Super Admin Emails (Hardcoded Enforcement)
        const superAdmins = [
          'onoyimab@veritas.edu.ng',
          'egbee@veritas.edu.ng',
          'christopherl@veritas.edu.ng'
        ];

        let finalRole = role;
        if (superAdmins.includes(userEmail.toLowerCase())) {
          finalRole = 'SUPER_ADMIN';
        }

        if (!identity) {
          // Insert new identity
          const [result] = await db.insert(chatIdentities).values({
            userId: userId,
            email: userEmail,
            entityType: role.toLowerCase(),
            entityId: entityId,
            displayName: displayName,
            role: finalRole,
            isOnline: true
          });

          // Fetch newly created identity
          [identity] = await db.select().from(chatIdentities).where(eq(chatIdentities.id, result.insertId));
        } else {
          // Update role if promoted to Super Admin
          if (identity.role !== 'SUPER_ADMIN' && finalRole === 'SUPER_ADMIN') {
            await db.update(chatIdentities)
              .set({ role: 'SUPER_ADMIN' })
              .where(eq(chatIdentities.id, identity.id));
            identity.role = 'SUPER_ADMIN';
          }
        }

        console.log(`[auth] login success :: identityId=${identity.id} email=${identity.email} role=${identity.role}`);
        return done(null, identity);
      } catch (err) {
        console.error('[auth] login error', err);
        return done(err);
      }
    }
  ));

  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const [identity] = await db.select().from(chatIdentities).where(eq(chatIdentities.id, id));
      done(null, identity);
    } catch (err) {
      done(err);
    }
  });

  // Auth Routes
  app.post("/api/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) return next(err);
      if (!user) {
        const message = (info && (info as any).message) || "Invalid credentials";
        return res.status(401).json({ message });
      }
      req.logIn(user, (err) => {
        if (err) return next(err);
        res.json({
          message: "Logged in successfully",
          user: req.user,
          sessionId: req.sessionID
        });
      });
    })(req, res, next);
  });

  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      req.session.destroy((err) => {
        if (err) return next(err);
        res.clearCookie('connect.sid');
        res.json({ message: "Logged out" });
      });
    });
  });

  app.get("/api/auth/user", (req, res) => {
    if (req.isAuthenticated()) {
      res.json(req.user);
    } else {
      res.status(401).json({ message: "Not authenticated" });
    }
  });
}

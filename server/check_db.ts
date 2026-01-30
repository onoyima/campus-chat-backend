
import { db } from "./db";
import { sql } from "drizzle-orm";

async function checkDb() {
    try {
        console.log("Tables:");
        const [tables] = await db.execute(sql`SHOW TABLES`);
        const tableNames = tables.map((t: any) => Object.values(t)[0]);
        // console.log(tableNames);

        const studentTables = tableNames.filter((t: string) => t.toLowerCase().includes('student'));
        console.log("Student tables:", studentTables);

        for (const t of studentTables) {
            console.log(`\nTable: ${t} Columns:`);
            const [cols] = await db.execute(sql.raw(`SHOW COLUMNS FROM \`${t}\``));
            console.log(cols.map((c: any) => `${c.Field} (${c.Type})`).join(', '));
        }

    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

checkDb();

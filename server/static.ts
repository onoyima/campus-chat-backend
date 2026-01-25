import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function serveStatic(app: Express) {
    const distPath = path.resolve(__dirname, "..", "public");

    // In backend-only deployment, skip static file serving
    if (!fs.existsSync(distPath)) {
        console.log("No static files to serve (backend-only mode)");
        return;
    }

    app.use(express.static(distPath));

    // fall through to index.html if the file doesn't exist
    app.use("*", (_req, res) => {
        res.sendFile(path.resolve(distPath, "index.html"));
    });
}

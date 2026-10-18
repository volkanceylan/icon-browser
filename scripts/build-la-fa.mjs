#!/usr/bin/env node
/*
 * Extract the Line Awesome -> Font Awesome class mapping from a
 * line-awesome-fa.css shim.
 *
 *   npm run la-fa
 *   npm run la-fa -- --source path/to/line-awesome-fa.css --out data/la-fa.json
 *
 * The shim defines `.fa-<name>:before { content: "<codepoint>" }` against the
 * Line Awesome font, so several Font Awesome names share one glyph. We invert
 * that: each Line Awesome icon name maps to every Font Awesome name that renders
 * the same glyph (exact name first).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const SOURCE = resolve(
    argValue(
        "--source",
        "P:/startsharp/Serenity/packages/assets/wwwroot/line-awesome/css/line-awesome-fa.css"
    )
);
const OUT = resolve(root, argValue("--out", "data/la-fa.json"));

if (!existsSync(SOURCE)) {
    console.error(`line-awesome-fa.css not found at ${SOURCE} (use --source)`);
    process.exitCode = 1;
} else {
    const la = JSON.parse(
        readFileSync(resolve(root, "node_modules/@iconify-json/la/icons.json"), "utf8")
    );
    const css = readFileSync(SOURCE, "utf8");

    const nameToCode = new Map();
    const codeToNames = new Map();
    for (const match of css.matchAll(/\.fa-([a-z0-9-]+):before\s*\{\s*content:\s*"([^"]+)"/g)) {
        const name = match[1];
        const code = match[2].replace(/\\/g, "").toLowerCase();
        if (!nameToCode.has(name)) nameToCode.set(name, code);
        if (!codeToNames.has(code)) codeToNames.set(code, new Set());
        codeToNames.get(code).add(name);
    }

    const icons = {};
    const add = (name) => {
        if (icons[name]) return;
        const code = nameToCode.get(name);
        if (!code) return;
        const shared = [...codeToNames.get(code)].sort();
        icons[name] = [name, ...shared.filter((value) => value !== name)];
    };

    for (const name of Object.keys(la.icons)) add(name);
    for (const name of Object.keys(la.aliases ?? {})) add(name);

    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(
        OUT,
        `${JSON.stringify({ version: 1, source: basename(SOURCE), icons }, null, 2)}\n`
    );
    console.log(`wrote ${Object.keys(icons).length} Line Awesome -> Font Awesome mappings to ${OUT}`);
}

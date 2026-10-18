#!/usr/bin/env node
/*
 * Precompute the browser data from the @iconify-json packages:
 *   - public/sets/index.json              : all set metadata (name, style, chunk file) — one file
 *   - public/sets/index.json.gz           : gzipped copy (served by dev/preview)
 *   - public/sets/<prefix>/<prefix>-<n>-<hash>.json : bodies, 250 per chunk (immutable)
 *   - public/sets/<prefix>/<prefix>-<n>-<hash>.json.gz : gzipped copy (served by dev/preview)
 *   - public/sets/build.json              : content hash used to bust the index cache
 *
 * The app loads the single index at startup and fetches a small chunk when an
 * icon's SVG is first needed, so SVG bodies stay out of JS memory.
 *
 *   npm run data
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { SET_PREFIXES } from "../src/icon-sets.ts";
import { buildSetItems } from "../src/variants.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(root, "public/sets");
const CHUNK_SIZE = 250;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Hash every generated file so the build id changes whenever any data changes.
const hash = createHash("sha256");
const write = (relativePath, content) => {
    hash.update(relativePath).update("\0").update(content).update("\0");
    const file = resolve(OUT, relativePath);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
};

let totalItems = 0;
let totalChunks = 0;
const setsIndex = [];

for (const prefix of SET_PREFIXES) {
    const pkg = resolve(root, "node_modules/@iconify-json", prefix);
    const data = JSON.parse(readFileSync(resolve(pkg, "icons.json"), "utf8"));
    const info = JSON.parse(readFileSync(resolve(pkg, "info.json"), "utf8"));

    const items = buildSetItems(data, info.palette === true).sort((a, b) =>
        a.name.localeCompare(b.name)
    );
    const width = data.width ?? 16;
    const height = data.height ?? width;
    const chunkCount = Math.ceil(items.length / CHUNK_SIZE);
    const chunks = Array.from({ length: chunkCount }, () => ({}));
    const itemList = [];

    items.forEach((item, i) => {
        const chunk = Math.floor(i / CHUNK_SIZE);
        itemList.push([item.name, item.style, chunk]);
        const entry = { body: item.body };
        if (item.width !== undefined) entry.w = item.width;
        if (item.height !== undefined) entry.h = item.height;
        if (item.left !== undefined) entry.l = item.left;
        if (item.top !== undefined) entry.t = item.top;
        chunks[chunk][item.name] = entry;
    });

    const chunkFiles = [];
    for (let c = 0; c < chunkCount; c++) {
        const content = JSON.stringify(chunks[c]);
        const chunkHash = createHash("sha256").update(content).digest("hex").slice(0, 16);
        const file = `${prefix}-${c}-${chunkHash}.json`;
        chunkFiles.push(file);
        write(`${prefix}/${file}`, content);
        writeFileSync(resolve(OUT, `${prefix}/${file}.gz`), gzipSync(content));
    }

    setsIndex.push({
        prefix,
        name: info.name,
        width,
        height,
        palette: info.palette === true,
        chunks: chunkFiles,
        items: itemList
    });

    totalItems += items.length;
    totalChunks += chunkCount;
    console.log(`${prefix.padEnd(24)} items=${String(items.length).padStart(6)} chunks=${chunkCount}`);
}

const indexContent = JSON.stringify({ sets: setsIndex });
write("index.json", indexContent);
writeFileSync(resolve(OUT, "index.json.gz"), gzipSync(indexContent));

// Small meta files, copied from data/ and gzipped so they are served compressed
// and stay out of the JS bundle (they are also part of the build hash).
const META_OUT = resolve(root, "public/data");
rmSync(META_OUT, { recursive: true, force: true });
mkdirSync(META_OUT, { recursive: true });
for (const name of ["codepoints", "la-fa", "synonyms"]) {
    const source = resolve(root, "data", `${name}.json`);
    if (!existsSync(source)) continue;
    const content = readFileSync(source, "utf8");
    hash.update(`data/${name}.json`).update("\0").update(content).update("\0");
    writeFileSync(resolve(META_OUT, `${name}.json`), content);
    writeFileSync(resolve(META_OUT, `${name}.json.gz`), gzipSync(content));
    console.log(`meta      ${name.padEnd(12)} ${Math.round(content.length / 1024)} KB`);
}

// Copy the notices next to the app so the About panel can fetch them.
const noticeSource = resolve(root, "notice.md");
if (existsSync(noticeSource)) {
    writeFileSync(resolve(root, "public/notice.md"), readFileSync(noticeSource, "utf8"));
    console.log("meta      notice.md");
}

const build = hash.digest("hex").slice(0, 16);
writeFileSync(resolve(OUT, "build.json"), JSON.stringify({ build }));
console.log(`TOTAL items=${totalItems} chunks=${totalChunks} build=${build}`);

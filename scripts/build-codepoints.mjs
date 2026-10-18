#!/usr/bin/env node
/*
 * Extract font glyph codepoints for the sets that ship a webfont role.
 *
 *   npm run codepoints
 *   npm run codepoints -- --la path/to/line-awesome-fa.css
 *
 * Sources:
 *   la     - the Font Awesome shim used to render Line Awesome
 *   bi     - bootstrap-icons/font/bootstrap-icons.css   (.bi-x::before)
 *   tabler - @tabler/icons-webfont/dist/tabler-icons.css (.ti-x:before)
 *
 * Writes data/codepoints.json: { la: { name: "f015" }, bi: {...}, tabler: {...} }
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const LA_SOURCE = resolve(
    argValue(
        "--la",
        "P:/startsharp/Serenity/packages/assets/wwwroot/line-awesome/css/line-awesome-fa.css"
    )
);
const BI_SOURCE = resolve(root, "node_modules/bootstrap-icons/font/bootstrap-icons.css");
const TABLER_OUTLINE = resolve(root, "node_modules/@tabler/icons-webfont/dist/tabler-icons.css");
const TABLER_FILLED = resolve(root, "node_modules/@tabler/icons-webfont/dist/tabler-icons-filled.css");
const TABLER_RE = /\.ti-([a-z0-9-]+):before\s*\{\s*content:\s*"([^"]+)"/g;
const OUT = resolve(root, argValue("--out", "data/codepoints.json"));

const clean = (value) => value.replace(/\\/g, "").toLowerCase();

function parse(css, regex) {
    const map = {};
    for (const match of css.matchAll(regex)) map[match[1]] = clean(match[2]);
    return map;
}

const codepoints = {};

if (existsSync(LA_SOURCE)) {
    const shim = parse(
        readFileSync(LA_SOURCE, "utf8"),
        /\.fa-([a-z0-9-]+):before\s*\{\s*content:\s*"([^"]+)"/g
    );
    const la = JSON.parse(
        readFileSync(resolve(root, "node_modules/@iconify-json/la/icons.json"), "utf8")
    );
    const map = {};
    for (const name of Object.keys(la.icons)) if (shim[name]) map[name] = shim[name];
    codepoints.la = map;
} else {
    console.warn(`! la shim not found at ${LA_SOURCE}, skipping la`);
}

if (existsSync(BI_SOURCE)) {
    codepoints.bi = parse(
        readFileSync(BI_SOURCE, "utf8"),
        /\.bi-([a-z0-9-]+)::before\s*\{\s*content:\s*"([^"]+)"/g
    );
} else {
    console.warn("! bootstrap-icons.css not found, skipping bi");
}

// The filled webfont reuses the outline class names (base .ti = filled font),
// and Iconify names those icons "<name>-filled".
if (existsSync(TABLER_OUTLINE)) {
    const tabler = parse(readFileSync(TABLER_OUTLINE, "utf8"), TABLER_RE);
    if (existsSync(TABLER_FILLED)) {
        const icons = JSON.parse(
            readFileSync(resolve(root, "node_modules/@iconify-json/tabler/icons.json"), "utf8")
        ).icons;
        for (const [name, code] of Object.entries(
            parse(readFileSync(TABLER_FILLED, "utf8"), TABLER_RE)
        )) {
            const key = `${name}-filled`;
            if (icons[key] && !tabler[key]) tabler[key] = code;
        }
    }
    codepoints.tabler = tabler;
} else {
    console.warn("! tabler-icons css not found, skipping tabler");
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ version: 1, codepoints }, null, 2)}\n`);
console.log(
    `wrote ${OUT} (${Object.entries(codepoints)
        .map(([prefix, map]) => `${prefix}:${Object.keys(map).length}`)
        .join(", ")})`
);

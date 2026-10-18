#!/usr/bin/env node
/*
 * Incremental synonym dictionary builder.
 *
 *   npm run synonyms                 # generate words that are missing from data/synonyms.json
 *   npm run synonyms -- --dry-run    # show what would be generated
 *   npm run synonyms -- --limit 50   # cap work for this run
 *   npm run synonyms -- --max 10     # max synonyms kept per word (default 10)
 *   npm run synonyms -- --effort low  # reasoning effort (off|minimal|low|medium|high|xhigh|max)
 *   npm run synonyms -- --refresh settings,home
 *
 * Environment (optionally via a .env file next to package.json):
 *   ICON_BROWSER_API_KEY   required
 *   ICON_BROWSER_API_URL   OpenAI-compatible chat completions endpoint
 *   ICON_BROWSER_MODEL     model name
 *
 * The dictionary is keyed by words that appear in icon names, so re-running after
 * adding icon sets only asks the model about the new words.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SET_PREFIXES } from "../src/icon-sets.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const OPENCODE_HOST = "https://opencode.ai";

function isOpenCodeEndpoint(url) {
    const lower = url.toLowerCase();
    if (!lower.startsWith(OPENCODE_HOST)) return false;
    const rest = lower.slice(OPENCODE_HOST.length);
    return rest === "" || rest.startsWith("/");
}

// Stable, opaque session id derived from the repository path and the current date.
// Same repo on the same day gives the same value; it rotates daily.
function openCodeSessionId() {
    const normalized = root.replace(/[\\/]+$/, "").toLowerCase();
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
        now.getDate()
    ).padStart(2, "0")}`;
    return createHash("sha256").update(`${normalized}|${day}`).digest("hex");
}

try {
    process.loadEnvFile?.(resolve(root, ".env"));
} catch {
    /* no .env file */
}

const API_KEY = process.env.ICON_BROWSER_API_KEY;
const API_URL =
    process.env.ICON_BROWSER_API_URL ||
    "https://opencode.ai/inference/go/openai/v1/chat/completions";
const MODEL = process.env.ICON_BROWSER_MODEL || "deepseek-v4.1-flash";

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const argValue = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const OUT = resolve(root, argValue("--out", "data/synonyms.json"));
const BATCH = Number.parseInt(argValue("--batch", "25"), 10);
const CONCURRENCY = Number.parseInt(argValue("--concurrency", "2"), 10);
const DELAY = Number.parseInt(argValue("--delay", "300"), 10);
const LIMIT = Number.parseInt(argValue("--limit", "0"), 10) || Infinity;
const MAX_SYNONYMS = Number.parseInt(argValue("--max", "10"), 10);
// Reasoning effort sent as `reasoning_effort`. Empty lets the provider choose.
const EFFORT = argValue("--effort", process.env.ICON_BROWSER_REASONING_EFFORT || "");
const REFRESH = argValue("--refresh", "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
const DRY = hasFlag("--dry-run");

const STOPWORDS = new Set([
    "filled",
    "outline",
    "outlined",
    "sharp",
    "rounded",
    "round",
    "solid",
    "thin",
    "bold",
    "duotone",
    "twotone",
    "off",
    "regular",
    "alt",
    "alternative"
]);

function tokenize(name, out) {
    for (const part of name.toLowerCase().split(/[^a-z0-9]+/)) {
        if (part.length < 3 || /^\d+$/.test(part) || STOPWORDS.has(part)) continue;
        out.add(part);
    }
}

function readIconSetPackages() {
    return SET_PREFIXES.map((prefix) => `@iconify-json/${prefix}`);
}

function collectWords() {
    const words = new Set();
    const sets = [];

    for (const pkg of readIconSetPackages()) {
        const file = resolve(root, "node_modules", pkg, "icons.json");
        if (!existsSync(file)) {
            console.warn(`! ${pkg} is not installed, skipping`);
            continue;
        }
        const data = JSON.parse(readFileSync(file, "utf8"));
        sets.push(data.prefix || pkg);
        for (const name of Object.keys(data.icons)) tokenize(name, words);
        for (const name of Object.keys(data.aliases || {})) tokenize(name, words);
    }

    return { words, sets };
}

function loadDictionary() {
    if (!existsSync(OUT)) return { version: 1, words: {} };
    const parsed = JSON.parse(readFileSync(OUT, "utf8"));
    return { version: parsed.version || 1, words: parsed.words || {} };
}

function normalizePhrase(value) {
    return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function parseJsonObject(content) {
    const trimmed = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end < 0) throw new Error(`no JSON object in response: ${content.slice(0, 120)}`);
    return JSON.parse(trimmed.slice(start, end + 1));
}

const SYSTEM_PROMPT =
    "You generate search metadata for an icon library. " +
    "You receive words that appear in icon names. For each word return related English words " +
    "a user might type to find an icon of that concept: synonyms, closely related objects, " +
    "and common UI vocabulary. Rules: lowercase; 1-2 words per phrase; up to 10 phrases per word " +
    "(aim for 10); no duplicates; never repeat the input word; no proper nouns; no explanations. " +
    "Respond with ONLY a JSON object mapping each input word to an array of strings.";

async function requestChat(words, withJsonMode) {
    const body = {
        model: MODEL,
        temperature: 0.3,
        messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: JSON.stringify(words) }
        ]
    };
    if (withJsonMode) body.response_format = { type: "json_object" };
    if (EFFORT) body.reasoning_effort = EFFORT;

    const headers = {
        "content-type": "application/json",
        authorization: `Bearer ${API_KEY}`
    };
    if (isOpenCodeEndpoint(API_URL)) {
        headers["x-opencode-session"] = openCodeSessionId();
    }

    const response = await fetch(API_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const text = (await response.text()).slice(0, 300);
        const error = new Error(`${response.status} ${response.statusText}: ${text}`);
        error.status = response.status;
        throw error;
    }

    const payload = await response.json();
    return parseJsonObject(payload.choices?.[0]?.message?.content ?? "");
}

async function chat(words) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            return await requestChat(words, attempt === 1);
        } catch (error) {
            lastError = error;
            if (error.status === 400 && attempt === 1) continue;
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * attempt));
        }
    }
    throw lastError;
}

function chunk(items, size) {
    const result = [];
    for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
    return result;
}

async function mapPool(items, size, worker) {
    let cursor = 0;
    const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            await worker(items[index], index);
        }
    });
    await Promise.all(runners);
}

async function main() {
    const { words, sets } = collectWords();
    const dictionary = loadDictionary();
    const known = new Set(Object.keys(dictionary.words));
    const pending = [...words]
        .filter((word) => !known.has(word) || REFRESH.includes(word))
        .sort();

    console.log(`icon sets : ${sets.join(", ")}`);
    console.log(`words     : ${words.size} found, ${known.size} already stored`);
    console.log(`to build  : ${pending.length}`);
    console.log(
        `model     : ${MODEL} @ ${API_URL}${EFFORT ? ` (effort=${EFFORT})` : ""}${
            isOpenCodeEndpoint(API_URL) ? " (x-opencode-session)" : ""
        }`
    );

    if (pending.length === 0) {
        console.log("dictionary is up to date");
        return;
    }

    const target = pending.slice(0, LIMIT === Infinity ? pending.length : LIMIT);

    if (DRY) {
        console.log(`dry run, would generate: ${target.join(", ")}`);
        return;
    }

    if (!API_KEY) {
        console.error("ICON_BROWSER_API_KEY is not set");
        process.exitCode = 1;
        return;
    }

    const save = () => {
        const sorted = {};
        for (const key of Object.keys(dictionary.words).sort()) sorted[key] = dictionary.words[key];
        mkdirSync(dirname(OUT), { recursive: true });
        writeFileSync(OUT, `${JSON.stringify({ version: 1, words: sorted }, null, 2)}\n`);
    };
    process.on("SIGINT", () => {
        save();
        console.log("\ninterrupted, progress saved");
        process.exit(130);
    });

    const batches = chunk(target, BATCH);
    let processed = 0;

    await mapPool(batches, CONCURRENCY, async (batch) => {
        const result = await chat(batch);
        for (const word of batch) {
            const raw = result[word];
            if (!Array.isArray(raw)) continue;
            const values = [...new Set(raw.map(normalizePhrase))]
                .filter((value) => value.length >= 2 && value !== word)
                .slice(0, MAX_SYNONYMS)
                .sort();
            if (values.length) dictionary.words[word] = values;
        }
        processed += batch.length;
        save();
        console.log(`  ${processed}/${target.length}`);
        if (DELAY) await new Promise((resolveDelay) => setTimeout(resolveDelay, DELAY));
    });

    save();
    console.log(`wrote ${Object.keys(dictionary.words).length} words to ${OUT}`);
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});

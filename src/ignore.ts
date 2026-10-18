import ignore from "ignore";
import raw from "../data/ignore.txt?raw";

const activeLines = (text: string): string[] =>
    text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"));

let patterns = activeLines(raw);
let matcher = ignore().add(patterns);

export function isIgnored(prefix: string, name: string): boolean {
    return matcher.ignores(`${prefix}/${name}`);
}

// Appends the pattern to data/ignore.txt via the dev/preview endpoint, then
// updates the in-memory matcher so the change applies without a reload.
export async function addIgnorePattern(pattern: string): Promise<void> {
    const clean = pattern.trim();
    if (!clean) throw new Error("empty pattern");
    const response = await fetch("/__ignore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pattern: clean })
    });
    if (!response.ok) throw new Error(`server returned ${response.status}`);
    patterns = [...patterns, clean];
    matcher = ignore().add(patterns);
}

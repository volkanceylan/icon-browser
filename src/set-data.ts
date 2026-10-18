import type { IconStyle } from "./variants";
import { BASE } from "./base";

export interface IconSetIndex {
    prefix: string;
    name: string;
    width: number;
    height: number;
    palette: boolean;
    // Chunk file names (content-hashed, immutable), indexed by the item's chunk.
    chunks: string[];
    items: Array<[string, IconStyle, number]>;
}

export interface IconBody {
    body: string;
    w?: number;
    h?: number;
    l?: number;
    t?: number;
}

// Fetched icon bodies, cached per chunk. Chunks hold 250 icons each, so a miss
// loads ~250 bodies instead of a whole set.
const chunkCache = new Map<string, Promise<Record<string, IconBody>>>();

// Content hash of the generated data (sets/build.json). Appended to the index
// request so a new build re-reads it; chunk files are content-hashed already and
// can be cached immutably.
let version = "";

async function loadVersion(): Promise<string> {
    try {
        const response = await fetch(`${BASE}sets/build.json`, { cache: "no-cache" });
        if (response.ok) return ((await response.json()) as { build?: string }).build ?? "";
    } catch {
        /* ignore */
    }
    return "";
}

const withVersion = (url: string): string => (version ? `${BASE}${url}?v=${version}` : `${BASE}${url}`);

export function dataVersion(): string {
    return version;
}

export async function loadIndexes(): Promise<IconSetIndex[]> {
    version = await loadVersion();
    const response = await fetch(withVersion("sets/index.json"));
    if (!response.ok) throw new Error("failed to load icon index");
    const data = (await response.json()) as { sets: IconSetIndex[] };
    return data.sets;
}

export function getBody(
    prefix: string,
    file: string,
    name: string
): Promise<IconBody | undefined> {
    const key = `${prefix}/${file}`;
    let promise = chunkCache.get(key);
    if (!promise) {
        promise = fetch(`${BASE}sets/${prefix}/${file}`).then((response) => {
            if (!response.ok) throw new Error(`failed to load ${prefix}/${file}`);
            return response.json() as Promise<Record<string, IconBody>>;
        });
        chunkCache.set(key, promise);
    }
    return promise.then((data) => data[name]);
}

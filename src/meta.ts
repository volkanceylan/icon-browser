import { BASE } from "./base";
import { dataVersion } from "./set-data";

export interface Meta {
    faByLa: Record<string, string[]>;
    codepoints: Record<string, Record<string, string>>;
    synonyms: Record<string, string[]>;
}

const EMPTY: Meta = { faByLa: {}, codepoints: {}, synonyms: {} };
let meta: Meta = EMPTY;

export function getMeta(): Meta {
    return meta;
}

async function loadJson<T>(name: string, fallback: T): Promise<T> {
    const version = dataVersion();
    const suffix = version ? `?v=${version}` : "";
    try {
        const response = await fetch(`${BASE}data/${name}.json${suffix}`);
        if (!response.ok) return fallback;
        return (await response.json()) as T;
    } catch {
        return fallback;
    }
}

export async function loadMeta(): Promise<Meta> {
    const [fa, cp, syn] = await Promise.all([
        loadJson<{ icons?: Record<string, string[]> }>("la-fa", {}),
        loadJson<{ codepoints?: Record<string, Record<string, string>> }>("codepoints", {}),
        loadJson<{ words?: Record<string, string[]> }>("synonyms", {})
    ]);
    meta = {
        faByLa: fa.icons ?? {},
        codepoints: cp.codepoints ?? {},
        synonyms: syn.words ?? {}
    };
    return meta;
}

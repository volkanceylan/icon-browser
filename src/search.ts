let forward = new Map<string, string[]>();
let reverse = new Map<string, string[]>();

export function initSearch(words: Record<string, string[]>): void {
    forward = new Map(Object.entries(words));
    reverse = new Map();
    for (const [key, values] of Object.entries(words)) {
        for (const value of values) {
            const keys = reverse.get(value);
            if (keys) keys.push(key);
            else reverse.set(value, [key]);
        }
    }
}

const MAX_RELATED = 8;

export interface CompiledQuery {
    active: boolean;
    prefix: string | null;
    phrase: string;
    tokens: string[];
    terms: string[];
    // One group per token: the token plus its related (synonym) terms.
    groups: string[][];
    tokenSet: Set<string>;
}

export function compileQuery(
    input: string,
    prefixes: ReadonlySet<string> = new Set()
): CompiledQuery {
    const raw = input.trim().toLowerCase();
    if (!raw) {
        return {
            active: false,
            prefix: null,
            phrase: "",
            tokens: [],
            terms: [],
            groups: [],
            tokenSet: new Set()
        };
    }

    // Set-qualified search: only "tabler:home" (colon). A dash must not be
    // treated as a qualifier, otherwise icon usage names like "la-dashboard"
    // get swallowed as "set la + dashboard".
    let body = raw;
    let prefix: string | null = null;
    const qualifier = raw.match(/^([a-z0-9]+):(.*)$/);
    if (qualifier && prefixes.has(qualifier[1])) {
        prefix = qualifier[1];
        body = qualifier[2];
    }

    // "-" is kept: a term like "la-dashboard" is one token that matches the
    // icon's full id ("la-dashboard"), not "la" + "dashboard" across all sets.
    const tokens = body
        .split(/[^a-z0-9-]+/)
        .map((token) => token.replace(/^-+|-+$/g, ""))
        .filter(Boolean);
    const phrase = tokens.join("-");
    const terms = new Set<string>();
    const groups: string[][] = [];
    for (const token of tokens) {
        terms.add(token);
        const related = new Set<string>();
        for (const value of forward.get(token) ?? []) related.add(value);
        for (const key of reverse.get(token) ?? []) related.add(key);
        const group = [token];
        let added = 0;
        for (const value of related) {
            if (added >= MAX_RELATED) break;
            group.push(value);
            terms.add(value);
            added++;
        }
        groups.push(group);
    }

    return {
        active: true,
        prefix,
        phrase,
        tokens,
        terms: [...terms],
        groups,
        tokenSet: new Set(tokens)
    };
}

export interface SearchableIcon {
    name: string;
    // Name words, including the set prefix.
    words: readonly string[];
    // Full ids the icon answers to ("tabler-home"; la also "fa-home").
    ids: readonly string[];
    // Alternative names that rank like the name (la icons' Font Awesome names).
    aliases?: readonly string[];
}

// A token is present when it is one of the icon's words, its name (or a prefix
// of it), an alias, or part of one of its ids.
function tokenMatches(icon: SearchableIcon, token: string): boolean {
    if (icon.words.includes(token)) return true;
    if (icon.name === token || icon.name.startsWith(token)) return true;
    if (icon.aliases?.includes(token)) return true;
    return icon.ids.some((value) => value === token || value.includes(token));
}

// Multi-word queries are AND across tokens, OR within each token's group: the
// icon must satisfy every typed word, either by the word itself or one of its
// related (synonym) terms.
export function matchesTokens(
    icon: SearchableIcon,
    groups: readonly (readonly string[])[]
): boolean {
    return groups.every((group) => group.some((term) => tokenMatches(icon, term)));
}

export function scoreName(icon: SearchableIcon, query: CompiledQuery): number {
    const { name, words, ids } = icon;
    const names = icon.aliases?.length ? [name, ...icon.aliases] : [name];
    let score = 0;

    if (query.phrase) {
        if (ids.includes(query.phrase)) score += 10000;
        else if (names.includes(query.phrase)) score += 9000;
        else if (ids.some((value) => value.startsWith(query.phrase))) score += 3000;
        else if (names.some((value) => value.startsWith(query.phrase))) score += 2500;
    }

    for (const token of query.tokens) {
        if (ids.includes(token)) score += 12000;
        else if (names.includes(token)) score += 5000;
        else if (words.includes(token)) score += 1200;
        else if (name.startsWith(token)) score += 1000;
        else if (name.includes(token)) score += 600;
        else if (ids.some((value) => value.includes(token))) score += 500;
    }

    for (const term of query.terms) {
        if (query.tokenSet.has(term)) continue;
        if (names.includes(term)) score += 900;
        else if (words.includes(term)) score += 300;
        else if (name.includes(term)) score += 150;
    }

    return score;
}

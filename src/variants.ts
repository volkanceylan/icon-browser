import type { ExtendedIconifyIcon, IconifyJSON } from "@iconify/types";

const WEIGHT_TOKENS = new Set([
    "thin",
    "light",
    "ultralight",
    "extralight",
    "regular",
    "normal",
    "medium",
    "semibold",
    "bold",
    "heavy",
    "black"
]);

export interface VariantCollapse {
    // Original icon names to hide as cards.
    drop: Set<string>;
    // Kept name -> display name (weight / outline suffix stripped).
    rename: Map<string, string>;
    // Kept display name -> hidden search names of collapsed duplicates.
    aliases: Map<string, string[]>;
}

const stripStroke = (body: string) => body.replace(/stroke-width="[^"]*"/g, "");

function pickWeightKeeper(entries: Array<{ name: string; body: string }>) {
    return (
        entries.find((entry) => entry.name.endsWith("-regular")) ??
        entries.find((entry) => entry.name.endsWith("-medium")) ??
        entries.find((entry) => entry.name.endsWith("-normal")) ??
        [...entries].sort((a, b) => a.name.localeCompare(b.name))[0]
    );
}

// Collapses redundancy:
//  1. weight families (IconMind bold/regular/thin, Phosphor thin/light/bold):
//     bodies that differ only by stroke-width are deduped and the weight suffix
//     stripped; when the base glyph already exists, the suffixed ones are hidden.
//  2. outline preference: a trailing "-outline" is stripped when the base name
//     is free (e.g. "abstain-answer-outline" -> "abstain-answer").
//  3. any icons whose bodies are identical once stroke-width is ignored -> keep
//     the alphabetically-first, remembering the other names as search aliases.
export function collapseVariants(data: IconifyJSON): VariantCollapse {
    const drop = new Set<string>();
    const rename = new Map<string, string>();
    const aliases = new Map<string, string[]>();
    const display = (name: string) => rename.get(name) ?? name;
    const visible = (name: string) => {
        const icon = data.icons[name];
        return icon && !icon.hidden && !drop.has(name);
    };

    // 1. weight families
    const weightGroups = new Map<string, Array<{ name: string; body: string }>>();
    for (const [name, icon] of Object.entries(data.icons)) {
        if (icon.hidden) continue;
        const dash = name.lastIndexOf("-");
        if (dash < 0) continue;
        const token = name.slice(dash + 1);
        if (!WEIGHT_TOKENS.has(token)) continue;
        const base = name.slice(0, dash);
        const entries = weightGroups.get(base) ?? [];
        entries.push({ name, body: icon.body });
        weightGroups.set(base, entries);
    }
    for (const [base, entries] of weightGroups) {
        if (entries.length < 2) continue;
        const baseIcon = data.icons[base];
        if (baseIcon && !baseIcon.hidden) {
            for (const entry of entries) drop.add(entry.name);
            continue;
        }
        const signature = stripStroke(entries[0].body);
        if (!entries.every((entry) => stripStroke(entry.body) === signature)) continue;
        const keep = pickWeightKeeper(entries);
        rename.set(keep.name, base);
        for (const entry of entries) {
            if (entry.name !== keep.name) drop.add(entry.name);
        }
    }

    // 1d. energy-icons ships every glyph in four forms: "<name>-20",
    // "<name>-20-bold", "<name>-48", "<name>-48-bold". Keep the 20 variant only
    // and strip the size/bold suffix.
    if (data.prefix === "energy-icons") {
        const sized = new Map<string, string[]>();
        for (const [name, icon] of Object.entries(data.icons)) {
            if (icon.hidden) continue;
            const match = /^(.*)-(20|48)(-bold)?$/.exec(name);
            if (!match) continue;
            const list = sized.get(match[1]) ?? [];
            list.push(name);
            sized.set(match[1], list);
        }
        for (const [base, names] of sized) {
            const baseIcon = data.icons[base];
            if (baseIcon && !baseIcon.hidden) {
                for (const name of names) drop.add(name);
                continue;
            }
            const keep =
                names.find((name) => name.endsWith("-20")) ??
                names.find((name) => name.endsWith("-20-bold")) ??
                [...names].sort()[0];
            rename.set(keep, base);
            for (const name of names) {
                if (name !== keep) drop.add(name);
            }
        }
    }

    // 1a. material-symbols shape combinations: drop "x-rounded" / "x-sharp" /
    // "x-outline-rounded" / "x-outline-sharp" / "x-rounded-sharp" when the
    // shorter variant exists. Keeps "x" and "x-outline", drops the shape combos.
    if (data.prefix.startsWith("material-symbols")) {
        for (const [name, icon] of Object.entries(data.icons)) {
            if (icon.hidden || drop.has(name)) continue;
            const match = /^(.*)-(rounded|sharp)$/.exec(name);
            if (!match) continue;
            const shorter = data.icons[match[1]];
            if (shorter && !shorter.hidden) drop.add(name);
        }
    }

    // 1c. ic style prefixes: "baseline-home" / "outline-home" / "round-home" /
    // "sharp-home" / "twotone-home" -> keep "outline-home" as "home".
    const PREFIX_STYLES = new Set(["baseline", "outline", "round", "sharp", "twotone"]);
    const prefixGroups = new Map<string, Array<{ name: string; style: string }>>();
    for (const [name, icon] of Object.entries(data.icons)) {
        if (icon.hidden || drop.has(name)) continue;
        const dash = name.indexOf("-");
        if (dash < 0) continue;
        const style = name.slice(0, dash);
        if (!PREFIX_STYLES.has(style)) continue;
        const base = name.slice(dash + 1);
        const entries = prefixGroups.get(base) ?? [];
        entries.push({ name, style });
        prefixGroups.set(base, entries);
    }
    for (const [base, entries] of prefixGroups) {
        if (entries.length < 2) continue;
        const keep = entries.find((entry) => entry.style === "outline");
        if (!keep) continue;
        const baseIcon = data.icons[base];
        if (baseIcon && !baseIcon.hidden) drop.add(base);
        rename.set(keep.name, base);
        for (const entry of entries) {
            if (entry.name !== keep.name) drop.add(entry.name);
        }
    }

    // 1b. sized style variants (Fluent: "add-20-regular"/"add-20-filled") ->
    // keep one (regular, size nearest 24) renamed to the bare concept. Only
    // real icon sizes count, so "battery-1-filled"/"dice-2-outline" are left alone.
    const KNOWN_SIZES = new Set([12, 16, 20, 24, 28, 32, 48]);
    const SIZED_STYLE = /^(.*)-(\d+)-(regular|filled|light|solid|outline)$/;
    const sizedGroups = new Map<string, Array<{ name: string; size: number; style: string }>>();
    for (const [name, icon] of Object.entries(data.icons)) {
        if (icon.hidden) continue;
        const match = SIZED_STYLE.exec(name);
        if (!match) continue;
        const size = Number.parseInt(match[2], 10);
        if (!KNOWN_SIZES.has(size)) continue;
        const entries = sizedGroups.get(match[1]) ?? [];
        entries.push({ name, size, style: match[3] });
        sizedGroups.set(match[1], entries);
    }
    for (const [base, entries] of sizedGroups) {
        if (entries.length < 2 || data.icons[base]) continue;
        const regulars = entries.filter((entry) => entry.style === "regular");
        const pool = (regulars.length ? regulars : entries).slice();
        pool.sort((a, b) => Math.abs(a.size - 24) - Math.abs(b.size - 24) || b.size - a.size);
        const keep = pool[0];
        rename.set(keep.name, base);
        for (const entry of entries) {
            if (entry.name !== keep.name) drop.add(entry.name);
        }
    }

    // 2. default-suffix preference: strip a trailing "-outline"/"-regular" when
    //    the base name is free (e.g. "abstain-answer-outline" -> "abstain-answer").
    const defaultSuffixes = ["outline", "regular"];
    const displayed = new Set<string>();
    for (const name of Object.keys(data.icons)) if (visible(name)) displayed.add(display(name));
    for (const name of Object.keys(data.icons)) {
        if (!visible(name)) continue;
        const current = display(name);
        for (const suffix of defaultSuffixes) {
            const tail = `-${suffix}`;
            if (!current.endsWith(tail)) continue;
            const base = current.slice(0, -tail.length);
            if (displayed.has(base)) break;
            rename.set(name, base);
            displayed.delete(current);
            displayed.add(base);
            break;
        }
    }

    // 3. identical drawings among the survivors
    const survivors = Object.keys(data.icons)
        .filter(visible)
        .map((name) => ({ name, body: data.icons[name].body }));

    const byBody = new Map<string, typeof survivors>();
    for (const entry of survivors) {
        const key = stripStroke(entry.body);
        const list = byBody.get(key) ?? [];
        list.push(entry);
        byBody.set(key, list);
    }

    for (const list of byBody.values()) {
        if (list.length < 2) continue;
        list.sort((a, b) => display(a.name).localeCompare(display(b.name)));
        const keptName = display(list[0].name);
        const extra = list.slice(1).map((entry) => {
            drop.add(entry.name);
            return display(entry.name);
        });
        aliases.set(keptName, extra);
    }

    return { drop, rename, aliases };
}

export type IconStyle = "outline" | "duotone" | "multicolor" | "solid";

export const STYLE_ORDER: IconStyle[] = ["outline", "duotone", "multicolor", "solid"];

export const STYLE_LABELS: Record<IconStyle, string> = {
    outline: "Outline",
    duotone: "Duotone",
    multicolor: "Multicolor",
    solid: "Solid"
};

function hasReducedOpacity(body: string): boolean {
    for (const match of body.matchAll(/(?:fill-)?opacity="([0-9.]+)"/g)) {
        if (Number.parseFloat(match[1]) < 1) return true;
    }
    return false;
}

// Sets whose base glyph is outline-style line art but drawn with fills
// (either globally, or because their filled variants carry a "-fill" suffix).
const OUTLINE_BASE = new Set([
    "bi",
    "ph",
    "carbon",
    "la",
    "ri",
    "ant-design",
    "ix",
    "teenyicons",
    "clarity",
    "qlementine-icons",
    "griddy-icons"
]);

// Classify an icon by style. No per-icon metadata exists, so this uses name
// conventions first, then the body, then the set default.
export function detectStyle(
    name: string,
    icon: ExtendedIconifyIcon,
    prefix: string,
    palette: boolean
): IconStyle {
    if (palette && prefix !== "icon-park") return "multicolor";
    if (/(^|-)duotone(-|$)|(^|-)twotone(-|$)/.test(name) || hasReducedOpacity(icon.body)) {
        return "duotone";
    }
    if (/(^|-)fill(ed)?(-|$)|(^|-)solid(-|$)/.test(name)) return "solid";
    if (/(^|-)outline(-|$)/.test(name)) return "outline";
    if (/stroke-width="/.test(icon.body) || /stroke="(?!none)/.test(icon.body)) return "outline";
    return OUTLINE_BASE.has(prefix) ? "outline" : "solid";
}

export interface SetItem {
    name: string;
    style: IconStyle;
    body: string;
    width?: number;
    height?: number;
    left?: number;
    top?: number;
}

function resolveIcon(data: IconifyJSON, name: string, depth = 0): ExtendedIconifyIcon | null {
    if (depth > 10) return null;
    if (data.icons[name]) return data.icons[name];
    const alias = data.aliases?.[name];
    return alias?.parent ? resolveIcon(data, alias.parent, depth + 1) : null;
}

// Produce the final list of cards for one icon set (collapse + dedupe + style),
// matching what the app shows. Used by the build script that writes the data.
export function buildSetItems(data: IconifyJSON, palette: boolean): SetItem[] {
    const prefix = data.prefix;
    const { drop, rename } = collapseVariants(data);
    const items: SetItem[] = [];
    const seen = new Set<string>();

    const add = (name: string, icon: ExtendedIconifyIcon | null) => {
        if (!icon || icon.hidden || drop.has(name)) return;
        const displayName = rename.get(name) ?? name;
        if (seen.has(displayName)) return;
        seen.add(displayName);
        const item: SetItem = {
            name: displayName,
            style: detectStyle(displayName, icon, prefix, palette),
            body: icon.body
        };
        if (icon.width !== undefined) item.width = icon.width;
        if (icon.height !== undefined) item.height = icon.height;
        if (icon.left !== undefined) item.left = icon.left;
        if (icon.top !== undefined) item.top = icon.top;
        items.push(item);
    };

    for (const [name, icon] of Object.entries(data.icons)) add(name, icon);
    for (const name of Object.keys(data.aliases ?? {})) {
        // Skip style-variant aliases (e.g. material-symbols "123-outline").
        const aliasName = rename.get(name) ?? name;
        const stripped = aliasName.replace(/(?:-(?:outline|rounded|sharp))+$/, "");
        if (stripped !== aliasName && seen.has(stripped)) continue;
        add(name, resolveIcon(data, name));
    }

    return items;
}

import type { IconifyIcon } from "@iconify/types";
import "./style.css";
import { BASE } from "./base";
import { CHROME_ICONS } from "./chrome-icons";
import { addIgnorePattern, isIgnored } from "./ignore";
import { formatRule, iconToInline, iconToSvg, iconToUrl, setClassSuffix } from "./iconify";
import { getMeta, loadMeta } from "./meta";
import { renderMarkdown } from "./markdown";
import { compileQuery, initSearch, matchesTokens, scoreName } from "./search";
import { getBody, loadIndexes, type IconBody, type IconSetIndex } from "./set-data";
import { createTheme, type ThemeMode } from "./theme";
import { STYLE_LABELS, STYLE_ORDER, type IconStyle } from "./variants";

function requireEl<T extends HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing element #${id}`);
    return el as T;
}

const grid = requireEl<HTMLDivElement>("grid");
const content = requireEl<HTMLElement>("content");
const aboutButton = requireEl<HTMLButtonElement>("about");
const aboutIcon = requireEl<HTMLElement>("about-icon");
const noticePanel = requireEl<HTMLDivElement>("notice");
const noticeBody = requireEl<HTMLDivElement>("notice-body");
const noticeClose = requireEl<HTMLButtonElement>("notice-close");
const noticeBackdrop = requireEl<HTMLDivElement>("notice-backdrop");
const search = requireEl<HTMLInputElement>("search");
const countEl = requireEl<HTMLSpanElement>("count");
const toast = requireEl<HTMLDivElement>("toast");
const menu = requireEl<HTMLDivElement>("menu");
const filterButton = requireEl<HTMLButtonElement>("filter");
const settings = requireEl<HTMLDivElement>("settings");
const setSearch = requireEl<HTMLInputElement>("set-search");
const setAll = requireEl<HTMLInputElement>("set-all");
const setList = requireEl<HTMLDivElement>("set-list");
const styleList = requireEl<HTMLDivElement>("style-list");
const themeButton = requireEl<HTMLButtonElement>("theme");
const themeGlyph = themeButton.querySelector("i");

// Row metrics mirror the CSS custom properties so the virtual window lines up
// exactly with the row-snap points.
const styles = getComputedStyle(document.documentElement);
const CARD_H = parseFloat(styles.getPropertyValue("--card-h")) || 100;
const GAP = parseFloat(styles.getPropertyValue("--gap")) || 8;
const ROW_H = CARD_H + GAP;
const OVERSCAN_ROWS = 4;

// Card bodies load only when a card nears the viewport. Icons are sorted by
// name across all sets, so a rendered batch spans many chunk files; fetching
// eagerly for off-screen cards floods the connection pool and stalls scrolling.
const pendingBodies = new WeakMap<HTMLElement, { item: IconItem; glyph: HTMLElement }>();
const cardItems = new WeakMap<HTMLElement, IconItem>();
const bodyObserver = new IntersectionObserver(
    (entries, observer) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const target = entry.target as HTMLElement;
            observer.unobserve(target);
            const queued = pendingBodies.get(target);
            pendingBodies.delete(target);
            if (!queued) continue;
            void itemBody(queued.item).then((body) => {
                if (body) {
                    queued.glyph.innerHTML = iconToInline(
                        toIcon(body),
                        queued.item.defaults,
                        queued.item.style !== "multicolor"
                    );
                }
            });
        }
    },
    { rootMargin: "400px 0px" }
);

interface IconItem {
    prefix: string;
    name: string;
    style: IconStyle;
    chunkFile: string;
    defaults: { width: number; height: number };
    words: string[];
    // Full ids this icon answers to ("tabler-home", and "fa-home" mappings for la).
    ids: string[];
    // Alternate names that rank like the name (la icons' Font Awesome names).
    aliases: string[];
    body?: IconBody;
}

let indexes: IconSetIndex[] = [];
let prefixes = new Set<string>();
const enabledPrefixes = new Set<string>();
const styleFilter = new Set<IconStyle>(STYLE_ORDER);
let allIcons: IconItem[] = [];
let filtered: IconItem[] = [];
let columns = 1;
let rowCount = 0;
let windowStart = -1;
let windowEnd = -1;
let suppressClickUntil = 0;

function buildIndex(): IconItem[] {
    const items: IconItem[] = [];
    for (const index of indexes) {
        const defaults = { width: index.width, height: index.height };
        for (const [name, style, chunk] of index.items) {
            if (isIgnored(index.prefix, name)) continue;
            const ids = [`${index.prefix}-${name}`];
            const aliases: string[] = [];
            if (index.prefix === "la") {
                for (const fa of getMeta().faByLa[name] ?? []) {
                    ids.push(`fa-${fa}`);
                    aliases.push(fa);
                }
            }
            items.push({
                prefix: index.prefix,
                name,
                style,
                chunkFile: index.chunks[chunk],
                defaults,
                ids,
                aliases,
                words: [index.prefix, ...name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)]
            });
        }
    }
    items.sort((a, b) => a.name.localeCompare(b.name) || a.prefix.localeCompare(b.prefix));
    return items;
}

function toIcon(body: IconBody): IconifyIcon {
    const icon: IconifyIcon = { body: body.body };
    if (body.w !== undefined) icon.width = body.w;
    if (body.h !== undefined) icon.height = body.h;
    if (body.l !== undefined) icon.left = body.l;
    if (body.t !== undefined) icon.top = body.t;
    return icon;
}

async function itemBody(item: IconItem): Promise<IconBody | undefined> {
    if (!item.body) {
        try {
            item.body = await getBody(item.prefix, item.chunkFile, item.name);
        } catch {
            /* chunk unavailable */
        }
    }
    return item.body;
}

function glyphFor(item: IconItem): string {
    return item.style === "multicolor" ? "svg-bg-icon" : "svg-icon";
}

function iconUrlFor(item: IconItem, body: IconBody): string {
    return iconToUrl(toIcon(body), item.defaults, item.style !== "multicolor");
}

// Font-based usage classes for the sets that ship a webfont. IconMind/IconOven
// have none. Bootstrap Icons applies the font to [class^="bi-"], so its base
// class is unnecessary; Tabler ("ti") and Line Awesome ("la") need their base.
function usageClasses(item: IconItem): string[] {
    if (item.prefix === "la") {
        const fa = getMeta().faByLa[item.name] ?? [];
        if (fa.length) return fa.map((name) => `fa fa-${name}`);
        return [`la la-${item.name}`];
    }
    if (item.prefix === "tabler") return [`ti ti-${item.name}`];
    if (item.prefix === "bi") return [`bi-${item.name}`];
    return [];
}

function hintFor(item: IconItem): string {
    return [`${item.prefix}:${item.name}`, ...usageClasses(item)].join("\n");
}

function createCard(item: IconItem): HTMLButtonElement {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "icon-card";
    card.title = hintFor(item);

    const glyph = document.createElement("span");
    glyph.className = "icon-glyph";

    const label = document.createElement("span");
    label.className = "icon-name";
    label.textContent = item.name;

    const badge = document.createElement("span");
    badge.className = "icon-set";
    badge.textContent = setClassSuffix(item.prefix);

    card.append(badge, glyph, label);

    cardItems.set(card, item);
    pendingBodies.set(card, { item, glyph });
    bodyObserver.observe(card);

    return card;
}

// One set of listeners on the grid instead of five per card keeps card creation
// cheap when thousands are appended while scrolling.
grid.addEventListener("click", (event) => {
    if (Date.now() < suppressClickUntil) return;
    const card = (event.target as HTMLElement).closest<HTMLButtonElement>(".icon-card");
    if (!card) return;
    const item = cardItems.get(card);
    if (item) void copyRule(item, card);
});

grid.addEventListener("contextmenu", (event) => {
    const card = (event.target as HTMLElement).closest<HTMLButtonElement>(".icon-card");
    if (!card) return;
    event.preventDefault();
    const item = cardItems.get(card);
    if (item) void showMenu(item, event.clientX, event.clientY);
});

let pressTimer: number | undefined;
let pressCard: HTMLButtonElement | null = null;
const cancelPress = () => {
    clearTimeout(pressTimer);
    pressCard = null;
};
grid.addEventListener(
    "touchstart",
    (event) => {
        const card = (event.target as HTMLElement).closest<HTMLButtonElement>(".icon-card");
        if (!card) return;
        const touch = event.touches[0];
        pressCard = card;
        clearTimeout(pressTimer);
        pressTimer = window.setTimeout(() => {
            const item = pressCard && cardItems.get(pressCard);
            if (!item) return;
            suppressClickUntil = Date.now() + 800;
            void showMenu(item, touch.clientX, touch.clientY);
        }, 450);
    },
    { passive: true }
);
grid.addEventListener("touchend", cancelPress);
grid.addEventListener("touchcancel", cancelPress);
grid.addEventListener("touchmove", cancelPress);

// The grid is virtualized: only the rows around the viewport exist in the DOM,
// and padding on the grid stands in for the rows above and below.
function layoutColumns(): void {
    const width = grid.clientWidth;
    const cellMin = parseFloat(styles.getPropertyValue("--cell-min")) || 92;
    const maxCols = parseFloat(styles.getPropertyValue("--max-cols")) || 10;
    const cell = Math.max(cellMin, (width - (maxCols - 1) * GAP) / maxCols);
    columns = Math.max(1, Math.floor((width + GAP) / (cell + GAP)));
    grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    rowCount = Math.ceil(filtered.length / columns);
}

function renderWindow(force = false): void {
    if (rowCount === 0) {
        grid.replaceChildren();
        grid.style.paddingTop = "0px";
        grid.style.paddingBottom = "0px";
        windowStart = -1;
        windowEnd = -1;
        return;
    }

    const scrollTop = content.scrollTop;
    const firstVisibleRow = Math.floor(scrollTop / ROW_H);
    const lastVisibleRow = Math.min(
        rowCount,
        Math.ceil((scrollTop + content.clientHeight) / ROW_H)
    );
    const visibleStart = firstVisibleRow * columns;
    const visibleEnd = Math.min(filtered.length, lastVisibleRow * columns);

    if (!force && visibleStart >= windowStart && visibleEnd <= windowEnd) return;

    const startRow = Math.max(0, firstVisibleRow - OVERSCAN_ROWS);
    const endRow = Math.min(rowCount, lastVisibleRow + OVERSCAN_ROWS);
    const start = startRow * columns;
    const end = Math.min(filtered.length, endRow * columns);

    grid.style.paddingTop = `${startRow * ROW_H}px`;
    grid.style.paddingBottom = `${(rowCount - endRow) * ROW_H}px`;

    bodyObserver.disconnect();
    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) frag.append(createCard(filtered[i]));
    grid.replaceChildren(frag);
    windowStart = start;
    windowEnd = end;
}

let renderScheduled = false;
function scheduleRender(): void {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
        renderScheduled = false;
        renderWindow();
    });
}

// Programmatic jumps get yanked back by `scroll-snap-type: y mandatory` because
// the off-screen rows it would snap to don't exist until rendered. So snap is
// switched off for the jump and restored once the new window is in place.
function scrollToRow(row: number): void {
    const snap = content.style.scrollSnapType;
    content.style.scrollSnapType = "none";
    content.scrollTop = row * ROW_H;
    renderWindow(true);
    requestAnimationFrame(() => {
        content.style.scrollSnapType = snap;
    });
}

function updateCount(): void {
    const total = allIcons.length.toLocaleString();
    const shown = filtered.length.toLocaleString();
    countEl.textContent =
        filtered.length === allIcons.length ? `${total} icons` : `${shown} of ${total}`;
}

function applyFilter(): void {
    const query = compileQuery(search.value, prefixes);

    let pool = allIcons;
    if (enabledPrefixes.size !== prefixes.size) {
        pool = pool.filter((item) => enabledPrefixes.has(item.prefix));
    }
    if (styleFilter.size !== STYLE_ORDER.length) {
        pool = pool.filter((item) => styleFilter.has(item.style));
    }
    if (query.active && query.prefix) {
        pool = pool.filter((item) => item.prefix === query.prefix);
    }

    if (!query.active || query.tokens.length === 0) {
        filtered = pool;
    } else {
        const scored: Array<{ item: IconItem; score: number }> = [];
        const requireAll = query.tokens.length > 1;
        for (const item of pool) {
            if (requireAll && !matchesTokens(item, query.groups)) continue;
            const value = scoreName(item, query);
            if (value > 0) scored.push({ item, score: value });
        }
        scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
        filtered = scored.map((entry) => entry.item);
    }

    content.scrollTop = 0;
    layoutColumns();
    windowStart = -1;
    windowEnd = -1;
    updateCount();
    renderWindow(true);
    saveState();
}

async function copyText(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        /* fall through to legacy path */
    }

    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.top = "-1000px";
    document.body.append(area);
    area.select();
    let ok = false;
    try {
        ok = document.execCommand("copy");
    } catch {
        ok = false;
    }
    area.remove();
    return ok;
}

let toastTimer: number | undefined;
function showToast(message: string): void {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 1800);
}

async function copyRule(item: IconItem, card: HTMLButtonElement): Promise<void> {
    const body = await itemBody(item);
    if (!body) {
        showToast("Icon data unavailable");
        return;
    }

    const url = iconUrlFor(item, body);
    const rule = formatRule(item.prefix, item.name, url, item.style === "multicolor" ? "bg" : "icon");

    if (await copyText(rule)) {
        card.classList.add("copied");
        setTimeout(() => card.classList.remove("copied"), 700);
        showToast(`Copied .${glyphFor(item)}-${setClassSuffix(item.prefix)}-${item.name}`);
    } else {
        showToast("Copy failed");
    }
}

async function ignoreIcon(item: IconItem): Promise<void> {
    const pattern = `${item.prefix}/${item.name}`;
    if (!window.confirm(`Hide "${pattern}"? It will be added to data/ignore.txt.`)) return;
    try {
        await addIgnorePattern(pattern);
        allIcons = buildIndex();
        buildSettings();
        applyFilter();
        showToast(`Ignored ${pattern}`);
    } catch (error) {
        showToast(`Could not ignore: ${(error as Error).message}`);
    }
}

async function menuEntries(item: IconItem): Promise<Array<{ label: string; text: string }>> {
    const entries: Array<{ label: string; text: string }> = [];
    const body = await itemBody(item);
    if (body) {
        entries.push({
            label: `.${glyphFor(item)}-${setClassSuffix(item.prefix)}-${item.name} { … }`,
            text: formatRule(
                item.prefix,
                item.name,
                iconUrlFor(item, body),
                item.style === "multicolor" ? "bg" : "icon"
            )
        });
        entries.push({ label: "<svg>…</svg>", text: iconToSvg(toIcon(body), item.defaults) });
    }

    for (const value of usageClasses(item)) entries.push({ label: value, text: value });

    const code = getMeta().codepoints[item.prefix]?.[item.name];
    if (code) entries.push({ label: `content: "\\${code}";`, text: `content: "\\${code}";` });

    return entries;
}

function hideMenu(): void {
    if (menu.hidden) return;
    menu.hidden = true;
    menu.replaceChildren();
}

// The "ignore" action writes data/ignore.txt through a loopback-only dev/preview
// endpoint. Probe it so the menu entry only appears where it can actually work.
let ignoreAvailable = false;

async function probeIgnore(): Promise<void> {
    try {
        const response = await fetch(`${BASE}__ignore`, {
            headers: { accept: "application/json" }
        });
        const type = response.headers.get("content-type") ?? "";
        ignoreAvailable =
            response.ok &&
            type.includes("application/json") &&
            ((await response.json()) as { ok?: boolean }).ok === true;
    } catch {
        ignoreAvailable = false;
    }
}

async function showMenu(item: IconItem, x: number, y: number): Promise<void> {
    const entries = await menuEntries(item);
    menu.replaceChildren();

    for (const entry of entries) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "menu-item";
        button.textContent = entry.label;
        button.title = entry.text;
        button.addEventListener("click", () => {
            void (async () => {
                const ok = await copyText(entry.text);
                hideMenu();
                showToast(ok ? `Copied ${entry.label}` : "Copy failed");
            })();
        });
        menu.append(button);
    }

    if (ignoreAvailable) {
        const ignoreButton = document.createElement("button");
        ignoreButton.type = "button";
        ignoreButton.className = "menu-item menu-danger";
        ignoreButton.textContent = "Ignore this icon…";
        ignoreButton.addEventListener("click", () => {
            hideMenu();
            void ignoreIcon(item);
        });
        menu.append(ignoreButton);
    }

    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
}

const setCheckboxes = new Map<string, HTMLInputElement>();
const styleCheckboxes = new Map<IconStyle, HTMLInputElement>();

function syncSetAll(): void {
    const all = prefixes.size > 0 && enabledPrefixes.size === prefixes.size;
    setAll.checked = all;
    setAll.indeterminate = !all && enabledPrefixes.size > 0;
}

function updateFilterState(): void {
    const enabled = [...prefixes].filter((prefix) => enabledPrefixes.has(prefix));
    const disabled = [...prefixes].filter((prefix) => !enabledPrefixes.has(prefix));
    filterButton.classList.toggle("active", disabled.length > 0);
    const summary =
        disabled.length === 0
            ? `Icon sets: all ${prefixes.size}`
            : `Icon sets: ${enabled.length}/${prefixes.size} — ${enabled.slice(0, 8).join(", ")}${
                  enabled.length > 8 ? ", …" : ""
              }`;
    filterButton.title = summary;
    filterButton.setAttribute("aria-label", summary);
}

function filterSetList(query: string): void {
    const value = query.trim().toLowerCase();
    for (const row of setList.children) {
        const element = row as HTMLElement;
        element.hidden = value !== "" && !(element.dataset.search ?? "").includes(value);
    }
}

function buildStyleList(): void {
    styleList.replaceChildren();
    styleCheckboxes.clear();
    for (const style of STYLE_ORDER) {
        const row = document.createElement("label");
        row.className = "set-item";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = styleFilter.has(style);
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) styleFilter.add(style);
            else styleFilter.delete(style);
            applyFilter();
        });

        const label = document.createElement("span");
        label.className = "set-prefix";
        label.textContent = STYLE_LABELS[style];

        row.append(checkbox, label);
        styleList.append(row);
        styleCheckboxes.set(style, checkbox);
    }
}

function buildSettings(): void {
    const counts = new Map<string, number>();
    for (const item of allIcons) counts.set(item.prefix, (counts.get(item.prefix) ?? 0) + 1);

    setList.replaceChildren();
    setCheckboxes.clear();

    for (const index of indexes) {
        const prefix = index.prefix;
        const row = document.createElement("label");
        row.className = "set-item";
        row.dataset.search = `${prefix} ${index.name ?? ""}`.toLowerCase();

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = enabledPrefixes.has(prefix);
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) enabledPrefixes.add(prefix);
            else enabledPrefixes.delete(prefix);
            syncSetAll();
            updateFilterState();
            applyFilter();
        });

        const prefixEl = document.createElement("span");
        prefixEl.className = "set-prefix";
        prefixEl.textContent = prefix;

        const nameEl = document.createElement("span");
        nameEl.className = "set-name";
        nameEl.textContent = index.name ?? prefix;

        const countEl = document.createElement("span");
        countEl.className = "set-count";
        countEl.textContent = String(counts.get(prefix) ?? 0);

        row.append(checkbox, prefixEl, nameEl, countEl);
        setList.append(row);
        setCheckboxes.set(prefix, checkbox);
    }

    syncSetAll();
    updateFilterState();
}

function openSettings(): void {
    settings.hidden = false;
    filterButton.setAttribute("aria-expanded", "true");
    const rect = filterButton.getBoundingClientRect();
    settings.style.top = `${rect.bottom + 6}px`;
    settings.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    setSearch.value = "";
    filterSetList("");
    setSearch.focus();
}

function closeSettings(): void {
    if (settings.hidden) return;
    settings.hidden = true;
    filterButton.setAttribute("aria-expanded", "false");
}

filterButton.addEventListener("click", () => {
    if (settings.hidden) openSettings();
    else closeSettings();
});

// "About" panel: the toolbar brand (or its icon on mobile) opens notice.md.
let noticeLoaded = false;

async function openNotice(): Promise<void> {
    noticePanel.hidden = false;
    noticeBackdrop.hidden = false;
    aboutButton.setAttribute("aria-expanded", "true");
    if (noticeLoaded) return;
    try {
        const response = await fetch(`${BASE}notice.md`, { cache: "no-cache" });
        noticeBody.innerHTML = renderMarkdown(
            response.ok ? await response.text() : "Notices are unavailable."
        );
        noticeLoaded = true;
    } catch {
        noticeBody.textContent = "Notices are unavailable.";
    }
}

function closeNotice(): void {
    if (noticePanel.hidden) return;
    noticePanel.hidden = true;
    noticeBackdrop.hidden = true;
    aboutButton.setAttribute("aria-expanded", "false");
}

aboutButton.addEventListener("click", () => {
    if (noticePanel.hidden) void openNotice();
    else closeNotice();
});
noticeClose.addEventListener("click", closeNotice);
noticeBackdrop.addEventListener("click", closeNotice);

setSearch.addEventListener("input", () => filterSetList(setSearch.value));

setAll.addEventListener("change", () => {
    if (setAll.checked) for (const prefix of prefixes) enabledPrefixes.add(prefix);
    else enabledPrefixes.clear();
    for (const [prefix, checkbox] of setCheckboxes) checkbox.checked = enabledPrefixes.has(prefix);
    syncSetAll();
    updateFilterState();
    applyFilter();
});

const themeIconNames: Record<ThemeMode, string> = {
    system: "device-desktop",
    light: "sun",
    dark: "moon"
};

function setChrome(el: Element | null, name: string, mask = true): void {
    const icon = CHROME_ICONS[name];
    if (el instanceof HTMLElement && icon) {
        el.style.setProperty("--svg", iconToUrl(icon, { width: 24, height: 24 }, mask));
    }
}

function updateThemeIcon(mode: ThemeMode): void {
    setChrome(themeGlyph, themeIconNames[mode]);
    const label = `Theme: ${mode} (click to change)`;
    themeButton.title = label;
    themeButton.setAttribute("aria-label", label);
}

let filterTimer: number | undefined;
function scheduleFilter(): void {
    clearTimeout(filterTimer);
    filterTimer = window.setTimeout(applyFilter, 120);
}

search.addEventListener("input", scheduleFilter);
search.addEventListener("search", applyFilter);

function isEditableTarget(target: EventTarget | null): boolean {
    return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
    );
}

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        if (!menu.hidden) {
            hideMenu();
            return;
        }
        if (!settings.hidden) {
            closeSettings();
            return;
        }
        if (!noticePanel.hidden) {
            closeNotice();
            return;
        }
        if (document.activeElement === search) {
            search.value = "";
            applyFilter();
        }
        return;
    }
    if (
        event.key === "/" &&
        document.activeElement !== search &&
        !(document.activeElement instanceof HTMLInputElement)
    ) {
        event.preventDefault();
        search.focus();
        return;
    }

    if (isEditableTarget(event.target)) return;

    const visibleRows = Math.max(1, Math.floor(content.clientHeight / ROW_H));
    const maxRow = Math.max(0, rowCount - visibleRows);
    const currentRow = Math.min(maxRow, Math.max(0, Math.round(content.scrollTop / ROW_H)));
    const pageRows = Math.max(1, visibleRows - 1);

    let targetRow: number;
    switch (event.key) {
        case "PageDown":
            targetRow = Math.min(maxRow, currentRow + pageRows);
            break;
        case "PageUp":
            targetRow = Math.max(0, currentRow - pageRows);
            break;
        case "ArrowDown":
            targetRow = Math.min(maxRow, currentRow + 1);
            break;
        case "ArrowUp":
            targetRow = Math.max(0, currentRow - 1);
            break;
        case "Home":
            targetRow = 0;
            break;
        case "End":
            targetRow = maxRow;
            break;
        default:
            return;
    }

    event.preventDefault();
    scrollToRow(targetRow);
});

document.addEventListener(
    "pointerdown",
    (event) => {
        const target = event.target as Node;
        if (!menu.hidden && !menu.contains(target)) hideMenu();
        if (!settings.hidden && !settings.contains(target) && !filterButton.contains(target)) {
            closeSettings();
        }
    },
    true
);

content.addEventListener("scroll", scheduleRender, { passive: true });
content.addEventListener("scroll", saveState, { passive: true });
content.addEventListener("scroll", hideMenu, { passive: true });
window.addEventListener("resize", () => {
    layoutColumns();
    windowStart = -1;
    windowEnd = -1;
    renderWindow(true);
    saveState();
});
window.addEventListener("resize", hideMenu);
window.addEventListener("resize", closeSettings);
window.addEventListener("blur", hideMenu);

const STATE_KEY = "icon-browser:state";

interface SavedState {
    sets: string[];
    styles: string[];
    query: string;
    scroll: number;
}

function loadState(): Partial<SavedState> | null {
    try {
        const raw = localStorage.getItem(STATE_KEY);
        return raw ? (JSON.parse(raw) as Partial<SavedState>) : null;
    } catch {
        return null;
    }
}

let saveTimer: number | undefined;
function saveState(): void {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
        try {
            localStorage.setItem(
                STATE_KEY,
                JSON.stringify({
                    sets: [...enabledPrefixes],
                    styles: [...styleFilter],
                    query: search.value,
                    scroll: content.scrollTop
                })
            );
        } catch {
            /* storage unavailable */
        }
    }, 200);
}

function restoreScroll(target: number): void {
    if (!(target > 0)) return;
    scrollToRow(Math.round(target / ROW_H));
}

async function main(): Promise<void> {
    countEl.textContent = "loading…";
    try {
        indexes = await loadIndexes();
        initSearch((await loadMeta()).synonyms);
        await probeIgnore();
    } catch (error) {
        countEl.textContent = "";
        grid.textContent = `Failed to load icons: ${(error as Error).message}`;
        return;
    }

    allIcons = buildIndex();
    prefixes = new Set(indexes.map((index) => index.prefix));

    const saved = loadState();
    if (saved?.sets) {
        for (const prefix of saved.sets) if (prefixes.has(prefix)) enabledPrefixes.add(prefix);
    } else {
        for (const prefix of prefixes) enabledPrefixes.add(prefix);
    }
    if (saved?.styles) {
        styleFilter.clear();
        for (const style of saved.styles) {
            if (STYLE_ORDER.includes(style as IconStyle)) styleFilter.add(style as IconStyle);
        }
    }
    if (typeof saved?.query === "string") search.value = saved.query;

    buildStyleList();
    buildSettings();
    setChrome(filterButton.querySelector("i"), "filter");
    setChrome(aboutIcon, "svg-light", false);

    applyFilter();
    if (saved?.scroll) restoreScroll(saved.scroll);

    const theme = createTheme(updateThemeIcon);
    themeButton.addEventListener("click", () => theme.cycle());
}

void main();

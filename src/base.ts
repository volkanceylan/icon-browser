// The path the app's data files are served under. The Vite `base` (e.g.
// "/icons/", set with `--base=/icons/` or ICON_BROWSER_BASE) is authoritative; a
// hosting page can additionally prefix it (Serenity sets
// <link id="ApplicationPath" href="…">), so the app can live at
// "<ApplicationPath>/icons/" — e.g. ApplicationPath "/" + base "/icons/".
function hintedBase(): string | undefined {
    const link = document.getElementById("ApplicationPath");
    const href = link?.getAttribute("href");
    if (href) return href;
    const global = (window as { __iconBrowserPath__?: unknown }).__iconBrowserPath__;
    return typeof global === "string" ? global : undefined;
}

export const BASE: string = (() => {
    const buildBase = import.meta.env.BASE_URL || "/";
    const hint = hintedBase();
    try {
        const raw =
            hint && buildBase.startsWith("/")
                ? `${hint.endsWith("/") ? hint : `${hint}/`}${buildBase.slice(1)}`
                : buildBase;
        const url = new URL(raw, document.baseURI);
        return url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
    } catch {
        return buildBase;
    }
})();

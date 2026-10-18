// Resolves the path the app's data files are served under. The hosting page can
// point at it (Serenity sets <link id="ApplicationPath" href="…">): the app then
// lives at "<ApplicationPath>/iconbrowser/". Without a hint, the directory of the
// current document is used, so a build loaded straight from its folder works.
function hintedBase(): string | undefined {
    const link = document.getElementById("ApplicationPath");
    const href = link?.getAttribute("href");
    if (href) return href;
    const global = (window as { __iconBrowserPath__?: unknown }).__iconBrowserPath__;
    return typeof global === "string" ? global : undefined;
}

const FOLDER = "iconbrowser/";

export const BASE: string = (() => {
    try {
        const hint = hintedBase();
        if (hint) {
            const root = hint.endsWith("/") ? hint : `${hint}/`;
            return new URL(`${root}${FOLDER}`, document.baseURI).pathname;
        }
        const dir = new URL(".", document.baseURI).pathname;
        return dir.endsWith("/") ? dir : `${dir}/`;
    } catch {
        return `/${FOLDER}`;
    }
})();

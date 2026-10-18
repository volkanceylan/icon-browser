// Iconify-compatible helpers that turn an icon JSON entry into a ready-to-paste
// `--svg` custom property value for the generic svg-icon-* classes.
//
// Mirrors @iconify/utils behaviour:
//   iconToSVG(body) -> <svg xmlns=".." viewBox="l t w h" width="w" height="h">body</svg>
//   currentColor is replaced with black (mask uses the alpha channel)
//   encoding: " -> '  % -> %25  # -> %23  < -> %3C  > -> %3E  whitespace collapsed

import type { IconifyIcon } from "@iconify/types";

export interface IconDimensions {
    width?: number;
    height?: number;
}

export function svgToUrl(svg: string): string {
    const encoded = svg
        .replace(/"/g, "'")
        .replace(/%/g, "%25")
        .replace(/#/g, "%23")
        .replace(/</g, "%3C")
        .replace(/>/g, "%3E")
        .replace(/\s+/g, " ");

    return `url("data:image/svg+xml,${encoded}")`;
}

// Stroke width is normalised here because the icons render as CSS masks and the
// stroke lives inside the data URI (this is what makes it into the copied rule).
// STROKE_WIDTH is expressed for a 24px viewBox; every stroke-width is scaled so
// the primary (first) one matches that ratio, keeping multi-stroke icons intact.
export const STROKE_WIDTH = 1.5;
const STROKE_REFERENCE = 24;

function rescaleStrokeWidth(body: string, target: number, size: number): string {
    const first = body.match(/stroke-width="([^"]+)"/);
    if (!first) return body;
    const primary = Number.parseFloat(first[1]);
    const desired = target * (size / STROKE_REFERENCE);
    if (!Number.isFinite(primary) || primary <= 0 || primary === desired) return body;
    const scale = desired / primary;
    const round = (value: number) => Math.round(value * 100) / 100;
    return body.replace(/stroke-width="([^"]+)"/g, (match, raw: string) => {
        const value = Number.parseFloat(raw);
        return Number.isFinite(value) ? `stroke-width="${round(value * scale)}"` : match;
    });
}

export function iconToUrl(icon: IconifyIcon, defaults: IconDimensions = {}, mask = true): string {
    const width = icon.width ?? defaults.width ?? 16;
    const height = icon.height ?? defaults.height ?? width;
    const left = icon.left ?? 0;
    const top = icon.top ?? 0;
    let body = rescaleStrokeWidth(icon.body, STROKE_WIDTH, Math.max(width, height));
    if (mask) body = body.replace(/currentColor/g, "black");

    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" ` +
        `viewBox="${left} ${top} ${width} ${height}" width="${width}" height="${height}">` +
        `${body}</svg>`;

    return svgToUrl(svg);
}

export function iconToSvg(icon: IconifyIcon, defaults: IconDimensions = {}): string {
    const width = icon.width ?? defaults.width ?? 16;
    const height = icon.height ?? defaults.height ?? width;
    const left = icon.left ?? 0;
    const top = icon.top ?? 0;
    const body = rescaleStrokeWidth(icon.body, STROKE_WIDTH, Math.max(width, height));

    return (
        `<svg xmlns="http://www.w3.org/2000/svg" ` +
        `width="${width}" height="${height}" viewBox="${left} ${top} ${width} ${height}">` +
        `${body}</svg>`
    );
}

// Inline SVG for on-screen rendering, sized to 1em. Unlike the mask data URL it
// keeps `currentColor` and per-icon colours, so it needs no encoding and no mask
// image decode. The mask/data-URL form is only produced when copying.
//
// Some mono sets (e.g. icon-park) hardcode black instead of `currentColor`; for
// those the black strokes/fills are switched to `currentColor` so they follow the
// theme. Colored (palette) icons are left untouched.
const BLACK_ATTR = /(["'])(#000000ff|#000000|#000|black)\1/gi;

export function iconToInline(
    icon: IconifyIcon,
    defaults: IconDimensions = {},
    mono = true
): string {
    const width = icon.width ?? defaults.width ?? 16;
    const height = icon.height ?? defaults.height ?? width;
    const left = icon.left ?? 0;
    const top = icon.top ?? 0;
    let body = rescaleStrokeWidth(icon.body, STROKE_WIDTH, Math.max(width, height));
    if (mono) body = body.replace(BLACK_ATTR, (_match, quote: string) => `${quote}currentColor${quote}`);

    return (
        `<svg xmlns="http://www.w3.org/2000/svg" ` +
        `viewBox="${left} ${top} ${width} ${height}" width="1em" height="1em">` +
        `${body}</svg>`
    );
}

// Iconify set prefixes usually already drop the trailing "icon"/"icons"
// (e.g. "tabler"); strip it if a set name still carries it so we don't end up
// with ".svg-icon-tabler-icons-...".
export function setClassSuffix(prefix: string): string {
    const stripped = prefix.replace(/[-_]?icons?$/i, "");
    return stripped || prefix;
}

export function formatRule(
    prefix: string,
    name: string,
    url: string,
    mode: "icon" | "bg" = "icon"
): string {
    const base = mode === "bg" ? "svg-bg-icon" : "svg-icon";
    return `.${base}-${setClassSuffix(prefix)}-${name} { --svg: ${url}; }`;
}

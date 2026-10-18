import { createReadStream, existsSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

const IGNORE_FILE = fileURLToPath(new URL("./data/ignore.txt", import.meta.url));

const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));
const DIST_DIR = fileURLToPath(new URL("./dist/", import.meta.url));
const GZ_PREFIXES = ["/sets/", "/data/"];

const isLoopback = (address: string | undefined): boolean =>
    address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";

// Dev/preview only: appends a pattern to data/ignore.txt. Loopback-only, so the
// ignore list cannot be edited from another host.
function ignoreEndpoint(): Plugin {
    const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        // Capability probe: lets the client hide the ignore UI when the app is
        // not served by this (loopback-only) dev/preview middleware.
        if (req.url === "/__ignore" && req.method === "GET") {
            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: isLoopback(req.socket.remoteAddress) }));
            return;
        }
        if (req.method !== "POST" || req.url !== "/__ignore") {
            next();
            return;
        }
        if (!isLoopback(req.socket.remoteAddress)) {
            res.statusCode = 403;
            res.end("forbidden");
            return;
        }

        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
            res.setHeader("content-type", "application/json");
            try {
                const pattern = String(
                    (JSON.parse(body) as { pattern?: unknown }).pattern ?? ""
                ).trim();
                if (!pattern || /[\r\n]/.test(pattern)) throw new Error("invalid pattern");
                await mkdir(dirname(IGNORE_FILE), { recursive: true });
                await appendFile(IGNORE_FILE, `${pattern}\n`, "utf8");
                res.end(JSON.stringify({ ok: true }));
            } catch (error) {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, error: String(error) }));
            }
        });
    };

    return {
        name: "icon-browser-ignore-endpoint",
        configureServer(server) {
            server.middlewares.use(handler);
        },
        configurePreviewServer(server) {
            server.middlewares.use(handler);
        }
    };
}

// Dev/preview only: serve the JSON data under /sets/ and /data/ (pre-gzipped
// when the client accepts it). Content-hashed chunk names and `?v=`-versioned
// URLs never change for a given build, so they are cached immutably; the
// unversioned build.json (and any direct hit) is revalidated.
function dataFiles(): Plugin {
    const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const [path, query = ""] = (req.url ?? "").split("?");
        if (!path.endsWith(".json") || !GZ_PREFIXES.some((prefix) => path.startsWith(prefix))) {
            next();
            return;
        }
        const relative = path.replace(/^\//, "");
        const raw = [resolve(PUBLIC_DIR, relative), resolve(DIST_DIR, relative)].find((candidate) =>
            existsSync(candidate)
        );
        if (!raw) {
            next();
            return;
        }
        const gzipped = `${raw}.gz`;
        const useGzip =
            existsSync(gzipped) && String(req.headers["accept-encoding"] ?? "").includes("gzip");
        const immutable = query.includes("v=") || /-[0-9a-f]{16}\.json$/.test(path);
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.setHeader("vary", "accept-encoding");
        res.setHeader(
            "cache-control",
            immutable ? "public, max-age=31536000, immutable" : "no-cache"
        );
        if (useGzip) res.setHeader("content-encoding", "gzip");
        createReadStream(useGzip ? gzipped : raw).pipe(res);
    };

    return {
        name: "icon-browser-data-files",
        configureServer(server) {
            server.middlewares.use(handler);
        },
        configurePreviewServer(server) {
            server.middlewares.use(handler);
        }
    };
}

// Writes manifest.json at the build root with the entry script/style file names,
// so a server page can reference the hashed assets without parsing index.html.
function assetManifest(): Plugin {
    return {
        name: "icon-browser-asset-manifest",
        apply: "build",
        generateBundle(_options, bundle) {
            let js = "";
            const css: string[] = [];
            for (const item of Object.values(bundle)) {
                if (item.type === "chunk" && item.isEntry && !js) js = item.fileName;
                if (item.type === "asset" && item.fileName.endsWith(".css")) css.push(item.fileName);
            }
            this.emitFile({
                type: "asset",
                fileName: "manifest.json",
                source: `${JSON.stringify({ js, css }, null, 2)}\n`
            });
        }
    };
}

export default defineConfig(({ mode }) => ({
    // Subfolder deploy (npm run build:site). Change the folder with
    // ICON_BROWSER_BASE=/icons/ or by passing --base=/icons/ to the build.
    base: process.env.ICON_BROWSER_BASE ?? (mode === "site" ? "/icons/" : "/"),
    plugins: [ignoreEndpoint(), dataFiles(), assetManifest()],
    server: { host: "localhost", watch: { ignored: ["**/data/ignore.txt"] } },
    preview: { host: "localhost" }
}));

// Theme handling. The stored value is the *mode* (system / light / dark); the
// resolved value ("light" | "dark") is written to <html data-theme> so CSS only
// has to deal with two states.

export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "icon-browser:theme";
const MODES: ThemeMode[] = ["system", "light", "dark"];

export interface ThemeController {
    readonly mode: ThemeMode;
    set(mode: ThemeMode): void;
    cycle(): void;
}

function readMode(): ThemeMode {
    try {
        const value = localStorage.getItem(STORAGE_KEY);
        if (value === "light" || value === "dark" || value === "system") return value;
    } catch {
        /* storage unavailable */
    }
    return "system";
}

export function createTheme(onChange: (mode: ThemeMode) => void): ThemeController {
    const media = matchMedia("(prefers-color-scheme: dark)");
    let mode = readMode();

    const apply = () => {
        const resolved = mode === "system" ? (media.matches ? "dark" : "light") : mode;
        document.documentElement.dataset.theme = resolved;
        onChange(mode);
    };

    media.addEventListener("change", () => {
        if (mode === "system") apply();
    });

    const controller: ThemeController = {
        get mode() {
            return mode;
        },
        set(next) {
            mode = next;
            try {
                localStorage.setItem(STORAGE_KEY, mode);
            } catch {
                /* storage unavailable */
            }
            apply();
        },
        cycle() {
            controller.set(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
        }
    };

    apply();
    return controller;
}

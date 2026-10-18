// Minimal markdown renderer for notice.md (headings, tables, lists, links,
// emphasis, inline code). The input is our own file, but everything is escaped
// before the small amount of markup is applied.

function escapeHtml(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(text: string): string {
    let out = escapeHtml(text);
    out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
    out = out.replace(
        /\[([^\]]+)\]\(([^)\s]+)\)/g,
        (_match, label: string, href: string) =>
            `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
    );
    out = out.replace(
        /&lt;(https?:\/\/[^\s&]+)&gt;/g,
        (_match, href: string) =>
            `<a href="${href}" target="_blank" rel="noopener noreferrer">${href}</a>`
    );
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    return out;
}

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isDivider = (line: string) => /^\s*\|[\s:|-]+\|\s*$/.test(line);

function tableCells(row: string): string[] {
    return row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => inline(cell.trim()));
}

export function renderMarkdown(markdown: string): string {
    const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
    const html: string[] = [];
    let i = 0;
    let paragraph: string[] = [];

    const flush = () => {
        if (paragraph.length) {
            html.push(`<p>${inline(paragraph.join(" "))}</p>`);
            paragraph = [];
        }
    };

    while (i < lines.length) {
        const line = lines[i];

        if (isTableRow(line) && isDivider(lines[i + 1] ?? "")) {
            flush();
            const header = tableCells(line);
            i += 2;
            const rows: string[][] = [];
            while (i < lines.length && isTableRow(lines[i])) rows.push(tableCells(lines[i++]));
            html.push(
                `<table><thead><tr>${header.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>` +
                    rows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") +
                    `</tbody></table>`
            );
            continue;
        }

        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        if (heading) {
            flush();
            const level = heading[1].length;
            html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
            i++;
            continue;
        }

        if (/^\s*[-*]\s+/.test(line)) {
            flush();
            const items: string[] = [];
            while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
                items.push(inline(lines[i].replace(/^\s*[-*]\s+/, "")));
                i++;
            }
            html.push(`<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`);
            continue;
        }

        if (line.trim() === "") {
            flush();
            i++;
            continue;
        }

        paragraph.push(line.trim());
        i++;
    }

    flush();
    return html.join("\n");
}

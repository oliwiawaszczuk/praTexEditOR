// VS Code snippet bodies (docs/02-plan.md §10.3) → CodeMirror snippet templates.
//
// VS Code: `$1`, `${1:default}`, `${1|a,b|}`, `$0`, variables `$TM_SELECTED_TEXT`,
// `${CURRENT_YEAR}`, `${VAR:default}`; `\$ \} \\` escape. CodeMirror: `${1:default}`
// (no braces inside a default), `${0}` = final cursor. Pure (no CodeMirror import):
// the settings page previews snippets without the editor chunk.

export interface Vars {
  selection?: string;
  clipboard?: string;
  filename?: string;
  now?: Date;
}

type Node = { t: "text"; v: string } | { t: "stop"; n: number; def: Node[] } | { t: "var"; name: string; def: Node[] };

function parse(s: string, i: number, stopAt: string | null): [Node[], number] {
  const out: Node[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ t: "text", v: text });
    text = "";
  };
  while (i < s.length) {
    const c = s[i];
    if (stopAt && c === stopAt) break;
    if (c === "\\" && i + 1 < s.length && "$}\\".includes(s[i + 1])) {
      text += s[i + 1];
      i += 2;
      continue;
    }
    if (c === "$") {
      const m = /^\$(\d+)/.exec(s.slice(i)) ?? /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(s.slice(i));
      if (m) {
        flush();
        out.push(/^\d/.test(m[1]) ? { t: "stop", n: +m[1], def: [] } : { t: "var", name: m[1], def: [] });
        i += m[0].length;
        continue;
      }
      if (s[i + 1] === "{") {
        const head = /^\$\{(\d+|[A-Za-z_][A-Za-z0-9_]*)/.exec(s.slice(i));
        if (head) {
          flush();
          const name = head[1];
          let j = i + head[0].length;
          let def: Node[] = [];
          if (s[j] === ":") {
            [def, j] = parse(s, j + 1, "}");
          } else if (s[j] === "|") {
            const end = s.indexOf("|}", j + 1);
            const first = s.slice(j + 1, end < 0 ? s.length : end).split(",")[0] ?? "";
            def = [{ t: "text", v: first }];
            j = end < 0 ? s.length : end + 1;
          } else if (s[j] === "/") {
            // Transform `${VAR/re/fmt/opts}`: not supported, use the plain value.
            let slashes = 0;
            while (j < s.length && !(s[j] === "}" && slashes >= 3)) {
              if (s[j] === "/" && s[j - 1] !== "\\") slashes++;
              j++;
            }
          }
          if (s[j] === "}") j++;
          out.push(/^\d/.test(name) ? { t: "stop", n: +name, def } : { t: "var", name, def });
          i = j;
          continue;
        }
      }
    }
    text += c;
    i++;
  }
  flush();
  return [out, i];
}

const pad = (n: number) => String(n).padStart(2, "0");

function variable(name: string, v: Vars): string | null {
  const now = v.now ?? new Date();
  const DAYS = ["niedziela", "poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota"];
  const MONTHS = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];
  switch (name) {
    case "TM_SELECTED_TEXT":
      return v.selection || null;
    case "CLIPBOARD":
      return v.clipboard || null;
    case "TM_FILENAME":
      return v.filename ?? null;
    case "TM_FILENAME_BASE":
      return v.filename ? v.filename.replace(/\.[^.]*$/, "") : null;
    case "CURRENT_YEAR":
      return String(now.getFullYear());
    case "CURRENT_YEAR_SHORT":
      return String(now.getFullYear()).slice(2);
    case "CURRENT_MONTH":
      return pad(now.getMonth() + 1);
    case "CURRENT_MONTH_NAME":
      return MONTHS[now.getMonth()];
    case "CURRENT_DATE":
      return pad(now.getDate());
    case "CURRENT_DAY_NAME":
      return DAYS[now.getDay()];
    case "CURRENT_HOUR":
      return pad(now.getHours());
    case "CURRENT_MINUTE":
      return pad(now.getMinutes());
    case "CURRENT_SECOND":
      return pad(now.getSeconds());
    default:
      return null;
  }
}

/** Nodes → plain text (defaults inside a default, variables resolved). */
function flat(nodes: Node[], v: Vars): string {
  return nodes.map((n) => (n.t === "text" ? n.v : n.t === "var" ? (variable(n.name, v) ?? flat(n.def, v)) : flat(n.def, v))).join("");
}

/** VS Code body → CodeMirror template. A default with braces or line breaks cannot be
 * a CodeMirror field: it is inserted as text with an empty field after it. */
export function toTemplate(body: string, vars: Vars = {}): string {
  const [nodes] = parse(body, 0, null);
  let out = "";
  for (const n of nodes) {
    if (n.t === "text") out += n.v;
    else if (n.t === "var") out += variable(n.name, vars) ?? flat(n.def, vars);
    else {
      const def = flat(n.def, vars);
      if (/[{}\n]/.test(def)) out += `${def}\${${n.n}}`;
      else out += def ? `\${${n.n}:${def}}` : `\${${n.n}}`;
    }
  }
  return out;
}

/** What the snippet inserts, without field markers (previews, completion info). */
export function toText(body: string, vars: Vars = {}): string {
  const [nodes] = parse(body, 0, null);
  return flat(nodes, vars);
}

/** Field ranges in `toText` output, for highlighting $1… in previews. */
export function fieldsOf(body: string, vars: Vars = {}): { from: number; to: number; n: number }[] {
  const [nodes] = parse(body, 0, null);
  const out: { from: number; to: number; n: number }[] = [];
  let pos = 0;
  for (const n of nodes) {
    const text = n.t === "text" ? n.v : n.t === "var" ? (variable(n.name, vars) ?? flat(n.def, vars)) : flat(n.def, vars);
    if (n.t === "stop") out.push({ from: pos, to: pos + text.length, n: n.n });
    pos += text.length;
  }
  return out;
}

/** A VS Code snippets file ({ name: { prefix, body, description } }) → plain entries. */
export function parseSnippetFile(json: unknown): { name: string; prefix: string; body: string; description: string }[] {
  if (!json || typeof json !== "object") return [];
  const out: { name: string; prefix: string; body: string; description: string }[] = [];
  for (const [name, raw] of Object.entries(json as Record<string, unknown>)) {
    const s = raw as { prefix?: unknown; body?: unknown; description?: unknown };
    if (!s || typeof s !== "object" || s.body === undefined) continue;
    const prefix = Array.isArray(s.prefix) ? String(s.prefix[0] ?? "") : String(s.prefix ?? "");
    const body = Array.isArray(s.body) ? s.body.map(String).join("\n") : String(s.body);
    out.push({ name, prefix, body, description: typeof s.description === "string" ? s.description : "" });
  }
  return out;
}

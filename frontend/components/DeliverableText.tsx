"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Check, Copy } from "@/components/icons";

/**
 * Rich renderer for free-form deliverable text (TaskPay's `submission` field).
 *
 * The submission is stored on-chain as plain text, so this parses it at render
 * time instead of trusting any markup: fenced code blocks get a header bar
 * (language + copy) and lightweight syntax highlighting, while surrounding
 * prose gets headings, lists, quotes, bold/italic/code spans, and links.
 * No dependencies — the submission is adversarially-bounded plain text, so a
 * tiny parser beats pulling a markdown engine into the bundle.
 */

// --- Lightweight syntax highlighting ---------------------------------------

type Token = { text: string; cls?: string };

const KEYWORDS = new Set([
  // JS/TS
  "abstract", "any", "as", "async", "await", "boolean", "break", "case", "catch", "class", "const",
  "continue", "declare", "default", "delete", "do", "else", "enum", "export", "extends", "false",
  "finally", "for", "from", "function", "get", "if", "implements", "import", "in", "instanceof",
  "interface", "keyof", "let", "new", "null", "number", "of", "private", "protected", "public",
  "readonly", "return", "satisfies", "set", "static", "string", "super", "switch", "this", "throw",
  "true", "try", "type", "typeof", "undefined", "unknown", "var", "void", "while", "yield",
  // Python / Go / Rust / Solidity (overlap is fine)
  "def", "elif", "except", "lambda", "None", "nonlocal", "pass", "raise", "with", "and", "or", "not",
  "func", "go", "defer", "chan", "map", "range", "select", "package", "struct", "nil", "panic",
  "fn", "impl", "match", "mut", "pub", "use", "where", "Self", "dyn", "move", "loop",
  "pragma", "contract", "constructor", "event", "modifier", "mapping", "address", "uint", "uint256",
  "int", "bytes", "bytes32", "bool", "require", "assert", "revert", "emit", "payable", "memory",
  "storage", "calldata", "external", "internal", "view", "pure", "virtual", "override", "is",
]);

// Comments: // and # line comments, /* */ block comments. `#` is guarded so
// it only matches at a word start (bash comments, not `this.#private`), and
// `--`/`++` are deliberately NOT comments (SQL-style) so `count--` and CLI
// flags like `--version` never render as comment text.
const TOKEN_RE =
  /(\/\/[^\n]*|(?:^|\s)#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b0x[0-9a-fA-F]+\b|\b\d+(?:\.\d+)?\b)|([A-Za-z_$][A-Za-z0-9_$]*)/g;

/** Tokenize a line of code into keyword/string/comment/number/default spans. */
function highlightLine(line: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(line)) !== null) {
    if (m.index > last) out.push({ text: line.slice(last, m.index) });
    const [full, comment, str, num, word] = m;
    if (comment) out.push({ text: full, cls: "text-faint italic" });
    else if (str) out.push({ text: full, cls: "text-ok" });
    else if (num) out.push({ text: full, cls: "text-warn2" });
    else if (word && KEYWORDS.has(word)) out.push({ text: full, cls: "text-accent font-medium" });
    else out.push({ text: full });
    last = m.index + full.length;
  }
  if (last < line.length) out.push({ text: line.slice(last) });
  return out;
}

// --- Inline prose markup: `code`, **bold**, *italic*, [text](url), bare URLs --

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Order matters: code span first (its content must never be marked up), then
  // links, then bold, then italic.
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\((?:https?:\/\/|\/)[^\s)]+\))|((?:https?:\/\/)[^\s<>()]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [full, code, bold, italic, link, url] = m;
    const key = `${keyPrefix}-${i++}`;
    if (code) {
      out.push(
        <code key={key} className="rounded-md border border-line bg-well px-1.5 py-0.5 font-mono text-[12px] text-accent">
          {full.slice(1, -1)}
        </code>,
      );
    } else if (bold) {
      out.push(<strong key={key} className="font-semibold text-fg">{full.slice(2, -2)}</strong>);
    } else if (italic) {
      out.push(<em key={key} className="italic">{full.slice(1, -1)}</em>);
    } else if (link) {
      const label = full.slice(1, full.indexOf("]"));
      const href = full.slice(full.indexOf("](") + 2, -1);
      out.push(
        <a key={key} href={href} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">
          {label}
        </a>,
      );
    } else if (url) {
      out.push(
        <a key={key} href={full} target="_blank" rel="noreferrer" className="break-all text-accent underline-offset-2 hover:underline">
          {full}
        </a>,
      );
    }
    last = m.index + full.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// --- Block-level parsing -----------------------------------------------------

interface CodeBlock {
  kind: "code";
  lang: string;
  lines: string[];
}
interface ProseBlock {
  kind: "prose";
  // Each line: [level, text] — level 0 paragraph, 1..3 heading, 4 quote, 5..7 list item
  lines: Array<{ level: number; text: string }>;
}
type Block = CodeBlock | ProseBlock;

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let prose: ProseBlock["lines"] = [];
  let inCode: { lang: string; lines: string[] } | null = null;

  const flushProse = () => {
    if (prose.length > 0) {
      blocks.push({ kind: "prose", lines: prose });
      prose = [];
    }
  };

  const flushCode = () => {
    if (inCode !== null) {
      blocks.push({ kind: "code", lang: inCode.lang, lines: inCode.lines });
      inCode = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = line.match(/^\s*```\s*(\S*)\s*$/);
    if (fence) {
      if (fence[1] === "") {
        // Bare ``` — opens a code block in prose, or closes the current one.
        if (inCode !== null) {
          blocks.push({ kind: "code", lang: inCode.lang, lines: inCode.lines });
          inCode = null;
        } else {
          flushProse();
          inCode = { lang: "", lines: [] };
        }
        continue;
      }
      // A fence carrying a language tag ALWAYS begins a labeled block (and
      // closes any open one). Bot output frequently mangles fences — doubled
      // ``` lines, or a block cut off mid-stream by the on-chain char cap —
      // and strict markdown parsing would then render later `\u0060\u0060\u0060ts`
      // lines as literal code. Lenient here reads much better.
      if (inCode !== null) {
        blocks.push({ kind: "code", lang: inCode.lang, lines: inCode.lines });
      }
      flushProse();
      inCode = { lang: fence[1]!, lines: [] };
      continue;
    }
    if (inCode !== null) {
      inCode.lines.push(line);
      continue;
}
    // Headings: # H1 through ### H3 (####+ treated as H3)
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1]!.length, 3);
      prose.push({ level, text: heading[2]! });
      continue;
    }
    // Quotes
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      prose.push({ level: 4, text: quote[1]! });
      continue;
    }
    // List items: -, *, • (level 5) and numbered (level 6, keeps the marker)
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    if (bullet) {
      prose.push({ level: 5, text: bullet[1]! });
      continue;
    }
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (numbered) {
      prose.push({ level: 6, text: `${numbered[1]}. ${numbered[2]}` });
      continue;
    }
    if (line.trim() === "") {
      prose.push({ level: 0, text: "" });
      continue;
    }
    prose.push({ level: 0, text: line });
  }
  flushProse();
  flushCode(); // an unterminated final block (truncated text) still renders
  return blocks;
}

function CodeBlockView({ block }: { block: CodeBlock }) {
  const [copied, setCopied] = useState(false);
  const code = useMemo(() => block.lines.join("\n"), [block.lines]);
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  }, [code]);

  const body = block.lines.map((line, i) => (
    <div key={i} className="whitespace-pre">
      {line === "" ? " " : highlightLine(line).map((t, j) => (t.cls ? <span key={j} className={t.cls}>{t.text}</span> : <span key={j}>{t.text}</span>))}
    </div>
  ));

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-line bg-canvas">
      <div className="flex items-center justify-between border-b border-lineSoft bg-subtle px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
          {block.lang || "code"}
        </span>
        <button
          onClick={onCopy}
          title="Copy code"
          className="rounded p-1 text-faint transition hover:bg-subtleH hover:text-fg"
        >
          {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
        </button>
      </div>
      <div className="overflow-x-auto px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-mute">
        {body}
      </div>
    </div>
  );
}

function ProseBlockView({ block, keyPrefix }: { block: ProseBlock; keyPrefix: string }) {
  const out: ReactNode[] = [];
  let list: ReactNode[] = [];

  const flushList = () => {
    if (list.length > 0) {
      out.push(
        <ul key={`${keyPrefix}-ul-${out.length}`} className="my-1.5 space-y-1 pl-1">
          {list}
        </ul>,
      );
      list = [];
    }
  };

  block.lines.forEach((line, i) => {
    const key = `${keyPrefix}-${i}`;
    if (line.level === 5 || line.level === 6) {
      list.push(
        <li key={key} className="flex gap-2 text-[13px] leading-relaxed text-mute">
          <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-faint" />
          <span>{renderInline(line.text, key)}</span>
        </li>,
      );
      return;
    }
    flushList();
    if (line.level >= 1 && line.level <= 3) {
      const size = line.level === 1 ? "text-[15px] font-semibold" : line.level === 2 ? "text-[14px] font-semibold" : "text-[13px] font-semibold";
      out.push(
        <p key={key} className={`${size} mt-3 mb-1 text-fg first:mt-0`}>
          {renderInline(line.text, key)}
        </p>,
      );
    } else if (line.level === 4) {
      out.push(
        <blockquote key={key} className="my-1.5 border-l-2 border-accent-line pl-3 text-[13px] italic leading-relaxed text-mute">
          {renderInline(line.text, key)}
        </blockquote>,
      );
    } else if (line.text === "") {
      // Skip empty lines — spacing comes from block margins.
    } else {
      out.push(
        <p key={key} className="my-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-mute">
          {renderInline(line.text, key)}
        </p>,
      );
    }
  });
  flushList();
  return <>{out}</>;
}

export default function DeliverableText({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <div className="text-[13px]">
      {blocks.map((b, i) =>
        b.kind === "code" ? <CodeBlockView key={i} block={b} /> : <ProseBlockView key={i} block={b} keyPrefix={`b${i}`} />,
      )}
    </div>
  );
}

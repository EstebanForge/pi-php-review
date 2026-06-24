/**
 * pi-php-review — Code review powered by a curated PHP 8.2+ idiomatic
 * anti-patterns guide.
 *
 * Registers a php_review tool that reads PHP code changes (git diff) and
 * returns them alongside the anti-patterns guide (numbered entries, each
 * with a bad/good pair plus citations to PHPStan error IDs, php.net
 * migration notes, clean-code-php, and phptherightway). The LLM reviews
 * the diff, flags anti-patterns, AND proposes a corrected snippet for each
 * finding.
 *
 * Features:
 *   - Reviews staged, unstaged, commit, or range diffs filtered to .php files
 *   - Bundles the anti-patterns guide as a sibling .md asset (human-editable)
 *   - PHP 8.2 floor: readonly classes, true/false/null standalone types,
 *     AllowDynamicProperties, enum/match/never, readonly properties,
 *     constructor property promotion, intersection types, enums, fibers
 *   - Categorizes findings: Bug/Critical, Suggestion, Nit, Good pattern
 *   - Custom TUI rendering for call + result
 *   - System prompt injection so the agent auto-invokes when reviewing PHP code
 *
 * Sibling to @estebanforge/pi-go-review and @estebanforge/pi-rust-review.
 * Pair with `phpstan analyse` (rule level 6+) and `php-cs-fixer` for
 * compiler-grade lint coverage; this tool focuses on design and idiomatic
 * mistakes static analyzers may not flag.
 */
import type { ExtensionAPI, ThemeColor } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// The anti-patterns guide ships as a sibling markdown file (source of truth,
// editable). Load lazily; memoize only on success so a transient read failure
// (e.g. a mid-install state during a Pi hot-reload) stays recoverable on the
// next call instead of pinning the degraded message for the process lifetime.
// Under Pi's jiti loader, import.meta.url resolves to this source file, so the
// sibling .md is reachable next to it.
let _guide: string | null = null;
function getGuide(): string {
	if (_guide !== null) return _guide;
	try {
		const here = path.dirname(fileURLToPath(import.meta.url));
		_guide = readFileSync(path.join(here, "php-anti-patterns.md"), "utf8");
		return _guide;
	} catch {
		return "## PHP anti-patterns guide unavailable\n\nThe bundled `php-anti-patterns.md` could not be read. Reinstall the package or check the install.";
	}
}

// git argument prefix per mode; the caller pathspec is appended after "--".
const STAT = ["--stat", "--patch"];
const GIT_PREFIX: Record<string, string[]> = {
	working: ["diff", ...STAT],
	staged: ["diff", "--cached", ...STAT],
	all: ["diff", "HEAD", ...STAT],
	commit: ["show", ...STAT],
	range: ["diff", ...STAT],
};

interface PhpReviewDetails {
	mode: string;
	ref?: string;
	path?: string;
	insertions: number;
	deletions: number;
	phpFilesFound: number;
	truncated: boolean;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "php_review",
		label: "PHP Review",
		description:
			"Review PHP code changes against a curated PHP 8.2+ idiomatic anti-patterns guide. " +
			"Reads git diffs (staged, unstaged, commits, or ranges), filters to .php files, " +
			"and returns the diff alongside the guide (numbered entries with bad/good pairs and citations to PHPStan error IDs, php.net migration notes, clean-code-php, phptherightway). " +
			"Each finding cites the entry number (e.g. #12) AND proposes a corrected snippet modeled on the guide's Do-This examples. " +
			"Use this whenever reviewing PHP code, PRs, or changes before committing.",
		promptSnippet: "Review PHP code changes and propose corrected snippets from the curated PHP 8.2+ anti-patterns guide",
		promptGuidelines: [
			"Use php_review when the user asks to review PHP code, check PHP changes, or audit a PHP PR.",
			"Target floor is PHP 8.2: prefer readonly classes, readonly properties, true/false/null standalone types, enum/match/never, constructor property promotion, intersection types, #[AllowDynamicProperties] when dynamic props are intentional.",
			"After receiving the diff and guide, analyze every changed .php file against relevant entries.",
			"For each finding: cite the entry number (e.g. #12), give file:line/code fragment, categorize (Bug/Critical, Suggestion, Nit), AND propose a corrected snippet modeled on the guide's ⛵ Do-This examples.",
			"Cite the relevant 'See also' references when applicable (PHPStan error identifier, php.net manual page, clean-code-php section, phptherightway page).",
			"Only flag anti-patterns actually present. Note Good patterns too.",
			"End with a verdict: Approve, Request Changes, or Needs Discussion.",
		],
		parameters: Type.Object({
			mode: StringEnum(["working", "staged", "commit", "range", "all"] as const, {
				description: "working=unstaged, staged=cached, commit=specific SHA, range=two refs, all=HEAD diff",
			}),
			ref: Type.Optional(Type.String({ description: "Commit SHA, branch, or range (e.g. main..HEAD). Required for commit/range." })),
			path: Type.Optional(Type.String({ description: "Limit to file or directory (e.g. src/Service)" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const { mode, ref, path: filePath } = params;
			const EXT = ".php";
			const GLOB = "*" + EXT;
			const MAX_LINES = 1500;

			if ((mode === "commit" || mode === "range") && !ref) {
				throw new Error(`ref required for ${mode} mode`);
			}

			// Narrow to the caller's file/dir, else default to all .php files.
			// For directories: pass the bare path so git prefix-matches; the prior
			// `dir/**/*.php` form silently matched nothing in git (slash before `**`
			// blocks the recursion). For files: literal match.
			const pathspec = !filePath
				? GLOB
				: filePath.endsWith(EXT)
					? filePath
					: filePath.replace(/\/+$/, "");
			const gitArgs = [...GIT_PREFIX[mode], ...(ref ? [ref] : []), "--", pathspec];

			const result = await pi.exec("git", gitArgs, { signal, timeout: 30000 });
			if (result.code !== 0) throw new Error(`git failed (${result.code}): ${result.stderr}`);

			const base = { mode, ref, path: filePath };
			if (!result.stdout.trim()) {
				return {
					content: [{ type: "text" as const, text: "No PHP file changes found. Try: staged, working, all, commit, or range." }],
					details: { ...base, insertions: 0, deletions: 0, phpFilesFound: 0, truncated: false } satisfies PhpReviewDetails,
				};
			}

			const lines = result.stdout.split("\n");

			// Anchor to the LAST stat line: in commit/range mode git emits the commit
			// message before the diffstat, so a message containing "N files changed"
			// would otherwise be parsed as the stat and poison the metrics.
			const statLine = lines.filter((line) => /\d+ files? changed/.test(line)).pop() ?? "";
			const insertions = parseInt(statLine.match(/(\d+) insertions?/)?.[1] ?? "0", 10);
			const deletions = parseInt(statLine.match(/(\d+) deletions?/)?.[1] ?? "0", 10);
			const phpFilesFound = result.stdout.match(/^diff --git a\/.*\.php b\/.*\.php$/gm)?.length ?? 0;

			const truncated = lines.length > MAX_LINES;
			const diffText = truncated ? lines.slice(0, MAX_LINES).join("\n") : result.stdout;

			const text = [
				`## PHP Code Review: ${mode}${ref ? " " + ref : ""}${filePath ? ` (${filePath})` : ""}`,
				"",
				`**${phpFilesFound}** PHP files, **+${insertions}** / **-${deletions}**`,
				"",
				"### Diff",
				"",
				"```diff",
				diffText,
				"```",
				"",
				...(truncated ? [`> Truncated to ${MAX_LINES} lines. Use path param to focus.`, ""] : []),
				"---",
				"",
				"### Review Instructions",
				"",
				"Analyze the diff against the PHP 8.2+ anti-patterns guide below.",
				"For each entry found:",
				"  - cite the **entry number** (e.g. '#12 Dynamic properties without #[AllowDynamicProperties]');",
				"  - give **file:line / code fragment**;",
				"  - categorize: Bug/Critical, Suggestion, or Nit;",
				"  - **propose the corrected snippet**, modeled on the guide's ⛵ Do-This examples.",
				"Cite 'See also' references when relevant (PHPStan error identifier, php.net manual page, clean-code-php section, phptherightway page).",
				"Only flag anti-patterns **actually present**, most impactful first. Note Good patterns too.",
				"End with **Verdict**: Approve / Request Changes / Needs Discussion.",
				"",
				getGuide(),
			].join("\n");

			return {
				content: [{ type: "text" as const, text }],
				details: { ...base, insertions, deletions, phpFilesFound, truncated } satisfies PhpReviewDetails,
			};
		},
		renderCall(args, theme, _ctx) {
			const modeColors: Record<string, ThemeColor> = {
				working: "warning",
				staged: "accent",
				commit: "success",
				range: "success",
				all: "warning",
			};
			let label = theme.fg("toolTitle", theme.bold("php_review "));
			label += theme.fg(modeColors[args.mode] ?? "accent", args.mode);
			if (args.ref) label += theme.fg("muted", " " + args.ref);
			if (args.path) label += theme.fg("dim", " — " + args.path);
			label += theme.fg("dim", "  (PHP 8.2+ anti-patterns)");
			return new Text(label, 0, 0);
		},
		renderResult(result, { expanded, isPartial }, theme, _ctx) {
			if (isPartial) return new Text(theme.fg("warning", "Scanning PHP changes..."), 0, 0);
			const details = result.details as PhpReviewDetails | undefined;
			if (!details || details.phpFilesFound === 0) return new Text(theme.fg("dim", "No PHP changes found"), 0, 0);

			let summary = theme.fg("accent", details.phpFilesFound + " PHP files");
			summary += theme.fg("dim", " | ") + theme.fg("success", "+" + details.insertions) + theme.fg("dim", "/") + theme.fg("error", "-" + details.deletions);
			summary += theme.fg("dim", " | ") + theme.fg("muted", "PHP 8.2+ anti-patterns guide");
			if (details.truncated) summary += theme.fg("warning", " (truncated)");

			if (!expanded) return new Text(summary, 0, 0);

			summary += "\n" + theme.fg("dim", "─".repeat(50));
			const content = result.content[0];
			if (content?.type === "text") {
				const statLines = content.text.split("\n").filter((line: string) => line.includes("|") && /[+-]/.test(line)).slice(0, 8);
				for (const line of statLines) summary += "\n" + theme.fg("dim", "  " + line.trim());
				if (statLines.length === 0) summary += "\n" + theme.fg("dim", "  (expand for diff + guide)");
			}
			return new Text(summary, 0, 0);
		},
	});
}

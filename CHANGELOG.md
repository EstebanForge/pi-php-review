# Changelog

## 1.0.1 — 2026-06-24

### Fixed
- **Directory pathspec leaked non-PHP files**: when `path` was a directory,
  the tool passed a bare pathspec that git prefix-matched every file under it
  (`.ts`, `.json`, etc.), feeding non-PHP diffs into a PHP review. Directory
  paths now use `:(glob)dir/**/*.php`, which filters to PHP AND recurses.

## 1.0.0 — 2026-06-23

Initial release. A Pi-native PHP code review tool, sibling to
`@estebanforge/pi-go-review` and `@estebanforge/pi-rust-review`. Registers a
`php_review` tool that reads git diffs filtered to `*.php`, attaches a
focused PHP 8.2+ rubric, and for each finding cites the entry number
**and proposes a corrected snippet**.

### Added

- `php_review` tool with five diff modes: `working`, `staged`, `all`,
  `commit`, `range`, plus a `path` scope.
- Bundled `extensions/php-anti-patterns.md` rubric: **16 entries across 4
  sections** (Types & Strictness, Error Handling, Builtin Correctness,
  Security). Security-weighted — 8 of 16 entries. Each entry is a
  one-line rationale plus a bad→good pair (the good side is the fix
  template) with an inline severity tag. Loaded at runtime via
  `import.meta.url`.
- PHP 8.2 floor. Dynamic properties (#4) flagged as deprecated.
- Review output proposes a corrected snippet for each finding.
- Custom TUI rendering for the tool call and result.

### Notes

- Curated synthesis drawing from PHP: The Right Way, clean-code-php,
  php.net migration guides, OWASP, and PHPStan rule levels. Manning's
  *100 PHP Mistakes and How to Avoid Them* (the would-be analog to *100
  Go Mistakes*) was cancelled before completion, so is not a source.

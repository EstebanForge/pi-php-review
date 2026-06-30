# @estebanforge/pi-php-review

PHP code review against a focused **PHP 8.2+ rubric**. Registers a `php_review` tool that reads git diffs, filters to `.php` files, and attaches the rubric (16 entries across 4 sections: strictness/typing, error handling, builtin correctness, security). Each entry is a one-line rationale plus a bad/good pair; the good side is the fix template.

Sibling to [`@estebanforge/pi-go-review`](https://github.com/EstebanForge/pi-go-review) and [`@estebanforge/pi-rust-review`](https://github.com/EstebanForge/pi-rust-review). Pair with `phpstan analyse` (rule level 6+) and `php-cs-fixer` for compiler-grade lint coverage; this tool focuses on design and idiomatic mistakes static analyzers may not flag.

## Install

```
pi install npm:@estebanforge/pi-php-review
```

## Usage

Ask Pi: **"review my PHP changes."**

The tool runs `git` in one of five modes:

| Mode | Description | Needs `ref` |
| --- | --- | --- |
| `working` | Unstaged changes | No |
| `staged` | Staged (cached) changes | No |
| `all` | All changes vs HEAD | No |
| `commit` | A specific commit | Yes (SHA) |
| `range` | A commit range | Yes (e.g. `main..HEAD`) |

Narrow scope with `path` (a file or directory). The tool runs `git` **from** that path — so `path` can point into a nested repo (e.g. a plugin inside a workspace whose root is not itself a git repo).

## What it does

1. Reads the git diff filtered to `*.php`.
2. Attaches the PHP 8.2+ rubric (16 entries, 4 sections).
3. The LLM reviews the diff and returns findings that **propose a corrected snippet**:

| Severity | Meaning |
| --- | --- |
| Bug / Critical | Must fix |
| Suggestion | Should consider |
| Nit | Minor improvement |
| Good pattern | Well done |

Each finding cites the entry number (e.g. **#14**), the file + code fragment, and a corrected snippet modeled on the guide's ⛵ Do-This examples. Ends with a **Verdict**: Approve / Request Changes / Needs Discussion.

## Rubric sections

| Section | Entries |
| --- | --- |
| 1. Types & Strictness | #1 - #4 |
| 2. Error Handling | #5 - #6 |
| 3. Builtin Correctness | #7 - #8 |
| 4. Security | #9 - #16 |

Security-weighted (8 of 16 entries): `#9` SQLi, `#10` XSS, `#11` CSRF, `#12` `extract()`, `#13` `unserialize()`, `#14` `hash_equals`, `#15` `password_hash` over `md5`, `#16` open redirect. Plus `#1` strict_types, `#2` loose `==`, `#7` `in_array` strict, `#8` `implode` arg order.

## TUI rendering

Custom rendering for both the tool call and its result: mode, file count, insertions/deletions, and truncation status at a glance.

## Credits

Curated synthesis drawing from:

- [PHP: The Right Way](https://phptherightway.com/) — community best-practices reference.
- [Clean Code PHP](https://github.com/piotrplenik/clean-code-php) by Piotr Plenik — MIT.
- [PHPStan rule levels](https://phpstan.org/user-guide/rule-levels) + [error identifiers](https://phpstan.org/error-identifiers).
- [php.net migration guides](https://www.php.net/manual/en/migration82.php) for PHP 8.2 BC breaks and deprecations.
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/) for security entries.
- [Rector](https://getrector.com/) PHP 8.2 migration rule set.
- Community PHP wisdom (Stack Overflow, php.watch, Marco Pivetta "Ocramius").

Note: Manning's *100 PHP Mistakes and How to Avoid Them* (the would-be PHP equivalent of *100 Go Mistakes*) was cancelled before completion and is not used as a source.

## License

MIT

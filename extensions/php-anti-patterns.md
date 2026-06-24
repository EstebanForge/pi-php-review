# PHP 8.2+ Review Rubric

Floor: **PHP 8.2**. Assume `declare(strict_types=1)` and PSR-12. Each entry: severity tag, one-line rationale, and a bad→good pair. The good side is the fix template. Cite the **entry number** (e.g. `#9`), quote **file:line**, categorize (Bug / Suggestion / Nit), propose a corrected snippet. Only flag what's actually present. Note Good patterns. End with **Verdict**: Approve / Request Changes / Needs Discussion.

---

## Types & Strictness

### #1 Missing `declare(strict_types=1)` [Bug]
Without it, scalars coerce silently: `"42"` is accepted as `int`.
- bad:  `function divide(int $a, int $b): float { return $a / $b; }` // divide("42","6") works
- good: `declare(strict_types=1);` at the top of every file → `divide("42","6")` throws TypeError

### #2 Loose equality `==` [Bug]
`==` juggles: `0 == "foo"`, `null == 0`, `[] == false`. Security vector for secrets.
- bad:  `if ($password == $_POST['pw']) { /* bypassable with 0 or "" */ }`
- good: `if (hash_equals($password, $_POST['pw'] ?? '')) { /* constant-time, strict */ }`

### #3 Missing parameter/return types [Suggestion]
Untyped boundaries crash deep instead of at the call site.
- bad:  `function findUser($id) { /* returns User|null|false per branch */ }`
- good: `function findUser(int $id): ?User { /* ... */ }`

### #4 Dynamic property without `#[AllowDynamicProperties]` [Bug]
PHP 8.2 deprecates undeclared properties (`E_DEPRECATED`, removed next major).
- bad:  `$cfg->runtime_extra = 'oops';` on a class that never declared it
- good: declare the property, or opt in: `#[AllowDynamicProperties] class Config { ... }`

---

## Error Handling

### #5 `@` error suppression [Bug]
`@` hides all errors (fatal included), burns stack traces.
- bad:  `$value = @file_get_contents($path);`
- good: `$value = file_get_contents($path); if ($value === false) { throw new \RuntimeException("Cannot read {$path}"); }`

### #6 Empty or over-broad catch [Bug]
`catch (\Throwable $e) {}` swallows failures and masks programmer errors (TypeError, etc.).
- bad:  `try { $this->charge($order); } catch (\Throwable $e) { /* oops */ }`
- good: `try { $this->charge($order); } catch (PaymentFailed $e) { $this->logger->error('payment failed', ['order' => $order->id]); throw $e; }`

---

## Builtin Correctness

### #7 `in_array` / `array_search` without strict mode [Bug]
Defaults to loose comparison: `0` matches any string starting with a digit.
- bad:  `if (in_array($id, $validIds)) { /* ... */ }`
- good: `if (in_array($id, $validIds, true)) { /* ... */ }`

### #8 `implode()` legacy argument order [Bug]
Pieces-first order is a TypeError on PHP 8.x (was deprecated in 7.4).
- bad:  `implode($pieces, ', ');`
- good: `implode(', ', $pieces);`

---

## Security

### #9 SQL injection — string-built query [Bug]
Never interpolate user data into SQL.
- bad:  `$sql = "SELECT * FROM users WHERE email = '" . $email . "'";`
- good: `$stmt = $pdo->prepare('SELECT * FROM users WHERE email = :email'); $stmt->execute(['email' => $email]);`

### #10 XSS — unescaped output [Bug]
`echo $user->bio;` renders user input as HTML.
- bad:  `echo "<p>{$user->bio}</p>";`
- good: `echo '<p>' . htmlspecialchars($user->bio, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '</p>';`

### #11 Missing CSRF token on state change [Bug]
A state-changing POST with no per-session token is triggerable from any origin.
- bad:  `if ($_SERVER['REQUEST_METHOD'] === 'POST') { $db->deleteAccount($_SESSION['user_id']); }`
- good: `if (! hash_equals($_SESSION['csrf'] ?? '', $_POST['csrf'] ?? '')) { throw new \RuntimeException('CSRF'); }` (+ SameSite cookie)

### #12 `extract()` on user input [Bug]
`extract($_POST)` lets a user overwrite your scope via `_SESSION` / `GLOBALS` keys.
- bad:  `extract($_POST);`
- good: `$name = $_POST['name'] ?? null; $email = $_POST['email'] ?? null;`

### #13 `unserialize()` on untrusted data [Bug]
Triggers magic methods (`__wakeup`, `__destruct`, `__toString`) → RCE chains.
- bad:  `$obj = unserialize($_COOKIE['cart']);`
- good: `$obj = json_decode($_COOKIE['cart'] ?? '[]', true, 16, JSON_THROW_ON_ERROR);`

### #14 Non-constant-time secret comparison [Bug]
`==` on tokens allows type-juggling bypass.
- bad:  `if ($_POST['token'] == $_SESSION['token']) { /* ... */ }`
- good: `if (hash_equals($_SESSION['token'], $_POST['token'] ?? '')) { /* ... */ }`

### #15 `md5`/`sha1` for password storage [Bug]
Not password hashes; rainbow-table friendly.
- bad:  `$hash = md5($password);`
- good: `$hash = password_hash($password, PASSWORD_BCRYPT);` / verify: `password_verify($password, $hash);`

### #16 Open redirect from user-controlled `Location` [Bug]
`header("Location: " . $_GET['next'])` turns your domain into a phishing redirector.
- bad:  `header('Location: ' . $_GET['next']);`
- good: `$next = $_GET['next'] ?? '/'; if (! str_starts_with($next, '/') || str_starts_with($next, '//')) { $next = '/'; } header('Location: ' . $next); exit;`

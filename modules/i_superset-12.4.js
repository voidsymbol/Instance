/* Instance Superset 12.4 */
;
(function compiler(global) {
'use strict';

const MESSAGES = {

	NOT_DATA_LITERAL: () => 'not a data literal',
	MANIFEST_NO_RETURN: (name) => `package ${name}: the manifest body must RETURN an object literal \u2014 ` +
		`package.json is JSON, so it cannot be computed.`,
	MANIFEST_NOT_OBJECT: (name, head) => `package ${name}: the manifest must return an OBJECT LITERAL, not ${head}\u2026`,
	MANIFEST_BAD_TOKEN: (name, bad) => `package ${name}: the manifest is written to package.json, which is JSON \u2014 ` +
		`'${bad}' cannot appear in it. Only strings, numbers, true/false/null, ` +
		`arrays and plain objects.`,
	MANIFEST_INVALID: (name) => `package ${name}: the manifest is not a valid object literal.`,
	PACKAGE_WRITE_EXTENDS: (name) => `package ${name}: write 'extends' rather than 'is' \u2014 a package inherits a real ` +
		`prototype. 'is' is the contract relation, on interfaces.`,
	USING_NEEDS_NAME: () => '`using package` needs a name.',
	INTERFACE_WRITE_IS: (name, base) => `interface ${name}: write 'is' rather than 'extends' \u2014 ` +
		`'interface ${name} is ${base || '\u2026'}'.`,
	IMPLEMENTS_NOT_IFACE: (cls, nm) => `Instance: class ${cls} implements '${nm}', which is not an interface here.`,
	IMPLEMENTS_MISSING: (cls, from, statik, name, isMethod) => `Instance: class ${cls} \u2014 '${from}' requires ${statik ? 'static ' : ''}` +
		`'${name}'${isMethod ? '()' : ''}, which is missing.`,
	IMPLEMENTS_NEEDS_METHOD: (cls, from, name) => `Instance: class ${cls} \u2014 '${from}' requires '${name}' to be a method.`,
	IMPLEMENTS_TIER: (cls, from, name, want, got) => `Instance: class ${cls} \u2014 '${from}' requires tier '${want || '(bare)'}' ` +
		`on '${name}', found '${got || '(bare)'}'.`,
	IMPLEMENTS_GRAIN: (cls, from, want, name, got) => `Instance: class ${cls} \u2014 '${from}' requires '${want}' on '${name}', found '${got}'.`,
	IMPLEMENTS_BAD_TYPE: (cls, one) => `Instance: class ${cls} \u2014 '${one}' is not a known type token.`,
	USING_NAMES_PACKAGE: (word) => '`using` must name a package: write `using package ' + word + ';`.',

	GOTO_PARSE: (where, name, why) => `goto: in ${where}'${name}' \u2014 ${why || 'parse'}`,
	GOTO_NO_TERMINATOR: (name) => `goto: block '${name}' ends without a terminator \u2014 write 'goto <label>;', ` +
		`'goto continue;', 'goto break;', 'goto return;', or return/throw.`,
	GOTO_YIELD_NEEDS_GENERATOR: () => 'goto: `goto yield` suspends, so this member must be a generator \u2014 write `*name()`.',
	GOTO_DUPLICATE_LABEL: () => 'goto: duplicate label',
	BLOCK_NEEDS_DO_AWAIT: () => 'a block takes `do` in front (C-DO): write `do await { \u2026 } as x`, or `do try await { \u2026 } as x` to soften it. ' +
		'(An object literal here needs parentheses: `await ({ \u2026 })`.)',
	DO_TAKES_BLOCK_LOCAL: (isTry, isAwait, opd) => '`do` takes a block: write `do ' + (isTry ? 'try ' : '') + (isAwait ? 'await ' : '') + '{ ' + opd + ' }`.',
	TRY_NEEDS_OPERAND: () => '`try` needs an operand.',
	CLAUSE_NEEDS_BLOCK_LOCAL: (pfx, body, tail) => 'a `catch` or `finally` clause needs a block to attach to: write ' +
		'`try ' + pfx + '{ ' + body + ' } ' + tail + '`.',
	CLAUSE_NEEDS_TRY_LOCAL: (pfx, rest) => 'a `catch` or `finally` clause attaches to `try`: write `do try ' + pfx + rest + '`.',
	AFTER_BLOCK_LOCAL: (tail) => 'nothing may follow the block: `' + tail + '`. A value is the block\'s last expression.',
	AWAIT_FOR_NOT_A_FORM: (opd) => '`await for` is not a form: write `await ' + opd + '`. The plain await ' +
		'drains the same sources AND a promise of an iterable, which `await for` cannot.',

	HEAD_WORD: (w) => w === 'try'
		? '`try` is the first word of a class head \u2014 the order is `[export default] try [grain] [participles] class`.'
		: w === 'defer' || w === 'await' ? '`' + w + '` is a member\'s lane, not a class grain \u2014 the head takes `setup`, `async` or `mixed`.'
		: STRUCTURAL.has(w) || GRAINS.has(w) || w === 'main'
		? '`' + w + '` is out of place \u2014 a class head reads `[export default] [try] [grain] [participles] class`' +
			(w === 'main' ? ', `main` among the participles.' : '.')
		: w === 'private' || w === 'protected'
		? '`' + w + '` is a member\'s tier, never a class head\'s \u2014 a head takes `public`, which makes the class a contract (C-PUBLIC).'
		: '`' + w + '` is not a class-head word \u2014 the head takes `public`, `try`, a grain (`setup`, `async`, `mixed`), ' +
			'the participles `iterable` and `untracked`, and `main`.',
	PUBLIC_LEADS_HEAD: () => '`public` leads a class head \u2014 the order is `[export default] public [try] [grain] [participles] class` (C-PUBLIC).',

	TIER_LEADS_AS: (tier, lead, slot) => 'the tier leads the member (C-TIER, ruled 5 Nov): write `' + tier + ' ' + (lead || '…') + ' as ' + slot + '`, not `as ' + tier + ' …`.',
	ONE_DESCRIPTOR_LIST: () => 'a field names one descriptor — ' + [...FIELD_DESCRIPTORS].map(w => '`' + w + '`').join(', ') + ' — not more than one.',
	SLOT_UNTRACKED_FIRST: (mut, name) => 'the slot reads `[untracked] [descriptor] name`: write `untracked ' + mut + ' ' + name + '`.',
	SLOT_EXPECTED: () => 'a slot is expected here: a name, a pattern (`{ a, b }`, `[a, b]`) or a computed key (`[k]`).',
	PATTERN_NEVER_CLOSES: () => 'the pattern or key opening here never closes on its line.',
	PATTERN_UNREADABLE: (text) => 'the pattern here could not be read: ' + text,
	SIGNATURE_WORD_AS_NAME: (w) => '`' + w + '` is a signature word, so it cannot name a field. Rename the field.',
	DOUBLE_SIDED_SIGILS: (name) => 'Double-sided sigils are banned: `' + name + '` carries both a prefix and a suffix run.',
	BARE_COMPREHENSION_RETIRED: (name, star) => 'the bare comprehension is retired: spell `' + name + star +
		'` — the star is the drain/spread marker now (hard supersede).',

	OVERRIDE_NOT_CONSTRUCTOR: () => '`@override` marks a method, a moment handler or a field: the constructor is its class\'s own.',
	OVERRIDE_NOT_STATIC: () => '`@override` is for the instance face: a static is its own class\'s already.',
	OVERRIDE_MARKS: () => '`@override` marks a method, a moment handler or a field.',
	OVERRIDE_PRIVATE: (name) => '`@override ' + name + '`: a private name is its class\'s own, and nothing below can reach it to replace.',
	OVERRIDE_NEEDS_MEMBER: () => '`@override` needs the member it marks.',
	OVERRIDE_ONCE: () => '`@override` is written once per member.',
	NOT_A_DECORATOR: (name) => '`@' + name + '` is not a decorator: `@override` is the one there is. (The member shortcut `@x = f()` is retired: write the lane line `await f() as x`.)',
	USE_IMPLICIT_RETIRED: () => "`'use implicit'` is retired (V11): a suspending field carries its lane on the line — `await f() as x`.",
	AT_MEMBER_IS_DECORATOR: () => 'a member that starts with `@` is a decorator (`@override`), and the member shortcut `@… = f()` is retired: write the lane line `await f() as …`.',
	LANE_SIGIL_TAKES_EQUALS: (sigil, word, slot) => 'the lane sigil `' + sigil + '` is the short form of `' + word + '`, and takes `=`: write `' + sigil + slot + ' = f()`, or the lane line `' + word + ' f() as ' + slot + '`.',
	AT_AFTER_HEAD_RETIRED: (head) => '`@` after `' + head + '` is the retired member shortcut: write the lane line `' + head + ' await f() as …`; a decorator (`@override`) goes first.',

	ONE_TIER: (a, b) => 'a field names one tier — `' + a + ' ' + b + '` is two.',
	TIER_LEADS_HEAD: (tier, right, wrong) => 'the tier leads the member (C-TIER, ruled 5 Nov): write `' + tier + ' ' + right + '`, not `' + wrong + '`.',
	DO_LEADS_TRY: (lane) => '`do` leads the block (C-DO): write `do try ' + lane + ' { \u2026 }`, not `try do`.',
	TIER_ON_STATIC_BLOCK: (tier) => '`' + tier + '` is a field\'s word — it says which machines hold the field\'s state, and a static block has none. Drop it.',
	CTOR_ONE_GRAIN: () => 'a constructor names one grain.',
	DO_OPENS_BLOCK_ON_LANE: (tryPart) => '`do` opens a block on a lane (C-DO): write `do ' + tryPart + 'await { \u2026 } as x`, or `x = do ' + tryPart + '{ \u2026 }` for a plain value.',
	YIELD_ON_METHOD: () => '`yield` is a lane and an emitter; a method has neither. Drop it.',
	DEFER_LEADS_YIELD: (awaitPart) => '`defer` leads the member (C-YIELDRAW): write `defer yield ' + awaitPart + '…`.',
	SETUP_IS_A_GRAIN: () => '`setup` names a grain — a class head or a constructor — and the half of a compound (`setup async`). ' +
		'The blocking lane on a member is `await`: write `await … as x`.',
	SYNC_RETIRED: () => '`sync` is retired (V11): `await` is the blocking lane, and `setup async` the batch run.',
	ONE_LANE: (lanes, w) => 'a member names ONE lane — `' + lanes + ' ' + w + '` is not a compound. The compounds are ' +
		'`setup async`, `async setup` and `defer async`.',
	YIELD_LEADS: (lanes, first) => '`yield` leads the member: write `yield ' + lanes + ' …`.' + (first === 'await' ? ' (`yield` alone emits as is; `yield await` waits first.)' : ''),
	WORD_OPENS_NOTHING_FOLLOWS: (w) => '`' + w + '` opens a member and nothing follows it.',

	AWAIT_ON_METHOD: (mname) => '`await` is a lane word; a method that suspends is `async ' + (mname || '[…]') + '() {}`.',
	DEFER_ON_METHOD: (mname) => '`defer` is a lane word; a method that suspends is `async ' + (mname || '[…]') + '() {}`.',
	METHOD_TAKES_ASYNC: () => 'a method takes `async`, or a lane before `set` (C-SETLANE) — nothing more.',
	GETTER_TAKES_NO_LANE: () => 'a getter takes no lane: it runs on demand, long after settlement.',
	METHOD_BODY_NEVER_CLOSES: (mname) => 'the body of `' + (mname || '[\u2026]') + '()` never closes.',

	LANE_NEEDS_EXPRESSION: (lane, beforeAs) => '`' + lane + '` opens a member, and an expression must follow it' + (beforeAs ? ' before `as`' : '') + '.',
	V11_VALUE_FIRST: (lane, value, slot, wrong) => 'V11: the value comes first and `as` names the slot — write `' + lane + ' ' + value + ' as ' + slot + '`, not `' + wrong + '`.',
	BLOCK_NEEDS_DO_TRY: (lane, body, slotPart, tail) => 'a block takes `do` in front (C-DO): write `do try ' + lane + ' ' + body + slotPart +
		'`' + (tail ? ', and apply `' + tail + '` to the slot on its own line' : '') + '. A call takes its fallback after the leading `try`: `try ' + lane + ' f() or d as x`.',
	TRY_LEADS_LANE: (lane, opd, slotPart) => '`try` leads the member: write `try ' + lane + ' ' + opd + slotPart + '`.',
	AWAIT_THIS_NOT_DEFERRED: () => '`await this` waits for the fans declared ABOVE it, where it stands. `defer` would move ' +
		'the wait to the tail, where a bare `await this;` already waits for every fan. Place `await this;` where the wait belongs.',
	LANE_ALREADY_WAITS: (lane, does, opd, slotPart) => '`' + lane + '` already ' + does + ': the `await` is redundant. Write `' +
		lane + ' ' + opd + slotPart + '`.',
	BLOCK_NEEDS_DO_LANE: (tryPart, lane, slotPart, slotTail) => 'a block takes `do` in front (C-DO): write `do ' + tryPart + lane + ' { … }' + slotPart +
		'`. (An object literal here needs parentheses: `' + lane + ' ({ … })' + slotTail + '`.)',
	DO_YIELD_GATE_NOT_BUILT: () => '`do yield { … };` is not built: bind the block (`do yield await { … } as x`), or emit a value (`yield f();`).',
	DO_IS_FOR_AWAIT: (tryPart, yieldPart, slotPart, lane, slotTail) => '`do` is built for the blocking lane: its block runs in the settlement, step by step. Write `do ' + tryPart + yieldPart + 'await { … }' +
		slotPart + '`, or give `' + lane + '` an expression — `' + lane + ' (async () => { … })()' + slotTail + '`.',
	DO_TAKES_BLOCK_LANE: (tryPart, lane, body, slotPart) => '`do` takes a block: write `do ' + tryPart + lane + ' { ' + body + ' }' + slotPart + '`.',
	INDEXED_ON_BLOCK: () => '`indexed` orders a lane\'s writes, and a block is one write.',
	AFTER_BLOCK_LANE: (tail) => 'nothing may follow the block: `' + tail + '`. A `catch` or `finally` attaches under `do try`; a value is the block\'s last expression.',
	CLAUSE_NEEDS_TRY_LANE: (lane, clause) => 'a `catch` or `finally` clause attaches to `try`: write `do try ' + lane + ' { … } ' + clause + '`.',
	FALLBACK_IS_OR: (tryPart, lane, opd, fallback, slot) => 'the line\'s fallback is the word `or` (C-FALLBACK): write `' + tryPart + lane + ' ' + opd + ' or ' + fallback + slot + '`. `??` stays JavaScript\'s inside an expression.',
	OR_NEEDS_FALLBACK: () => '`or` takes a fallback after it (C-FALLBACK): a call, a name, a literal or a group.',
	FALLBACK_ONE_OPERAND: (one, rest, whole) => 'a fallback is one operand — a call, a name, a literal or a group (C-FALLBACK): `' + one + '` is one, and `' +
		rest + '` follows it. Group it: `or (' + whole + ')`.',
	FALLBACK_NEEDS_A_WAIT: (lane, write) => 'a fallback applies to the value that arrived (C-FALLBACK), and `' + lane + '` waits for nothing here: `or` would meet the promise. ' + write,
	LANE_ALREADY_WAITS_FALLBACK: (lane, tryPart, opd, slot) => '`' + lane + '` already waits: the `await` is redundant. Write `' + tryPart + lane + ' ' + opd + slot + '`.',
	GATE_FALLBACK_NOWHERE: (tryPart, lane, opd) => 'a gate binds nothing, so its fallback lands nowhere (C-FALLBACK): bind the value, `' + tryPart + lane + ' ' + opd + ' as x`.',
	COMPUTED_KEY_NO_FALLBACK: () => 'a computed key takes no fallback yet (C-FALLBACK): bind a name, `… as x`, and write the key from it.',
	CLAUSE_NEEDS_BLOCK_LANE: (clause, lane, body, tail, slot) => 'a `' + clause + '` clause needs a block to attach to (C-DO): write `do try ' + lane + ' { ' + body + ' } ' + tail + slot + '`.',
	LANE_ONE_OPERAND: (lane, one, rest, advice) => '`' + lane + '` takes one operand — a call, a name, a literal or a group (C-DO): `' + one + '` is one, and `' +
		rest + '` follows it. ' + advice,
	DEFER_YIELD_BINDS: (opd) => '`defer yield` emits at the tail, so it binds: write `defer yield ' + opd + ' as x`, or `defer ' + opd + ';` for the gate.',
	TRY_ON_EMISSION: (lane, opd) => '`try` on an emission is not built: on a failure it would have to emit nothing or emit `undefined`. Bind the value — `try ' + lane + ' ' +
		opd + ' as x` — or drop the `try`.',
	GATE_NEEDS_A_WAITER: (lane) => 'a gate binds nothing, so only `await` and `defer` open one — `' + lane + ' …;` has nobody waiting and nothing bound. ' +
		'Bind it with `as`, or write `await …;` / `defer …;`.',
	INDEXED_ON_GATE: () => '`indexed` orders a lane\'s writes, and a gate writes nothing.',
	TIER_ON_GATE: (tier) => '`' + tier + '` says which machines hold a field\'s state, and a gate binds no field. Bind it with `as`, or drop the word.',
	AFTER_SLOT: (rest, slot) => 'nothing may follow the slot on its line: `' + rest + '` after `' + slot + '`.',
	COMPUTED_KEY_MODIFIER: (extra) => 'a computed key takes no modifier but `static` and `await`: `' + extra + '` is not built for one yet.',
	DRAIN_TAKES_SOURCE: (lane, slot) => 'a drain takes a source, not a block: write `' + lane + ' f() as ' + slot + '`.',
	DRAIN_NO_FALLBACK: (source) => 'a drain takes its source as one operand, and a fallback for a source is not built (C-FALLBACK): drain `' +
		source + '`, or bind the value with its fallback first and drain that.',

	ROLE_WORD_RETIRED: (gone, right, name) => '`' + gone + '` is retired: the role words are `active` (runs at new, re-runs when a dependency moves) and `passive` (a formula, cached) — write `' + right + ' ' + name + '()`.',
	INDEXED_ALONE: () => '`indexed` orders the writes of a lane and has none to order on its own — name a lane (`async indexed f() as x`), or drop it.',
	ONE_TRACKING_WORD: () => 'a member names one tracking word — `untracked` or `volatile`, not both.',
	ROLE_WORD_RETIRED_VOLATILE: (gone, right, name) => '`' + gone + '` is retired: the role words are `active` and `passive` — write `volatile ' + right + ' ' + name + '()`.',
	ONE_ROLE: (a, b) => 'a signal-function names one role — `' + a + ' ' + b + '` is two.',
	COLUMN_WORD_BEFORE_ROLE: (w, role, name) => 'the column reads `[' + w + '] ' + role + ' [descriptor] name()`: write `' + w + ' ' + role + ' ' + name + '()`.',
	WORD_AT_LEFT_MARGIN: (w, role, name) => '`' + w + '` stands at the left margin, before the role: write `' + w + ' ' + role + ' ' + name + '()`.',
	ROLE_LEADS_DESCRIPTOR: (role, mut, name) => 'the role leads the descriptor: write `' + role + ' ' + mut + ' ' + name + '()`.',
	COLUMN_TIER_UNTRACKED_DESCRIPTOR: (line) => 'the column reads `[tier] [untracked] [descriptor] name`: write `' + line + '`.',
	LANE_LEADS_OR_ONE_DESCRIPTOR: (isLane, lane, slot) => isLane
		? 'the lane word leads the member (V11): write `' + lane + ' … as ' + slot + '`.'
		: 'a field names one descriptor — ' + [...FIELD_DESCRIPTORS].map(x => '`' + x + '`').join(', ') + ' — not more than one.',
	ROLE_DESCRIBES_METHOD: (role, prefix) => '`' + role + '` describes a method: write `' + prefix + 'name(…) { … }`.',
	BRACKET_NEVER_CLOSES: () => 'the bracket opening here never closes.',
	V11_AWAIT_AS_KEY: (key) => 'V11: the value comes first and `as` names the slot — write `await … as ' + key + '`.',
	TIER_ON_METHOD: (tier) => '`' + tier + '` is a field\'s word — it says which machines hold the field\'s state, and a method has none. Drop it.',
	COMPUTED_METHOD_NEVER_CLOSES: () => 'the body of this computed-name method never closes.',
	ONE_DESCRIPTOR: () => 'a field names one descriptor.',
	V11_KEY_BOUND_WITH_EQUALS: (key, value) => 'V11: the key [' + key + '] is bound with `=`, which never waits. Write `await ' + value + ' as [' + key + ']`.',
	PATTERN_BINDS: (text) => 'a pattern binds: write `' + text + ' = …`, or `await … as ' + text + '`.',
	V11_PATTERN_BOUND_WITH_EQUALS: (text, value) => 'V11: the pattern ' + text + ' is bound with `=`, which never waits. Write `await ' + value + ' as ' + text + '`.',
	CALL_NOT_MEMBER: (hasAs, line, name) => hasAs
		? 'V11: the lane word leads the member and `as` names the slot — write `await ' + line + '`.'
		: '`' + name + '(…)` is a call, not a member: a method has a body, and a value comes after its lane word (`await ' + name + '(…) as x`).',
	TIER_ON_METHOD_NAMED: (tier, name) => '`' + tier + '` is a field\'s word — it says which machines hold the field\'s state, and ' + (name === 'constructor' ? 'the constructor has none. Drop it.' : 'a method has none. Write `' + tier + ' ' + name + ' = …`, or drop it.'),
	ROLE_ON_GETTER: (role, name, isEffect) => '`' + role + '` describes a method, and a getter is a formula already: write `get ' + name + '()`' + (isEffect ? ', or `active ' + name + '()` for something that runs' : '') + '.',
	CTOR_NO_ROLE: () => 'the constructor takes no role word.',
	ROLE_NOT_GENERATOR: (role, name) => 'a signal-function is not a generator: `' + role + ' ' + name + '*()` has no meaning.',
	ROLE_NOT_ASYNC: (role, name) => 'a signal-function is synchronous — its body runs inside the kernel: `' + role + ' async ' + name + '()` has no meaning. Await inside a lane instead.',

	ONE_CONSTRUCTOR: (cls, statik) => `Instance: class ${cls || '?'} — one ${statik ? 'static ' : ''}constructor per class.`,
	SCTOR_NO_LANE: (cls, grain) => (`Instance: class ${cls || '?'} — a static constructor takes no ` +
		`lane word; the class head declares the class face's grain. Write '${grain} class* ${cls || ''}'.`).replace(/ '$/, "'"),
	CTOR_EMITS_ITERATES: (cls, statik) => `Instance: class ${cls || '?'} — the ${statik ? 'static ' : ''}constructor emits, so it must ` +
		`say it iterates: write \`${statik ? 'static ' : ''}constructor*()\`.`,

	V11_VALUE_FIRST_AWAIT: (value, slot) => 'V11: the value comes first and `as` names the slot — write `await ' +
		value + ' as ' + slot + '`.',
	V11_FIELD_EQUALS_NEVER_WAITS: (name, form, slot) => 'V11: field \'' + name + '\' is bound with `=`, which never waits. Write `' + form + ' as ' + slot + '`.',
	TRY_INSIDE_DO: (name, opd) => '`try` softens the block from inside `do`: write `' + name + ' = do try ' + opd + '`.',
	BRACES_AFTER_DO: (name, body, tail) => 'braces are a value after `do` (C-DO): write `' + name + ' = do try ' + body + '`' +
		(tail ? ', and apply `' + tail + '` on its own line' : '') + '.',
	TRY_LEADS_FIELD: (slot, opd) => '`try` leads the member: write `try ' + slot + ' = ' + opd + '`.',
	NOT_A_MODIFIER: (name, after) => '`' + name + '` is not a modifier — as written it declares a bare field named `'
		+ name + '`, and `' + after + '` begins a SEPARATE member. Put it on its own line if that was the intent.',

	VOLATILE_NAMES_ROLE: (name) => '`volatile` describes a signal-function: name its role — `volatile passive ' + name + '()`, or `volatile active ' + name + '()`.',
	SIGIL_IN_FRONT: (line) => 'the sigil goes in front of the name (C-ROLE): write `' + line + '()`.',
	SUFFIX_SIGIL_WARNING: (cls, name, line) => `class ${cls || '(anonymous)'}: \`${name}()\` is read as an effect by where its sigil sits; the position is retired (C-ROLE) — write \`${line}()\`.`,
	HEAD_TRY_NOT_REACHING_FACE: (cls, face, say) => `class ${cls || '(anonymous)'}: the head's \`try\` does not reach the ${face} face \u2014 its constructor is written without one, so that face fails hard. Write \`${say}\` to soften it (C-MASTER).`,
	NEEDS_A_FACE: (what, contract) => contract
		? '`' + what + '` needs a face to settle on, and a public class is a contract: plain, synchronous JavaScript that ' +
			'keepers run, of Instance only `try` \u2014 drop `' + what + '` (C-PUBLIC).'
		: '`' + what + '` needs a face to settle on, and a class that extends nothing is ' +
		'plain JavaScript, where of Instance only `try` applies \u2014 extend an Instance base (`extends Div`), or drop `' +
		what + '`.',
	CONTRACT_FIELDS_PUBLIC: () => 'a contract\'s fields are public already \u2014 every keeper holds them \u2014 so a tier word adds nothing; a working field that is not state starts with an underscore (C-PUBLIC).',
	FIELD_CANNOT_AWAIT: (contract) => contract ? 'a contract\'s field cannot `await`: a keeper runs the class to its end in one step (C-PUBLIC).'
		: 'a field of a class that extends nothing cannot `await`: nothing settles it, so nothing waits \u2014 ' +
		'extend an Instance base (`extends Div`), or move the wait into a method.',
	CONTRACT_EXTENDS_CONTRACT: (ext) => 'a public class is a contract and extends `Contract`' + (ext ? ', not `' + ext + '`' : '') + ' (C-PUBLIC).',
	CONTRACT_NO_SOFT_FACE: () => 'a contract has no soft face: a call that throws is rolled back whole by the keeper, so `try` on the head would hide what must be seen \u2014 drop it (C-PUBLIC).',
	CONTRACT_NO_SOFT_MEMBER: () => 'a contract has no soft member: a call that throws is rolled back whole by the keeper (C-ATOMIC) \u2014 write a `try` statement inside the method if a failure is yours to handle (C-PUBLIC).',
	CONTRACT_SYNCHRONOUS: (w) => 'a contract is synchronous: a keeper runs a call to its end in one step and hashes what it left \u2014 `' + w + '` has no place in it (C-PUBLIC).',
	CONTRACT_NO_PROMISE: () => 'a contract is synchronous: `Promise` has no place in it (C-PUBLIC).',
	CONTRACT_FUEL_RESERVED: () => '`__fuel` is the step counter\'s name, reserved in a contract (C-PUBLIC).',
	CONTRACT_LOOP_BRACES: (w) => 'a contract\'s loop writes its braces, so the step counter has a block to stand in: `' + w + ' (\u2026) { \u2026 }` (C-PUBLIC).',
	CONTRACT_DO_WHILE_BRACES: () => 'a contract\'s loop writes its braces: `do { \u2026 } while (\u2026)` (C-PUBLIC).',
	CONTRACT_NO_GENERATOR: () => 'a contract\'s method is not a generator: a keeper runs a call to its end in one step (C-PUBLIC).',
	CONTRACT_NO_SIGNAL_FUNCTIONS: (role) => 'a contract has no signal-functions: there is no kernel on the keeper for `' + role + '` to run in \u2014 write a plain method (C-PUBLIC).',
	CONTRACT_NO_STATIC_FIELD: () => 'a contract keeps its state on its objects: a static field has no slot and no hash \u2014 make it an object\'s field, or a method\'s constant (C-PUBLIC).',
	CONTRACT_NO_COMPUTED_KEY: () => 'a contract\'s fields are named: a computed key has no name to hash under (C-PUBLIC).',
	CONTRACT_NO_OVERRIDE: () => '`@override` has no chain in a contract: it extends `Contract` and nothing below reaches it (C-PUBLIC).',
	MEMBER_EMITS_CLASS_ITERATES: (cls) => `Instance: class ${cls || '?'} \u2014 this member emits, so the class must say it ` +
		`iterates: write \`class* ${cls || ''}\`.`,
	STATIC_LANE_NEEDS_GRAIN: (cls) => `Instance: class ${cls || '(anonymous)'} \u2014 a static names a lane, but the ` +
		`class head declares no grain. Write 'setup class', 'mixed class' or 'async class' \u2014 ` +
		`the head is what the consumer reads.`,
	SCTOR_NO_PARAMS: (cls) => `Instance: class ${cls} \u2014 a static constructor takes no parameters: nothing calls it. ` +
		`Configure a subclass through a static method or a field it declares.`,
	SCTOR_SUPER_NO_ARGS: (cls, ext) => `Instance: class ${cls} \u2014 'super()' on the class face takes no arguments. It waits for ` +
		`'${ext}' to settle; it does not run its static constructor again (P-6).`,
	SCTOR_SUPER_NEEDS_EXTENDS: (cls) => `Instance: class ${cls} \u2014 'super()' in a static constructor needs an 'extends'.`,
	SCTOR_BARE_SUPER: (cls) => `Instance: class ${cls} \u2014 a bare 'super()' on the class face says nothing ` +
		`about waiting. Write 'yield super()' (joined) or 'await super()' (ordered).`,
	SCTOR_VOID_SUPER: (cls) => `Instance: class ${cls} \u2014 'void super()' on the class face is not built yet.`,
	SCTOR_SUSPEND_BEFORE_SUPER: (cls, ext) => `Instance: class ${cls} \u2014 nothing may suspend before 'super()' in a static constructor: ` +
		`'${ext}' has not settled yet. Move the await after it.`,
	SCTOR_NEEDS_GRAIN: (cls, joins) => `Instance: class ${cls} \u2014 the static constructor ` +
		`${joins ? 'joins its parent' : 'suspends'}, but the class head declares no grain. ` +
		`Write 'setup class*' or 'mixed class*' \u2014 the head is what the consumer reads.`,
	SCTOR_SETUP_AWAITS_SUPER: (cls) => `Instance: class ${cls} \u2014 a 'setup class' orders the class ` +
		`face after its parent, so write 'await super()' \u2014 or declare the class 'mixed'.`,
	SCTOR_ASYNC_NOTHING_TO_WAIT: (cls, form) => `Instance: class ${cls} \u2014 an 'async class' detaches its class face, ` +
		`so there is nothing for '${form} super()' to wait on. Drop the call, or declare the class 'mixed'.`,
	SCTOR_FOLD_STATIC_BLOCK: (cls) => `Instance: class ${cls} \u2014 a class with a static constructor has one place where its ` +
		`class face runs. Fold the 'static { \u2026 }' block into it.`,
	SET_PER_LEVEL_NOT_BUILT: (cls, name, ext) => `Instance: class ${cls || '(anonymous)'}: '${name}' is set in ${ext}, ` +
		`and a per-level \`set\` on the INSTANCE face is not built yet (C-SHADOW). Declare it \`let\` for now.`,
	CONST_IN_PARENT: (cls, name, mut, ext) => `class ${cls || '(anonymous)'}: '${name}' is ${mut} in ${ext} \u2014 ` +
		`one value for the hierarchy, so a subclass may not declare its own. Declare it 'set' in ` +
		`${ext} for one value per class.`,
	CONST_IN_PARENT_SOFT: (cls, name, mut, ext) => wording('CONST_IN_PARENT', cls, name, mut, ext) + ' (soft: the write will fail softly)',
	CONST_IN_PARENT_HARD: (cls, name, mut, ext) => 'Instance: ' + wording('CONST_IN_PARENT', cls, name, mut, ext),
	FIELD_LANE_NEEDS_GRAIN: (cls, hasCtor) => `Instance: class ${cls || '(anonymous)'} \u2014 a field names a lane, but neither ` +
		`the ${hasCtor ? 'constructor' : 'synthesized constructor'} nor the class head declares a grain. ` +
		`Mark the class ('setup class', 'mixed class', 'async class')` +
		(hasCtor ? `, the constructor ('setup constructor'), or the call ('await super()').` : `.`),
	GRAIN_ADMITS: (cls, side, admits, name, lane, isFan) => `Instance: class ${cls} \u2014 ${side === 'async' ? 'an' : 'a'} '${side}' class admits ` +
		`${admits} fields, and '${name}' is '${lane}'. ` +
		(isFan
			? `A fan is not covered by 'await new ${cls}()', so the class must say ` +
			  `'mixed' \u2014 that is what the word means.`
			: `An 'async' class promises nothing joins; declare it 'mixed' to hold both.`),
	SETUP_FACE_OVER_FAN_PARENT: (cls, face, ext, theirs) => `Instance: class ${cls} \u2014 its ${face} face is 'setup' but '${ext}' is ` +
		`'${theirs}'. A 'setup' class promises 'await' delivers everything, and an ` +
		`inherited fan would still be in flight when it resolves.` +
		` Declare ${cls} 'mixed' to inherit ${ext}'s timeline honestly.`,
	SETUP_PARENT_NEEDS_AWAIT_SUPER: (cls, ext, found) => `Instance: class ${cls} \u2014 '${ext}' is a 'setup class', which orders its ` +
		`inheritance chain, so a child must 'await super()'. Found ` +
		`${found}` +
		`, which would run this level against '${ext}' state that has not settled. ` +
		`Write 'await super()', or make '${ext}' a 'mixed class' if its chain need ` +
		`not be ordered.`,
	ASYNC_PARENT_NOTHING_TO_WAIT: (cls, ext, form) => `Instance: class ${cls} \u2014 '${ext}' is an 'async class': its fields are ` +
		`fans and none of them join, so there is no settlement for ` +
		`'${form} super()' to wait on. Detach with ` +
		`'void super()', or make '${ext}' a 'setup' or 'mixed' class if its state ` +
		`should be joinable.`,
	FIELD_READS_LATER_FIELD: (cls, field, read, same) => `Instance: class ${cls} \u2014 field '${field}' reads 'this.${read}', ` +
		`which settles ${same ? 'as part of the same assignment' : 'later'}. It would be ` +
		`undefined here. Declare '${read}' before '${field}' as an 'await' field, ` +
		`or move the dependent work into '${read}' itself.`,
	FIELD_READS_CTOR_PARAM: (cls, field, pn) => `Instance: class ${cls} \u2014 field '${field}' references constructor ` +
		`parameter '${pn}'. Plain JS field initialisers cannot see constructor ` +
		`parameters; assign it in the constructor body instead: ` +
		`this.${field} = ${pn};`,
	NATIVE_NAME: (cls, kind, n) => `Instance: class ${cls} \u2014 ` + (kind === 'method'
		? `field '${n}' would hide the element's own ${n}() method, and it would never be state. Rename the field.`
		: kind === 'readonly'
		? `'${n}' is the element's own read-only member; a field cannot set it. Rename the field.`
		: `'${n}' is the element's own property, so it takes a plain value and nothing more: a lane, a ` +
		  `descriptor or a blank declaration there sends a settlement value through the platform's setter, ` +
		  `or promises a slot the platform does not keep. Write '${n} = \u2026', or rename the field.`) +
		' (C-NATIVENAME)',
	FIELD_SUSPENDS_NO_LANE: (cls, field) =>
		`Instance: class ${cls} \u2014 field '${field}' suspends but names no lane. ` +
		`Write 'await \u2026 as ${field}' to make the class wait for it, or ` +
		`'async \u2026 as ${field}' to let it settle in the background.`,
	INSTANCE_AWAIT_NEEDS_GRAIN: (cls) =>
		`Instance: class ${cls} \u2014 an instance field uses 'await' (a pending field at 'new'); ` +
		`'${cls}' must be declared 'mixed class' or 'async class'.`,

	LOCAL_LANE_RETIRED: (w, lane, name) => '`' + w + ' ' + lane + ' ' + name + '` is retired (V11): a local binding has no lane. Write `' + w + ' ' + name + ' = await \u2026`.',
	MEMBER_SHORTCUT_RETIRED: (slot, pre, init) => 'the member shortcut `@' + slot + ' = …` is retired: a lane sigil belongs to property notation (`obj.@' + slot + '`), and a member that starts with `@` is a decorator (`@override`). Write the lane line: `' + pre + 'await ' + init + ' as ' + slot + ';`.',
	DOT_AT_NAMES_MEMBER: (dot, isKey) => '`.@` awaits a named member: write `' + dot + '@name`' + (isKey ? ', or `(await x[…])` for a computed key' : '') + '.',
	DOT_AT_NOTHING_WAITS: (name, dot) => '`.@' + name + '` awaits (it is `(await …' + dot + name + ')`), and nothing here can wait: ' +
		'make the method `async`, or move the read into the constructor, a lane line (`await x.@' + name + ' as v`) or a `do await { … }` block.',

	JS_DOES_NOT_PARSE: (why, line, word) => 'JavaScript: ' + why + ' — at `' + line + '`' + (word ? ' — `' + word +
		'` is a word Instance rewrites: if the line is valid, the compiler mis-built it (please report it with the source)' : ''),
	EMIT_DOES_NOT_PARSE: (where, why) => 'Instance: the compiler produced output that does not parse — a bug in Instance, not in this source' +
		where + ': ' + why + '. Please report it with the source.',
	COMPILED_LINE: (line, textOf) => ' (compiled line ' + line + ': `' + textOf + '`)',
	AT_LINE: (msg, line) => msg + ' (line ' + line + ')',
	TOP_LEVEL_YIELD_IN_MODULE: () => 'a top-level yield cannot live in a module',

	TT_NOT_CAPTURE_TAG: () => '[Instance] superset policy: not the capture tag',
	TT_NOT_COMPILER_OUTPUT: () => '[Instance] superset policy: not compiler output',
	CAPTURE_REFUSED: (why) => '[Instance] superset: ' + why + ' \u2014 the page was NOT captured, so ' +
		'every Instance block after this point will run as JavaScript and throw. ' +
		'Load this file as a plain parser-blocking script in <head>: ' +
		'no async, no defer, no injection after load.',
	CAPTURE_PARSER_DONE: (state) => 'the parser has already finished (readyState=' + state + ')',
	CAPTURE_NO_CURRENT_SCRIPT: () => 'there is no document.currentScript',
	CAPTURE_SCRIPT_DEFERRED: (how) => 'this script is ' + how,
	CAPTURE_CORE_NOT_LOADED: () => 'the core is not loaded yet \u2014 load i_core, i_chimera and i_dsl BEFORE the compiler, which captures everything after it',
	CAPTURE_NOT_WRITTEN: (why) => '[Instance] superset: the capture could not be written (' + why + '). ' +
		'Under Trusted Types, allow the `superset` policy in the trusted-types directive \u2014 it writes ' +
		'only this one tag and the scripts the compiler emits.',
	FETCH_UNAVAILABLE: () => 'fetch is unavailable',
	FETCH_HTTP: (status) => 'HTTP ' + status,
	OVERRIDE_IS_DEFAULT: (sandbox) => '[Instance] `override` on the compiler tag is the default now \u2014 it can be removed' +
		(sandbox ? ', and it contradicts `sandbox`, which wins.' : '.'),
	ALLOW_BYPASS_UNKNOWN: (v) => '[Instance] allow-bypass="' + v + '" is not a value the compiler knows \u2014 ' +
		'nothing may bypass. Use allow-bypass, allow-bypass="external" or allow-bypass="inline".',
	BYPASS_REFUSED: (label, allow) => '[Instance] bypass on ' + label + ' was refused \u2014 ' +
		(allow ? 'this page allows bypass for ' + allow + ' scripts only'
		       : 'in global mode the compiler owns every script unless its tag says allow-bypass') +
		'. It is compiled like any other.',
	SUPER_IS_SUPERSET: () => '[Instance] <script super> is now <script superset> \u2014 the old name still works for now.',
	HANDED_BACK: (label, why, integrity) => '[Instance] ' + label + ' ' + why +
		' \u2014 handed back to the browser, which runs it as plain JavaScript' +
		(integrity ? ' under its own integrity check' : '') +
		'. Deletes in it are not observed.',
	NEUTRALIZED: (name, why) => '[Instance] superset: ' + name + ' ' + why,
	NONCE_REFUSED: () => 'carries no nonce, or the wrong one \u2014 under this page\'s policy the ' +
		'parser would have refused it, so it is put back inert',
	NOT_FETCHED: (why) => 'could not be fetched (' + why +
		' \u2014 a network or CORS failure, file://, or an integrity mismatch)',
	NOT_RUN_INSTANCE_SOURCE: (why) => why + '; it is Instance source, so it was not run',
	DID_NOT_COMPILE: (why) => 'did not compile (' + why + ')',
	FAILED: (why) => 'failed: ' + why,
	LOADED_AFTER_COMPILER: (src) => '[Instance] capture: ' + src +
		' was loaded AFTER the compiler, so it was captured \u2014 inline blocks may run before it arrives. ' +
		'Load it before the compiler, which belongs last.',
};

const wording = (key, ...args) => {
	const row = MESSAGES[key];
	if (typeof row !== 'function') throw new Error('messages: no row named ' + key);
	return row(...args);
};

const err = (key, at, Kind = SyntaxError, ...args) => { const e = new Kind(wording(key, ...args)); if (at != null) e.at = at; return e; };

const M_OPEN = '\uE000', M_CLOSE = '\uE001';
const ID_START = /[$_#\p{ID_Start}]/u, ID_CONT = /[$#\u200c\u200d\p{ID_Continue}]/u;

const PUNCT_BY_WIDTH = {
	4: ['>>>='],
	3: ['...', '===', '!==', '**=', '<<=', '>>=', '&&=', '||=', '??=', '>>>'],
	2: [
		'=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=',
		'/=', '%=', '&=', '|=', '^=', '**', '<<', '>>'
	]
};

const PUNCT_WIDTHS = Object.keys(PUNCT_BY_WIDTH).map(Number).sort((a, b) => b - a);

const RE_KW = new Set([
	'return', 'typeof', 'case', 'do', 'delete', 'void', 'in', 'instanceof',
	'new', 'yield', 'await', 'throw', 'else', 'of', 'default', 'for'
]);

function jump(a, i, n) { return a[i + n] || {}; }
function next(a, i) { return jump(a, i, 1); }
function prev(a, i) { return jump(a, i, -1); }

function escRe(s) { return String(s).replace(/[$^*+?.()|[\]{}\\]/g, '\\$&'); }

function flags(src, i, n) { while (i < n && /[a-z]/.test(src[i])) i++; return i; }

function stripComments(src, comments = []) {
	const r = scan(String(src), comments);
	return { code: r.code, comments: r.comments };
}

function lex(code) {
	const c = String(code);
	return assertClean(scan(c).spans, c);
}

function lexOr(code) { try { return lex(code); } catch (e) { return null; } }

function maskComments(src) {
	const { code: stripped, comments } = stripComments(src);
	return stripped.replace(/\uE000(\d+)\uE001(\n*)/g, (_, id, nls) => {
		const c = comments[Number(id)];
		return c.replace(/[^\n]/g, ' ') + nls.slice((c.match(/\n/g) || []).length);
	});
}

function splice(text, edits) {
	let out = '', pos = 0;
	for (const e of edits.slice().sort((a, b) => a.s - b.s)) { out += text.slice(pos, e.s) + e.text; pos = e.e; }
	return out + text.slice(pos);
}

const TLA_BLOCK_HEADS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);
const TLA_OPERAND = new Set(['await', 'typeof', 'void', 'delete', 'new', 'return', 'throw', 'yield',
	'in', 'of', 'instanceof', 'case', 'else', 'do', 'extends']);

function hasTopLevelAwait(js) {
	if (!/\bawait\b/.test(js)) return false;
	try { var text = maskComments(js), t = lex(text); }
	catch (e) { return false; }
	const ends = k => k && ((k.w !== undefined && !TLA_OPERAND.has(k.w)) || k.lit || k.num ||
		k.c === ')' || k.c === ']' || k.c === '}');
	const stack = [], arrows = [];
	let fnDepth = 0, classAt = -1, parenHead = null;
	for (let i = 0; i < t.length; i++) {
		const k = t[i], prev = t[i - 1], next = t[i + 1];
		while (arrows.length) {
			const at = arrows[arrows.length - 1];
			const done = stack.length < at ||
				(stack.length === at && (/^[,;:)\]}]$/.test(k.c || '') ||
					(prev && prev.c !== '=>' && k.w !== undefined && ends(prev) &&
					 /\n/.test(text.slice(prev.e, k.s)))));
			if (!done) break;
			arrows.pop();
		}
		if (k.c === '(' || k.c === '[') { stack.push({ fn: false, head: prev }); continue; }
		if (k.c === ')' || k.c === ']') { const e = stack.pop(); parenHead = e && e.head; continue; }
		if (k.c === '{') {
			let fn = false;
			if (classAt === stack.length) { fn = true; classAt = -1; }
			else if (prev && prev.c === '=>') fn = true;
			else if (prev && prev.c === ')' && !(parenHead && TLA_BLOCK_HEADS.has(parenHead.w))) fn = true;
			stack.push({ fn }); if (fn) fnDepth++;
			continue;
		}
		if (k.c === '}') { const e = stack.pop(); if (e && e.fn) fnDepth--; continue; }
		if (k.c === '=>') { if (!next || next.c !== '{') arrows.push(stack.length); continue; }
		if (k.w === 'class' && !(prev && prev.c === '.')) { classAt = stack.length; continue; }
		if (k.w === 'await' && fnDepth === 0 && !arrows.length && !(prev && prev.c === '.') &&
			!(next && /^(=|;|\)|,|]|}|:|\.)$/.test(next.c || ''))) return true;
	}
	return false;
}

function readLiteral(text) {
	const t = lex(text);
	let i = 0;
	const fail = () => { throw new SyntaxError(wording('NOT_DATA_LITERAL')); };
	const str = k => {
		const raw = text.slice(k.s, k.e), body = raw.slice(1, -1);
		return JSON.parse('"' + (raw[0] === '"' ? body : body.replace(/\\'/g, "'").replace(/"/g, '\\"')) + '"');
	};
	const put = (o, key, v) => Object.defineProperty(o, key, { value: v, enumerable: true, writable: true, configurable: true });
	function value() {
		const k = t[i++];
		if (!k) fail();
		if (k.c === '{') {
			const o = {};
			while (t[i] && t[i].c !== '}') {
				const key = t[i++];
				const name = key.w !== undefined ? key.w : (key.lit === '"' || key.lit === "'") ? str(key) : key.num ? String(Number(key.raw)) : fail();
				if (!t[i] || t[i++].c !== ':') fail();
				put(o, name, value());
				if (t[i] && t[i].c === ',') i++; else if (!t[i] || t[i].c !== '}') fail();
			}
			i++; return o;
		}
		if (k.c === '[') {
			const a = [];
			while (t[i] && t[i].c !== ']') {
				a.push(value());
				if (t[i] && t[i].c === ',') i++; else if (!t[i] || t[i].c !== ']') fail();
			}
			i++; return a;
		}
		if (k.c === '-' && t[i] && t[i].num) return -Number(t[i++].raw);
		if (k.num) return Number(k.raw);
		if (k.lit === '"' || k.lit === "'") return str(k);
		if (k.w === 'true') return true;
		if (k.w === 'false') return false;
		if (k.w === 'null') return null;
		return fail();
	}
	const v = value();
	if (i !== t.length) fail();
	return v;
}

const WORDS = {
	setup:     { lane: 'sync',  head: true, strip: true },
	sync:      { lane: 'sync',  internal: true },

	async:     { lane: 'async', head: true, strip: true },
	defer:     { lane: 'defer', head: true },
	batch:     { lane: 'batch', internal: true },
	using:     { lane: 'using' },
	mixed:     { head: true, strip: true },
	iterable:  { structural: true, strip: true },
	untracked: { structural: true, strip: true },

	active:    { role: 'effect' },
	passive:   { role: 'computed' },
	effect:    { retired: 'active' },
	computed:  { retired: 'passive' },
	volatile:  { tracking: true },
	try:       { structural: true, master: true },
	indexed:   { structural: true },

	private:   { tier: 0 },
	protected: { tier: 1 },
	public:    { tier: 2, contract: true },
	let:       { descriptor: true },
	const:     { descriptor: true },
	enum:      { descriptor: true },

	pin:       { descriptor: true },
	ply:       { descriptor: true },
	azo:       { descriptor: true },
	get:       { accessor: true, fieldDescriptor: true },
	set:       { accessor: true, fieldDescriptor: true },
	export:    { strip: true },
	default:   { strip: true },
	main:      { strip: true },
};

const _pick = f => new Set(Object.keys(WORDS).filter(w => f(WORDS[w])));
const GRAINS = _pick(r => r.head && !r.internal);
const FIELD_MODS = _pick(r => r.lane);

const LANE_WORDS = _pick(r => r.lane && !r.internal);
const STRUCTURAL = _pick(r => r.structural && r.strip);

const ROLE_WORDS = _pick(r => r.role);
const roleOf = w => WORDS[w] && WORDS[w].role || null;

const retiredOf = w => WORDS[w] && WORDS[w].retired || null;

const DESCRIPTOR_WORDS = _pick(r => r.descriptor);

const FIELD_DESCRIPTORS = _pick(r => r.descriptor || r.fieldDescriptor);

const TIER_WORDS = _pick(r => r.tier !== undefined);

const HEAD_STRIP = _pick(r => r.strip || r.master);

const sq = s => "'" + String(s).replace(/[\\']/g, '\\$&') + "'";
const LANE_ALIAS = Object.fromEntries(Object.entries(WORDS)
	.filter(([w, r]) => r.lane && r.lane !== w).map(([w, r]) => [w, r.lane]));

const canonLane = w => (Object.prototype.hasOwnProperty.call(LANE_ALIAS, w) ? LANE_ALIAS[w] : w);

const isBlocking = w => canonLane(w) === 'sync';

const ACCESSOR_KW = new Set(['get', 'set']);

const PAIR = { '{': '}', '[': ']', '(': ')' };

function grains(rec, code) {
	const parts = ctorParts(rec, code);
	const form = parts && parts.superForm;
	const dInst = (rec.ctor && rec.ctor.mods.map(canonLane).find(x => x === 'sync' || x === 'mixed' || x === 'async'))
		|| rec.grain || null;
	const fan = statics => rec.members.some(m =>
		m.kind === 'field' && !!m.static === statics && slotOf(m, code) === 'fan');
	const ctorWord = rec.ctor && rec.ctor.mods.find(m => LINK[m]);
	return {
		parts,
		head:  LINK[rec.grain] || 'cap',
		link:  !rec.ctor ? (LINK[rec.grain] || 'cap')
			: LINK[form] ? LINK[form]
			: ctorWord === 'async' ? 'cap' : LINK[ctorWord] || 'cap',
		mode:  form || FORM[rec.grain] || 'plain',
		cls:   rec.grain || (fan(true) ? 'mixed' : 'sync'),
		inst:  dInst || (fan(false) ? 'mixed' : 'sync'),
		dInst,
	};
}

const FORM = { sync: 'await', mixed: 'yield', async: 'void' };
const LINK = Object.fromEntries(Object.entries(FORM).flatMap(([g, f]) => [[g, g], [f, g]]));

const EXTENDS = /\bextends\b/;

const RUNTIME = { ref: '\u00f8' };

const rt = name => RUNTIME.ref + '.' + name;

const USING_ASM = {
	CALL:  (n, a) => ({ pre: `${n}[Symbol.for('Instance.package')].call(this${a ? ', ' + a : ''});` }),
	AWAIT: (n, a, i) => { const R = reg('value', n); return { pre: `const ${R} = ${n}[Symbol.for('Instance.package')].call(this${a ? ', ' + a : ''});`,
	                       post: `yield ${R};` }; },
};
const USING_MOD = {
	plain:       { op: 'CALL',  soft: false },
	try:         { op: 'CALL',  soft: true  },
	await:       { op: 'AWAIT', soft: false },
	'try await': { op: 'AWAIT', soft: true  },
};

const JSON_WORDS = new Set(['true', 'false', 'null']);

function manifestLiteral(text) {
	const t = lexOr(text); if (!t) return { bad: 'unparseable' };
	for (let i = 0; i < t.length; i++) {
		const w = t[i].w, c = t[i].c;
		if (t[i].lit || t[i].num) continue;
		if (c && '{}[]:,'.includes(c)) continue;
		if (w && JSON_WORDS.has(w)) continue;
		if (w && t[i + 1] && t[i + 1].c === ':') continue;
		return { bad: w || c, at: t[i].s };
	}

	return null;
}

function readManifest(body, name) {
	const t = lexOr(body); if (!t) return null;
	const at = t.findIndex((k, i) => k.w === 'public' && t[i + 1] && t[i + 1].w === 'static' &&
		t[i + 2] && t[i + 2].w === 'get' && t[i + 3] && t[i + 3].w === 'manifest');
	if (at < 0) return null;
	const open = t.findIndex((k, i) => i > at + 3 && k.c === '{');
	if (open < 0) return null;
	const close = matchPair(t, open);
	if (close < 0) return null;
	const first = t[open + 1];
	if (first?.w !== 'return') throw new SyntaxError(wording('MANIFEST_NO_RETURN', name));
	let last = close - 1;
	if (t[last] && t[last].c === ';') last--;
	const objText = body.slice(t[open + 2] ? t[open + 2].s : t[close].s, t[last] ? t[last].e : t[close].s).trim();
	if (!/^\{/.test(objText)) throw new SyntaxError(wording('MANIFEST_NOT_OBJECT', name, objText.slice(0, 24)));
	const bad = manifestLiteral(objText);
	if (bad) throw new SyntaxError(wording('MANIFEST_BAD_TOKEN', name, bad.bad));
	try { var value = readLiteral(objText); } catch (e) {
		throw new SyntaxError(wording('MANIFEST_INVALID', name));
	}

	const schema = 'manifest' in value ? value.manifest
	             : ('manifest_version' in value ? value.manifest_version : 1);
	delete value.manifest;
	delete value.manifest_version;
	return { schema, value };
}

function writeManifest(obj, path, diags) {
	const inNode = typeof process !== 'undefined' && process.versions && process.versions.node;
	if (!inNode) {
		diags.push({ level: 'warning', message:
			'manifest present but not running in Node \u2014 package.json was not written.' });
		return false;
	}
	try {
		const fs = require('fs');
		const next = JSON.stringify(obj, null, 2) + '\n';
		try { var cur = fs.readFileSync(path, 'utf8'); } catch (e) {}
		if (cur === next) return 'unchanged';
		fs.writeFileSync(path, next);
		return cur === undefined ? 'created' : 'updated';
	} catch (e) {
		diags.push({ level: 'warning', message: 'manifest could not be written: ' + e.message });
		return false;
	}
}

function parsePackages(spans, code) {
	const out = new Map();
	for (let i = 0; i < spans.length; i++) {
		if (spans[i].w !== 'package') continue;
		if (spans[i - 1]?.w === 'using') continue;
		const name = spans[i + 1]?.w;
		if (!name) continue;
		let j = i + 2, base = null, impl = [];

		if (spans[j]?.w === 'is') {
			throw err('PACKAGE_WRITE_EXTENDS', spans[j].s, SyntaxError, name);
		}
		if (spans[j]?.w === 'extends') { base = spans[j + 1]?.w || null; j += 2; }
		if (spans[j]?.w === 'implements') {
			j++;
			while (spans[j] && spans[j].w) { impl.push(spans[j].w); j++; if (spans[j]?.c === ',') j++; else break; }
		}
		while (j < spans.length && spans[j].c !== '{') j++;
		const close = matchPair(spans, j);
		if (close < 0) continue;
		const asy = spans.slice(j + 1, close).some((k, x, a) => k.w === 'async' && a[x + 1] && a[x + 1].w === 'constructor');
		const man = readManifest(code.slice(spans[j].e, spans[close].s), name);
		out.set(name, { name, base, implements: impl, async: asy, manifest: man, s: spans[i].s, e: spans[close].e,
		                bodyS: spans[j].e, bodyE: spans[close].s });
		i = close;
	}
	return out;
}

function emitPackage(pk, code) {

	const body = code.slice(pk.bodyS, pk.bodyE).replace(/\bpublic\s+(?=static\b)/g, '');
	const rec = { name: pk.name, members: [], ctor: null, grain: null, implements: [], pkg: true };
	const t = lexOr(body); if (!t) return `class ${pk.name} {}\n`;
	parseBody(t, 0, t.length, rec, body);
	const fields = rec.members.filter(m => m.kind === 'field' && m.name != null && !m.static);
	const rest   = rec.members.filter(m => m.kind !== 'field' && m.kind !== undefined);
	const lines  = [];
	if (pk.base) lines.push(`        ${pk.async ? 'await ' : ''}${pk.base}[Symbol.for('Instance.package')].call(this);`);
	for (const f of fields)
		lines.push(`        this.${emitName(f.name)} = ${f.init ? rhs(body.slice(f.init.s, f.init.e)) : 'undefined'};`);
	let args = '';
	if (rec.ctor) {
		const open = body.indexOf('(', rec.ctor.span.s);
		args = body.slice(open + 1, closeParen(body, open)).trim();
		const bo = body.indexOf('{', closeParen(body, open));
		const ct = lexOr(body.slice(bo)) ?? null;
		const c = ct ? matchPair(ct, 0) : -1;
		if (c >= 0) lines.push('        ' + body.slice(bo + 1, bo + ct[c].s).trim());
	}
	const kind = pk.async ? 'async function' : 'function';
	return `class ${pk.name}${pk.base ? ' extends ' + pk.base : ''} {\n` +
		rest.map(m => '    ' + body.slice(m.span.s, m.span.e).trim()).join('\n') + (rest.length ? '\n' : '') +
		`    static [Symbol.for('Instance.package')] = ${kind} (${args}) {\n` +
		lines.join('\n') + (lines.length ? '\n' : '') + `    };\n}\n`;
}

function parseUsings(spans, from, to, code) {
	const out = [];
	for (let k = from; k < to; k++) {
		let b = k, mods = [];
		if (spans[b]?.w === 'try') { mods.push('try'); b++; }
		if (spans[b]?.w === 'await') { mods.push('await'); b++; }
		if (spans[b]?.w !== 'using' || spans[b + 1]?.w !== 'package') continue;
		const name = spans[b + 2]?.w;
		if (!name) { throw err('USING_NEEDS_NAME', spans[b].s); }
		let j = b + 3, args = '';
		if (spans[j]?.c === '(') {
			const c = matchPair(spans, j);
			if (c < 0) continue;
			args = code.slice(spans[j].e, spans[c].s).trim();
			j = c + 1;
		}
		out.push({ name, args, mod: mods.join(' ') || 'plain',
		            span: { s: spans[k].s, e: (spans[j] || spans[j - 1]).e } });
		k = j;
	}
	return out;
}
const TYPE_REF = {
	Number:   { typeof: 'number' },
	String:   { typeof: 'string' },
	Boolean:  { typeof: 'boolean' },
	Symbol:   { typeof: 'symbol' },
	BigInt:   { typeof: 'bigint' },
	Function: { typeof: 'function' },
	Object:   { tag: '[object Object]' },
	Array:    { tag: '[object Array]' },
	Date:     { tag: '[object Date]' },
	Map:      { tag: '[object Map]' },
	Set:      { tag: '[object Set]' },
	Promise:  { tag: '[object Promise]' },
	RegExp:   { tag: '[object RegExp]' },
};

function parseInterfaces(spans, code) {

	const out = new Map();
	for (let i = 0; i < spans.length; i++) {
		if (spans[i].w !== 'interface') continue;
		const name = spans[i + 1]?.w;
		if (!name) continue;

		let j = i + 2, bases = [];
		if (spans[j]?.w === 'extends') {
			throw err('INTERFACE_WRITE_IS', spans[j].s, SyntaxError, name, spans[j + 1]?.w);
		}
		if (spans[j]?.w === 'is') {
			j++;
			while (spans[j] && spans[j].w) { bases.push(spans[j].w); j++; if (spans[j]?.c === ',') j++; else break; }
		}
		while (j < spans.length && spans[j].c !== '{') j++;
		const close = matchPair(spans, j);
		if (close < 0) continue;
		const members = [];
		for (let k = j + 1; k < close; k++) {
			if (spans[k].c === ';') continue;
			const mods = [];

			const jsAsync = p => spans[p].w === 'async' && !!spans[p + 1]?.w && spans[p + 2]?.c === '(';
			while (spans[k] && spans[k].w && (GRAINS.has(spans[k].w) || LANE_WORDS.has(spans[k].w) || spans[k].w === 'static' || jsAsync(k))
			       && spans[k + 1]?.c !== ':' && spans[k + 1]?.c !== '(') { mods.push(spans[k].w); k++; }
			const mname = spans[k] && spans[k].w;
			if (!mname) continue;
			k++;
			let kind = 'field', type = null;
			if (spans[k]?.c === '(') { kind = 'method'; const c = matchPair(spans, k); k = c < 0 ? k : c + 1; }

			if (spans[k]?.c === ':' || spans[k]?.c === '=') {
				k++;
				if (spans[k]?.c === '[') {
					const c = matchPair(spans, k);
					type = [];
					for (let q = k + 1; q < c; q++) if (spans[q].w) type.push(spans[q].w);
					k = c < 0 ? k + 1 : c + 1;
				} else { type = spans[k] && spans[k].w; k++; }
			}
			members.push({ name: mname, kind, type, mods, statik: mods.includes('static') });
			while (k < close && spans[k].c !== ';') k++;
		}
		out.set(name, { name, bases, members, s: spans[i].s, e: spans[close].e });
		i = close;
	}
	return out;
}

function ifaceMembers(iface, all, seen) {
	seen = seen || new Set();
	if (seen.has(iface.name)) return [];
	seen.add(iface.name);
	let out = [];
	for (const b of iface.bases) { const p = all.get(b); if (p) out = out.concat(ifaceMembers(p, all, seen)); }
	return out.concat(iface.members);
}

function checkImplements(rec, code, ifaces, diags) {
	if (!rec.implements || !rec.implements.length) return null;
	const need = [];
	for (const nm of rec.implements) {
		const iface = ifaces.get(nm);
		if (!iface) throw new SyntaxError(wording('IMPLEMENTS_NOT_IFACE', rec.name, nm));
		for (const m of ifaceMembers(iface, ifaces)) need.push({ ...m, from: nm });
	}
	const typed = [];
	for (const m of need) {
		const have = rec.members.find(x => x.name === m.name && !!x.static === !!m.statik) ||
		             (m.name === 'constructor' && rec.ctor);
		if (!have) throw new SyntaxError(wording('IMPLEMENTS_MISSING', rec.name, m.from, m.statik, m.name, m.kind === 'method'));
		if (m.kind === 'method' && have.kind === 'field') throw new SyntaxError(wording('IMPLEMENTS_NEEDS_METHOD', rec.name, m.from, m.name));

		const tier = (n) => (String(n).match(/^[$\u0394\u03a3\u03a6\u00f8]+/) || [''])[0];
		if (tier(m.name) !== tier(have.name || '')) throw new SyntaxError(wording('IMPLEMENTS_TIER', rec.name, m.from, m.name, tier(m.name), tier(have.name)));

		const want = m.mods.find(x => GRAINS.has(x));
		if (want) {
			const got = (have.mods || []).find(x => GRAINS.has(x) || LINK[x]) || rec.grain;
			if (canonLane(got) !== canonLane(want)) throw new SyntaxError(wording('IMPLEMENTS_GRAIN', rec.name, m.from, want, m.name, got || 'none'));
		}
		if (m.type && m.kind === 'field') {
			for (const one of (Array.isArray(m.type) ? m.type : [m.type]))
				if (!TYPE_REF[one] && !ifaces.has(one)) throw new SyntaxError(wording('IMPLEMENTS_BAD_TYPE', rec.name, one));
			typed.push({ name: m.name, type: m.type });
		}
	}
	return typed.length ? typed : null;
}

const GOTO_REG = { lvl: new Map(), frame: null };

function gotoLabel(lvl) {
	if (!GOTO_REG.lvl.has(lvl)) GOTO_REG.lvl.set(lvl, { L: reg('label'), S: reg('label') });
	return GOTO_REG.lvl.get(lvl);
}

function gotoFrame() { return GOTO_REG.frame || (GOTO_REG.frame = reg('label')); }
const GOTO_ASM = {
	JUMP:  (lvl, st, y) => `{ ${gotoLabel(lvl).S} = ${JSON.stringify(st)}; ${y ? 'yield; ' : ''}continue ${gotoLabel(lvl).L}; }`,
	EXIT:  (lvl, st, y) => `{ ${y ? 'yield; ' : ''}break ${gotoLabel(lvl).L}; }`,
	FRAME: (lvl, st, y) => `{ ${y ? 'yield; ' : ''}continue ${gotoFrame()}; }`,
};
const GOTO_ACT = {

	this:     { op: 'JUMP', at: (h) => h },
	continue: { op: 'JUMP', at: (h) => h.sibs[h.idx + 1] || null, fallback: 'EXIT' },
	break:    { op: 'EXIT', at: (h) => h },
	return:   { op: 'EXIT', at: (h) => { while (h.parent) h = h.parent; return h; } },
	void:     'return',
};
const GOTO_TGT = {
	super: { home: (node) => node.parent, orFrame: true },
	this:  { home: (node) => node },

};
const GOTO_ACTS = new Set(Object.keys(GOTO_ACT));

function gotoTree(body) {
	const info = ownTokens(body);
	if (!info) return null;
	const { t, own } = info;
	const pos = new Map(own.map((v, k) => [v, k]));
	const out = [];
	let k = 0;
	while (k < own.length) {
		const i = own[k], j = own[k + 1], b = own[k + 2];
		if (t[i] && t[i].w && !GOTO_ACTS.has(t[i].w) && t[j] && t[j].c === ':' && t[b] && t[b].c === '{') {
			const close = matchPair(t, b);
			if (close < 0) return null;
			const inner = body.slice(t[b].e, t[close].s);
			out.push({ name: t[i].w, s: t[i].s, bs: t[b].e, be: t[close].s, e: t[close].e,
			           text: inner, kids: gotoTree(inner) || [] });
			const nk = pos.get(close);
			if (nk === undefined) return null;
			k = nk + 1;
			continue;
		}
		k++;
	}
	return out.length ? out : null;
}

function gotoIndex(tree, level, parent, sink) {
	tree.forEach((n, i) => {
		n.level = level; n.parent = parent; n.sibs = tree; n.idx = i;
		sink.set(n.name, n);
		if (n.kids.length) gotoIndex(n.kids, level + 1, n, sink);
	});
	return sink;
}

function gotoJump(node, act, target, index, susp, ctx) {

	let A = GOTO_ACT[act];
	while (typeof A === 'string') A = GOTO_ACT[A];
	if (!A) return { err: `'${act}' is not a goto action` };
	let home = node;
	if (target) {
		const T = GOTO_TGT[target];
		if (T) {
			home = T.home(node);
			if (!home) {
				if (T.orFrame) { if (ctx) ctx.fn = true; return { text: GOTO_ASM.FRAME(0, null, susp) }; }
				return { err: `'${target}' has no referent here` };
			}
		} else {
			home = index.get(target);
			if (!home) return { err: `'${target}' is not a label here` };
		}
	}
	const at = A.at(home);
	if (!at) return { text: GOTO_ASM[A.fallback || 'EXIT'](home.level, null, susp) };
	return { text: GOTO_ASM[A.op](at.level, at.name, susp) };
}

function gotoRewrite(text, node, index, ctx) {
	const info = ownTokens(text);
	if (!info) return null;
	const { t, own } = info;
	const edits = [];
	let ends = null, err = null;
	for (let k = 0; k < own.length; k++) {
		const i = own[k], w = t[i].w;
		if (w === 'return' || w === 'throw') { ends = w; continue; }
		if (w !== 'goto') continue;
		let p = k + 1, susp = false, act = 'this', target = null;
		if (t[own[p]] && t[own[p]].w === 'yield') { susp = true; p++; }
		const a = t[own[p]] && t[own[p]].w;
		if (a && GOTO_ACTS.has(a)) { act = a; p++; }
		const tw = t[own[p]] && t[own[p]].w;
		if (tw) { target = tw; p++; }
		const last = t[own[p - 1]];
		const r = gotoJump(node, act, target, index, susp, ctx);
		if (r.err) { err = r.err; break; }
		edits.push({ s: t[i].s, e: last.e, text: r.fn ? `{ ${susp ? 'yield; ' : ''}continue ${gotoFrame()}; }` : r.text });
		ends = 'goto';
	}
	if (err) return { err };
	return { out: splice(text, edits), ends };
}

function gotoEmit(nodes, index, ctx) {
	const level = nodes[0].level;
	const cases = [];
	for (const n of nodes) {
		let body;
		if (n.kids.length) {
			const pre = n.text.slice(0, n.kids[0].s);
			const post = n.text.slice(n.kids[n.kids.length - 1].e);
			const rp = gotoRewrite(pre, n, index, ctx), rq = gotoRewrite(post, n, index, ctx);
			if (!rp || rp.err) throw new SyntaxError(wording('GOTO_PARSE', '', n.name, rp && rp.err));
			if (!rq || rq.err) throw new SyntaxError(wording('GOTO_PARSE', '', n.name, rq && rq.err));
			body = rp.out + '\n' + gotoEmit(n.kids, index, ctx) + '\n' + rq.out;
			if (!rq.ends) throw new SyntaxError(wording('GOTO_NO_TERMINATOR', n.name));
		} else {
			const r = gotoRewrite(n.text, n, index, ctx);
			if (!r || r.err) throw new SyntaxError(wording('GOTO_PARSE', 'block ', n.name, r && r.err));
			if (!r.ends) throw new SyntaxError(wording('GOTO_NO_TERMINATOR', n.name));
			body = r.out;
		}
		cases.push(`case ${JSON.stringify(n.name)}: {${body}}`);
	}
	return `let ${gotoLabel(level).S} = ${JSON.stringify(nodes[0].name)};\n${gotoLabel(level).L}: while (true) { switch (${gotoLabel(level).S}) {\n` +
		cases.join('\n') + `\n} }`;
}

function gotoWrap(text) {
	GOTO_REG.lvl.clear(); GOTO_REG.frame = null;
	const open = text.indexOf('{');
	if (open < 0) return text;
	const t = lexOr(text.slice(open)); if (!t) return text;
	const close = matchPair(t, 0);
	if (close < 0) return text;
	const body = text.slice(open + 1, open + t[close].s);
	const tree = gotoTree(body);
	if (!tree) return text;
	const info = ownTokens(body);
	if (!info || !info.own.some(i => info.t[i].w === 'goto')) return text;

	const yields = info.own.some(i => info.t[i].w === 'goto' && info.t[i + 1] && info.t[i + 1].w === 'yield');
	if (yields) {
		const h = lexOr(text.slice(0, open)) ?? [];
		const isGen = h.some(k => k.c === '*');
		if (!isGen) throw new SyntaxError(wording('GOTO_YIELD_NEEDS_GENERATOR'));
	}
	const index = gotoIndex(tree, 0, null, new Map());
	const names = [...index.keys()];
	if (names.length !== new Set(names).size) throw new SyntaxError(wording('GOTO_DUPLICATE_LABEL'));
	const pre = body.slice(0, tree[0].s), post = body.slice(tree[tree.length - 1].e);
	const ctx = { fn: false };
	const machine = gotoEmit(tree, index, ctx);

	return text.slice(0, open + 1) +
		(ctx.fn ? gotoFrame() + ': while (true) {\n' : '') + pre + '\n' + machine + '\n' + post +
		(ctx.fn ? '\nbreak ' + gotoFrame() + ';\n}\n' : '') + text.slice(open + 1 + body.length);
}

function skipFn(t, i, text) {

	if (t[i].w === 'function') {
		while (i < t.length && t[i].c !== '{') { if (t[i].c === '(') { const c = matchPair(t, i); if (c < 0) return i + 1; i = c; } i++; }
		const c = matchPair(t, i); return c < 0 ? t.length : c + 1;
	}
	if (t[i].c === '=>' || t[i].w === 'yield') {
		if (t[i].c === '=>' && t[i + 1] && t[i + 1].c === '{') { const c = matchPair(t, i + 1); return c < 0 ? t.length : c + 1; }
		let d = 0, q = 0, k = i + 1;
		for (; k < t.length; k++) {
			const c = t[k].c, p = t[k - 1];
			if (t[k].lit === '`') {
				const raw = text.slice(t[k].s, t[k].e);
				if (raw[0] === '}') { if (d === 0) return k; d--; }
				if (raw.endsWith('${')) d++;
				continue;
			}
			if (c === '(' || c === '[' || c === '{') { d++; continue; }
			if (c === ')' || c === ']' || c === '}') { if (d === 0) return k; d--; continue; }
			if (d > 0) continue;
			if (c === ',' || c === ';' || (c === ':' && q-- === 0)) return k;
			if (c === '?') q++;
			else if (k > i + 1 && t[k].w !== undefined && t[k].w !== 'in' && t[k].w !== 'instanceof' &&
			    /\n/.test(text.slice(p.e, t[k].s)) && (p.num || p.lit || /^[)\]}]$/.test(p.c || '') ||
			    (p.w !== undefined && (!TLA_OPERAND.has(p.w) || /^\??\.$/.test((t[k - 2] || {}).c || ''))))) return k;
		}
		return k;
	}
	return i + 1;
}

function isName(t, i, text) {
	const p = t[i - 1], n = t[i + 1];
	if ((p && /^\??\.$/.test(p.c || '')) || (n && n.c === ':')) return true;
	if (!n || n.c !== '(') return false;
	const c = matchPair(t, i + 1), b = c < 0 ? null : t[c + 1];
	return !!b && b.c === '{' && !/\n/.test(text.slice(t[c].e, b.s));
}

function ownTokens(text) {

	const t = lexOr(text); if (!t) return null;
	const own = [], bodies = new Set();
	for (let i = 0; i < t.length; ) {
		const k = t[i], p = t[i - 1], prop = !!p && /^\??\.$/.test(p.c || '');
		if (bodies.has(i)) { const c = matchPair(t, i); i = c < 0 ? t.length : c + 1; continue; }

		if ((k.w === 'function' && !prop && !(t[i + 1] && t[i + 1].c === ':')) || k.c === '=>') { i = skipFn(t, i, text); continue; }

		if (k.c === '(' && p && (p.w || p.c === ']' || p.lit || p.num) && !TLA_BLOCK_HEADS.has(p.w) &&
		    !(p.w === 'await' && t[i - 2] && t[i - 2].w === 'for')) {
			const c = matchPair(t, i), b = c < 0 ? null : t[c + 1];
			if (b && b.c === '{' && !/\n/.test(text.slice(t[c].e, b.s))) { const e = matchPair(t, c + 1); i = e < 0 ? t.length : e + 1; continue; }
		}

		if (k.w === 'class' && !prop && !/^[(=:;,})\]]$/.test((t[i + 1] || {}).c || '')) {
			let j = i + 1;
			while (j < t.length && t[j].c !== '{') { if (t[j].c === '(' || t[j].c === '[') { const c = matchPair(t, j); if (c < 0) break; j = c; } j++; }
			bodies.add(j);
		}
		own.push(i); i++;
	}
	return { t, own };
}

function settleText(text, emits) {
	const nl = (a, b) => /\n/.test(text.slice(a.e, b.s));
	if (emits) {
		const own = ownTokens(text); if (!own) return text;
		const t = own.t, edits = [];
		for (const x of own.own) {
			const k = t[x], n = t[x + 1];
			if (k.w !== 'yield' || isName(t, x, text) || (n && n.w === 'super')) continue;
			const star = !!n && n.c === '*', o = star ? x + 2 : x + 1;

			if (!star && (!t[o] || /^[;,)\]}:]$/.test(t[o].c || '') || nl(k, t[o]))) { edits.push({ s: k.s, e: k.e, text: rt('emit') + '(this, undefined)' }); continue; }
			if (!t[o]) continue;
			const last = t[skipFn(t, x, text) - 1];
			edits.push({ s: k.s, e: t[o].s, text: star ? 'yield* ' + rt('drain') + '(' : rt('emit') + '(this, ' });
			edits.push({ s: last.e, e: last.e, text: star ? ', _ => ' + rt('emit') + '(this, _))' : ')' });
		}
		if (edits.length) text = splice(text, edits);
	}

	for (let guard = 0; guard < 100; guard++) {
		const own = ownTokens(text); if (!own) return text;
		const t = own.t, x = own.own.find(i => t[i].w === 'for' && t[i + 1] && t[i + 1].w === 'await' && t[i + 2] && t[i + 2].c === '(');
		if (x === undefined) break;
		const pc = matchPair(t, x + 2); if (pc < 0 || !t[pc + 1]) break;

		let d = 0, of = -1;
		for (let i = x + 3; i < pc && of < 0; i++) {
			if (/^[([{]$/.test(t[i].c || '')) d++;
			else if (/^[)\]}]$/.test(t[i].c || '')) d--;
			else if (d === 0 && t[i].w === 'of' && i > x + 3 && !/^(?:const|let|var)$/.test(t[i - 1].w || '')) of = i;
		}
		if (of < 0) break;

		let up = -1;
		for (let i = x - 1, dd = 0; i >= 0 && up < 0; i--) {
			if (/^[)\]}]$/.test(t[i].c || '')) dd++;
			else if (/^[([{]$/.test(t[i].c || '')) { if (dd === 0) up = i; else dd--; }
		}
		const close = up < 0 ? -1 : matchPair(t, up);
		const sts = statementsOf(text.slice(t[x].s, close < 0 ? text.length : t[close].s));
		if (!sts || !sts.stmts.length) break;
		const endAt = t[x].s + sts.t[sts.stmts[0].e].e;

		const label = x >= 2 && t[x - 1].c === ':' && t[x - 2].w && t[x - 2].w !== 'default' &&
			!(t[x - 3] && (t[x - 3].w === 'case' || /^\??\.$/.test(t[x - 3].c || ''))) ? x - 2 : -1;
		const head = text.slice(t[x + 3].s, t[of - 1].e), src = text.slice(t[of + 1].s, t[pc - 1].e);
		const name = (lexOr(head) || []).filter(k => k.w && !/^(?:const|let|var|this)$/.test(k.w)).map(k => k.w)[0] || '';
		const I = reg('iterator', name), V = reg('value', name), S = reg('transient');

		const loop = '{ const ' + I + ' = (async function* (' + S + ') { yield* ' + S + '; })(' + src + '); let ' + V + '; ' +
			'try { ' + (label >= 0 ? text.slice(t[label].s, t[label + 1].e) + ' ' : '') +
			'while (!(' + V + ' = yield ' + I + '.next()).done) { ' + head + ' = ' + V + '.value; ' + text.slice(t[pc + 1].s, endAt) + ' } } ' +
			'finally { if (' + V + ' && !' + V + '.done) yield ' + I + '.return(); } }';
		text = text.slice(0, t[label >= 0 ? label : x].s) + loop + text.slice(endAt);
	}
	const own = ownTokens(text); if (!own) return text;
	const t = own.t, edits = [];

	const before = p => /^(?:[;{}()[,?:]|=>|\.\.\.|(?:[-+*/%&|^]|\*\*|<<|>>>?|&&|\|\||\?\?)?=)$/.test(p.c || '') ||
		(p.lit === '`' && text.slice(p.s, p.e).endsWith('${')) || /^(?:return|throw|case|yield|else|do|of)$/.test(p.w || '');

	const ends = i => {
		const p = t[i];
		if (p.c === ')') {
			let q = i;
			for (let dd = 0; q >= 0; q--) { if (/^[)\]}]$/.test(t[q].c || '')) dd++; else if (/^[([{]$/.test(t[q].c || '') && --dd === 0) break; }
			const h = t[q - 1] || {};
			return !(TLA_BLOCK_HEADS.has(h.w) || (h.w === 'await' && (t[q - 2] || {}).w === 'for'));
		}
		return !!(p.num || p.c === ']' || p.c === '}' || (p.lit && !(p.lit === '`' && text.slice(p.s, p.e).endsWith('${'))) ||
			(p.w && (!TLA_OPERAND.has(p.w) || (i > 0 && /^\??\.$/.test(t[i - 1].c || '')))));
	};
	for (const x of own.own) {
		const k = t[x], p = t[x - 1], n = t[x + 1];
		if (k.w !== 'await' || !n || isName(t, x, text) || (p && p.w === 'for')) continue;
		const len = unaryOperand(text.slice(k.s)); if (len === null) continue;
		const ai = t.findIndex(q => q.s >= k.s + len), last = t[(ai < 0 ? t.length : ai) - 1], after = ai < 0 ? null : t[ai];
		const asi = !!p && nl(p, k) && ends(x - 1);
		const whole = (!p || asi || before(p)) &&
			(!after || /^[;)\]},:]$/.test(after.c || '') || (after.lit === '`' && text[after.s] === '}') ||
			 (nl(last, after) && ((after.w && !/^(?:in|instanceof)$/.test(after.w)) || after.num || (after.lit && after.lit !== '`'))));
		const gap = /^\s*/.exec(text.slice(k.e))[0].length;
		edits.push({ s: k.s, e: k.e + gap, text: (whole ? '' : asi ? ';(' : '(') + 'yield' + (gap || n.c !== '(' ? ' ' : '') });
		if (!whole) edits.push({ s: last.e, e: last.e, text: ')' });
	}
	return edits.length ? splice(text, edits) : text;
}

const REG_KIND = {
	transient: 'tmp', value: 'value', array: 'array', label: 'label',
	static: 'static', error: 'error', iterator: 'iterator', gate: 'defer', join: 'defer',

	batch: 'batch',
};
let ANON_N = 0;
const REG_BY_KEY = new Map(), REG_SEEN = new Map();

function regFor(key, kind, name) {
	if (!REG_BY_KEY.has(key)) REG_BY_KEY.set(key, reg(kind, name));
	return REG_BY_KEY.get(key);
}

function reg(kind, name) {
	const word = REG_KIND[kind];
	if (word === undefined) throw new Error('reg: unknown register kind ' + kind);

	const tag = name ? String(name).replace(/^[@&?]+/, '').replace(/[^\p{ID_Continue}$]/gu, '') : '';
	const base = '\u00f8' + word + (tag ? '_' + tag : '');
	const seen = REG_SEEN.get(base) || 0;
	REG_SEEN.set(base, seen + 1);
	if (!tag) return base + seen;
	return seen === 0 ? base : base + '_' + (seen + 1);
}

function blockInit(text, whole) {
	const L = leading(text);
	if (!L.t) return null;

	const isDo = L.kws[0] === 'do', isTry = L.kws[isDo ? 1 : 0] === 'try', isAwait = L.has('await');
	const first = L.t.find(k => k.s >= L.at);
	const braced = first && first.c === '{';
	if (!isTry && !isDo) {
		if (L.kws[0] === 'await' && braced) throw new SyntaxError(wording('BLOCK_NEEDS_DO_AWAIT'));
		return null;
	}
	if (isDo && !braced) throw new SyntaxError(wording('DO_TAKES_BLOCK_LOCAL', isTry, isAwait, L.opd));
	const pfx = isAwait ? 'await ' : '';
	if (!braced) {
		const rest = L.opd;
		if (!rest) throw new SyntaxError(wording('TRY_NEEDS_OPERAND'));
		if (first && (first.w === 'catch' || first.w === 'finally')) throw new SyntaxError(wording('CLAUSE_NEEDS_BLOCK_LOCAL', pfx, '\u2026', 'catch (e) { \u2026 }'));
		if (whole) return { body: pfx + rest, tail: '', cat: null, fin: null, bare: true };
		const split = unaryOperand(rest);
		if (split === null) return null;
		const opd = rest.slice(0, split).trim(), tail = rest.slice(split).trim();
		const tt = leading(tail);
		if (tt.t && tt.t.some(k => k.w === 'catch' || k.w === 'finally')) throw new SyntaxError(wording('CLAUSE_NEEDS_BLOCK_LOCAL', pfx, opd, tail));
		return { body: pfx + opd, tail, cat: null, fin: null, bare: true };
	}

	const open = first.s;
	const ti = L.t.indexOf(first);
	const cl = matchPair(L.t, ti);
	if (cl < 0) return null;
	const close = L.t[cl].e;
	let cat = null, fin = null, k = cl + 1;
	const clause = (kw) => {
		if (!L.t[k] || L.t[k].w !== kw) return null;
		k++;
		let param = '';
		if (L.t[k] && L.t[k].c === '(') { const c = matchPair(L.t, k); param = text.slice(L.t[k].s, L.t[c].e); k = c + 1; }
		if (!L.t[k] || L.t[k].c !== '{') return null;
		const c2 = matchPair(L.t, k);
		if (c2 < 0) return null;
		const body = text.slice(L.t[k].s, L.t[c2].e);
		k = c2 + 1;
		return { param, body };
	};
	cat = clause('catch');
	fin = clause('finally');
	const tail = L.t[k] ? text.slice(L.t[k].s).trim() : '';
	if (isDo && !isTry && (cat || fin)) throw new SyntaxError(wording('CLAUSE_NEEDS_TRY_LOCAL', pfx, text.slice(open)));
	if (isDo && tail) throw new SyntaxError(wording('AFTER_BLOCK_LOCAL', tail));
	return { body: text.slice(open + 1, close - 1), tail, cat, fin, doBlock: isDo, hard: isDo && !isTry, autoAwait: isDo && isAwait };
}
const ASI_CONTINUES = new Set(['instanceof', 'in', 'catch', 'finally', 'else', 'as', 'or']);
const ASI_OPENS = new Set(['await', 'yield', 'new', 'typeof', 'void', 'delete', 'return', 'try']);

function fieldNeedsASI(spans, from, to, code) {
	let d = 0;
	for (let i = from; i < to; i++) {
		const c = spans[i].c;
		if (c === '(' || c === '[' || c === '{') { d++; continue; }
		if (c === ')' || c === ']' || c === '}') { d--; continue; }
		if (d > 0 || i === from) continue;
		const prevTok = spans[i - 1];
		if (!prevTok) continue;

		if (!/\n/.test(code.slice(prevTok.e, spans[i].s))) continue;

		if (!(prevTok.w || prevTok.num || prevTok.lit ||
		      prevTok.c === ')' || prevTok.c === ']' || prevTok.c === '}')) continue;
		if (prevTok.w && ASI_OPENS.has(prevTok.w)) continue;

		if (spans[i].w && ASI_CONTINUES.has(spans[i].w)) continue;
		if (!spans[i].w && c !== ';') continue;
		if (c === ';') return -1;

		const nx = spans[i + 1];
		if (nx && (nx.c === '=' || nx.c === '(' || nx.w || nx.c === '[')) return i;
	}
	return -1;
}

function patternTargets(text) {
	const t = lexOr(text); if (!t) return null;
	const names = [], edits = [];
	let d = 0;
	const stack = [];
	for (let i = 0; i < t.length; i++) {
		const c = t[i].c, w = t[i].w;
		if (c === '{' || c === '[') { stack.push(c === '['); d++; continue; }
		if (c === '}' || c === ']') { stack.pop(); d--; continue; }
		if (!w) continue;
		const nx = t[i + 1], pv = t[i - 1];
		if (pv && pv.c === ':') continue;
		if (nx && nx.c === ':') {
			const al = t[i + 2];
			if (al && al.w) { names.push(al.w); edits.push({ s: al.s, e: al.e, text: 'this.' + al.w }); i += 2; }
			continue;
		}

		names.push(w);
		edits.push({ s: t[i].s, e: t[i].e, text: stack[stack.length - 1] ? 'this.' + w : w + ': this.' + w });
	}
	if (!names.length) return null;
	return { names, target: splice(text, edits) };
}

function unaryOperand(text) {
	const t = lexOr(text); if (!t || !t.length) return null;

	const tpl = i => {
		let d = 0;
		do {
			if (t[i].lit === '`') { const raw = text.slice(t[i].s, t[i].e); if (raw[0] === '}') d--; if (raw.endsWith('${')) d++; }
			i++;
		} while (d > 0 && i < t.length);
		return i;
	};
	let i = 0;

	while (t[i] && (/^(?:await|void|typeof|delete|try)$/.test(t[i].w || '') || /^[!~+-]$/.test(t[i].c || ''))) i++;
	while (t[i] && t[i].w === 'new') i++;
	if (!t[i]) return null;
	if (t[i].c === '(' || t[i].c === '[' || t[i].c === '{') { const c = matchPair(t, i); if (c < 0) return null; i = c + 1; }
	else if (t[i].lit === '`') i = tpl(i);
	else if (t[i].w || t[i].num || t[i].lit) i++;
	else return null;
	while (i < t.length) {
		const c = t[i].c, n = t[i + 1];
		if ((c === '.' || c === '?.') && n && n.w) { i += 2; continue; }
		if (c === '?.' && n && (n.c === '(' || n.c === '[')) { i++; continue; }
		if (c === '(' || c === '[') { const m = matchPair(t, i); if (m < 0) break; i = m + 1; continue; }
		if (t[i].lit === '`') { i = tpl(i); continue; }
		break;
	}
	return i >= t.length ? text.length : t[i].s;
}

const DO_GRAIN = { grain: 'operand' };

function doAwait(text) {
	if (!DO_GRAIN.grain) return text;
	const r = statementsOf(text); if (!r) return text;
	const { t, stmts } = r;
	const edits = [];
	const PFX = new Set(['!', '~', '+', '-']), PFX_W = new Set(['typeof', 'void', 'delete', 'await']);
	const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^=', '&&=', '||=', '??=']);
	const BIN = new Set(['+', '-', '*', '/', '%', '**', '==', '!=', '===', '!==', '<', '>', '<=', '>=', '&&', '||', '??', '&', '|', '^', '<<', '>>', '>>>', '?', ':', ',']);
	const STILL = new Set(['this', 'super', 'true', 'false', 'null', 'undefined']);
	const name = i => i > 0 && /^\??\.$/.test(t[i - 1].c || '');

	const top = (a, b, fn) => {
		let d = 0, tpl = 0;
		for (let i = a; i < b; i++) {
			const k = t[i];
			if (k.lit === '`') { const raw = text.slice(k.s, k.e); if (raw[0] === '}') tpl--; if (raw.endsWith('${')) tpl++; continue; }
			if (tpl > 0) continue;
			if (/^[([{]$/.test(k.c || '')) { d++; continue; }
			if (/^[)\]}]$/.test(k.c || '')) { d--; continue; }
			if (d > 0) continue;
			if ((k.w === 'function' && !name(i)) || k.c === '=>') { i = skipFn(t, i, text) - 1; continue; }
			if (fn(i, k) === false) return;
		}
	};

	const find = (a, b, f) => { let at = -1; top(a, b, (i, k) => { if (f(i, k)) { at = i; return false; } }); return at; };

	const value = (a, b) => {
		let start = a;
		top(a, b, (i, k) => { if (ASSIGN.has(k.c || '')) start = i + 1; });
		if (start >= b) return;
		const w = t[start].w;
		if (w === 'function' || w === 'class' || w === 'yield' || (w === 'async' && t[start + 1] && (t[start + 1].w === 'function' || t[start + 1].c === '(' || (t[start + 1].w && t[start + 2] && t[start + 2].c === '=>')))) return;
		if (t[start].c === '=>' || find(start, b, (i, k) => k.c === '=>') >= 0 && find(start, b, (i, k) => BIN.has(k.c || '')) < 0) return;
		if (DO_GRAIN.grain === 'statement') {
			let p = start; while (p < b && (PFX.has(t[p].c || '') || PFX_W.has(t[p].w))) { if (t[p].w === 'await') return; p++; }
			if (p >= b) return;
			const one = unaryOperand(text.slice(t[p].s, t[b - 1].e)) === t[b - 1].e - t[p].s;
			if (one && (STILL.has(t[p].w) || (b - p === 1 && (t[p].num || t[p].lit)))) return;

			edits.push({ s: t[one ? p : start].s, e: t[one ? p : start].s, text: one ? 'await ' : 'await (' });
			if (!one) edits.push({ s: t[b - 1].e, e: t[b - 1].e, text: ')' });
			return;
		}
		let i = start;
		while (i < b) {
			let p = i, own = false;
			while (p < b && (PFX.has(t[p].c || '') || PFX_W.has(t[p].w))) { if (t[p].w === 'await') own = true; p++; }
			if (p >= b || t[p].c === '...' || t[p].c === '++' || t[p].c === '--') return;
			const len = unaryOperand(text.slice(t[p].s, t[b - 1].e)); if (len === null) return;
			const end = t[p].s + len;
			let q = p; while (q < b && t[q].s < end) q++;
			if (q < b && t[q].c === '=>') { i = skipFn(t, q, text); }
			else {
				const still = STILL.has(t[p].w) || (q === p + 1 && (t[p].num || t[p].lit)) || (q < b && (t[q].c === '++' || t[q].c === '--'));
				if (!own && !still) edits.push({ s: t[p].s, e: t[p].s, text: 'await ' });
				i = q;
			}
			if (i >= b) break;
			const k = t[i];
			if (BIN.has(k.c || '') || k.w === 'in' || k.w === 'instanceof' || k.c === '++' || k.c === '--') { i++; continue; }
			return;
		}
	};

	const declare = (a, b) => {
		let s = a;
		const one = (x, y) => { const eq = find(x, y, (i, k) => k.c === '='); if (eq >= 0) value(eq + 1, y); };
		top(a, b, (i, k) => { if (k.c === ',') { one(s, i); s = i + 1; } });
		one(s, b);
	};

	const inner = (a, b) => {
		if (a >= b) return;
		if (t[a].c === '{') { const c = matchPair(t, a); if (c > a + 1) edits.push({ s: t[a].e, e: t[c - 1].e, text: doAwait(text.slice(t[a].e, t[c - 1].e)) }); return; }
		edits.push({ s: t[a].s, e: t[b - 1].e, text: doAwait(text.slice(t[a].s, t[b - 1].e)) });
	};

	const paren = o => { const c = matchPair(t, o); return c < 0 ? -1 : c + 1; };
	const CTL = new Set(['if', 'while', 'with', 'switch']);
	const statement = (s, e) => {
		let h = s;
		while (t[h] && t[h].w && t[h + 1] && t[h + 1].c === ':' && h + 1 < e && !/^(?:case|default)$/.test(t[h].w)) h += 2;
		const k = t[h]; if (!k) return;
		let end = e + 1; if (t[e].c === ';' && e > h) end = e;
		if (k.c === ';' || k.c === '}') return;
		if (k.c === '{') return inner(h, end);
		const w = k.w;
		if (!w || name(h)) return value(h, end);
		if (w === 'case' || w === 'default') { const c = find(h + 1, end, (i, q) => q.c === ':'); if (c >= 0 && c + 1 < end) edits.push({ s: t[c + 1].s, e: t[end - 1].e, text: doAwait(text.slice(t[c + 1].s, t[end - 1].e)) }); return; }
		if (/^(?:function|class|throw|break|continue|debugger|import|export)$/.test(w) || (w === 'async' && t[h + 1] && t[h + 1].w === 'function')) return;
		if (w === 'return') return h + 1 < end ? value(h + 1, end) : undefined;
		if (w === 'const' || w === 'let' || w === 'var') return declare(h + 1, end);
		if (w === 'do') {
			let b = h + 1, be = find(h + 1, end, (i, q) => q.w === 'while' && (t[i - 1].c === '}' || t[i - 1].c === ';'));
			if (be < 0) return;
			inner(b, be);
			if (t[be + 1] && t[be + 1].c === '(') { const c = paren(be + 1); if (c > 0) value(be + 2, c - 1); }
			return;
		}
		if (w === 'try') {
			let p = h + 1;
			while (p < end && t[p]) {
				if (t[p].c === '{') { const c = matchPair(t, p); if (c < 0) return; inner(p, c + 1); p = c + 1; continue; }
				if (t[p].w === 'catch' || t[p].w === 'finally') { p++; if (t[p] && t[p].c === '(') { const c = paren(p); if (c < 0) return; p = c; } continue; }
				return;
			}
			return;
		}
		if (w === 'for') {
			let o = h + 1; if (t[o] && t[o].w === 'await') o++;
			if (!t[o] || t[o].c !== '(') return;
			const close = paren(o) - 1; if (close < 0) return;
			const of = find(o + 1, close, (i, q) => (q.w === 'of' || q.w === 'in') && i > o + 1 && !/^(?:const|let|var)$/.test(t[i - 1].w || ''));
			if (of >= 0) value(of + 1, close);
			else {
				const semis = []; top(o + 1, close, (i, q) => { if (q.c === ';') semis.push(i); });
				if (semis.length === 2) {
					const d = t[o + 1];
					if (d && /^(?:const|let|var)$/.test(d.w || '')) declare(o + 2, semis[0]); else value(o + 1, semis[0]);
					value(semis[0] + 1, semis[1]);
				}
			}
			return inner(close + 1, end);
		}
		if (CTL.has(w)) {
			if (!t[h + 1] || t[h + 1].c !== '(') return;
			const close = paren(h + 1) - 1; if (close < 0) return;
			value(h + 2, close);
			if (w === 'switch') { if (t[close + 1] && t[close + 1].c === '{') inner(close + 1, end); return; }

			let b = close + 1, be = b;
			if (t[b] && t[b].c === '{') be = matchPair(t, b) + 1;
			else { be = find(b, end, (i, q) => q.w === 'else' && i > b); if (be < 0) be = end; }
			inner(b, be);
			if (t[be] && t[be].w === 'else' && be < end) {
				if (t[be + 1] && t[be + 1].w === 'if') statement(be + 1, end - 1); else inner(be + 1, end);
			}
			return;
		}
		return value(h, end);
	};
	for (const st of stmts) statement(st.s, st.e);
	return edits.length ? splice(text, edits) : text;
}

function labelledBlock(soft, ctx) {
	let { body, tail, cat, fin, bare } = soft;
	const { id, name, noYield } = ctx;

	const autoReturn = txt => {
		const r = statementsOf(txt), o = ownTokens(txt); if (!r || !o || r.stmts.length < 2) return txt;
		if (o.own.some(i => o.t[i].w === 'return' && !isName(o.t, i, txt))) return txt;
		const st = r.stmts[r.stmts.length - 1], t = r.t;
		let h = st.s; while (t[h] && t[h].w && t[h + 1] && t[h + 1].c === ':' && h + 1 < st.e) h += 2;
		const k = t[h]; if (!k || k.c === '{' || k.c === ';' || k.c === '}') return txt;
		if (k.w && !/^\??\.$/.test((t[h - 1] || {}).c || '') && /^(?:if|for|while|do|switch|try|const|let|var|function|class|throw|break|continue|debugger|async|case|default|yield)$/.test(k.w) &&
		    !(k.w === 'async' && !(t[h + 1] && t[h + 1].w === 'function'))) return txt;
		return txt.slice(0, k.s) + 'return ' + txt.slice(k.s);
	};
	if (soft.doBlock) {
		const prep = txt => { let x = name ? autoReturn(txt) : txt; return soft.autoAwait ? doAwait(x) : x; };
		body = prep(body);
		if (cat) cat = { param: cat.param, body: '{' + prep(cat.body.slice(1, -1)) + '}' };
		if (fin && soft.autoAwait) fin = { body: '{' + doAwait(fin.body.slice(1, -1)) + '}' };
	}
	const hard = !!soft.hard;

	const expr = x => { const y = 'yield ' + x, t = lexOr(y); return t && skipFn(t, 0, y) >= t.length ? x : '(' + x + ')'; };

	const settled = x => 'yield ' + rhs(expr(x));
	if (bare) {
		const V = reg('value', name), B = reg('label', name);

		const handler = cat ? `catch ${cat.param || '(e)'} ${cat.body}` : 'catch (e) {}';
		return [`try { ${B}: { var ${V} = ${noYield ? body : settled(body)}; } } ${handler}`,
			`this.${name} = ${V}${tail ? ' ' + tail : ''};`];
	}

	const text = noYield ? body : settleText(body);
	const info = ownTokens(text);
	if (!info) return null;
	const { t, own } = info;
	const V = name ? reg('value', name) : null, B = reg('label', name);

	let decl = 'var ';
	const put = () => { const d = decl; decl = ''; return d + V; };
	const edits = [];
	for (const i of own) {
		if (t[i].w !== 'return' || isName(t, i, text)) continue;
		let k = i + 1, d = 0, end = text.length;
		for (; k < t.length; k++) {
			const c = t[k].c;
			if (c === '(' || c === '[' || c === '{') d++;
			else if (c === ')' || c === ']' || c === '}') { if (d === 0) { end = t[k].s; break; } d--; }
			else if (c === ';' && d === 0) { end = t[k].s; break; }
		}
		while (end > t[i].e && /\s/.test(text[end - 1])) end--;
		const empty = text.slice(t[i].e, end).trim() === '' || !name;
		const wrap = !empty && expr(text.slice(t[i].e, end).trim()) !== text.slice(t[i].e, end).trim();
		edits.push({ s: t[i].s, e: t[i].e, text: empty ? `{ break ${B}` : `{ ${put()} =${wrap ? ' (' : ''}` });
		edits.push({ s: end, e: end, text: empty ? ' }' : `${wrap ? ')' : ''}; break ${B}; }` });
	}
	let out = splice(text, edits);

	if (!name) {
		const stmts = `${B}: {${out}}`;
		if (hard) return [stmts];
		let h = 'catch (e) {}';
		if (cat) h = `catch ${cat.param || '(e)'} {${noYield ? cat.body.slice(1, -1) : settleText(cat.body.slice(1, -1))}}`;
		return [`try { ${stmts} } ${h}${fin ? ' finally {' + (noYield ? fin.body.slice(1, -1) : settleText(fin.body.slice(1, -1))) + '}' : ''}`];
	}

	const one = s => { const r = statementsOf(s); return !!r && r.stmts.length === 1; };
	const hasReturn = own.some(i => t[i].w === 'return' && !isName(t, i, text));
	if (!hasReturn) {
		const first = own.find(i => t[i].w || t[i].c);
		const labelish = first !== undefined && t[first].w && t[own[own.indexOf(first) + 1]] && t[own[own.indexOf(first) + 1]].c === ':';
		const blockish = first !== undefined && t[first].c === '{';
		const simple = one(text) && !labelish && !blockish &&
			!own.some(i => ['const', 'let', 'var', 'if', 'for', 'while', 'switch', 'try', 'do'].includes(t[i].w));

		if (simple) {
			const orig = body.trim().replace(/;\s*$/, '');

			const val = noYield ? expr(orig) : soft.autoAwait ? expr(settleText(orig)) : settled(orig);
			if (hard) return [`this.${name} = ${val};`];
			out = `${put()} = ${val}`;
		}
	}

	if (hard) return [`${decl ? `var ${V}; ` : ''}${B}: {${out}}`, `this.${name} = ${V};`];

	let handler = 'catch (e) {}';
	if (cat) {
		const inner = noYield ? cat.body.slice(1, -1) : settleText(cat.body.slice(1, -1));
		const ci = ownTokens(inner);
		let cb = inner;
		if (ci) {
			const ce = [];
			for (const i of ci.own) {
				if (ci.t[i].w !== 'return' || isName(ci.t, i, inner)) continue;
				let k = ci.own.indexOf(i) + 1, d = 0, end = inner.length;
				for (let q = i + 1; q < ci.t.length; q++) {
					const c = ci.t[q].c;
					if (c === '(' || c === '[' || c === '{') d++;
					else if (c === ')' || c === ']' || c === '}') { if (d === 0) { end = ci.t[q].s; break; } d--; }
					else if (c === ';' && d === 0) { end = ci.t[q].s; break; }
				}
				const empty = inner.slice(ci.t[i].e, end).trim() === '';
				ce.push({ s: ci.t[i].s, e: ci.t[i].e, text: empty ? '{' : `{ ${put()} =` });
				ce.push({ s: end, e: end, text: ' }' });
			}
			cb = splice(cb, ce);
			if (!ce.length) {
				const simple = ci.own.length > 0 && one(inner) &&
					!ci.own.some(i => ['const','let','var','if','for','while','switch','try','do','throw'].includes(ci.t[i].w));
				if (simple && inner.trim()) cb = `${put()} = ${inner.trim().replace(/;\s*$/, '')}`;
			}
		}
		handler = `catch ${cat.param || '(e)'} {${cb}}`;
	}
	let finBody = fin && fin.body;
	if (finBody && !noYield) finBody = '{' + settleText(finBody.slice(1, -1)) + '}';

	return [`try { ${decl ? `var ${V}; ` : ''}${B}: {${out}} } ${handler}${finBody ? ' finally ' + finBody : ''}`,
		`this.${name} = ${V}${tail ? ' ' + tail : ''};`];
}
const LEAD_KW = new Set(['do', 'try', 'await', 'yield', 'for', 'defer']);

function leading(text) {
	const t = lexOr(String(text)); if (!t) return { t: null, kws: [], at: 0, opd: String(text) };
	const kws = [];
	let i = 0;
	while (t[i] && t[i].w && LEAD_KW.has(t[i].w)) { kws.push(t[i].w); i++; }
	const at = t[i] ? t[i].s : String(text).length;
	return { t, kws, at, opd: String(text).slice(at).trim(), has: (k) => kws.includes(k) };
}

function hasAwait(text, w = 'await') {
	const s = String(text), o = ownTokens(s);
	return !!o && o.own.some(i => o.t[i].w === w && !isName(o.t, i, s));
}

function rhs(v) {
	const text = String(v), L = leading(text);
	if (L.kws[0] === 'yield') return L.opd;

	if (L.t && L.t.length > 1 && L.t[0].w === 'await' && unaryOperand(text) === text.length) {
		const bare = L.kws[0] === 'await' ? L.opd : text;
		if (!hasAwait(bare)) return bare;
	}
	if (!hasAwait(text)) return text;
	const a = '=> ' + text, t = lexOr(a), whole = !!t && t[1] && t[1].c !== '{' && skipFn(t, 0, a) >= t.length;
	return `(async () => ${whole ? text : '(' + text + ')'})()`;
}

function isBind(t) { return !!t && (t.c === '=' || t.w === 'as'); }

function src(v, unwrap) {
	const raw = String(v).trim(), L = leading(raw);
	if (L.kws[0] === 'await' && L.kws[1] === 'for') throw new SyntaxError(wording('AWAIT_FOR_NOT_A_FORM', L.opd));

	if (L.kws[0] === 'await' || unwrap) return '(yield ' + rhs(raw) + ')';
	return '(' + raw + ')';
}

const drainInto = (srcExpr, into) => `yield* ${rt('drain')}(${srcExpr}${into ? ', ' + into : ''})`;

const fanCall = (n, value, o, mode) => {
	const pattern = o && o.pattern;
	const args = [pattern ? `[${o.names.map(x => sq(emitName(x))).join(', ')}]` : sq(n), value];

	const words = [o && o.soft && 'try', mode].filter(Boolean).join(' ');
	if (words) args.push(sq(words));
	if (pattern) args.push(`_ => { (${pattern} = _${o.soft ? ' ?? ' + (/^\[/.test(pattern) ? '[]' : '{}') : ''}); }`);
	return `${rt('fan')}(this, ${args.join(', ')});`;
};

const batchBarrier = o => `yield ${rt('batch')}(this, ${o.batchRun.map(x => {
	const words = [x.soft && 'try', x.memo && 'indexed'].filter(Boolean).join(' ');
	return `[${sq(x.name)}, ${regFor(x.key, x.kind, x.name)}${words ? ', ' + sq(words) : ''}]`;
}).join(', ')});`;
const FIELD = [

	{ lc: 'sync',    susp: true,  comp: 'drain', slot: 'spine', mirror: true, tier: false,
		emit: (n, v, o) => `this.${n} = ${drainInto(src(v, o && o.unwrap), o && o.obj ? '{}' : '')};` },
	{ lc: 'sync',    susp: true,  comp: 'drain', slot: 'spine', mirror: true, tier: true,
		emit: (n, v, o) => `this.${n} = ${o && o.obj ? '{}' : '[]'}; ${drainInto(src(v, o && o.unwrap), 'this.' + n)};` },
	{ lc: 'sync',    susp: true,  comp: null,    slot: 'spine', mirror: true,
		emit: (n, v, o) => {
			const b = blockInit(o && o.soft ? 'try ' + String(v).trim() : String(v), o && o.soft);
			if (b) { const lines = labelledBlock(b, { id: o.at && o.at.s != null ? o.at.s : 0, name: n, noYield: false });
			         if (lines) return lines.join('\n'); }
			return `this.${n} = yield ${rhs(v)};`;
		} },

	{ lc: 'batch',   susp: true,  comp: null,    slot: 'spine', mirror: true,
		emit: (n, v, o) => {
			const reg = regFor('batch:' + o.at.s, 'batch', n);
			return [`const ${reg} = ${rhs(v)}; // @batch-start`, ...(o.batchLast ? [batchBarrier(o)] : [])].join('\n');
		} },
	{ lc: 'defer',   susp: true,  comp: null,    slot: 'acquire', mirror: true, bare: true,
		pre:  (n, v, o) => `const ${regFor('gate:' + o.at.s, 'gate')} = ${rhs(v)}; // @defer-start`,
		emit: (n, v, o) => o && o.soft
			? `try { yield ${regFor('gate:' + o.at.s, 'gate')}; } catch (e) {}`
			: `yield ${regFor('gate:' + o.at.s, 'gate')};` },
	{ lc: null,      susp: true,  comp: null,    slot: 'spine', mirror: true, bare: true,
		emit: (n, v, o) => {

			if (o && o.doBlock) { const b = blockInit(String(v), false); const lines = b && labelledBlock(b, { id: o.at && o.at.s != null ? o.at.s : 0, name: null, noYield: false }); if (lines) return lines.join('\n'); }
			return o && o.soft ? `try { yield ${rhs(v)}; } catch (e) {}` : `yield ${rhs(v)};`;
		} },

	{ lc: 'deferbatch', susp: true, comp: null, slot: 'acquire', mirror: true,
		pre:  (n, v, o) => `const ${regFor('join:' + n, 'join', n)} = ${rhs(v)}; // @defer-start`,
		emit: (n, v, o) => o.batchLast ? batchBarrier(o) : '' },

	{ lc: 'defer',   susp: true,  comp: null,    slot: 'acquire', mirror: true,
		pre:  (n, v, o) => `const ${regFor('join:' + n, 'join', n)} = ${rhs(v)}; // @defer-start`,
		emit: (n, v, o) => {
			const J = regFor('join:' + n, 'join', n);
			if (!(o && o.soft)) return `this.${n} = yield ${J};`;
			const V = reg('value', n);
			return `try { var ${V} = yield ${J}; } catch (e) {}\nthis.${n} = ${V};`;
		} },
	{ lc: 'async',   susp: null,  comp: 'drain', slot: 'fan',   mirror: true,
		emit: (n, v, o) => o && o.obj
			? `this.${n} = {}; ${rt('inflight')}(this, (async () => { for await (const _ of ${src(v)}) this.${n}[_[0]] = _[1]; })());`
			: `this.${n} = []; ${rt('inflight')}(this, (async () => { for await (const _ of ${src(v)}) this.${n}.push(_); })());` },

	{ lc: 'asyncdelay', susp: null, comp: null, slot: 'fan', mirror: true,
		emit: (n, v, o) => fanCall(n, `() => ${rhs(v)}`, o, 'delay') },

	{ lc: 'async',   susp: null,  comp: null,    slot: 'fan',   mirror: true, memo: true,
		emit: (n, v, o) => fanCall(n, rhs(v), o, 'indexed') },
	{ lc: 'async',   susp: null,  comp: null,    slot: 'fan',   mirror: true,
		emit: (n, v, o) => fanCall(n, rhs(v), o) },
	{ lc: null,      susp: null,  comp: 'spread', slot: 'plain', mirror: true,
		emit: (n, v, o) => o && o.obj ? `this.${n} = { ...(${String(v).replace(/^sync\s+/, '')}) };`
			: `this.${n} = [...${String(v).replace(/^sync\s+/, '')}];` },

	{ lc: null,      susp: null,  comp: null,    slot: 'plain', mirror: true, soft: true,
		emit: (n, v, o) => {
			const b = blockInit(o && o.soft ? 'try ' + String(v).trim() : String(v), o && o.soft);
			if (!b) return `this.${n} = ${v};`;
			const lines = labelledBlock(b, { id: o.at && o.at.s != null ? o.at.s : 0, name: n, noYield: true });
			return lines ? lines.join('\n') : `this.${n} = ${v};`;
		} },
	{ lc: null,      susp: null,  comp: null,    slot: 'plain', mirror: true,
		emit: (n, v) => `this.${n} = ${v};` }
];
const TIER = /[$\u03a3\u0394\u03a6\u00f8]/;

function slotOf(m, code) { return rowFor(m, code).slot; }
const ADMITS = { sync: ['sync', 'defer'], mixed: ['sync', 'defer', 'async'], async: ['async'] };
const SLOT_LANE = { fan: 'async', acquire: 'defer' };

const fieldBody = (f, code) => (f.kind === 'field' && f.name != null && f.init)
	? code.slice(f.init.s, f.init.e).replace(/`(?:[^`\\]|\\[\s\S])*`|'(?:[^'\\]|\\[\s\S])*'|"(?:[^"\\]|\\[\s\S])*"/g, '""') : null;

function sigilBare(n) { return String(n); }
const PENDING = "Symbol.for('??')";

const BLANK = "Symbol.for('..')";

function mkField(m, init, code, pre) {

	if (m.rendezvous) init = rt('landed') + '(this' + (m.soft ? ', true' : '') + ')';
	if (m.kind === 'emit') return { op: 'EMIT', init, star: !!m.star, at: m.span, fallback: m.fallback ? tryWrap(orToNullish(code.slice(m.fallback.s, m.fallback.e).trim())) : null };

	if (m.kind === 'dynkey') return { op: 'DYNKEY', key: m.key, init, unwrap: !!m.unwrap, at: m.span };
	return ({ op: pre ? 'FIELD_PRE' : 'FIELD',
	name: m.name, names: m.names, pattern: m.pattern,
	init, row: rowFor(m, code), obj: m.comprehension === 'object', at: m.span, soft: !!m.soft, emit: !!m.emit,

	memo: !!m.memo, batchRun: m.batchRun, batchLast: !!m.batchLast, unwrap: !!m.unwrap, doBlock: !!m.doBlock,

	fallback: m.fallback ? tryWrap(orToNullish(code.slice(m.fallback.s, m.fallback.e).trim())) : null });
}

function orToNullish(text) {
	const t = lexOr(text); if (!t) return text;
	const edits = []; let d = 0;
	for (const k of t) {
		if (/^[([{]$/.test(k.c || '')) d++; else if (/^[)\]}]$/.test(k.c || '')) d--;
		else if (d === 0 && k.w === 'or') edits.push({ s: k.s, e: k.e, text: '??' });
	}
	return edits.length ? splice(text, edits) : text;
}
const DETACH_TOKEN = "Symbol.for('Instance.detach')";

function handshakeFor(mode) { return mode === 'await' ? 'this' : mode === 'void' ? DETACH_TOKEN : null; }
const IND = '    ';

const PRIVATE_TIER = /^[$ΔΣΦø]{1,2}(?=#)/;
function emitName(n) { return n == null ? null : String(n).replace(PRIVATE_TIER, ''); }

function isPrivate(n) { return emitName(n)[0] === '#'; }
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function findClasses(src) {
	const sc = scan(String(src));
	const { code, spans } = desugar(sc.code, assertClean(sc.spans, sc.code), sc.comments);
	return parseClasses(spans, code);
}

function delimited(src, i, isRegex) {
	const n = src.length, q = src[i];
	let cls = false;
	while (++i < n) {
		const d = src[i];
		if (d === '\\') { i++; continue; }
		if (d === '\n') return isRegex ? flags(src, i, n) : i;
		if (isRegex) {
			if (d === '[') cls = true;
			else if (d === ']') cls = false;
			else if (d === '/' && !cls) return flags(src, i + 1, n);
		} else if (d === q) return i + 1;
	}
	return isRegex ? flags(src, i, n) : i;
}

function run(src, i, numeric) {
	const n = src.length;
	if (!numeric) { while (++i < n && ID_CONT.test(src[i])); return i; }
	while (++i < n && /[\w.]/.test(src[i]))
		if ((src[i] === 'e' || src[i] === 'E') && /[+-]/.test(src[i + 1] || '')) i++;
	return i;
}

function skip(src, i, interp) {
	const n = src.length;
	if (!interp) {
		i++;
		while (i < n) {
			const c = src[i];
			if (c === '\\') { i += 2; continue; }
			if (c === '`') return i + 1;
			if (c === '$' && src[i + 1] === '{') {
				i = skip(src, i + 2, true);
				if (src[i] === '}') i++;
				continue;
			}
			i++;
		}
		return i;
	}
	let depth = 1;
	while (i < n && depth > 0) {
		const d = src[i];
		if (d === '{') { depth++; i++; }
		else if (d === '}') { depth--; if (!depth) return i; i++; }
		else if (d === '"' || d === "'") i = delimited(src, i, false);
		else if (d === '`') i = skip(src, i, false);
		else if (d === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; }
		else if (d === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; }
		else i++;
	}
	return i;
}

function scan(src, comments = []) {
	let out = '';
	const spans = [];
	let i = 0;
	const n = src.length;

	let prevWord = null;
	let prevPunct = null;
	let prevValue = false;

	const mark = (text, nl) => {
		comments.push(text);
		return M_OPEN + (comments.length - 1) + M_CLOSE + '\n'.repeat(nl);
	};

	const emit = (text, tok) => {
		const s = out.length;
		out += text;
		if (tok) spans.push(Object.assign({ s, e: out.length }, tok));
	};

	while (i < n) {
		const c = src[i];

		if (c === M_OPEN) {
			const close = src.indexOf(M_CLOSE, i);
			const e = close < 0 ? n : close + 1;
			emit(src.slice(i, e));
			i = e;
			continue;
		}

		if (c === '/' && src[i + 1] === '/') {
			const s = i;
			while (i < n && src[i] !== '\n') i++;
			out += mark(src.slice(s, i), 0);
			continue;
		}
		if (c === '/' && src[i + 1] === '*') {
			const s = i;
			const e = src.indexOf('*/', i + 2);
			i = e < 0 ? n : e + 2;
			const text = src.slice(s, i);
			out += mark(text, (text.match(/\n/g) || []).length);
			continue;
		}

		const reOpens = c === '/' && (prevWord != null ? RE_KW.has(prevWord)
			: prevPunct === '++' || prevPunct === '--' ? !prevValue
			: prevPunct != null ? !(prevPunct === ')' || prevPunct === ']' || prevPunct === '}')
			: !prevValue);
		if (c === '"' || c === "'" || reOpens) {
			const s = i;
			i = delimited(src, i, c === '/');
			const text = src.slice(s, i);
			emit(text, c === '/' ? { lit: '/', re: text } : { lit: c });
			prevValue = true; prevWord = prevPunct = null;
			continue;
		}
		if (c === '`') {

			const s = out.length;
			const parts = [];
			let head = s;
			i = template(src, i, comments, t => { out += t; }, (r) => {
				const at = out.length;
				parts.push({ s: head, e: at, lit: '`' });
				for (const k of r.spans) parts.push({ ...k, s: k.s + at, e: k.e + at });
				head = at + r.code.length;
			});
			if (parts.length) { parts.push({ s: head, e: out.length, lit: '`' }); spans.push(...parts); }
			else spans.push({ s, e: out.length, lit: '`' });
			prevValue = true; prevWord = prevPunct = null;
			continue;
		}

		if (ID_START.test(c)) {
			const s = i;
			i = run(src, i, false);
			const w = src.slice(s, i);
			emit(w, { w });
			prevWord = w; prevPunct = null;
			prevValue = !RE_KW.has(w);
			continue;
		}

		if (c >= '0' && c <= '9' || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
			const s = i;
			i = run(src, i, true);
			const raw = src.slice(s, i);
			emit(raw, { num: 1, raw });
			prevValue = true; prevWord = prevPunct = null;
			continue;
		}

		if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
			emit(c); i++;
			continue;
		}

		let p = src[i];
		for (const w of PUNCT_WIDTHS) {
			const t = src.substr(i, w);
			if (!PUNCT_BY_WIDTH[w].includes(t)) continue;
			if (t === '?.' && src[i + 2] >= '0' && src[i + 2] <= '9') break;
			p = t; break;
		}
		emit(p, p === '++' || p === '--' ? { c: p, prefix: !prevValue } : { c: p });
		i += p.length;
		prevPunct = p; prevWord = null;

		if (p !== '++' && p !== '--') prevValue = p === ')' || p === ']' || p === '}';
	}

	return { code: out, comments, spans };
}

function template(src, i, comments, write, inner) {
	const n = src.length;
	write('`');
	i++;
	while (i < n) {
		const c = src[i];
		if (c === '\\') { write(src.slice(i, i + 2)); i += 2; continue; }
		if (c === '`') { write('`'); return i + 1; }
		if (c === '$' && src[i + 1] === '{') {
			write('${');
			const start = i + 2;
			i = skip(src, start, true);
			const r = scan(src.slice(start, i), comments);
			if (inner) inner(r);
			write(r.code);
			if (src[i] === '}') { write('}'); i++; }
			continue;
		}
		write(c);
		i++;
	}
	return i;
}

function restoreComments(code, comments) {

	return code.replace(new RegExp(M_OPEN + '(\\d+)' + M_CLOSE + '(\\n*)', 'g'), (_, id, nls) => {
		const c = comments[Number(id)];
		if (c === undefined) throw new Error('unknown comment marker: ' + id);
		return c + nls.slice((c.match(/\n/g) || []).length);
	});
}

function assertClean(x, code) {
	if (code === undefined) {
		const m = x.match(new RegExp('[' + M_OPEN + M_CLOSE + ']'));
		if (m) throw new Error('comment marker survived to output at index ' + m.index);
		return x;
	}
	let last = -1;
	for (const t of x) {
		if (t.s < last) throw new Error('spans out of order at ' + t.s);
		if (t.e <= t.s) throw new Error('empty span at ' + t.s);
		if (/[\uE000\uE001]/.test(code.slice(t.s, t.e)))
			throw new Error('a marker leaked into a token at ' + t.s);
		last = t.e;
	}
	return x;
}

function parseClasses(spans, code, recover) {
	const classes = [];

	const headRefusal = (w, at) => err('HEAD_WORD', at, SyntaxError, w);
	for (let i = 0; i < spans.length; i++) {
		if (spans[i].w !== 'class') continue;

		if (/^\??\.$/.test(prev(spans, i).c || '') || /^[(=:;,})\]]$/.test(next(spans, i).c || '')) continue;

		let grain = null;
		let headStart = spans[i].s;

		const starCls = next(spans, i).c === '*' ? 1 : 0;
		const structuralCls = new Set(starCls ? ['iterable'] : []);

		const inRun = w => w === 'try' || w === 'main' || w === 'public' || STRUCTURAL.has(w) || GRAINS.has(w);
		let run = i;
		while (run > 0 && inRun(spans[run - 1].w) && !/^\??\.$/.test(prev(spans, run - 1).c || '')) run--;
		if (run < i && /\n/.test(code.slice(spans[run].e, spans[i].s))) {
			const b = prev(spans, run);
			if (b.w ? TLA_OPERAND.has(b.w) : b.c && !/^[;{})\]]$/.test(b.c)) run++;
		}
		let _b = i, isMain = false, headFault = null, soft = false;
		const headWord = test => _b - 1 >= run && test(spans[_b - 1].w);
		while (headWord(w => STRUCTURAL.has(w) || w === 'main')) {
			if (prev(spans, _b).w === 'main') isMain = true; else structuralCls.add(prev(spans, _b).w);
			headStart = prev(spans, _b).s; _b--;
		}
		if (headWord(w => GRAINS.has(w))) {
			grain = canonLane(prev(spans, _b).w);
			headStart = prev(spans, _b).s;
			_b--;
			if (grain === 'defer') headFault = headRefusal('defer', headStart);
		}

		if (headWord(w => w === 'try')) {
			soft = true;
			headStart = prev(spans, _b).s;
			_b--;
			if (!headFault && headWord(w => STRUCTURAL.has(w) || GRAINS.has(w) || w === 'main')) headFault = headRefusal('try', spans[_b].s);
		}

		let isPublic = false;
		if (headWord(w => w === 'public')) {
			isPublic = true;
			headStart = prev(spans, _b).s;
			_b--;
			if (!headFault && headWord(w => w === 'try' || STRUCTURAL.has(w) || GRAINS.has(w) || w === 'main'))
				headFault = err('PUBLIC_LEADS_HEAD', spans[_b - 1].s);
		}
		if (_b > 1 && prev(spans, _b).w === 'default' && prev(spans, _b - 1).w === 'export') {
			isMain = true;
			headStart = prev(spans, _b - 1).s;
			_b -= 2;
		}

		{
			const pw = prev(spans, _b);
			if (!headFault && pw.w && !RE_KW.has(pw.w) && pw.w !== 'export' && pw.w !== 'extends' &&
			    !/\n/.test(code.slice(pw.e, headStart))) {
				headFault = headRefusal(pw.w, pw.s);
				headStart = pw.s;
			}
		}

		if (headFault && !recover) throw headFault;

		const nw = jump(spans, i, 1 + starCls).w, named = nw && nw !== 'extends';
		const name = named ? jump(spans, i, 1 + starCls).w : null;

		let j = i + 1 + starCls;
		while (j < spans.length && spans[j].c !== '{') j++;
		if (j >= spans.length) continue;

		let ext = null, impl = [];
		for (let x = i + 1; x < j; x++) {
			if (spans[x].w === 'extends') ext = next(spans, x).w || null;
			if (spans[x].w === 'implements') {
				let y = x + 1;
				while (spans[y] && spans[y].w) { impl.push(spans[y].w); y++; if (spans[y]?.c === ',') y++; else break; }
			}
		}
		const close = matchPair(spans, j);
		if (close < 0) continue;
		const rec = {
			name,
			structural: structuralCls,
			ext,
			grain,
			implements: impl,
			main: isMain,
			public: isPublic,
			head: { s: headStart, e: spans[j].s },
			body: { s: spans[j].e, e: spans[close].s },
			ctor: null,
			sctor: null,
			members: []
		};

		for (const at = { k: j + 1 }; ;) {
			try { parseBody(spans, at.k, close, rec, code, at); break; }
			catch (e) {
				if (!recover || !(e instanceof SyntaxError || e instanceof TypeError)) throw e;
				if (at.ctor) { rec.fault = e; break; }
				(rec.faults || (rec.faults = [])).push(e);
				const semi = topLevel(spans, at.k, close, ';');
				const asi = fieldNeedsASI(spans, at.k, semi < 0 ? close : semi, code);
				at.k = Math.max(at.k + 1, asi >= 0 ? asi : semi >= 0 ? semi + 1 : close);
			}
		}

		rec.soft = soft;
		const softInst = rec.ctor ? !!rec.ctor.soft : soft, softCls = rec.sctor ? !!rec.sctor.soft : soft;
		for (const m of rec.members) {
			if (!(m.static ? softCls : softInst)) continue;
			if (m.kind === 'staticBlock' && !m.softBlock) {
				const raw = code.slice(m.span.s, m.span.e);
				m.softBlock = raw.slice(raw.indexOf('{')) + ' catch (e) {}';
			}
			if (m.kind !== 'field' || m.comprehension || !m.init || m.soft) continue;
			const v = lexOr(code.slice(m.init.s, m.init.e));
			if (v && ((v[0] && v[0].w === 'try') ||
			    (v.length === 1 && (v[0].num || (v[0].lit && v[0].lit !== '`') || JSON_WORDS.has(v[0].w))))) continue;
			m.soft = true;
			if (v && v[0] && v[0].c === '{' && !suspends(m, code)) m.paren = true;
		}
		if (headFault) rec.fault = headFault;
		classes.push(rec);
		i = close;
	}
	return classes;
}

function closeParen(t, from) {
	let d = 0;
	for (let i = from; i < t.length; i++) {
		if (t[i] === '(') d++;
		else if (t[i] === ')' && !--d) return i;
	}
	return from;
}

function matchPair(spans, open, to = spans.length) {
	const o = spans[open] && spans[open].c, c = PAIR[o];
	if (!c) return -1;
	let d = 0;
	for (let k = open; k < to; k++) {
		if (spans[k].c === o) d++;
		else if (spans[k].c === c) { d--; if (d === 0) return k; }
	}
	return -1;
}

function topLevel(spans, from, to, ch) {
	let d = 0;
	for (let p = from; p < to; p++) {
		const c = spans[p].c;
		if (c === ch && d === 0) return p;
		if (c === '(' || c === '[' || c === '{') d++;
		else if (c === ')' || c === ']' || c === '}') d--;
	}
	return -1;
}

function methodEnd(spans, at, to) {
	const b = topLevel(spans, at, to, '{');
	return b < 0 ? -1 : matchPair(spans, b, to);
}

const LANE_START = new Set(['await', 'async', 'defer', 'yield', 'setup']);

function topLevelAs(spans, from, to) {
	let d = 0;
	for (let p = from; p < to; p++) {
		const c = spans[p].c;
		if (c === '(' || c === '[' || c === '{') { d++; continue; }
		if (c === ')' || c === ']' || c === '}') { d--; continue; }
		if (d === 0 && spans[p].w === 'as' && !/^\??\.$/.test(prev(spans, p).c || '')) return p;
	}
	return -1;
}

function tryOperandEnd(text) {
	const t = lexOr(text); if (!t || !t.length) return null;
	if (t[0].c !== '{') return unaryOperand(text);
	const c = matchPair(t, 0); if (c < 0) return null;
	let i = c + 1;
	for (;;) {
		if (t[i] && (t[i].w === 'catch' || t[i].w === 'finally')) {
			const fin = t[i].w === 'finally'; i++;
			if (!fin && t[i] && t[i].c === '(') { const p = matchPair(t, i); if (p < 0) return null; i = p + 1; }
			if (!t[i] || t[i].c !== '{') return null;
			const b = matchPair(t, i); if (b < 0) return null; i = b + 1;
			continue;
		}
		break;
	}
	return i >= t.length ? text.length : t[i].s;
}

function parseBody(spans, from, to, rec, code, cursor) {

	const valueEnd = b => {
		const semi = topLevel(spans, b, to, ';');
		const asi = fieldNeedsASI(spans, b, semi < 0 ? to : semi, code);
		if (asi >= 0) return { last: asi, e: spans[asi - 1].e, next: asi };
		const p = semi < 0 ? to : semi;
		return { last: p, e: p > b ? spans[p - 1].e : spans[b] ? spans[b].s : spans[b - 1].e, next: semi >= 0 ? p + 1 : p };
	};
	const initEnd = b => valueEnd(b + 1);
	const slotIsKey = (p, stop) => { while (spans[p] && (spans[p].w === 'untracked' || FIELD_DESCRIPTORS.has(spans[p].w)) && p + 1 < stop) p++;
		return !!spans[p] && spans[p].c === '[' && (() => { const cl = matchPair(spans, p, stop); return cl >= 0 && topLevel(spans, p + 1, cl, ',') < 0; })(); };

	const readSlot = (p, stop, at, lead) => {
		const out = { untracked: false, mut: null, name: null, names: null, pattern: null, key: null, comprehension: null, s: spans[p] ? spans[p].s : at };
		const tierHere = q => { if (spans[q] && TIER_WORDS.has(spans[q].w) && q + 1 < stop) {
			const rest = []; for (let r = q + 1; r < stop && spans[r]; r++) rest.push(code.slice(spans[r].s, spans[r].e));
			throw err('TIER_LEADS_AS', spans[q].s, SyntaxError, spans[q].w, lead, [...(out.untracked ? ['untracked'] : []), ...(out.mut ? [out.mut] : []), ...rest].join(' ')); } };
		tierHere(p);
		if (spans[p] && spans[p].w === 'untracked' && p + 1 < stop) { out.untracked = true; p++; tierHere(p); }
		if (spans[p] && FIELD_DESCRIPTORS.has(spans[p].w) && p + 1 < stop) {
			out.mut = spans[p].w; p++;
			if (spans[p] && FIELD_DESCRIPTORS.has(spans[p].w) && p + 1 < stop)
				throw err('ONE_DESCRIPTOR_LIST', spans[p].s);
			tierHere(p);
			if (spans[p] && spans[p].w === 'untracked' && p + 1 < stop)
				throw err('SLOT_UNTRACKED_FIRST', spans[p].s, SyntaxError, out.mut, spans[p + 1].w);
		}
		if (p >= stop || !spans[p]) throw err('SLOT_EXPECTED', at);
		const t = spans[p];
		if (t.c === '{' || t.c === '[') {
			const cl = matchPair(spans, p, stop);
			if (cl < 0) throw err('PATTERN_NEVER_CLOSES', t.s);
			const text = code.slice(t.s, spans[cl].e);

			if (t.c === '[' && topLevel(spans, p + 1, cl, ',') < 0) { out.key = code.slice(t.e, spans[cl].s); out.e = spans[cl].e; return { slot: out, p: cl + 1 }; }
			const pt = patternTargets(text);
			if (!pt) throw err('PATTERN_UNREADABLE', t.s, SyntaxError, text);
			out.names = pt.names; out.pattern = pt.target; out.name = pt.names[0]; out.e = spans[cl].e;
			return { slot: out, p: cl + 1 };
		}
		if (!t.w) throw err('SLOT_EXPECTED', t.s);
		if (Object.prototype.hasOwnProperty.call(WORDS, t.w) || LANE_START.has(t.w) || t.w === 'as' || t.w === 'or' || t.w === 'static')
			throw err('SIGNATURE_WORD_AS_NAME', t.s, SyntaxError, t.w);

		if (t.w.length > 2 && /^[$ΔΣΦø]/.test(t.w) && /[$ΔΣΦø]$/.test(t.w))
			throw err('DOUBLE_SIDED_SIGILS', t.s, TypeError, t.w);
		out.name = t.w; out.e = t.e; p++;
		const cb = spans[p] && spans[p].c;
		if ((cb === '[' || cb === '{') && next(spans, p).c === (cb === '[' ? ']' : '}')) {
			if (jump(spans, p, 2).c !== '*')
				throw err('BARE_COMPREHENSION_RETIRED', t.s, SyntaxError, t.w, cb === '[' ? '[]*' : '{}*');
			out.comprehension = cb === '[' ? 'array' : 'object'; out.e = spans[p + 2].e; p += 3;
		}
		return { slot: out, p };
	};
	let k = from;

	let ov = null;
	const overrideMember = () => {
		if (ov === null) return;
		if (rec.ctor !== ov.ctor || rec.sctor !== ov.sctor) throw err('OVERRIDE_NOT_CONSTRUCTOR', ov.at);
		if (rec.members.length <= ov.n) return;
		const m = rec.members[ov.n];
		if (m.static) throw err('OVERRIDE_NOT_STATIC', ov.at);
		if (!['method', 'accessor', 'field', 'dynkey'].includes(m.kind) || (!m.name && !m.key)) throw err('OVERRIDE_MARKS', ov.at);
		if (m.name && m.name[0] === '#') throw err('OVERRIDE_PRIVATE', ov.at, SyntaxError, m.name);
		m.override = true;
		ov = null;
	};
	while (k < to) {
		overrideMember();
		if (cursor) { cursor.k = k; cursor.ctor = false; }
		const t = spans[k];
		if (t.c === ';') { if (ov !== null && rec.members.length === ov.n) throw err('OVERRIDE_NEEDS_MEMBER', ov.at); k++; continue; }

		if (t.c === '@' && spans[k + 1] && spans[k + 1].w === 'override' && spans[k + 1].s === t.e) {
			if (ov !== null) throw err('OVERRIDE_ONCE', t.s);
			ov = { at: t.s, n: rec.members.length, ctor: rec.ctor, sctor: rec.sctor };
			k += 2;
			continue;
		}
		if (t.c === '@' && spans[k + 1] && spans[k + 1].w && spans[k + 1].s === t.e)
			throw err('NOT_A_DECORATOR', t.s, SyntaxError, spans[k + 1].w);

		if (/^['"]use implicit['"]$/.test(code.slice(t.s, t.e).trim()))
			throw err('USE_IMPLICIT_RETIRED', t.s);

		if ((t.c === '?' || t.c === '&' || t.c === '@') && spans[k + 1] && (spans[k + 1].w || spans[k + 1].c === '{' || spans[k + 1].c === '[')) {
			if (t.c === '@') throw err('AT_MEMBER_IS_DECORATOR', t.s);
			const word = LANE_SIGIL[t.c], slot = spans[k + 1].w || '{ … }';
			throw err('LANE_SIGIL_TAKES_EQUALS', t.s, SyntaxError, t.c, word, slot);
		}

		if (jump(spans, k, 2).c === '{' &&
		    ((t.w === 'static' && next(spans, k).w === 'try') ||
		     (t.w === 'try' && next(spans, k).w === 'static'))) {
			const bOpen = k + 2;
			const bEnd = matchPair(spans, bOpen);
			if (bEnd >= 0 && !isBind(next(spans, bEnd))) {
				let end = bEnd;

				for (;;) {
					const nx = next(spans, end);
					if (!nx || (nx.w !== 'catch' && nx.w !== 'finally')) break;
					let j = spans.indexOf(nx);
					if (spans[j + 1] && spans[j + 1].c === '(') j = matchPair(spans, j + 1);
					const cb = spans[j + 1] && spans[j + 1].c === '{' ? matchPair(spans, j + 1) : -1;
					if (cb < 0) break;
					end = cb;
				}
				const inner = code.slice(spans[bOpen].s, spans[end].e);
				const hasTail = end !== bEnd;
				rec.members.push({ kind: 'staticBlock', name: null, mods: ['static'], static: true,
					init: null, softBlock: hasTail ? inner : inner + ' catch (e) {}',
					span: { s: t.s, e: spans[end].e } });
				k = end + 1;
				continue;
			}
		}

		if (t.w === 'static' && next(spans, k).c === '{' &&
		    !(matchPair(spans, k + 1) >= 0 && isBind(next(spans, matchPair(spans, k + 1))))) {
			const end = matchPair(spans, k + 1);
			rec.members.push({ kind: 'staticBlock', name: null, mods: ['static'], static: true,
				init: null, span: { s: t.s, e: spans[end].e } });
			k = end + 1;
			continue;
		}

		{
			let b = k;
			if (spans[b]?.w === 'try') b++;
			if (spans[b]?.w === 'await') b++;
			if (spans[b]?.w === 'using' && spans[b + 1]?.w && spans[b + 1]?.w !== 'package') {
				throw err('USING_NAMES_PACKAGE', spans[b].s, SyntaxError, spans[b + 1].w);
			}
			if (spans[b]?.w === 'using' && spans[b + 1]?.w === 'package') {
				const stop = topLevel(spans, b, to, ';');
				const end = stop < 0 ? to : stop;
				(rec.usings || (rec.usings = [])).push({ from: k, to: end });
				k = stop < 0 ? end : stop + 1;
				continue;
			}
		}

		const startTok = spans[k];

		let isStatic = false, lhsTry = false, lhsDo = false, lhsTier = null, lhsTierTok = null;
		const opens = p => spans[p + 1] && p + 1 < to && (spans[p + 1].w || /^[*[{?&@]$/.test(spans[p + 1].c || ''));
		const headSoFar = () => [lhsTier, isStatic ? 'static' : null, lhsDo ? 'do' : null, lhsTry ? 'try' : null].filter(Boolean).join(' ');

		for (;;) {
			if (TIER_WORDS.has(spans[k].w) && opens(k)) {
				if (lhsTier !== null) throw err('ONE_TIER', spans[k].s, SyntaxError, lhsTier, spans[k].w);
				if (isStatic || lhsTry || lhsDo) throw err('TIER_LEADS_HEAD', spans[k].s, SyntaxError, spans[k].w, headSoFar() + ' ' + (spans[k + 1].w || '…'), headSoFar() + ' ' + spans[k].w);
				lhsTier = spans[k].w; lhsTierTok = spans[k]; k++; continue;
			}
			if (spans[k].w === 'static' && !isStatic && opens(k)) { isStatic = true; k++; continue; }
			if (spans[k].w === 'do' && !lhsDo && opens(k)) {
				if (lhsTry) throw err('DO_LEADS_TRY', spans[k].s, SyntaxError, spans[k + 1].w || 'await');
				lhsDo = true; k++; continue;
			}
			if (spans[k].w === 'try' && !lhsTry && opens(k)) { lhsTry = true; k++; continue; }
			break;
		}
		if (k >= to) break;
		if (lhsTier !== null && isStatic && spans[k].c === '{')
			throw err('TIER_ON_STATIC_BLOCK', lhsTierTok.s, SyntaxError, lhsTier);
		if ((spans[k].c === '?' || spans[k].c === '&' || spans[k].c === '@') && spans[k + 1] && (spans[k + 1].w || spans[k + 1].c === '{' || spans[k + 1].c === '[')) {
			if (spans[k].c === '@') throw err('AT_AFTER_HEAD_RETIRED', spans[k].s, SyntaxError, code.slice(startTok.s, spans[k].s).trim());
			const word = LANE_SIGIL[spans[k].c], slot = spans[k + 1].w || '{ … }';
			throw err('LANE_SIGIL_TAKES_EQUALS', spans[k].s, SyntaxError, spans[k].c, word, slot);
		}

		let ctorGrain = null;
		const ctorWords = [];

		const ctorWordAt = p => GRAINS.has(spans[p].w) || STRUCTURAL.has(spans[p].w);
		const ctorAhead = () => { let p = k; while (spans[p] && ctorWordAt(p)) p++; return !!spans[p] && spans[p].w === 'constructor'; };
		while (spans[k] && ctorWordAt(k) && ctorAhead()) {
			if (GRAINS.has(spans[k].w)) { if (ctorGrain) throw err('CTOR_ONE_GRAIN', spans[k].s); ctorGrain = spans[k].w; }
			else ctorWords.push(spans[k].w);
			k++;
		}

		const laneOpens = p => {
			if (!LANE_START.has(spans[p].w)) return false;
			const n = spans[p + 1];
			if (!n || p + 1 >= to || n.c === '=' || n.c === ';') return false;
			if (n.c === '(') { const cl = matchPair(spans, p + 1, to); return !(cl >= 0 && next(spans, cl).c === '{'); }
			return true;
		};

		if (lhsDo && !laneOpens(k))
			throw err('DO_OPENS_BLOCK_ON_LANE', spans[k].s, SyntaxError, lhsTry ? 'try ' : '');
		if (laneOpens(k)) {
			const W = spans[k].w;
			k++;

			if (W === 'yield' && spans[k] && spans[k].c === '*') {

				{
					let q = -1;
					if (spans[k + 1] && spans[k + 1].c === '[') { const cl = matchPair(spans, k + 1, to); if (cl >= 0) q = cl + 1; }
					else if (spans[k + 1] && spans[k + 1].w) q = k + 2;
					if (q > 0 && spans[q] && spans[q].c === '(') {
						const cl = matchPair(spans, q, to);
						if (cl >= 0 && next(spans, cl).c === '{') throw err('YIELD_ON_METHOD', startTok.s);
					}
				}
				const v = valueEnd(k + 1);
				rec.members.push({ kind: 'emit', name: null, bare: true, emit: true, star: true,
					mods: [], static: isStatic,
					init: { s: spans[k + 1] && k + 1 < v.last ? spans[k + 1].s : spans[k].e, e: v.e },
					span: { s: startTok.s, e: v.e } });
				k = v.next;
				continue;
			}
			const lane = [];
			let lhsYield = false, saidAwait = -1;

			const fanWord = p => !!spans[p] && spans[p].w === 'async';
			if (W === 'defer' && !fanWord(k)) {
				lane.push('defer');
				if (spans[k] && spans[k].w === 'yield' && laneOpens(k)) { lhsYield = true; k++; }
				if (spans[k] && spans[k].w === 'await' && laneOpens(k)) { saidAwait = k; k++; }
			} else if (W === 'yield') {
				lhsYield = true;

				if (spans[k] && (fanWord(k) || spans[k].w === 'setup') && laneOpens(k)) { lane.push(spans[k].w); k++; }
				else if (spans[k] && spans[k].w === 'defer') throw err('DEFER_LEADS_YIELD', spans[k].s, SyntaxError, spans[k + 1] && spans[k + 1].w === 'await' ? '' : 'await ');
				else if (spans[k] && spans[k].w === 'await' && laneOpens(k)) { lane.push('await'); saidAwait = k; k++; }
			} else lane.push(W);

			const L0 = lane[0];
			if (L0 === 'setup') {
				if (fanWord(k)) { lane.push(spans[k].w); k++; }
				else throw err('SETUP_IS_A_GRAIN', spans[k - 1].s);
			}
			else if (L0 === 'async' && spans[k] && spans[k].w === 'setup') { lane.push('setup'); k++; }
			else if (L0 === 'defer' && fanWord(k)) { lane.push(spans[k].w); k++; }
			if (spans[k] && spans[k].w === 'sync')
				throw err('SYNC_RETIRED', spans[k].s);
			if (spans[k] && LANE_START.has(spans[k].w) && spans[k].w !== 'await' && spans[k].w !== 'yield')
				throw err('ONE_LANE', spans[k].s, SyntaxError, lane.join(' '), spans[k].w);
			if (spans[k] && spans[k].w === 'yield')
				throw err('YIELD_LEADS', spans[k].s, SyntaxError, lane.join(' '), lane[0]);

			let lhsMemo = false;
			if (spans[k] && spans[k].w === 'indexed' && k + 1 < to) { lhsMemo = true; k++; }

			const laneSaid = (lane[0] === 'defer' ? ['defer', ...lane.slice(1), lhsYield && 'yield', saidAwait >= 0 && 'await'] : [lhsYield && 'yield', ...lane]).filter(Boolean).join(' ');

			const mods = lane.map(w => w === 'await' ? 'sync' : canonLane(w));
			if (mods[0] === 'sync' && mods[1] === 'async') mods.splice(0, 2, 'batch');
			else if (mods[0] === 'defer' && mods[1] === 'async') mods[1] = 'batch';
			if (k >= to) throw err('WORD_OPENS_NOTHING_FOLLOWS', startTok.s, SyntaxError, W);

			{
				let p = k, acc = null;
				if (ACCESSOR_KW.has(spans[p].w) && spans[p + 1] && (spans[p + 1].w || spans[p + 1].c === '[' || spans[p + 1].c === '*')) { acc = spans[p].w; p++; }
				if (spans[p] && spans[p].c === '*') p++;
				let q = -1, mname = null;
				if (spans[p] && spans[p].c === '[') { const cl = matchPair(spans, p, to); if (cl >= 0) q = cl + 1; }
				else if (spans[p] && spans[p].w) { q = p + 1; mname = spans[p].w; }
				if (q > 0 && spans[q] && spans[q].c === '(') {
					const cl = matchPair(spans, q, to);
					if (cl >= 0 && next(spans, cl).c === '{') {
						if (lhsYield) throw err('YIELD_ON_METHOD', startTok.s);

						if (lane[0] === 'await' && !acc) throw err('AWAIT_ON_METHOD', startTok.s, SyntaxError, mname);

						if (lane[0] === 'defer' && !acc) throw err('DEFER_ON_METHOD', startTok.s, SyntaxError, mname);
						if (lane.length > 1 || lhsMemo) throw err('METHOD_TAKES_ASYNC', startTok.s);
						if (acc === 'get' && lane[0] !== 'async') throw err('GETTER_TAKES_NO_LANE', startTok.s);
						const end = methodEnd(spans, q, to);
						if (end < 0) throw err('METHOD_BODY_NEVER_CLOSES', startTok.s, SyntaxError, mname);
						const m = { kind: acc ? 'accessor' : 'method', name: mname, mods: [...lane, ...(acc ? [acc] : [])], static: isStatic,
							init: null, soft: lhsTry, mut: null, span: { s: startTok.s, e: spans[end].e } };
						if (acc === 'set') { m.setLane = mods[0]; m.soft = lhsTry; }
						rec.members.push(m);
						k = end + 1;
						continue;
					}
				}
			}

			const v = valueEnd(k);
			const asAt = topLevelAs(spans, k, v.last);
			const exprLast = asAt >= 0 ? asAt : v.last;
			if (exprLast <= k) throw err('LANE_NEEDS_EXPRESSION', startTok.s, SyntaxError, laneSaid, asAt >= 0);
			const eqAt = topLevel(spans, k, exprLast, '=');
			if (eqAt >= 0) {
				const nm = code.slice(spans[k].s, spans[eqAt].s).trim(), rest = code.slice(spans[eqAt].e, spans[exprLast - 1].e).trim();
				const bare = (lhsYield && !lane.length && /^await\s/.test(rest) ? 'await ' : '') + rest.replace(/^await\s+/, '');
				throw err('V11_VALUE_FIRST', spans[k].s, SyntaxError, laneSaid, bare, nm, nm + ' = …');
			}
			const exprText = code.slice(spans[k].s, spans[exprLast - 1].e);

			if (asAt >= 0) {
				const et = lexOr(exprText) || [];
				const slotLike = et.length >= 2 && et.every(t => t.w) && et.slice(0, -1).every(t => t.w === 'untracked' || FIELD_DESCRIPTORS.has(t.w)) && !FIELD_DESCRIPTORS.has(et[et.length - 1].w) && !LANE_START.has(et[et.length - 1].w);
				if (slotLike) throw err('V11_VALUE_FIRST', spans[k].s, SyntaxError, laneSaid, code.slice(spans[asAt].e, spans[v.last - 1].e).trim(), exprText.trim(), exprText.trim() + ' as \u2026');
			}
			const L = leading(exprText);

			if (L.kws[0] === 'try') {
				const rest = L.t[1] ? exprText.slice(L.t[1].s) : '';
				const opd = L.t[1] && L.t[1].w === 'await' ? rest.replace(/^await\s+/, '') : rest;

				if (/^\{/.test(opd)) {
					const lt = lexOr(opd) || [], cl = lt.length ? matchPair(lt, 0) : -1, tail = cl >= 0 ? opd.slice(lt[cl].e).trim() : '';
					const fb = /^\?\?\s+/.test(tail) ? ' catch { ' + tail.replace(/^\?\?\s+/, '') + ' }' : '';
					throw err('BLOCK_NEEDS_DO_TRY', spans[k].s, SyntaxError, laneSaid, (cl >= 0 ? opd.slice(0, lt[cl].e) : opd) + fb, asAt >= 0 ? ' as …' : ';', tail && !fb ? tail : '');
				}
				throw err('TRY_LEADS_LANE', spans[k].s, SyntaxError, laneSaid, opd, asAt >= 0 ? ' as …' : ';');
			}
			if (L.kws[0] === 'await' && L.opd === 'this' && mods[0] === 'defer' && asAt < 0)
				throw err('AWAIT_THIS_NOT_DEFERRED', startTok.s);

			if (L.t && L.t[0] && L.t[0].w === 'await' && unaryOperand(exprText) === exprText.length && !hasAwait(L.opd) && !(lhsYield && asAt < 0))
				throw err('LANE_ALREADY_WAITS', spans[k].s, SyntaxError, laneSaid, lane.includes('async') && lane.length === 1 ? 'unwraps what lands' : 'waits', L.opd, asAt >= 0 ? ' as …' : '');

			const blockOpd = !!(L.t && (q => q && q.c === '{')(L.t.find(q => q.s >= L.at)));
			if (blockOpd && !lhsDo)
				throw err('BLOCK_NEEDS_DO_LANE', spans[k].s, SyntaxError, lhsTry ? 'try ' : '', laneSaid, asAt >= 0 ? ' as …' : ';', asAt >= 0 ? ' as …' : '');
			if (lhsDo && lhsYield && asAt < 0) throw err('DO_YIELD_GATE_NOT_BUILT', startTok.s);
			if (lhsDo && (mods[0] !== 'sync' || mods.length > 1))
				throw err('DO_IS_FOR_AWAIT', spans[k].s, SyntaxError, lhsTry ? 'try ' : '', lhsYield ? 'yield ' : '', asAt >= 0 ? ' as …' : ';', laneSaid, asAt >= 0 ? ' as …' : '');
			if (lhsDo && !blockOpd)
				throw err('DO_TAKES_BLOCK_LANE', spans[k].s, SyntaxError, lhsTry ? 'try ' : '', laneSaid, exprText.trim(), asAt >= 0 ? ' as …' : ';');
			if (lhsDo && lhsMemo) throw err('INDEXED_ON_BLOCK', startTok.s);
			if (lhsDo) {
				const whole = tryOperandEnd(exprText);
				if (whole !== exprText.length) throw err('AFTER_BLOCK_LANE', spans[k].s, SyntaxError, exprText.slice(whole == null ? 0 : whole).trim());
				const lt = lexOr(exprText) || [], cl = lt.length ? matchPair(lt, 0) : -1;
				if (!lhsTry && cl >= 0 && lt[cl + 1] && (lt[cl + 1].w === 'catch' || lt[cl + 1].w === 'finally'))
					throw err('CLAUSE_NEEDS_TRY_LANE', spans[k].s, SyntaxError, laneSaid, exprText.slice(lt[cl].e).trim());
			}

			let fallback;
			if (!lhsDo && L.t && L.t.length) {
				const uo = unaryOperand(exprText);
				if (uo !== null && uo < exprText.length) {
					const slotSaid = asAt >= 0 ? ' as ' + code.slice(spans[asAt].e, spans[v.last - 1].e).trim() : ';';
					const tail = exprText.slice(uo).trim();
					if (/^\?\?(?!=)/.test(tail))
						throw err('FALLBACK_IS_OR', spans[k].s, SyntaxError, lhsTry ? 'try ' : '', laneSaid, exprText.slice(0, uo).trim(), tail.slice(2).trim(), slotSaid);
					if (/^or\b/.test(tail)) {
						for (let fb = tail; fb; ) {
							const r = fb.slice(2).trim(), u = r ? unaryOperand(r) : null;
							if (u === null) throw err('OR_NEEDS_FALLBACK', spans[k].s);
							fb = r.slice(u).trim();
							if (fb && !/^or\b/.test(fb))
								throw err('FALLBACK_ONE_OPERAND', spans[k].s, SyntaxError, r.slice(0, u).trim(), fb, r);
						}
						if (!(mods.length === 1 && (mods[0] === 'sync' || mods[0] === 'defer')))
							throw err('FALLBACK_NEEDS_A_WAIT', spans[k].s, SyntaxError, laneSaid, lhsYield && !mods.length ? 'Write `' + (lhsTry ? 'try ' : '') + 'yield await ' + exprText.trim() + slotSaid + '`.'
								: 'A fan takes no fallback yet: write `' + (lhsTry ? 'try ' : '') + 'await ' + exprText.trim() + slotSaid + '` to wait for it where it stands.');
						if (L.t[0].w === 'await')
							throw err('LANE_ALREADY_WAITS_FALLBACK', spans[k].s, SyntaxError, laneSaid, lhsTry ? 'try ' : '', exprText.trim().replace(/^await\s+/, ''), slotSaid);
						if (asAt < 0 && !lhsYield)
							throw err('GATE_FALLBACK_NOWHERE', spans[k].s, SyntaxError, lhsTry ? 'try ' : '', laneSaid, exprText.trim());
						if (asAt >= 0 && slotIsKey(asAt + 1, v.last))
							throw err('COMPUTED_KEY_NO_FALLBACK', spans[k].s);
						fallback = { s: spans[k].s + uo, e: spans[exprLast - 1].e };
					} else {

						if (/^(?:catch|finally)\b/.test(tail))
							throw err('CLAUSE_NEEDS_BLOCK_LANE', spans[k].s, SyntaxError, tail.split(/\s|\{|\(/)[0], laneSaid, exprText.slice(0, uo).trim(), tail, slotSaid);
						const blocking = mods[0] === 'sync' && mods.length === 1;
						const group = '`' + laneSaid + ' (' + exprText.trim() + ')' + slotSaid + '`', block = '`do ' + (lhsTry ? 'try ' : '') + (blocking ? laneSaid : lhsYield && !mods.length ? 'yield await' : 'await') + ' { ' + exprText.trim() + ' }' + slotSaid + '`';
						throw err('LANE_ONE_OPERAND', spans[k].s, SyntaxError, laneSaid, exprText.slice(0, uo).trim(), exprText.slice(uo).trim(), lhsYield && asAt < 0 ? 'Group it: ' + group + '.'
							: blocking ? 'Write ' + block + ', where each statement waits once per operand.'
							: 'Group it: ' + group + ', or let its parts wait in turn: ' + block + '.');
					}
				}
			}
			const init = { s: spans[k].s, e: spans[exprLast - 1].e };
			if (asAt < 0) {

				if (lhsYield) {
					if (mods[0] === 'defer')
						throw err('DEFER_YIELD_BINDS', startTok.s, SyntaxError, exprText.trim());

					if (lhsTry)
						throw err('TRY_ON_EMISSION', startTok.s, SyntaxError, laneSaid, exprText.trim());

					rec.members.push({ kind: 'emit', name: null, bare: true, emit: true, mods: [], static: isStatic, fallback,
						init: saidAwait >= 0 ? { s: spans[saidAwait].s, e: init.e } : init, span: { s: startTok.s, e: v.e } });
					k = v.next;
					continue;
				}
				if (mods.length !== 1 || (mods[0] !== 'sync' && mods[0] !== 'defer'))
					throw err('GATE_NEEDS_A_WAITER', startTok.s, SyntaxError, laneSaid);
				if (lhsMemo) throw err('INDEXED_ON_GATE', startTok.s);
				if (lhsTier !== null) throw err('TIER_ON_GATE', lhsTierTok.s, SyntaxError, lhsTier);

				const rendezvous = exprLast === k + 1 && spans[k].w === 'this';
				if (rendezvous && mods[0] === 'defer')
					throw err('AWAIT_THIS_NOT_DEFERRED', startTok.s);

				rec.members.push({ kind: 'field', name: null, bare: true, soft: lhsTry && !lhsDo, mods: mods[0] === 'defer' ? ['defer'] : [], static: isStatic, rendezvous,
					comprehension: null, unwrap: true, init, span: { s: startTok.s, e: v.e }, doBlock: lhsDo, doTry: lhsDo && lhsTry });
				k = v.next;
				continue;
			}

			const { slot, p } = readSlot(asAt + 1, v.last, spans[asAt].e, code.slice(startTok.s, spans[asAt].s).trim());
			if (p !== v.last) throw err('AFTER_SLOT', spans[p].s, SyntaxError, code.slice(spans[p].s, spans[v.last - 1].e).trim(), code.slice(slot.s, slot.e));
			const fmods = [...mods, ...(slot.untracked ? ['untracked'] : []), ...(lhsTier ? [lhsTier] : [])];
			if (slot.key !== null) {

				const extra = mods[0] !== 'sync' || mods.length > 1 ? laneSaid : lhsTry ? 'try' : lhsYield ? 'yield' : lhsMemo ? 'indexed' : slot.mut || (slot.untracked ? 'untracked' : null) || lhsTier;
				if (extra) throw err('COMPUTED_KEY_MODIFIER', startTok.s, SyntaxError, extra);
				rec.members.push({ kind: 'dynkey', name: null, key: slot.key, mods: ['sync'], static: isStatic, unwrap: true,
					init, span: { s: startTok.s, e: v.e } });
				k = v.next;
				continue;
			}
			if (lhsDo && slot.comprehension) throw err('DRAIN_TAKES_SOURCE', startTok.s, SyntaxError, laneSaid, code.slice(slot.s, slot.e));

			if (fallback && slot.comprehension) throw err('DRAIN_NO_FALLBACK', startTok.s, SyntaxError, code.slice(spans[k].s, fallback.s).trim());

			rec.members.push({ kind: 'field', name: slot.name, names: slot.names || undefined, pattern: slot.pattern || undefined,
				mods: fmods, static: isStatic, soft: lhsTry && !lhsDo, emit: lhsYield, memo: lhsMemo, mut: slot.mut, comprehension: slot.comprehension,
				unwrap: mods.length > 0, fallback, init, span: { s: startTok.s, e: v.e }, from: startTok.s, doBlock: lhsDo, doTry: lhsDo && lhsTry });
			k = v.next;
			continue;
		}

		if (spans[k].w === 'sync' && opens(k))
			throw err('SYNC_RETIRED', spans[k].s);
		if (retiredOf(spans[k].w) && ROLE_WORDS.has(retiredOf(spans[k].w)) && opens(k))
			throw err('ROLE_WORD_RETIRED', spans[k].s, SyntaxError, spans[k].w, retiredOf(spans[k].w), spans[k + 1] && spans[k + 1].w || '…');
		if (spans[k].w === 'indexed' && opens(k))
			throw err('INDEXED_ALONE', spans[k].s);
		if (spans[k].w === 'using' && opens(k))
			throw err('USING_NAMES_PACKAGE', spans[k].s, SyntaxError, spans[k + 1].w || '…');
		let untracked = false, mut = null, acc = null;
		const tier = lhsTier, tierTok = lhsTierTok;
		const words = tier ? [tier] : [];
		if (spans[k] && spans[k].w === 'untracked' && opens(k)) { untracked = true; words.push('untracked'); k++; }

		if (spans[k] && TIER_WORDS.has(spans[k].w) && opens(k)) {
			if (tier !== null) throw err('ONE_TIER', spans[k].s, SyntaxError, tier, spans[k].w);
			throw err('TIER_LEADS_HEAD', spans[k].s, SyntaxError, spans[k].w, [headSoFar(), untracked ? 'untracked' : null, spans[k + 1].w || '…'].filter(Boolean).join(' '), [headSoFar(), untracked ? 'untracked' : null, spans[k].w].filter(Boolean).join(' '));
		}

		let volatile = false, role = null, roleTok = null;
		if (spans[k] && spans[k].w === 'volatile' && opens(k)) {
			if (untracked) throw err('ONE_TRACKING_WORD', spans[k].s);
			volatile = true; k++;
			if (spans[k] && spans[k].w === 'untracked' && opens(k)) throw err('ONE_TRACKING_WORD', spans[k].s);
			if (spans[k] && retiredOf(spans[k].w) && ROLE_WORDS.has(retiredOf(spans[k].w)) && opens(k))
				throw err('ROLE_WORD_RETIRED_VOLATILE', spans[k].s, SyntaxError, spans[k].w, retiredOf(spans[k].w), spans[k + 1] && spans[k + 1].w || '…');
		}
		if (spans[k] && ROLE_WORDS.has(spans[k].w) && opens(k)) {
			role = roleOf(spans[k].w); roleTok = spans[k]; k++;
			if (spans[k] && ROLE_WORDS.has(spans[k].w) && opens(k))
				throw err('ONE_ROLE', spans[k].s, SyntaxError, roleTok.w, spans[k].w);
			if (spans[k] && (spans[k].w === 'volatile' || spans[k].w === 'untracked') && opens(k))
				throw err('COLUMN_WORD_BEFORE_ROLE', spans[k].s, SyntaxError, spans[k].w, roleTok.w, spans[k + 1].w || '…');
			if (spans[k] && (spans[k].w === 'try' || spans[k].w === 'static') && opens(k))
				throw err('WORD_AT_LEFT_MARGIN', spans[k].s, SyntaxError, spans[k].w, roleTok.w, spans[k + 1].w || '…');
		}
		if (spans[k] && DESCRIPTOR_WORDS.has(spans[k].w) && opens(k)) {
			mut = spans[k].w; k++;
			if (spans[k] && (ROLE_WORDS.has(spans[k].w) || spans[k].w === 'volatile') && opens(k))
				throw err('ROLE_LEADS_DESCRIPTOR', spans[k].s, SyntaxError, spans[k].w, mut, spans[k + 1].w || '…');
			if (spans[k] && (DESCRIPTOR_WORDS.has(spans[k].w) || ACCESSOR_KW.has(spans[k].w)) && opens(k))
				throw err('ONE_DESCRIPTOR_LIST', spans[k].s);
			if (spans[k] && TIER_WORDS.has(spans[k].w) && opens(k))
				throw err('TIER_LEADS_HEAD', spans[k].s, SyntaxError, spans[k].w, [headSoFar(), untracked ? 'untracked' : null, mut, spans[k + 1].w || '…'].filter(Boolean).join(' '), mut + ' ' + spans[k].w);
			if (spans[k] && spans[k].w === 'untracked' && opens(k))
				throw err('COLUMN_TIER_UNTRACKED_DESCRIPTOR', spans[k].s, SyntaxError, [tier, 'untracked', mut, spans[k + 1].w || '…'].filter(Boolean).join(' '));
		}

		if ((words.length || role || volatile) && spans[k] && spans[k].w === 'async' && opens(k) && (() => {
			let p = k + 1; if (ACCESSOR_KW.has(spans[p].w) && spans[p + 1] && (spans[p + 1].w || spans[p + 1].c === '[' || spans[p + 1].c === '*')) p++;
			if (spans[p] && spans[p].c === '*') p++;
			let q = -1; if (spans[p] && spans[p].c === '[') { const cl = matchPair(spans, p, to); if (cl >= 0) q = cl + 1; } else if (spans[p] && spans[p].w) q = p + 1;
			if (q < 0 || !spans[q] || spans[q].c !== '(') return false;
			const cl = matchPair(spans, q, to); return cl >= 0 && next(spans, cl).c === '{';
		})()) { words.push('async'); k++; }

		if (spans[k] && ACCESSOR_KW.has(spans[k].w) && opens(k)) { acc = spans[k].w; k++; }
		if (spans[k] && (DESCRIPTOR_WORDS.has(spans[k].w) || ACCESSOR_KW.has(spans[k].w) || LANE_START.has(spans[k].w) || spans[k].w === 'untracked') && opens(k) && spans[k].w !== 'constructor') {
			const w = spans[k].w;
			throw err('LANE_LEADS_OR_ONE_DESCRIPTOR', spans[k].s, SyntaxError, LANE_START.has(w), w === 'setup' ? 'await' : w, [mut, acc].filter(Boolean).join(' ') + (mut || acc ? ' ' : '') + (spans[k + 1].w || 'x'));
		}
		if (k >= to) break;

		let star = false;
		if (spans[k].c === '*') { star = true; k++; }

		const roleOnly = () => { if (role || volatile) throw err('ROLE_DESCRIBES_METHOD', (roleTok || startTok).s, SyntaxError, roleTok ? roleTok.w : 'volatile', (volatile ? 'volatile ' : '') + (roleTok ? roleTok.w + ' ' : '')); };
		if ((role || volatile) && spans[k] && (spans[k].c === '[' || spans[k].c === '{')) roleOnly();

		if (spans[k] && (spans[k].c === '[' || spans[k].c === '{')) {
			const cl = matchPair(spans, k, to);
			if (cl < 0) throw err('BRACKET_NEVER_CLOSES', spans[k].s);
			const bind = next(spans, cl);
			if (bind.w === 'as') throw err('V11_AWAIT_AS_KEY', spans[cl + 1].s, SyntaxError, code.slice(spans[k].s, spans[cl].e));
			if (spans[k].c === '[' && bind.c === '(' && topLevel(spans, k + 1, cl, ',') < 0) {
				if (tier) throw err('TIER_ON_METHOD', tierTok.s, SyntaxError, tier);
				if (mut || untracked || acc && false) {  }
				const end = methodEnd(spans, cl + 1, to);
				if (end < 0) throw err('COMPUTED_METHOD_NEVER_CLOSES', startTok.s);
				rec.members.push({ kind: acc ? 'accessor' : 'method', name: null, mods: [...words, ...(acc ? [acc] : [])], static: isStatic,
					key: code.slice(spans[k].e, spans[cl].s), init: null, soft: lhsTry, mut, span: { s: startTok.s, e: spans[end].e } });
				k = end + 1;
				continue;
			}
			if (acc) { if (mut) throw err('ONE_DESCRIPTOR', spans[k].s); mut = acc; acc = null; }
			const text = code.slice(spans[k].s, spans[cl].e);
			if (spans[k].c === '[' && topLevel(spans, k + 1, cl, ',') < 0) {

				const keyText = code.slice(spans[k].e, spans[cl].s);
				const extra = lhsTry ? 'try' : mut || (untracked ? 'untracked' : null) || tier;
				if (extra) throw err('COMPUTED_KEY_MODIFIER', startTok.s, SyntaxError, extra);
				const end = bind.c === '=' ? initEnd(cl + 1) : null;
				if (end && hasAwait(code.slice(spans[cl + 1].e, end.e)))
					throw err('V11_KEY_BOUND_WITH_EQUALS', spans[cl + 1].s, SyntaxError, keyText.trim(), code.slice(spans[cl + 1].e, end.e).trim().replace(/^await\s+/, ''));
				rec.members.push({ kind: 'dynkey', name: null, key: keyText, mods: [], static: isStatic, unwrap: false,
					init: end ? { s: spans[cl + 1].e, e: end.e } : null, span: { s: startTok.s, e: end ? end.e : spans[cl].e } });
				k = end ? end.next : cl + 1 + (bind.c === ';' ? 1 : 0);
				continue;
			}

			if (bind.c !== '=') throw err('PATTERN_BINDS', spans[k].s, SyntaxError, text);
			const pt = patternTargets(text);
			if (!pt) throw err('PATTERN_UNREADABLE', spans[k].s, SyntaxError, text);
			const end = initEnd(cl + 1);
			const vtext = code.slice(spans[cl + 1].e, end.e);
			if (hasAwait(vtext)) throw err('V11_PATTERN_BOUND_WITH_EQUALS', spans[cl + 1].s, SyntaxError, text, vtext.trim().replace(/^await\s+/, ''));
			rec.members.push({ kind: 'field', name: pt.names[0], names: pt.names, pattern: pt.target, mods: words, static: isStatic, soft: lhsTry,
				emit: false, memo: false, mut, unwrap: false, init: { s: spans[cl + 1].e, e: end.e }, span: { s: startTok.s, e: end.e }, from: startTok.s });
			k = end.next;
			continue;
		}

		const nameTok = spans[k];
		if (!nameTok || !nameTok.w) { if (nameTok && (nameTok.c === '?' || nameTok.c === '&' || nameTok.c === '@')) { k++; continue; } k++; continue; }
		const name = nameTok.w;
		k++;

		if (name.length > 2 && /^[$ΔΣΦø]/.test(name) && /[$ΔΣΦø]$/.test(name))
			throw err('DOUBLE_SIDED_SIGILS', nameTok.s, TypeError, name);

		const ctorMods = [...(ctorGrain ? [canonLane(ctorGrain)] : []), ...ctorWords];
		if (name === 'constructor' && spans[k]?.c === '*' && !ctorMods.includes('iterable')) { ctorMods.push('iterable'); k++; }
		else if (name === 'constructor' && spans[k]?.c === '*') k++;

		let comprehension = null;
		const _cb = spans[k]?.c;
		if ((_cb === '[' || _cb === '{') && next(spans, k).c === (_cb === '[' ? ']' : '}')) {
			if (jump(spans, k, 2).c !== '*')
				throw err('BARE_COMPREHENSION_RETIRED', nameTok.s, SyntaxError, name, _cb === '[' ? '[]*' : '{}*');
			comprehension = _cb === '[' ? 'array' : 'object';
			k += 3;
		}

		if (spans[k] && spans[k].c === '(') {
			const cl = matchPair(spans, k, to);
			if (cl >= 0 && next(spans, cl).c !== '{') {
				const asAt = topLevelAs(spans, cl + 1, valueEnd(cl + 1).last);
				throw err('CALL_NOT_MEMBER', nameTok.s, SyntaxError, asAt >= 0, asAt >= 0 ? code.slice(nameTok.s, spans[cl].e) + ' as ' + code.slice(spans[asAt].e, valueEnd(asAt + 1).e).trim() : '', name);
			}
			const end = methodEnd(spans, k, to);
			if (end < 0) throw err('METHOD_BODY_NEVER_CLOSES', nameTok.s, SyntaxError, name);

			if (tier) throw err('TIER_ON_METHOD_NAMED', tierTok.s, SyntaxError, tier, name);

			const m = { kind: acc ? 'accessor' : 'method', name, mods: [...words, ...ctorMods, ...(acc ? [acc] : [])], static: isStatic,
				init: null, soft: lhsTry, mut, span: { s: startTok.s, e: spans[end].e } };

			if (role || volatile) {
				if (acc) throw err('ROLE_ON_GETTER', (roleTok || startTok).s, SyntaxError, roleTok ? roleTok.w : 'volatile', name, role === 'effect');
				if (name === 'constructor') throw err('CTOR_NO_ROLE', (roleTok || startTok).s);
				if (star) throw err('ROLE_NOT_GENERATOR', (roleTok || startTok).s, SyntaxError, roleTok ? roleTok.w : 'volatile', name);
				if (words.includes('async')) throw err('ROLE_NOT_ASYNC', (roleTok || startTok).s, SyntaxError, roleTok ? roleTok.w : 'volatile', name);
				m.role = role; m.volatile = volatile; m.roleWord = roleTok ? roleTok.w : null;
			}
			if (name === 'constructor') {
				if (cursor) cursor.ctor = true;

				const face = isStatic ? 'sctor' : 'ctor';
				m.kind = face;
				if (rec[face]) throw err('ONE_CONSTRUCTOR', startTok.s, SyntaxError, rec.name, isStatic);
				if (isStatic && ctorGrain)
					throw err('SCTOR_NO_LANE', startTok.s, SyntaxError, rec.name, ctorGrain);

				m.star = star || ctorMods.includes('iterable');
				if (!m.star) {
					const src = code.slice(spans[k].s, spans[end].e), own = ownTokens(src);
					const emits = !!own && own.own.some(i => own.t[i].w === 'yield' && !isName(own.t, i, src) &&
						!(own.t[i + 1] && own.t[i + 1].w === 'super'));
					if (emits) throw err('CTOR_EMITS_ITERATES', startTok.s, SyntaxError, rec.name, isStatic);
				}
				rec[face] = m;
			}
			else rec.members.push(m);
			k = end + 1;
			continue;
		}
		roleOnly();
		if (acc) { if (mut) throw err('ONE_DESCRIPTOR', nameTok.s); mut = acc; acc = null; }

		if (spans[k] && spans[k].w === 'as' && k < to)
			throw err('V11_VALUE_FIRST_AWAIT', spans[k].s, SyntaxError, code.slice(spans[k].e, valueEnd(k + 1).e).trim(), [mut, name].filter(Boolean).join(' '));
		if (spans[k] && spans[k].c === '=') {
			const end = initEnd(k);
			const vtext = code.slice(spans[k].e, end.e);

			{
				const L = leading(vtext.trim()), slotText = [tier, untracked ? 'untracked' : null, mut, name + (comprehension ? (comprehension === 'array' ? '[]*' : '{}*') : '')].filter(Boolean).join(' ');
				const soft = L.kws[0] === 'try', isDo = L.kws[0] === 'do';
				const opd = L.opd.replace(/^await\s+/, '');
				const whole = soft && tryOperandEnd(opd) === opd.length;

				const first = L.t && L.t.find(q => q.s >= L.at);
				if (isDo && (hasAwait(vtext) || L.has('await')))
					throw err('V11_FIELD_EQUALS_NEVER_WAITS', spans[k].s, SyntaxError, name, 'do ' + (L.has('try') || lhsTry ? 'try ' : '') + 'await ' + L.opd, slotText);
				if (isDo && lhsTry) throw err('TRY_INSIDE_DO', startTok.s, SyntaxError, name, L.opd);
				if (first && first.c === '{' && (soft || lhsTry) && !isDo) {
					const opd = soft ? L.opd : vtext.trim(), lt = lexOr(opd) || [], cl = lt.length ? matchPair(lt, 0) : -1, tail = cl >= 0 ? opd.slice(lt[cl].e).trim() : '';
					const fb = /^\?\?\s+/.test(tail) ? ' catch { ' + tail.replace(/^\?\?\s+/, '') + ' }' : '';
					throw err('BRACES_AFTER_DO', spans[k].s, SyntaxError, name, cl >= 0 && (fb || /^(?:catch|finally)\b/.test(tail) === false) ? opd.slice(0, lt[cl].e) + fb : opd, tail && !fb && !/^(?:catch|finally)\b/.test(tail) ? tail : '');
				}
				if (hasAwait(vtext))
					throw err('V11_FIELD_EQUALS_NEVER_WAITS', spans[k].s, SyntaxError, name, (soft || lhsTry ? 'try ' : '') + 'await ' + opd, slotText);
				if (whole)
					throw err('TRY_LEADS_FIELD', spans[k].s, SyntaxError, slotText, opd);
			}
			rec.members.push({ kind: 'field', name, mods: words, static: isStatic, soft: lhsTry, emit: false, memo: false, mut, comprehension,
				unwrap: false, init: { s: spans[k].e, e: end.e }, span: { s: nameTok.s, e: end.e }, from: startTok.s });
			k = end.next;
			continue;
		}

		const afterBare = spans[k];
		if (afterBare && k < to && (afterBare.w || /^[[{*]$/.test(afterBare.c || '')) && !/\n/.test(code.slice(nameTok.e, afterBare.s))) {
			throw err('NOT_A_MODIFIER', nameTok.s, SyntaxError, name, afterBare.w || afterBare.c);
		}

		rec.members.push({ kind: 'field', name, mods: words, static: isStatic, soft: lhsTry, emit: false, memo: false, mut, comprehension, init: null,
			unwrap: false, span: { s: nameTok.s, e: nameTok.e }, from: startTok.s });
	}
	overrideMember();
	if (ov !== null) throw err('OVERRIDE_NEEDS_MEMBER', ov.at);
}

function suspends(member, code) {

	if (member.unwrap) return true;
	if (!member.init) return false;
	const t = lexOr(code.slice(member.init.s, member.init.e)); if (!t) return false;

	const own = ownTokens(code.slice(member.init.s, member.init.e));
	const mine = own ? new Set(own.own.map(i => own.t[i].s)) : null;
	for (let i = 0; i < t.length; i++) {
		if (t[i].w !== 'await' && t[i].w !== 'yield') continue;
		if (mine && !mine.has(t[i].s)) continue;
		if (isName(t, i, code.slice(member.init.s, member.init.e))) continue;
		if (i > 0 && t[i - 1].c === '.') continue;
		if (t[i + 1] && t[i + 1].c === ':') continue;
		return true;
	}
	return false;
}

function lifecycleOf(member) {
	for (const m of member.mods) {

		if (m === 'async' && member.mods.some(isBlocking)) return 'asyncdelay';

		if (m === 'defer') return member.mods.includes('batch') ? 'deferbatch' : 'defer';
		if (isBlocking(m)) return 'sync';
		if (FIELD_MODS.has(m)) return m;
	}
	return null;
}

function rowFor(m, code) {

	const sp = suspends(m, code);
	const lc = lifecycleOf(m) || (sp && !m.bare ? 'sync' : null);
	const comp = m.comprehension ? (sp ? 'drain' : 'spread') : null;
	const tier = m.name != null && TIER.test(String(m.name).replace(/^[@&?]+/, ''));
	const soft = !!m.soft || !!m.doBlock || (m.init && /^(?:try|do)$/.test(leading(code.slice(m.init.s, m.init.e)).kws[0] || ''));
	return FIELD.find(r =>

		(r.memo === undefined || !!r.memo === !!m.memo) &&
		(!!r.soft === !!(soft && !sp)) &&
		(!!r.bare === !!m.bare) &&
		(r.lc === null || r.lc === lc) &&
		(r.susp === null || r.susp === sp) &&
		(r.tier === undefined || r.tier === tier) &&
		r.comp === comp) || FIELD[FIELD.length - 1];
}

const NATIVE = new Map(Object.entries({
	method: `
		addEventListener after animate append appendChild ariaNotify attachInternals attachShadow before
		blur checkVisibility click cloneNode closest compareDocumentPosition computedStyleMap contains
		dispatchEvent focus getAnimations getAttribute getAttributeNS getAttributeNames getAttributeNode
		getAttributeNodeNS getBoundingClientRect getClientRects getElementsByClassName
		getElementsByTagName getElementsByTagNameNS getHTML getRootNode hasAttribute hasAttributeNS
		hasAttributes hasChildNodes hasPointerCapture hidePopover insertAdjacentElement
		insertAdjacentHTML insertAdjacentText insertBefore isDefaultNamespace isEqualNode isSameNode
		lookupNamespaceURI lookupPrefix matches moveBefore normalize prepend querySelector
		querySelectorAll releasePointerCapture remove removeAttribute removeAttributeNS
		removeAttributeNode removeChild removeEventListener replaceChild replaceChildren replaceWith
		requestFullscreen requestPointerLock scroll scrollBy scrollIntoView scrollIntoViewIfNeeded
		scrollTo setAttribute setAttributeNS setAttributeNode setAttributeNodeNS setHTMLUnsafe
		setPointerCapture showPopover toggleAttribute togglePopover webkitMatchesSelector
		webkitRequestFullScreen webkitRequestFullscreen when`,
	readonly: `
		ATTRIBUTE_NODE CDATA_SECTION_NODE COMMENT_NODE DOCUMENT_FRAGMENT_NODE DOCUMENT_NODE
		DOCUMENT_POSITION_CONTAINED_BY DOCUMENT_POSITION_CONTAINS DOCUMENT_POSITION_DISCONNECTED
		DOCUMENT_POSITION_FOLLOWING DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC
		DOCUMENT_POSITION_PRECEDING DOCUMENT_TYPE_NODE ELEMENT_NODE ENTITY_NODE ENTITY_REFERENCE_NODE
		NOTATION_NODE PROCESSING_INSTRUCTION_NODE TEXT_NODE assignedSlot attributeStyleMap attributes
		baseURI childElementCount childNodes children clientHeight clientLeft clientTop clientWidth
		currentCSSZoom dataset firstChild firstElementChild isConnected isContentEditable lastChild
		lastElementChild localName namespaceURI nextElementSibling nextSibling nodeName nodeType
		offsetHeight offsetLeft offsetParent offsetTop offsetWidth ownerDocument parentElement
		parentNode prefix previousElementSibling previousSibling scrollHeight scrollWidth shadowRoot
		tagName`,
	property: `
		accessKey ariaActiveDescendantElement ariaAtomic ariaAutoComplete ariaBrailleLabel
		ariaBrailleRoleDescription ariaBusy ariaChecked ariaColCount ariaColIndex ariaColIndexText
		ariaColSpan ariaControlsElements ariaCurrent ariaDescribedByElements ariaDescription
		ariaDetailsElements ariaDisabled ariaErrorMessageElements ariaExpanded ariaFlowToElements
		ariaHasPopup ariaHidden ariaInvalid ariaKeyShortcuts ariaLabel ariaLabelledByElements ariaLevel
		ariaLive ariaModal ariaMultiLine ariaMultiSelectable ariaOrientation ariaPlaceholder
		ariaPosInSet ariaPressed ariaReadOnly ariaRelevant ariaRequired ariaRoleDescription ariaRowCount
		ariaRowIndex ariaRowIndexText ariaRowSpan ariaSelected ariaSetSize ariaSort ariaValueMax
		ariaValueMin ariaValueNow ariaValueText autocapitalize autofocus classList className
		contentEditable dir draggable editContext elementTiming enterKeyHint hidden id inert innerHTML
		innerText inputMode lang nodeValue nonce onabort onanimationend onanimationiteration
		onanimationstart onauxclick onbeforecopy onbeforecut onbeforeinput onbeforematch onbeforepaste
		onbeforetoggle onbeforexrselect onblur oncancel oncanplay oncanplaythrough onchange onclick
		onclose oncommand oncontentvisibilityautostatechange oncontextlost oncontextmenu
		oncontextrestored oncopy oncuechange oncut ondblclick ondrag ondragend ondragenter ondragleave
		ondragover ondragstart ondrop ondurationchange onemptied onended onerror onfocus onformdata
		onfullscreenchange onfullscreenerror ongotpointercapture oninput oninvalid onkeydown onkeypress
		onkeyup onload onloadeddata onloadedmetadata onloadstart onlostpointercapture onmousedown
		onmouseenter onmouseleave onmousemove onmouseout onmouseover onmouseup onmousewheel onpaste
		onpause onplay onplaying onpointercancel onpointerdown onpointerenter onpointerleave
		onpointermove onpointerout onpointerover onpointerrawupdate onpointerup onprogress onratechange
		onreset onresize onscroll onscrollend onscrollsnapchange onscrollsnapchanging onsearch
		onsecuritypolicyviolation onseeked onseeking onselect onselectionchange onselectstart
		onslotchange onstalled onsubmit onsuspend ontimeupdate ontoggle ontransitioncancel
		ontransitionend ontransitionrun ontransitionstart onvolumechange onwaiting onwebkitanimationend
		onwebkitanimationiteration onwebkitanimationstart onwebkitfullscreenchange
		onwebkitfullscreenerror onwebkittransitionend onwheel outerHTML outerText part popover role
		scrollLeft scrollTop slot spellcheck style tabIndex textContent title translate
		virtualKeyboardPolicy writingSuggestions`,
}).flatMap(([kind, names]) => names.trim().split(/\s+/).map(n => [n, kind])));

function check(rec, code, fail, ctx, g) {
	const soft = ctx && ctx.recover;
	const bad = (key, at, Kind = SyntaxError, ...args) => {
		if (!soft) throw err(key, at, Kind, ...args);
		(ctx.diags || []).push({ level: 'error', at, message: wording(key, ...args), name: Kind.name });
	};
	const grainOf = ctx.grainOf || {};
	const diags = ctx.diags || [];

	for (const m of rec.members) {
		if (m.kind !== 'method' || !m.name || m.name === 'constructor') continue;
		const run = /[$\u03a3\u0394\u03a6\u00f8]+$/.exec(m.name);
		const suffixed = !!run && run[0].length < m.name.length && !/^[$\u03a3\u0394\u03a6\u00f8]/.test(m.name);
		const at = m.span ? m.span.s : rec.head.s;
		if (m.volatile && !m.role) bad('VOLATILE_NAMES_ROLE', at, SyntaxError, m.name);
		if (suffixed && m.role) bad('SIGIL_IN_FRONT', at, SyntaxError, (m.static ? 'static ' : '') + (m.soft ? 'try ' : '') + (m.volatile ? 'volatile ' : '') + m.roleWord + ' ' + run[0] + m.name.slice(0, run.index));
		else if (suffixed) diags.push({ level: 'warn', at, message: wording('SUFFIX_SIGIL_WARNING', rec.name, m.name, `${m.static ? 'static ' : ''}${m.soft ? 'try ' : ''}active ${run[0]}${m.name.slice(0, run.index)}`) });
	}

	if (rec.soft) for (const [m, face, say] of [[rec.ctor, 'instance', 'try ' + ((rec.ctor && rec.ctor.mods.find(x => GRAINS.has(x))) || 'mixed') + ' constructor' + (rec.ctor && rec.ctor.star ? '*' : '') + '()'], [rec.sctor, 'class', 'static try constructor' + (rec.sctor && rec.sctor.star ? '*' : '') + '()']])
		if (m && !m.soft) diags.push({ level: 'warn', at: m.span ? m.span.s : rec.head.s, message: wording('HEAD_TRY_NOT_REACHING_FACE', rec.name, face, say) });

	const contract = !!rec.public;
	if (contract || !/\bextends\b/.test(code.slice(rec.head.s, rec.head.e))) {
		const said = w => w === 'sync' ? 'await' : w === 'batch' ? 'setup async' : w;
		const no = (what, at) => { throw err('NEEDS_A_FACE', at, SyntaxError, what, contract); };
		for (const k of lexOr(code.slice(rec.head.s, rec.head.e)) || []) {
			if (k.w === 'class') break;
			if (k.w && (GRAINS.has(k.w) || STRUCTURAL.has(k.w) || k.w === 'main')) no(k.w, rec.head.s + k.s);
		}
		if (rec.structural && rec.structural.size) no('class*', rec.head.s);
		if (rec.sctor) no('static constructor', rec.sctor.span.s);
		if (rec.usings && rec.usings.length) no('using package', rec.head.s);
		const ctorWord = rec.ctor && rec.ctor.mods.find(w => w !== 'try');
		if (ctorWord) no(ctorWord === 'iterable' ? 'constructor*' : (ctorWord === 'sync' ? 'setup' : ctorWord) + ' constructor', rec.ctor.span.s);
		for (const m of rec.members) {
			const at = m.from != null ? m.from : m.span ? m.span.s : rec.head.s;
			const method = m.kind === 'method' || m.kind === 'accessor';
			if (m.kind === 'emit' || m.emit) no('yield', at);
			if (m.bare) no((m.mods || [])[0] === 'defer' ? 'defer' : 'await', at);
			if (m.setLane) no(said(m.setLane) + ' set', at);
			if (contract && (m.mods || []).some(w => TIER_WORDS.has(w))) throw err('CONTRACT_FIELDS_PUBLIC', at);
			const word = (m.mods || []).find(w => w !== 'static' && !(method && (w === 'async' || ACCESSOR_KW.has(w))));
			if (word) no(said(word), at);
			if (m.mut) no(m.mut, at);
			if (m.memo) no('indexed', at);
			if (m.unwrap) no('as', at);
			if (m.comprehension) no(m.comprehension === 'array' ? '[]*' : '{}*', at);
			if (m.pattern) no(code.slice(m.span.s, m.init ? m.init.s : m.span.e).replace(/\s*(?:=|as)\s*$/, '').trim(), at);
			if ((m.kind === 'field' || m.kind === 'dynkey') && ((m.init && hasAwait(code.slice(m.init.s, m.init.e))) || hasAwait(m.key || '')))
				throw err('FIELD_CANNOT_AWAIT', at, SyntaxError, contract);
		}
	}

	if (contract) {
		if (rec.ext !== 'Contract') throw err('CONTRACT_EXTENDS_CONTRACT', rec.head.s, SyntaxError, rec.ext);

		if (rec.soft) throw err('CONTRACT_NO_SOFT_FACE', rec.head.s);
		for (const m of rec.members) if (m.soft) throw err('CONTRACT_NO_SOFT_MEMBER', m.from != null ? m.from : m.span ? m.span.s : rec.head.s);
		const text = code.slice(rec.head.s, rec.body.e), toks = lexOr(text) || [];
		for (const k of toks) {
			if (k.w === 'async' || k.w === 'await' || k.w === 'yield') throw err('CONTRACT_SYNCHRONOUS', rec.head.s + k.s, SyntaxError, k.w);
			if (k.w === 'Promise') throw err('CONTRACT_NO_PROMISE', rec.head.s + k.s);
			if (k.w === '__fuel') throw err('CONTRACT_FUEL_RESERVED', rec.head.s + k.s);
		}
		for (let i = 0; i < toks.length; i++) {
			const k = toks[i];
			if ((k.w === 'for' || k.w === 'while') && toks[i + 1] && toks[i + 1].c === '(') {
				const close = matchPair(toks, i + 1), n = close > 0 ? toks[close + 1] : null;
				if (n && n.c !== '{' && !(k.w === 'while' && n.c === ';')) throw err('CONTRACT_LOOP_BRACES', rec.head.s + k.s, SyntaxError, k.w);
			}
			if (k.w === 'do' && toks[i + 1] && toks[i + 1].c !== '{' && !(toks[i - 1] && /^\??\.$/.test(toks[i - 1].c || '')))
				throw err('CONTRACT_DO_WHILE_BRACES', rec.head.s + k.s);
		}
		for (const m of rec.members) {
			const at = m.from != null ? m.from : m.span ? m.span.s : rec.head.s;
			if ((m.kind === 'method' || m.kind === 'accessor') && m.span) {
				const mt = lexOr(code.slice(m.span.s, m.span.e)) || [], p = mt.findIndex(k => k.c === '(');
				if (mt.slice(0, p < 0 ? mt.length : p).some(k => k.c === '*')) throw err('CONTRACT_NO_GENERATOR', at);
				if (m.role) throw err('CONTRACT_NO_SIGNAL_FUNCTIONS', at, SyntaxError, m.roleWord || 'active');
			}
			if (m.kind === 'field' && m.static) throw err('CONTRACT_NO_STATIC_FIELD', at);
			if (m.kind === 'dynkey') throw err('CONTRACT_NO_COMPUTED_KEY', at);
			if ((m.mods || []).some(w => TIER_WORDS.has(w))) throw err('CONTRACT_FIELDS_PUBLIC', at);
			if (m.override) throw err('CONTRACT_NO_OVERRIDE', at);
		}
	}

	if (rec.members.some(m => m.emit) && !(rec.structural && rec.structural.has('iterable'))) {
		const m0 = rec.members.find(m => m.emit);
		throw err('MEMBER_EMITS_CLASS_ITERATES', m0.span ? m0.span.s : rec.head.s, SyntaxError, rec.name);
	}

	const grained = m => m.kind === 'field' && m.name != null &&
		(lifecycleOf(m) !== null || suspends(m, code));
	const statedFields = { cls: rec.members.some(m => grained(m) && m.static),
	                       inst: rec.members.some(m => grained(m) && !m.static) };
	if (statedFields.cls && !rec.grain) throw new SyntaxError(wording('STATIC_LANE_NEEDS_GRAIN', rec.name));

	if (rec.sctor) {
		const sp = ctorParts(rec, code, rec.sctor);
		const at = rec.sctor.span.s;
		const say = (key, ...args) => err(key, at, SyntaxError, rec.name || '(anonymous)', ...args);
		if (sp.params) throw say('SCTOR_NO_PARAMS');
		if (sp.superArgs) throw say('SCTOR_SUPER_NO_ARGS', rec.ext);
		if (sp.superArgs !== null && !rec.ext) throw say('SCTOR_SUPER_NEEDS_EXTENDS');
		if (sp.superArgs !== null && !sp.superForm) throw say('SCTOR_BARE_SUPER');
		if (sp.superForm === 'void') throw say('SCTOR_VOID_SUPER');
		if (hasAwait(sp.prefix)) throw say('SCTOR_SUSPEND_BEFORE_SUPER', rec.ext);
		if ((sp.superForm || hasAwait(sp.tail)) && !rec.grain) throw say('SCTOR_NEEDS_GRAIN', sp.superForm);
		if (sp.superForm === 'yield' && rec.grain === 'sync') throw say('SCTOR_SETUP_AWAITS_SUPER');
		if (sp.superForm && rec.grain === 'async') throw say('SCTOR_ASYNC_NOTHING_TO_WAIT', sp.superForm);
		const blk = rec.members.find(m => m.kind === 'staticBlock');
		if (blk) throw err('SCTOR_FOLD_STATIC_BLOCK', blk.span.s, SyntaxError, rec.name || '(anonymous)');
	}

	{
		const pr = rec.ext && grainOf[rec.ext] && grainOf[rec.ext].rec;
		if (pr) for (const m of rec.members) {
			if (m.kind !== 'field' || m.name == null) continue;
			const theirs = pr.members.find(x => x.kind === 'field' && x.name === m.name && !!x.static === !!m.static);
			if (!theirs) continue;
			if (theirs.mut === 'set' && !m.static) {

				throw err('SET_PER_LEVEL_NOT_BUILT', m.span ? m.span.s : rec.head.s, SyntaxError, rec.name, emitName(m.name), rec.ext);
			}
			if (theirs.mut !== 'const' && theirs.mut !== 'enum') continue;
			if (m.soft) { diags.push({ level: 'warn', message: wording('CONST_IN_PARENT_SOFT', rec.name, emitName(m.name), theirs.mut, rec.ext) }); continue; }
			throw err('CONST_IN_PARENT_HARD', m.span ? m.span.s : rec.head.s, SyntaxError, rec.name, emitName(m.name), theirs.mut, rec.ext);
		}
	}
	if (statedFields.inst) {

		const ctorSays = (rec.ctor && (rec.ctor.mods.some(x => LINK[x] || GRAINS.has(x))
			|| (g.parts && g.parts.superForm))) || !!rec.grain;
		if (!ctorSays) throw new SyntaxError(wording('FIELD_LANE_NEEDS_GRAIN', rec.name, rec.ctor));
	}

	for (const m of rec.members) {

		if (m.kind !== 'field' || !(suspends(m, code) || lifecycleOf(m))) continue;

		if (m.bare) continue;

		const raw = m.static ? rec.grain : (rec.ctor && rec.ctor.mods.map(canonLane).find(x => ADMITS[x])) || rec.grain;
		const side = raw && ADMITS[raw] ? raw : 'mixed';
		const lane = SLOT_LANE[slotOf(m, code)] || 'sync';
		if (!ADMITS[side].includes(lane))
			throw new SyntaxError(wording('GRAIN_ADMITS', rec.name, side === 'sync' ? 'setup' : side, ADMITS[side].map(w => w === 'sync' ? 'setup' : w).join('/'), m.name, lane === 'sync' ? 'setup' : lane, lane === 'async'));
	}

	const parent = rec.ext ? grainOf[rec.ext] : undefined;
	const parentGrain = parent && parent.link;
	const childLink = g.link;

	const declared = { class: rec.grain, instance: g.dInst };
	for (const [face, theirs] of [
		['class', parent && parent.cls], ['instance', parent && parent.inst]]) {

		const mine = declared[face];
		if (mine !== 'sync' || !theirs || theirs === 'sync') continue;
		throw new SyntaxError(wording('SETUP_FACE_OVER_FAN_PARENT', rec.name, face, rec.ext, theirs));
	}

	if (parent && parent.dcls === 'sync' && childLink !== 'sync')
		throw new SyntaxError(wording('SETUP_PARENT_NEEDS_AWAIT_SUPER', rec.name, rec.ext, FORM[childLink] ? `'${FORM[childLink]} super()'` : "a bare 'super()'"));

	if ((childLink === 'sync' || childLink === 'mixed') && parentGrain === 'async')
		throw new SyntaxError(wording('ASYNC_PARENT_NOTHING_TO_WAIT', rec.name, rec.ext, FORM[childLink]));

	const settleRank = (() => {
		const fields = rec.members.filter(m => m.kind === 'field' || m.kind === 'dynkey');
		const { pre, post, tail, acq } = settleOrder(fields, code, false);
		const order = [...pre, ...tail];

		const assign = new Map(), init = new Map(), src = new Map();
		fields.forEach((m, i) => src.set(m, i));
		order.forEach((m, i) => assign.set(m, i));

		const landed = f => pre.length + post.filter(g => !acq(g) && src.get(g) < src.get(f)).length;
		order.forEach(m => init.set(m, acq(m) ? landed(m) : assign.get(m)));
		return { assign, init, src };
	})();
	member: for (const f of rec.members) {
		const body = settleRank.init.has(f) ? fieldBody(f, code) : null;
		if (body === null) continue;
		for (const g of rec.members) {
			if (g.kind !== 'field' || g.name == null || !settleRank.assign.has(g)) continue;
			if (settleRank.assign.get(g) < settleRank.init.get(f)) continue;
			if (slotOf(g, code) === 'fan') continue;

			if (g !== f && settleRank.src.get(g) > settleRank.src.get(f)) continue;
			const n = escRe(sigilBare(g.name));
			if (!new RegExp(`this\\s*\\.\\s*${n}\\b`).test(body)) continue;
			bad('FIELD_READS_LATER_FIELD', f.span && f.span.s, SyntaxError, rec.name, f.name, sigilBare(g.name), g === f);
			continue member;
		}
	}

	const cp = g.parts;
	if (cp && cp.params.trim()) {
		const paramNames = [];

		const segs = [];
		let d = 0, last = 0;
		for (let i = 0; i < cp.params.length; i++) {
			const c = cp.params[i];
			if (c === '(' || c === '[' || c === '{') d++;
			else if (c === ')' || c === ']' || c === '}') d--;
			else if (c === ',' && d === 0) { segs.push(cp.params.slice(last, i)); last = i + 1; }
		}
		segs.push(cp.params.slice(last));
		for (const seg of segs) {
			const pt = lexOr(seg); if (!pt) continue;
			let i = 0;
			if (pt[i] && pt[i].c === '...') i++;
			if (pt[i] && pt[i].w && (!pt[i + 1] || pt[i + 1].c === '=')) paramNames.push(pt[i].w);
		}
		param: for (const f of rec.members) {
			const body = fieldBody(f, code);
			if (body === null) continue;
			for (const pn of paramNames)
				if (new RegExp(`(?<![.\\p{ID_Continue}$#])${escRe(pn)}(?![\\p{ID_Continue}$])(?!\\s*:)`, 'u').test(body)) {
					bad('FIELD_READS_CTOR_PARAM', f.span && f.span.s, SyntaxError, rec.name, f.name, pn);
					continue param;
				}
		}
	}

	if (rec.ext) {
		const I = typeof globalThis !== 'undefined' ? globalThis.Instance : undefined;
		const IE = typeof globalThis !== 'undefined' && typeof globalThis.InstanceError === 'function' ? globalThis.InstanceError : SyntaxError;
		let root = rec.ext;
		for (let r = grainOf[root] && grainOf[root].rec, seen = new Set([rec]); r && r.ext && !seen.has(r); r = grainOf[root] && grainOf[root].rec) { seen.add(r); root = r.ext; }
		for (const m of rec.members) {
			if (m.kind !== 'field' || m.static) continue;
			const plain = !!m.init && !m.mut && !(m.mods && m.mods.length) && rowFor(m, code).slot === 'plain';
			for (const raw of m.names || [m.name]) {
				const n = emitName(raw);
				if (!n || /^[$\u03a3\u0394\u03a6\u00f8#]/.test(n)) continue;
				const exact = I && typeof I.isIntrinsic === 'function' ? I.isIntrinsic(root, n) : undefined;
				const kind = exact !== undefined ? exact : NATIVE.get(n) || false;
				if (!kind || (plain && kind === 'property')) continue;
				bad('NATIVE_NAME', m.from != null ? m.from : m.span ? m.span.s : rec.head.s, IE, rec.name, kind, n);
			}
		}
	}
	return rec;
}

function ctorParts(rec, code, m0 = rec.ctor) {
	if (!m0) return null;
	const t = code.slice(m0.span.s, m0.span.e);
	const p0 = t.indexOf('(');
	const params = t.slice(p0 + 1, closeParen(t, p0)).trim();
	const b0 = t.indexOf('{', closeParen(t, p0));
	const body = t.slice(b0 + 1, t.lastIndexOf('}'));

	const bt = lexOr(body) ?? [];
	const si = bt.findIndex((k, i) => k.w === 'super' && bt[i + 1] && bt[i + 1].c === '(');
	const kw = si > 0 && ['yield', 'await', 'void'].includes(bt[si - 1].w) ? bt[si - 1].w : undefined;
	const m = si < 0 ? null : Object.assign([body.slice(kw ? bt[si - 1].s : bt[si].s, bt[si + 1].e), kw], { index: kw ? bt[si - 1].s : bt[si].s });
	if (!m) return { params, superArgs: null, superForm: null, prefix: '', tail: body.trim() };
	const superForm = m[1] || null;
	const prefix = body.slice(0, m.index).trim();
	const s0 = body.indexOf('(', m.index), s1 = closeParen(body, s0);
	let after = s1 + 1;
	if (body[after] === ';') after++;
	return { params, superArgs: body.slice(s0 + 1, s1).trim(), superForm, prefix, tail: body.slice(after).trim() };
}

function statementsOf(text) {
	const t = lexOr(text); if (!t || !t.length) return null;
	const head = at => (t[at].w && t[at + 1] && t[at + 1].c === ':' && t[at + 2]) ? at + 2 : at;
	const name = at => at > 0 && /^\??\.$/.test(t[at - 1].c || '');
	const declares = at => t[at].w === 'function' || t[at].w === 'class' ||
		(t[at].w === 'async' && !!t[at + 1] && t[at + 1].w === 'function');
	const OPEN = new Set(['else', 'do', 'try', 'finally', 'new', 'typeof', 'void', 'delete', 'await',
		'in', 'of', 'instanceof', 'case', 'extends', 'let', 'const', 'var', 'async', 'throw', 'function', 'class']);
	const stmts = [], ctl = new Set();

	let s = 0, d = 0, tpl = 0, block = false, doing = 0;
	const cut = e => { const h = head(s); stmts.push({ s, e, decl: declares(h) ? (t[h].w === 'class' ? 'class' : 'function') : null }); s = e + 1; doing = 0; };

	const ends = at => {
		const p = t[at];
		return !!(p.num || p.lit || /^[)\]}]$/.test(p.c || '') ||
			(/^(\+\+|--)$/.test(p.c || '') && at > s && !/\n/.test(text.slice(t[at - 1].e, p.s))) ||
			(p.w && (!OPEN.has(p.w) || name(at))));
	};
	for (let i = 0; i < t.length; i++) {
		const k = t[i], p = t[i - 1], nx = t[i + 1];
		if (d === 0 && tpl === 0 && i > s && doing !== 1 && /\n/.test(text.slice(p.e, k.s)) &&
		    (k.w === 'let' || k.w === 'const' || (!ctl.has(i - 1) && ends(i - 1) &&
		     ((k.w && !ASI_CONTINUES.has(k.w) && k.w !== 'of' && k.w !== 'extends') || k.num || (k.lit && k.lit !== '`') ||
		      k.c === '++' || k.c === '--' || k.c === '!' || k.c === '~' || (k.c === '{' && !declares(head(s))))))) cut(i - 1);
		if (k.lit === '`') {
			const raw = text.slice(k.s, k.e);
			tpl += (raw.endsWith('${') ? 1 : 0) - (raw[0] === '}' ? 1 : 0);
			continue;
		}
		if (tpl > 0) continue;
		if (k.c === '(' || k.c === '[' || k.c === '{') {
			if (d === 0 && k.c === '{') block = i === head(s) || ctl.has(i - 1) || declares(head(s)) ||
				(!!p && /^(else|try|finally|do|catch)$/.test(p.w || '') && !name(i - 1));
			d++;
			continue;
		}
		if (k.c === ')' || k.c === ']' || k.c === '}') {
			d--;
			if (d === 0 && k.c === '}' && block && doing !== 1 && !(nx && /^(else|catch|finally)$/.test(nx.w || ''))) cut(i);
			continue;
		}
		if (d > 0) continue;
		if (k.c === ';') {
			if (doing !== 1 && !(nx && nx.w === 'else')) cut(i);
			continue;
		}
		if (!k.w || name(i)) continue;
		if (k.w === 'do') doing = 1;
		else if (k.w === 'while' && doing === 1) doing = 2;
		else if (/^(if|for|while|with|switch|catch)$/.test(k.w)) {
			const o = nx && nx.w === 'await' ? i + 2 : i + 1;
			if (t[o] && t[o].c === '(') ctl.add(matchPair(t, o));
		}
	}
	if (s < t.length) cut(t.length - 1);
	return { t, stmts };
}

function softStatements(text) {
	const r = statementsOf(text); if (!r) return text;
	const { t, stmts } = r;
	let out = '', pos = 0;
	for (const st of stmts) {
		const a = t[st.s];
		let body = text.slice(a.s, t[st.e].e);
		if ((a.w === 'let' || a.w === 'const') && t[st.s + 1] && (t[st.s + 1].w || t[st.s + 1].c === '[' || t[st.s + 1].c === '{'))
			body = 'var' + body.slice(a.e - a.s);
		const cls = st.decl === 'class' && a.w === 'class' && t[st.s + 1] && t[st.s + 1].w && t[st.s + 1].w !== 'extends';
		if (cls) body = 'var ' + t[st.s + 1].w + ' = ' + body;
		const keep = st.decl === 'function' || (st.s === st.e && a.c === ';');
		out += text.slice(pos, a.s) + (keep ? body : 'try { ' + body + ' } catch (e) {}');
		pos = t[st.e].e;
	}
	return out + text.slice(pos);
}

function buildIR(rec, code, opts = {}, g = grains(rec, code)) {
	const _structural = {
		cls:  !!(rec.structural && rec.structural.size),
		inst: !!(rec.ctor && rec.ctor.mods && rec.ctor.mods.includes('iterable'))
	};
	const ops = [];

	for (const face of [false, true]) {
		let run = null;
		for (const m of rec.members) {
			if (!!m.static !== face) continue;
			if ((m.mods || []).includes('batch')) {
				if (!run) run = { last: null };
				m.batchLast = false; run.last = m;
			} else if (run) { run.last.batchLast = true; run = null; }
		}
		if (run) run.last.batchLast = true;
	}
	const text = m => (m.init ? code.slice(m.init.s, m.init.e).trim() : undefined);

	const KINDS = new Set(['field', 'dynkey', 'emit']);
	const fields = rec.members.filter(m => KINDS.has(m.kind) && !m.static);
	const statics = rec.members.filter(m => KINDS.has(m.kind) && m.static);

	const sourceEmpty = rec.members.length === 0 && !rec.ctor && !rec.sctor;

	const source = code.slice(rec.head.s, rec.body.e + 1);

	const firstField = rec.members.find(m => m.kind === 'field');
	const anchor = Math.min(
		firstField ? firstField.span.s : Infinity,
		rec.ctor ? rec.ctor.span.s : Infinity);
	const untrackWrap = (t) => {
		const ut = lexOr(t); if (!ut) return t;
		let ui = 0, stat = '';
		if (ut[ui] && ut[ui].w === 'static') { stat = 'static '; ui++; }
		if (!(ut[ui] && ut[ui].w === 'untracked')) return t;
		const rest = t.slice(ut[ui].e).trim();
		const open = rest.indexOf('{'), close = rest.lastIndexOf('}');
		if (open < 0 || close <= open) return stat + rest;
		const bodyAt = ut[ui].e + (t.slice(ut[ui].e).length - rest.length) + open;
		const isAsync = ut.slice(ui + 1).some(k => k.s < bodyAt && k.w === 'async');
		const arrow = isAsync ? 'async () =>' : '() =>';
		return stat + rest.slice(0, open + 1) +
			` return ${rt('untrack')}(${arrow} {` + rest.slice(open + 1, close) + `}); }`;
	};

	const softWrap = (t, on) => {
		if (!on) return t;
		const k0 = lexOr(t); if (!k0) return t;
		const ti = k0.findIndex(x => x.w === 'try');
		if (ti < 0) return t;
		const bare = (t.slice(0, k0[ti].s) + t.slice(k0[ti].e)).replace(/^\s+/, '');
		const k = lexOr(bare); if (!k) return bare;
		const pi = k.findIndex(x => x.c === '(');
		if (pi < 0) return bare;
		const pc = matchPair(k, pi);
		if (pc < 0) return bare;
		let bo = -1;
		for (let i = pc + 1; i < k.length; i++) if (k[i].c === '{') { bo = i; break; }
		if (bo < 0) return bare;
		const bc = matchPair(k, bo);
		if (bc < 0) return bare;
		const head = bare.slice(0, k[bo].e);
		const body = bare.slice(k[bo].e, k[bc].s);
		const tail = bare.slice(k[bc].s);
		const pre = k.slice(0, bo);
		if (pre.some(x => x.c === '*'))
			return head + ' try {' + body + '} catch (e) { return undefined; } ' + tail;
		const arrow = pre.some(x => x.w === 'async') ? 'async () =>' : '() =>';
		return head + ` return ${rt('soft')}(${arrow} {` + body + '}); ' + tail;
	};

	const descStrip = (t, mut) => {
		if (!mut || mut === 'get' || mut === 'set') return t;
		const k = lexOr(t); if (!k) return t;
		const i = k.findIndex(x => x.w === mut);
		if (i < 0) return t;
		return (t.slice(0, k[i].s) + t.slice(k[i].e)).replace(/^\s+/, '').replace(/^(\S+) {2,}/, '$1 ');
	};

	const roleStrip = (t, m) => {
		if (!m.role && !m.volatile) return t;
		const k = lexOr(t); if (!k) return t;
		const bo = k.findIndex(x => x.c === '(');
		const drop = k.filter((x, i) => i < bo && (x.w === m.roleWord || (m.volatile && x.w === 'volatile')));
		let out = t;
		for (const x of drop.reverse()) out = out.slice(0, x.s) + out.slice(x.e).replace(/^[ \t]+/, '');
		return out;
	};

	const rendered = new Map();
	const verbatim = rec.members
		.filter(m => m.kind === 'method' || m.kind === 'accessor' || m.kind === 'staticBlock')
		.map(m => {
			let raw = code.slice(m.span.s, m.span.e);

			if (m.softBlock) raw = 'static { try ' + m.softBlock + ' }';

			if (m.setLane) {
				const rebuilt = laneSetter(raw, m.name, m.setLane, m.soft);
				if (rebuilt) raw = rebuilt;
			}
			raw = descStrip(raw, m.mut);
			raw = roleStrip(raw, m);
			const text = gotoWrap(untrackWrap(tryWrap(localLane(nestWrap(softWrap(raw, m.soft), opts)))));
			rendered.set(m, text);

			const lines = [m.span.s];
			for (let o = code.indexOf('\n', m.span.s); o >= 0 && o < m.span.e; o = code.indexOf('\n', o + 1)) lines.push(o + 1);
			return { text, before: m.span.s < anchor, at: m.span.s, lines };
		});

	const mode = g.mode;
	ops.push({ op: 'SUPER_CALL', mode, at: rec.head });

	const sp = ctorParts(rec, code, rec.sctor);
	const sForm = sp && sp.superForm;
	const staticOps = settleOps(statics, code,
		sForm ? handshakeFor(sForm) : rec.grain === 'mixed' ? null : rec.grain === 'async' ? DETACH_TOKEN : 'this',
		!!(sp && (sp.superArgs !== null || hasAwait(sp.tail))), false, false);

	const softCls = rec.sctor ? !!rec.sctor.soft : !!rec.soft, softCtor = !!(rec.ctor && rec.ctor.soft);
	if (sp && sp.prefix) {
		const at = staticOps.findIndex(o => o.op === 'SEED' || o.op === 'PARTITION');
		staticOps.splice(at < 0 ? staticOps.length : at, 0,
			{ op: 'CTOR_PREFIX', text: softCls ? softStatements(sp.prefix) : sp.prefix, at: rec.sctor.span });
	}
	if (sp && sp.tail) staticOps.push({ op: 'CTOR_TAIL', text: softCls ? softStatements(sp.tail) : sp.tail, at: rec.sctor.span });

	const cp = g.parts;
	if (cp && cp.prefix) ops.push({ op: 'CTOR_PREFIX', text: softCtor ? softStatements(cp.prefix) : cp.prefix, at: rec.ctor.span });
	ops.push(...settleOps(fields, code, handshakeFor(mode),
		rec.grain === 'mixed' || rec.grain === 'sync' || rec.grain === 'async' || mode === 'void', true,
		mode === 'await'));
	if (cp && cp.tail) ops.push({ op: 'CTOR_TAIL', text: softCtor ? softStatements(cp.tail) : cp.tail, at: rec.ctor.span });

	const htext = code.slice(rec.head.s, rec.head.e), ht = lexOr(htext);
	let head = htext.trim(), hi = 0;
	while (ht && ht[hi] && ht[hi].w && HEAD_STRIP.has(ht[hi].w)) hi++;
	if (ht && ht[hi] && ht[hi].w === 'class') {
		let j = hi + 1;
		if (ht[j] && ht[j].c === '*') j++;
		const impl = ht.findIndex((k, x) => x > j && k.w === 'implements');
		const end = impl >= 0 ? ht[impl].s : htext.length;
		head = ('class ' + htext.slice(ht[j] ? ht[j].s : end, end)).trim();
	}

	let plain = null;
	if (!EXTENDS.test(head) || rec.public) {
		const edits = [], put = (s, e, text) => edits.push({ s: s - rec.head.s, e: e - rec.head.s, text });
		const tw = rec.soft && ht ? ht.findIndex(k => k.w === 'try') : -1;
		if (tw >= 0) put(rec.head.s + ht[tw].s, rec.head.s + ht[tw + 1].s, '');

		const pw = rec.public && ht ? ht.findIndex(k => k.w === 'public') : -1;
		if (pw >= 0) put(rec.head.s + ht[pw].s, rec.head.s + ht[pw + 1].s, '');
		for (const m of rec.members) {
			if (rendered.has(m)) {
				const text = rewriteMember(rendered.get(m));
				if (text !== code.slice(m.span.s, m.span.e)) put(m.span.s, m.span.e, text);
				continue;
			}
			if (m.kind !== 'field') continue;
			const col = m.from != null ? lexOr(code.slice(m.from, m.span.s)) : null, t0 = col ? col.findIndex(k => k.w === 'try') : -1;
			if (t0 >= 0) put(m.from + col[t0].s, m.from + (col[t0 + 1] ? col[t0 + 1].s : m.span.s - m.from), '');
			if (!m.init) continue;
			const v = code.slice(m.init.s, m.init.e), inner = tryWrap('=' + v).slice(1), w = inner.trim();

			const opd = !m.paren && /^\{/.test(w) ? w : !/^\{/.test(w) && unaryOperand(w) === w.length ? w : '(' + w + ')';
			const out = !m.soft ? inner : /^\s*/.exec(v)[0] + tryWrap('= try ' + opd).slice(2);
			if (out !== v) put(m.init.s, m.init.e, out);
		}
		if (rec.ctor) {
			const s = rec.ctor.span.s, e = rec.ctor.span.e;
			let text = code.slice(s, e);
			if (rec.ctor.soft) {
				const t = lexOr(text), k0 = t ? t.findIndex(k => k.w === 'try') : -1;
				if (k0 >= 0) text = text.slice(0, t[k0].s) + text.slice(t[k0 + 1].s);
				const u = lexOr(text) || [], p = u.findIndex(k => k.c === '('), pc = p < 0 ? -1 : matchPair(u, p);
				const bo = pc < 0 ? -1 : u.findIndex((k, i) => i > pc && k.c === '{'), bc = bo < 0 ? -1 : matchPair(u, bo);
				if (bc > 0) text = text.slice(0, u[bo].e) + softStatements(text.slice(u[bo].e, u[bc].s)) + text.slice(u[bc].s);
			}
			text = gotoWrap(untrackWrap(tryWrap(localLane(nestWrap(text, opts)))));
			if (text !== code.slice(s, e)) put(s, e, text);
		}
		plain = splice(source, edits);
		if (rec.public) plain = fuel(plain);
	}
	return { name: rec.name, grain: rec.grain, structural: (_structural.cls || _structural.inst) ? _structural : null, ctor: cp, head,
		ops, staticOps, verbatim, sourceEmpty, source, plain, public: !!rec.public,
		headAt: rec.head.s, ctorAt: rec.ctor ? rec.ctor.span.s : rec.head.s };
}

function settleOrder(list, code, split0) {
	const blocks = m => m.kind === 'dynkey' ? !!m.unwrap || hasAwait(m.key) || (!!m.init && hasAwait(code.slice(m.init.s, m.init.e)))
		: m.kind === 'emit' ? !!m.star || hasAwait(code.slice(m.init.s, m.init.e)) : ['spine', 'acquire'].includes(slotOf(m, code));
	const acq = m => m.kind === 'field' && slotOf(m, code) === 'acquire';
	const at = split0 ? 0 : list.findIndex(blocks);
	const pre = at < 0 ? list : list.slice(0, at), post = at < 0 ? [] : list.slice(at);
	return { pre, post, acq, tail: [...post.filter(m => !acq(m)), ...post.filter(acq)] };
}

function settleOps(all, code, handshake, forced, handsOut, syncLink) {
	const ops = [];

	{
		let run = null;
		for (const m of all) {
			if ((m.mods || []).includes('batch')) {
				if (!run) run = { last: null, members: [] };
				m.batchLast = false; run.last = m; m.batchRun = run.members;

				const n = emitName(m.name), defer = (m.mods || []).includes('defer');
				run.members.push({ name: n, soft: !!m.soft, memo: !!m.memo,
					key: defer ? 'join:' + n : 'batch:' + (m.span ? m.span.s : 0), kind: defer ? 'join' : 'batch' });
			} else if (run) { run.last.batchLast = true; run = null; }
		}
		if (run) run.last.batchLast = true;
	}

	const text = m => !m.init ? (m.override ? 'undefined' : BLANK) : m.paren ?    '(' + tryWrap(code.slice(m.init.s, m.init.e).trim()) + ')'

		: m.doBlock ? 'do ' + (m.doTry ? 'try ' : '') + 'await ' + tryWrap(code.slice(m.init.s, m.init.e).trim())

		: tryWrap(code.slice(m.init.s, m.fallback ? m.fallback.s : m.init.e).trim());

	const { pre, post, acq } = settleOrder(all, code, handsOut && syncLink);

	for (const m of pre) ops.push(mkField(m, text(m), code));

	const firstBlock = post.findIndex(m => !acq(m));
	const lead = firstBlock < 0 ? post : post.slice(0, firstBlock);
	for (const m of lead) ops.push(mkField(m, text(m), code, true));

	const seeded = post.filter(m => m.kind === 'field' && slotOf(m, code) !== 'fan' && !m.bare);

	const fanned = post.filter(m => m.kind === 'field' && slotOf(m, code) === 'fan' && !m.bare)
		.flatMap(m => m.names || [m.name]).filter(n => !isPrivate(emitName(n)));
	if (seeded.length || fanned.length) ops.push({ op: 'SEED', names: seeded.flatMap(m => m.names || [m.name]), fans: fanned, value: PENDING,
		at: (seeded[0] || post.find(m => slotOf(m, code) === 'fan')).span });

	if (!post.length) {
		if (forced) ops.push({ op: 'PARTITION', handshake, at: null });
		return ops;
	}
	ops.push({ op: 'PARTITION', handshake, at: null });
	for (const m of post.slice(lead.length)) ops.push(mkField(m, text(m), code, acq(m)));
	for (const m of post) if (acq(m)) ops.push(mkField(m, text(m), code));
	return ops;
}

const definable = o => o.op === 'FIELD' && !o.pattern && !o.emit && !o.soft && !isPrivate(emitName(o.name)) &&
	(o.row.slot === 'plain' || o.row.slot === 'spine' || (o.row.slot === 'acquire' && o.row.lc === 'defer')) &&
	o.row.lc !== 'batch' && !o.row.comp && !o.row.bare && !o.row.tier &&
	!/^(?:try|do)$/.test(leading(String(o.init)).kws[0] || '');

const rowCall = (kind, names) => FIELD_DESCRIPTORS.has(kind)
	? `${rt(kind)}(this, [${names.map(n => sq(n)).join(', ')}]);`
	: `${rt('define')}(this, ${sq(kind)}, [${names.map(n => sq(n)).join(', ')}]);`;

function describeOps(ops, kinds) {
	const segs = [{ at: 0, rows: new Map() }];
	const put = (r, k, n) => r.has(k) ? r.get(k).push(n) : r.set(k, [n]);
	ops.forEach((o, i) => {
		if (o.op === 'FIELD') for (const n of (o.names || [o.name]).filter(Boolean).map(emitName))
			if (kinds.has(n)) { if (definable(o)) o.define = kinds.get(n); else put(segs[segs.length - 1].rows, kinds.get(n), n); kinds.delete(n); }

		if (o.op === 'PARTITION' ||
		    (o.op === 'FIELD' && (o.row.slot === 'spine' || o.row.slot === 'acquire') && (!/batch$/.test(o.row.lc || '') || o.batchLast)) ||
		    (o.op === 'EMIT' && (o.star || hasAwait(o.init))) ||
		    (o.op === 'DYNKEY' && (o.unwrap || hasAwait(o.key) || hasAwait(o.init))) ||
		    ((o.op === 'CTOR_PREFIX' || o.op === 'CTOR_TAIL') && (hasAwait(o.text) || hasAwait(o.text, 'yield'))))
			segs.push({ at: i + 1, rows: new Map() });
	});
	for (const [n, k] of kinds) put(segs[0].rows, k, n);

	for (let s = segs.length - 1; s >= 0; s--) if (segs[s].rows.size)
		ops.splice(segs[s].at, 0, { op: 'LINE', text: [...segs[s].rows].map(([k, v]) => rowCall(k, v)).join(' '), at: null });
	return segs[0].rows.size ? 1 : 0;
}

function fuel(text) {
	const t = lexOr(text); if (!t) return text;
	const NOFUEL = new Set(['if', 'switch', 'catch', 'with', 'else', 'try', 'finally', 'return', 'typeof', 'void', 'delete', 'throw', 'new', 'await', 'yield', 'in', 'of', 'instanceof', 'case', 'class', 'extends']);
	const edits = [];

	const back = close => { let d = 0; for (let i = close; i >= 0; i--) { if (t[i].c === ')') d++; else if (t[i].c === '(') { d--; if (d === 0) return i; } } return -1; };

	const exprEnd = j => { let d = 0, last = j; for (let i = j; i < t.length; i++) { const c = t[i].c; if (c === '(' || c === '[' || c === '{') d++; else if (c === ')' || c === ']' || c === '}') { if (d === 0) break; d--; } else if (d === 0 && (c === ',' || c === ';')) break; last = i; } return last; };
	const body = i => { const close = matchPair(t, i); if (close < 0) return; edits.push({ at: t[i].e, text: ' __fuel.enter(); try {' }); edits.push({ at: t[close].s, text: '} finally { __fuel.exit(); } ' }); };
	for (let i = 0; i < t.length; i++) {
		const k = t[i], p = t[i - 1];
		if (k.c === '{' && p) {
			if (p.c === '=>') { body(i); continue; }
			if (p.w === 'do') { edits.push({ at: k.e, text: ' __fuel();' }); continue; }
			if (p.c !== ')') continue;
			const open = back(i - 1), q = open > 0 ? t[open - 1] : null;
			if (!q || !q.w || NOFUEL.has(q.w)) continue;
			if (q.w === 'for' || q.w === 'while') edits.push({ at: k.e, text: ' __fuel();' }); else body(i);
		} else if (k.c === '=>' && t[i + 1] && t[i + 1].c !== '{') {
			const end = exprEnd(i + 1);
			edits.push({ at: t[i + 1].s, text: '(__fuel.enter(), __fuel.leave(' }); edits.push({ at: t[end].e, text: '))' });
		}
	}

	edits.sort((a, b) => b.at - a.at || (/^[)}]/.test(a.text) ? -1 : 1));
	let out = text; for (const e of edits) out = out.slice(0, e.at) + e.text + out.slice(e.at);
	return out;
}

function emitClass(ir, opts = {}, ats = null) {

	if (!ir.name) {
		const featureless = !(ir.ops || []).length && !(ir.staticOps || []).length
			&& !ir.ctor && !(ir.verbatim || []).length && !ir.grain;
		if (featureless && ir.source) return ir.plain != null ? ir.plain : ir.source;

	}

	if ((!EXTENDS.test(ir.head) || ir.public) && ir.source) return ir.plain != null ? ir.plain : ir.source;

	const grainTag = ir.grain ? ' // @' + ir.grain : '';
	const body = renderOps(ir.ops, 3, ir.usings, ir.usingsPost, !!opts.resume);
	const statics = renderOps(ir.staticOps || [], 3);

	if (opts.resume) {
		const names = [...new Set(ir.ops.filter(o => (o.op === 'FIELD' || o.op === 'FIELD_PRE') && o.name != null)
			.flatMap(o => (o.names || [o.name]).map(emitName)).filter(n => n && !isPrivate(n)))];
		if (names.length) body.unshift({ t: IND.repeat(3) + `${rt('resumable')}(this, [${names.map(sq).join(', ')}]);`, at: ir.headAt != null ? ir.headAt : null });
	}

	return assemble(ir, body, statics, grainTag, ats, ir.name ? '\u00f8' + ir.name : '\u00f8anonymous_' + (++ANON_N));
}

function renderOps(ops, depth, usings, post, resume) {
	const body = [];
	let cur = null;
	const push = text => body.push({ t: IND.repeat(depth) + text, at: cur });

	const lines = (text, trim) => {
		const ls = String(text).split('\n'), code = ls.length > 1 && /[`\\]/.test(text) ? stripComments(text).code : null;
		const cl = code ? code.split('\n') : ls, lt = code && cl.length === ls.length ? lexOr(code) || [] : [];
		const inside = at => lt.some(k => k.lit && k.s < at && k.e > at);
		let pos = 0;
		ls.forEach((line, n) => {
			const end = pos + cl[n].length;
			body.push({ t: inside(pos) ? line : IND.repeat(depth) + (!trim ? line : inside(end) ? line.trimStart() : line.trim()), at: cur });
			pos = end + 1;
		});
	};

	for (const u of (usings || [])) lines(u);

	for (const o of ops) {
		cur = o.at && o.at.s != null ? o.at.s : null;
		switch (o.op) {
			case 'SUPER_CALL':
				break;
			case 'SEED':
				push(seed(o) + ' // @seed');
				break;
			case 'FIELD': {

				let text = o.row.emit(emitName(o.name), o.init, o);
				const nm = emitName(o.name);
				const atBoundary = (t2, fn) => {
					const lines = String(t2).split('\n');
					for (let i = lines.length - 1; i >= 0; i--) {
						const L = lines[i], at = L.indexOf('this.' + nm + ' = ');

						if (at < 0) continue;
						if (L.slice(at + ('this.' + nm + ' = ').length).startsWith('Symbol.for')) continue;
						const vs = at + ('this.' + nm + ' = ').length;

						let ve = vs, d2 = 0;
						for (; ve < L.length; ve++) {
							const ch = L[ve];
							if (ch === '(' || ch === '[' || ch === '{') d2++;
							else if (ch === ')' || ch === ']' || ch === '}') { if (d2 === 0) break; d2--; }
							else if (ch === ';' && d2 === 0) break;
						}
						while (ve > vs && /\s/.test(L[ve - 1])) ve--;
						lines[i] = fn(L, at, vs, ve);
						break;
					}
					return lines.join('\n');
				};

				if (o.fallback)
					text = atBoundary(text, (L, at, vs, ve) => {
						const val = L.slice(vs, ve);
						return L.slice(0, vs) + (/^yield\b/.test(val) ? '(' + val + ')' : val) + ' ' + settleText(o.fallback) + L.slice(ve);
					});
				if (o.emit)
					text = atBoundary(text, (L, at, vs, ve) =>
						L.slice(0, vs) + rt('emit') + '(this, ' + L.slice(vs, ve) + ')' + L.slice(ve));

				if (o.define) {
					const m = String(text).match(/^this\.(\S+) = (yield )?([\s\S]*);$/);
					const word = FIELD_DESCRIPTORS.has(o.define);
					text = m ? `${rt(word ? o.define : 'define')}(this, ${[...(word ? [] : [sq(o.define)]), sq(nm),
							...(o.init === BLANK ? [] : [(m[2] || '') + m[3]])].join(', ')});`
						: `${rowCall(o.define, [nm])}\n${text}`;
				}
				if (o.init === BLANK) text += ' // @blank';
				if (o.pattern && o.row.slot !== 'fan') {
					cur = o.at;

					const fb = o.soft ? ' ?? ' + (/^\[/.test(o.pattern) ? '[]' : '{}') : '';
					text = atBoundary(text, (L, at, vs, ve) =>
						L.slice(0, at) + `(${o.pattern} = ${L.slice(vs, ve)}${fb})` + L.slice(ve));
				}

				const ns = (o.names || [o.name]).map(emitName).filter(n => n && !isPrivate(n));
				if (resume && o.row.slot !== 'acquire' && ns.length && ns.length === (o.names || [o.name]).length &&
				    !(o.pattern && o.row.lc === 'batch') && String(text) !== '') {
					const has = `${rt('resumes')}(this, ${ns.length > 1 ? '[' + ns.map(sq).join(', ') + ']' : sq(ns[0])})`;
					const val = n => `${rt('resumed')}(this, ${sq(n)})`;
					if (o.row.lc === 'batch') {
						lines(String(text).replace(/^(const \S+ = )(.*)(; \/\/ @batch-start)$/m, (_, a, v, z) => `${a}${has} ? ${val(nm)} : (${v})${z}`));
						break;
					}
					const word = o.define && FIELD_DESCRIPTORS.has(o.define);
					const write = o.define && !o.pattern
						? `${rt(word ? o.define : 'define')}(this, ${[...(word ? [] : [sq(o.define)]), sq(nm), val(nm)].join(', ')});`
						: ns.map(n => `this.${n} = ${o.emit && !o.pattern ? rt('emit') + '(this, ' + val(n) + ')' : val(n)};`).join(' ');
					push(`if (${has}) ${ns.length > 1 && !(o.define && !o.pattern) ? '{ ' + write + ' }' : write}`);
					if (!/\n/.test(String(text))) push('else ' + text);
					else { push('else {'); depth++; lines(text); depth--; push('}'); }
					break;
				}
				if (String(text) !== '') lines(text);
				break;
			}
			case 'FIELD_PRE': {
				let pre = o.row.pre(emitName(o.name), o.init, o);

				if (resume && o.name != null && !o.pattern && !isPrivate(emitName(o.name)))
					pre = pre.replace(/^(const \S+ = )(.*)(; \/\/ @defer-start)$/, (_, a, v, z) =>
						`${a}${rt('resumes')}(this, ${sq(emitName(o.name))}) ? ${rt('resumed')}(this, ${sq(emitName(o.name))}) : (${v})${z}`);
				push(pre);
				break;
			}
			case 'EMIT':
				cur = o.at;
				if (o.star) {
					const srcx = hasAwait(o.init) ? 'yield ' + rhs(o.init) : o.init;
					push(`${drainInto(`(${srcx})`, `_ => ${rt('emit')}(this, _)`)};`);
				}
				else if (o.fallback) push(`${rt('emit')}(this, (yield ${rhs(o.init)}) ${settleText(o.fallback)});`);
				else push(`${rt('emit')}(this, ${hasAwait(o.init) ? 'yield ' + rhs(o.init) : o.init});`);
				break;
			case 'DYNKEY':
				cur = o.at;

				push(`this[${hasAwait(o.key) ? 'yield ' + rhs(o.key) : o.key.trim()}] = ${o.unwrap || hasAwait(o.init) ? 'yield ' + rhs(o.init) : o.init};` +
					(o.init === BLANK ? ' // @blank' : ''));
				break;
			case 'PARTITION':
				push(`yield (yield${o.handshake ? ' ' + o.handshake : ''});` +
					' '.repeat(20) + '// @partition');

				for (const t of (post || [])) lines(t);
				break;
			case 'LINE':
				push(o.text);
				break;
			case 'CTOR_PREFIX':
			case 'CTOR_TAIL': {

				lines(settleText(o.text, true), true);
				break;
			}
			default:
				throw new Error('v9 emit: unknown op ' + o.op);
		}
	}

	for (let i = body.length - 2; i >= 0; i--) {
		const m = /^\s*const (\u00f8[^\s=]+) = (.*); \/\/ @(?:defer|batch)-start$/.exec(body[i].t), use = body[i + 1].t;
		if (!m || /^\s*try\b/.test(use) || (use.match(/\u00f8(?:defer|batch)/g) || []).length !== 1) continue;
		const re = new RegExp('(?<![\\p{ID_Continue}$])' + escRe(m[1]) + '(?![\\p{ID_Continue}$])', 'gu');
		if ((use.match(re) || []).length !== 1 || body.reduce((n, b) => n + (b.t.match(re) || []).length, 0) !== 2) continue;
		body[i + 1] = { t: use.replace(re, () => m[2]), at: body[i].at };
		body.splice(i, 1);
	}
	return body;
}

function assemble(ir, body, statics, grainTag, ats, tn) {

	const fmt = v => rewriteMember(v.text).split('\n')
		.map((l, i) => (i ? l : IND + l.trim())).join('\n');
	const vAll = ir.verbatim || [];

	const vBefore = vAll.flatMap(v => {
		const t = fmt(v), at = v.at != null ? v.at : null, ls = t.split('\n');
		return v.lines && v.lines.length === ls.length ? ls.map((l, k) => ({ t: l, at: v.lines[k] })) : [{ t, at }];
	});
	const vAfter = [];
	const verbatim = vBefore;

	if (!body.length && !statics.length && !verbatim.length && !ir.ctor) {
		const t = EXTENDS.test(ir.head) || grainTag
			? `${ir.head} {${grainTag}\n}`
			: `${ir.head} {}`;
		return flatten([{ t, at: ir.headAt }], ats);
	}

	const superMode = (ir.ops.find(o => o.op === 'SUPER_CALL') || {}).mode || 'plain';

	const authored = ir.ctor && ir.ctor.superArgs !== null;

	const params = authored ? ir.ctor.params : '...args';
	const args = authored ? ir.ctor.superArgs : '...args';

	const tag = superMode === 'plain' ? '' : ` // @${superMode}`;
	const sup = `super(${args});${tag}`;

	const H = ir.headAt != null ? ir.headAt : null;
	const C = ir.ctorAt != null ? ir.ctorAt : H;
	const L = (t, at) => ({ t, at });
	const out = [];
	out.push(L(`${ir.head} {${grainTag}`, H));
	const _pv = privateAccessors(ir);
	if (ir.structural) {

		const F = (st) => [
			`${st}[Symbol.iterator]() { return this[Symbol.for('Instance.iterate')]('sync'); }`,
			`${st}[Symbol.asyncIterator]() { return this[Symbol.for('Instance.iterate')]('async'); }`];
		if (ir.structural.inst) _pv.push(...F(IND).map((t, i) => i ? t : t));
		if (ir.structural.cls) _pv.push(...F(IND + 'static '));
	}
	out.push(..._pv.map(t => L(t, H)));
	out.push(...vBefore);
	if (body.length || ir.ctor) {
		if (out.length > 1) out.push(L('', C));
		out.push(L(IND + `constructor(${params}) {${grainTag}`, C));
		out.push(L(IND.repeat(2) + sup, C));

		out.push(L(IND.repeat(2) + `this[Symbol.new](function* ${tn}() {`, C));
		out.push(...body);
		out.push(L(IND.repeat(2) + '});', C));
		out.push(L(IND + '}', C));
	} else if (ir.armOnly) {

		if (out.length > 1) out.push(L('', C));
		out.push(L(IND + `constructor(...args) {${grainTag}`, C));
		out.push(L(IND.repeat(2) + 'super(...args);', C));
		out.push(L(IND.repeat(2) + 'this[Symbol.new](null);', C));
		out.push(L(IND + '}', C));
	}

	if (body.length || ir.ctor || ir.armOnly) out.push(L(IND + `static { ${rt('level')}(this); }`, C));

	out.push(...vAfter);
	if (statics.length) {
		if (out.length > 1) out.push(L('', H));
		out.push(L(IND + 'static {', H));
		out.push(L(IND.repeat(2) + `this[Symbol.new](function* ${tn}_Static() {`, H));
		out.push(...statics);
		out.push(L(IND.repeat(2) + '});', H));
		out.push(L(IND + '}', H));
	}
	out.push(L('}', H));
	return flatten(out, ats);
}

const STMT_BEFORE = new Set([';', '{', '}']);
const STMT_WORDS = new Set(['else', 'do', 'finally']);

function valueBody(inner) {
	const t = lexOr(inner); if (!t) return inner;
	if (!t.length) return inner;
	if (t.some(k => k.w === 'return')) return inner;
	let d = 0, stmts = 0, sawTop = false;
	for (const k of t) {
		if (k.c === '(' || k.c === '[' || k.c === '{') d++;
		else if (k.c === ')' || k.c === ']' || k.c === '}') d--;
		else if (k.c === ';' && d === 0) stmts++;
		else if (d === 0) sawTop = true;
	}
	if (!sawTop) return inner;
	const trimmed = inner.trim().replace(/;\s*$/, '');
	if (stmts > 1 || (stmts === 1 && !/;\s*$/.test(inner.trim()))) return inner;
	return 'return ' + trimmed + ';';
}

function tryWrap(text) {
	const t = lexOr(text); if (!t) return text;
	const edits = [];
	for (let i = 0; i < t.length; i++) {
		if (t[i].w !== 'try') continue;
		const p = t[i - 1];
		if (!p || STMT_BEFORE.has(p.c) || STMT_WORDS.has(p.w) || p.c === ')') continue;
		let k = i + 1, isAwait = false;
		if (t[k] && t[k].w === 'await') { isAwait = true; k++; }
		if (!t[k]) continue;
		let body, end, cat = null, fin = null;
		if (t[k].c === '{') {
			const c = matchPair(t, k);
			if (c < 0) continue;
			body = valueBody(text.slice(t[k].e, t[c].s));
			end = c + 1;
			const clause = (kw) => {
				if (!t[end] || t[end].w !== kw) return null;
				let q = end + 1, param = '';
				if (t[q] && t[q].c === '(') { const pc = matchPair(t, q); param = text.slice(t[q].s, t[pc].e); q = pc + 1; }
				if (!t[q] || t[q].c !== '{') return null;
				const bc = matchPair(t, q);
				const r = { param, body: text.slice(t[q].e, t[bc].s) };
				end = bc + 1;
				return r;
			};
			cat = clause('catch'); fin = clause('finally');
		} else {
			const rest = text.slice(t[k].s);
			const split = unaryOperand(rest);
			if (split === null) continue;
			body = 'return ' + (isAwait ? 'await ' : '') + rest.slice(0, split).trim() + ';';
			end = t.findIndex(x => x.s >= t[k].s + split);
			if (end < 0) end = t.length;
		}
		const asy = isAwait || hasAwait(body) || (cat && hasAwait(cat.body)) ? 'async ' : '';
		const handler = cat ? `catch ${cat.param || '(e)'} { ${valueBody(cat.body)} }` : 'catch (e) { return undefined; }';
		const iife = `(${asy}() => { try { ${body} } ${handler}${fin ? ' finally {' + fin.body + '}' : ''} })()`;
		edits.push({ s: t[i].s, e: t[end - 1] ? t[end - 1].e : text.length, text: (asy ? 'await ' : '') + iife });
		i = end - 1;
	}
	return edits.length ? splice(text, edits) : text;
}

function accessorWordOnField(mods, mut, name, at) {
	const acc = mods.find(w => ACCESSOR_KW.has(w));
	if (!acc) return mut;
	if (mut) {
		throw err('ONE_DESCRIPTOR_LIST', at);
	}
	mods.splice(mods.indexOf(acc), 1);

	return acc;
}

function localLane(text) {

	const t = lexOr(text); if (!t) return text;
	for (let i = 0; i < t.length; i++) {
		const w = t[i].w;
		if (w !== 'let' && w !== 'const') continue;
		const lane = t[i + 1] && t[i + 1].w;
		if (lane !== 'setup' && lane !== 'sync' && lane !== 'async' && lane !== 'defer' && lane !== 'await') continue;
		const nm = t[i + 2];
		if (!nm || !nm.w || !(t[i + 3] && t[i + 3].c === '=')) continue;
		throw err('LOCAL_LANE_RETIRED', t[i].s, SyntaxError, w, lane, nm.w);
	}
	return text;
}

function nestWrap(text, opts) {
	const t = lexOr(text); if (!t) return text;
	if (!t.some(k => k.w === 'class')) return text;
	const r = compile(text, { ...opts, sourceMap: false, manifest: null, verify: false });
	return r.code;
}

function laneSetter(slice, name, policy, soft) {
	const t = lexOr(slice); if (!t) return null;
	const open = t.findIndex(k => k.c === '{');
	if (open < 0) return null;
	const close = matchPair(t, open);
	if (close < 0) return null;
	const pOpen = t.findIndex(k => k.c === '(');
	const pClose = pOpen >= 0 ? matchPair(t, pOpen) : -1;
	const param = pClose > 0 ? slice.slice(t[pOpen].e, t[pClose].s).trim() : 'value';
	const body = slice.slice(t[open].e, t[close].s);

	const info = ownTokens(body);
	let cut = -1;
	if (info) {
		let d = 0;
		for (let i = 0; i < info.t.length; i++) {
			const c = info.t[i].c;
			if (c === '{' || c === '(' || c === '[') { d++; continue; }
			if (c === '}' || c === ')' || c === ']') { d--; continue; }
			if (d === 0 && info.t[i].w === 'await' && info.own.includes(i)) {

				let j = i, dd = 0;
				while (j > 0) {
					const cc = info.t[j - 1].c;
					if (cc === '}' || cc === ')' || cc === ']') dd++;
					else if (cc === '{' || cc === '(' || cc === '[') dd--;
					else if (cc === ';' && dd === 0) break;
					j--;
				}
				cut = info.t[j] ? info.t[j].s : info.t[i].s;
				break;
			}
		}
	}
	const prefix = cut < 0 ? body : body.slice(0, cut);
	const rest = cut < 0 ? '' : body.slice(cut);
	const inner = soft
		? `try { ${rest} } catch (e) {}`
		: rest;
	const sched = rest.trim()
		? `${rt('lane')}(this, ${sq(name)}, ${sq(policy)}, async () => { ${inner} });`
		: '';
	return `set ${name}(${param}) {${prefix}${sched ? '\n        ' + sched + '\n    ' : ''}}`;
}

function rewriteMember(slice) {
	const t = lexOr(slice); if (!t) return slice;
	let i = 0, stat = '';
	if (t[i] && t[i].w === 'static') { stat = 'static '; i++; }
	if (!(t[i] && t[i].w === 'async' && t[i + 1] && t[i + 1].w === 'get')) return slice;
	const name = t[i + 2];
	if (!name || !name.w) return slice;
	const open = t.findIndex((k, j) => j > i + 2 && k.c === '{');
	if (open < 0) return slice;
	const close = matchPair(t, open);
	if (close < 0) return slice;
	const body = slice.slice(t[open].e, t[close].s).trim();
	return `${stat}get ${name.w}() { return (async () => { ${body} })(); }`;
}

function seed(o) {
	const names = o.names.map(emitName), pub = names.filter(n => !isPrivate(n));
	const fans = (o.fans || []).map(emitName), list = [...pub.map(n => sq(n)), ...(fans.length ? [`[${fans.map(n => sq(n)).join(', ')}]`] : [])];
	return [...(list.length ? [`${rt('pending')}(this, ${list.join(', ')});`] : []),
		...names.filter(isPrivate).map(n => `this.${n} = ${o.value};`)].join('\n' + IND.repeat(3));
}

function privateAccessors(ir) {

	const seen = new Set();
	const out = [];
	for (const [st, ops] of [['', ir.ops || []], ['static ', ir.staticOps || []]]) {
		for (const o of ops) {
			const names = o.op === 'SEED' ? o.names : (o.name ? [o.name] : []);
			for (const raw of names) {
				const n = emitName(raw);
				const pm = String(raw).match(/^([$\u0394\u03a3\u03a6\u00f8]{1,2})?#(.+)$/);
				if (!pm || seen.has(n)) continue;
				seen.add(n);
				const tier = pm[1] || '', bare = pm[2];
				const key = `#\u01c1${bare}\u01c1`, targ = tier ? `, '${tier}'` : '';
				out.push(IND + `${st}${key} = Symbol();`);
				out.push(IND + `${st}get #${bare}() { const v = ${rt('cell')}` +
					`(this, this.${key}${targ}).get(); return v === ${PENDING} ? undefined : v; }`);
				out.push(IND + `${st}set #${bare}(v) { ${rt('cell')}` +
					`(this, this.${key}${targ}).set(v); }`);
			}
		}
	}
	return out;
}

function flatten(out, ats) {
	const lines = [];
	for (const o of out) for (const l of String(o.t).split('\n')) {
		lines.push(l);
		if (ats) ats.push(o.at == null ? null : o.at);
	}
	return lines.join('\n');
}

function vlq(n) {
	let v = n < 0 ? ((-n) << 1) | 1 : n << 1, out = '';
	do { let d = v & 31; v >>>= 5; if (v > 0) d |= 32; out += B64[d]; } while (v > 0);
	return out;
}

function lineIndex(src) {
	const nl = [0];
	for (let i = 0; i < src.length; i++) if (src[i] === '\n') nl.push(i + 1);
	return (off) => {
		let lo = 0, hi = nl.length - 1;
		while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (nl[mid] <= off) lo = mid; else hi = mid - 1; }
		return lo;
	};
}

function buildMap(regions, src, opts, lineOf) {
	const outLines = [], srcLines = [];
	for (const r of regions) {
		const parts = r.text.split('\n');
		const base = lineOf(r.at);
		for (let i = 0; i < parts.length; i++) {
			const own = r.ats && r.ats[i] != null ? lineOf(r.ats[i]) : base + i;
			if (i === 0 && outLines.length) outLines[outLines.length - 1] += parts[i];
			else { outLines.push(parts[i]); srcLines.push(own); }
		}
	}
	let prev = 0;
	const mappings = srcLines.map(sl => {
		const seg = vlq(0) + vlq(0) + vlq(sl - prev) + vlq(0);
		prev = sl;
		return seg;
	}).join(';');
	return {
		version: 3,
		file: opts.file || 'out.js',
		sources: [opts.source || 'input.is'],
		sourcesContent: opts.inlineSources === false ? undefined : [src],
		names: [],
		mappings
	};
}

function rewriteDeletes(code) {
	if (!/\bdelete\b|\bdeleteProperty\b/.test(code)) return code;
	try { var t = lex(maskComments(code)); }
	catch (e) { return code; }
	const close = i => {
		const o = t[i].c, c = o === '(' ? ')' : ']';
		for (let j = i, d = 0; j < t.length; j++) { if (t[j].c === o) d++; else if (t[j].c === c && --d === 0) return j; }
		return -1;
	};
	const NOT_PRIMARY = /^(super|new|typeof|void|await|yield|delete|function|class|in|of|instanceof|async)$/;
	const STRICT = 'function(){return !this}()';
	const edits = [];
	for (let i = 0; i < t.length; i++) {
		const afterDot = i > 0 && (t[i - 1].c === '.' || t[i - 1].c === '?.');
		if (t[i].w === 'Reflect' && !afterDot && t[i + 1] && t[i + 1].c === '.' &&
		    t[i + 2] && t[i + 2].w === 'deleteProperty' && t[i + 3] && t[i + 3].c === '(') {
			edits.push({ s: t[i].s, e: t[i + 2].e, text: rt('reflectDelete') }); i += 2; continue;
		}
		if (t[i].w !== 'delete' || afterDot) continue;
		if (t[i + 1] && t[i + 1].c === ':') continue;
		if (!t[i + 1] || !t[i + 1].w || NOT_PRIMARY.test(t[i + 1].w)) continue;
		let j = i + 2;
		const segs = [];
		while (t[j]) {
			const tk = t[j], nx = t[j + 1];
			if ((tk.c === '.' || tk.c === '?.') && nx && nx.w) {
				segs.push({ opt: tk.c === '?.', key: sq(nx.w), s: tk.s, e: nx.e }); j += 2;
			} else if (tk.c === '[' || (tk.c === '?.' && nx && nx.c === '[')) {
				const at = tk.c === '[' ? j : j + 1, q = close(at); if (q < 0 || q === at + 1) break;
				segs.push({ opt: tk.c === '?.', key: code.slice(t[at + 1].s, t[q].s), s: tk.s, e: t[q].e }); j = q + 1;
			} else if (tk.c === '(' || (tk.c === '?.' && nx && nx.c === '(')) {
				const at = tk.c === '(' ? j : j + 1, q = close(at); if (q < 0) break;
				segs.push({ opt: tk.c === '?.', call: true, s: tk.s, e: t[q].e }); j = q + 1;
			} else break;
		}
		const last = segs[segs.length - 1];
		if (!last || last.call) continue;
		if (segs.slice(0, -1).some(g => g.opt)) continue;
		const obj = code.slice(t[i + 1].s, last.s);
		edits.push({ s: t[i].s, e: last.e, text: last.opt
			? rt('delete') + '(' + obj + ', () => (' + last.key + '), ' + STRICT + ', true)'
			: rt('delete') + '(' + obj + ', ' + last.key + ', ' + STRICT + ')' });
		i = j - 1;
	}
	return edits.length ? splice(code, edits) : code;
}

const LANE_SIGIL = { '?': 'async', '@': 'await', '&': 'defer' };

function classBodies(spans, code) {
	const out = [];
	for (let i = 0; i < spans.length; i++) {
		const k = spans[i], p = spans[i - 1];
		if (k.w !== 'class' || (p && /^\??\.$/.test(p.c || '')) || (spans[i + 1] && spans[i + 1].c === ':')) continue;
		let j = i + 1;
		while (j < spans.length && spans[j].c !== '{') { if (spans[j].c === '(' || spans[j].c === '[') { const c = matchPair(spans, j); if (c < 0) break; j = c; } j++; }
		if (j >= spans.length || spans[j].c !== '{') continue;
		const c = matchPair(spans, j);
		if (c > 0) out.push([j, c]);
	}
	return out;
}

function memberStarts(spans, o, c) {
	const out = [];
	let d = 0, fresh = true;
	for (let p = o + 1; p < c; p++) {
		const ch = spans[p].c;
		if (d === 0 && fresh && ch !== ';' && ch !== '}') { out.push(p); fresh = false; }
		if (ch === '(' || ch === '[' || ch === '{') d++;
		else if (ch === ')' || ch === ']' || ch === '}') { d--; if (d === 0 && ch === '}') fresh = true; }
		else if (ch === ';' && d === 0) fresh = true;
	}
	return out;
}

function laneSigilEdit(code, spans) {
	for (const [o, c] of classBodies(spans, code)) {
		for (const m of memberStarts(spans, o, c)) {
			let q = m;
			for (let n = 0; n < 2 && spans[q] && (spans[q].w === 'static' || spans[q].w === 'try'); n++) q++;
			const sig = spans[q] && LANE_SIGIL[spans[q].c];
			if (!sig || !spans[q + 1] || q + 1 >= c) continue;
			if (spans[q].c === '@' && spans[q + 1].w === 'override' && spans[q + 1].s === spans[q].e) continue;
			const eq = topLevel(spans, q + 1, c, '=');
			let end = topLevel(spans, q + 1, c, ';'); if (end < 0) end = c;
			if (eq < 0 || eq >= end || eq === q + 1) continue;
			const slot = code.slice(spans[q + 1].s, spans[eq].s).trim();
			const init = code.slice(spans[eq].e, spans[end - 1].e).trim();
			const pre = code.slice(spans[m].s, spans[q].s);

			if (spans[q].c === '@')
				throw err('MEMBER_SHORTCUT_RETIRED', spans[q].s, SyntaxError, slot, pre, init.replace(/^await\s+/, ''));
			return { s: spans[m].s, e: end < c ? spans[end].e : spans[end - 1].e, text: pre + sig + ' ' + init + ' as ' + slot + ';' };
		}
	}
	return null;
}

function receiverStart(spans, i) {
	let j = i - 1;
	for (;;) {
		const k = spans[j]; if (!k) return j + 1;
		if (k.c === ')' || k.c === ']') {
			let d = 0, q = j;
			for (; q >= 0; q--) { const cc = spans[q].c; if (cc === k.c) d++; else if (cc === PAIR_OPEN[k.c]) { d--; if (d === 0) break; } }
			if (q < 0) return j + 1;
			j = q - 1;
			const p = spans[j];
			if (p && ((p.w !== undefined && !TLA_OPERAND.has(p.w) && !TLA_BLOCK_HEADS.has(p.w) && !NOT_CALLEE.has(p.w)) || p.c === ')' || p.c === ']' || p.lit !== undefined)) continue;
			return q;
		}
		if (k.w !== undefined || k.lit !== undefined || k.num !== undefined) {
			const p = spans[j - 1];
			if (p && /^\??\.$/.test(p.c || '') && spans[j - 2] && spans[j - 2].e <= p.s) { j -= 2; continue; }
			if (p && p.w === 'new') return j - 1;
			return j;
		}
		return j + 1;
	}
}
const PAIR_OPEN = { ')': '(', ']': '[', '}': '{' };
const NOT_CALLEE = new Set(['in', 'of', 'instanceof', 'else', 'do', 'case', 'return', 'throw', 'typeof', 'void', 'delete', 'await', 'yield', 'new', 'as', 'or']);

function awaitAllowed(spans, code, i) {

	let body = null;
	for (const b of classBodies(spans, code)) if (b[0] < i && i < b[1] && (!body || b[0] > body[0])) body = b;
	let m = -1;
	if (body) { for (const s of memberStarts(spans, body[0], body[1])) if (s <= i) m = s; }

	let ownAsync = false, ownHead = -1;
	if (m >= 0) {
		let q = m; const words = [];
		while (spans[q] && spans[q].w !== undefined && q < i) { words.push(spans[q].w); q++; }
		if (spans[q] && spans[q].c === '(') ownHead = q;
		if (words.includes('constructor')) ownAsync = true;
		else if (words[0] === 'do' || (words[0] === 'static' && words[1] === 'do') || words.some(w => LANE_START.has(w))) ownAsync = true;
		else if (words.includes('async')) ownAsync = true;
		else if (spans[q] && spans[q].c === '(' && !words.some(w => LANE_START.has(w))) ownAsync = false;
		else ownAsync = false;
	}

	const stack = [];
	const from = m >= 0 ? m : 0;
	for (let p = from; p < i; p++) {
		while (stack.length && stack[stack.length - 1].end <= p) stack.pop();
		const k = spans[p], prev = spans[p - 1];
		if (k.w === 'function' && !(prev && /^\??\.$/.test(prev.c || '')) && !(spans[p + 1] && spans[p + 1].c === ':')) {
			stack.push({ async: !!prev && prev.w === 'async', end: skipFn(spans, p, code) });
		} else if (k.c === '=>') {
			let h = p - 1;
			if (spans[h] && spans[h].c === ')') { let d = 0; for (; h >= 0; h--) { if (spans[h].c === ')') d++; else if (spans[h].c === '(') { if (--d === 0) break; } } }
			const asy = !!spans[h - 1] && spans[h - 1].w === 'async';
			stack.push({ async: asy, end: skipFn(spans, p, code) });
		} else if (k.c === '(' && p !== ownHead && prev && prev.w !== undefined && !TLA_BLOCK_HEADS.has(prev.w) && !LANE_START.has(prev.w) && !TLA_OPERAND.has(prev.w)) {
			const c = matchPair(spans, p), b = c < 0 ? null : spans[c + 1];
			if (b && b.c === '{' && !/\n/.test(code.slice(spans[c].e, b.s)) && !(spans[p - 2] && /^\??\.$/.test(spans[p - 2].c || ''))) {
				const e = matchPair(spans, c + 1);
				if (e > i) stack.push({ async: !!spans[p - 2] && spans[p - 2].w === 'async', end: e + 1 });
			}
		}
	}
	while (stack.length && stack[stack.length - 1].end <= i) stack.pop();
	return stack.length ? stack[stack.length - 1].async : ownAsync;
}

function awaitMemberEdit(code, spans) {
	for (let i = 1; i + 1 < spans.length; i++) {
		if (spans[i].c !== '@' || !/^\??\.$/.test(spans[i - 1].c || '')) continue;
		const name = spans[i + 1];
		if (name.w === undefined) throw err('DOT_AT_NAMES_MEMBER', spans[i].s, SyntaxError, spans[i - 1].c === '?.' ? '?.' : '.', name.c === '[');
		if (!awaitAllowed(spans, code, i)) throw err('DOT_AT_NOTHING_WAITS', spans[i].s, SyntaxError, name.w, spans[i - 1].c);
		const r = receiverStart(spans, i - 1);
		return { s: spans[r].s, e: name.e, text: '(await ' + code.slice(spans[r].s, spans[i - 1].s) + spans[i - 1].c + name.w + ')' };
	}
	return null;
}

function desugar(code, spans, comments) {
	for (let n = 0; n < 4096; n++) {
		const edit = laneSigilEdit(code, spans) || awaitMemberEdit(code, spans);
		if (!edit) break;
		code = splice(code, [edit]);
		spans = assertClean(scan(code, comments).spans, code);
	}
	return { code, spans };
}

function compile(source, opts = {}) {

	ANON_N = 0; REG_BY_KEY.clear(); REG_SEEN.clear();

	let { code, comments, spans } = scan(String(source));
	const diagnostics = [];
	try { ({ code, spans } = desugar(code, spans, comments)); var ifaces = parseInterfaces(spans, code), packages = parsePackages(spans, code), classes = parseClasses(spans, code, !!opts.recover); }
	catch (err) {

		if (!opts.recover || !(err instanceof SyntaxError || err instanceof TypeError)) throw err;
		const line = lineIndex(code)(err.at !== undefined ? err.at : 0) + 1;
		diagnostics.push({ level: 'error', line, at: err.at, name: err.constructor.name, message: err.message });
		return { code: `/* ${err.constructor.name} @line ${line}: ${String(err.message).replace(/\*\//g, '*\\/')} */`,
			diagnostics, version: Superset.version };
	}

	const grainOf = {}, G = new Map();
	for (const rec of classes) G.set(rec, grains(rec, code));
	for (const rec of classes) if (rec.name) grainOf[rec.name] = {
		link: G.get(rec).link,
		cls:  G.get(rec).cls,
		dcls: rec.grain,
		inst: G.get(rec).inst,
		rec
	};

	const lineAt = lineIndex(code);
	const locate = (e, rec) => {
		const at = e.at !== undefined ? e.at : rec.head.s;
		e.line = lineAt(at) + 1;
		e.at = at;
		return e;
	};

	const edits = [];

	const members = new Map();

	for (const f of ifaces.values()) {
		const tok = (t) => Array.isArray(t) ? '[' + t.join(', ') + ']' : t;
		const rows = f.members
			.filter(m => m.kind === 'field')
			.map(m => `    ${m.statik ? 'static ' : ''}${m.name}${m.type ? ' = ' + tok(m.type) : ';'}`.replace(/([^;])$/, '$1;'));
		edits.push({ s: f.s, e: f.e + 1, text: `class ${f.name}${f.bases.length ? ' extends ' + f.bases[0] : ''} {\n${rows.join('\n')}\n}\n`, ats: null });
	}
	for (const pk of packages.values())
		edits.push({ s: pk.s, e: pk.e + 1, text: emitPackage(pk, code), ats: null });

	const noteOf = e => `/* ${e.constructor.name} @line ${e.line}: ${String(e.message).replace(/\*\//g, '*\\/').replace(/\s*\n\s*/g, ' ')} */`;
	const diagOf = e => ({ level: 'error', line: e.line, at: e.at, name: e.constructor.name, message: e.message });
	for (let ci = 0; ci < classes.length; ci++) {
		const rec = classes[ci], mark = diagnostics.length;
		try {
			if (rec.fault) throw rec.fault;
			check(rec, code, (r, m, why) => {
				const e = err(why === 'lifecycle' ? 'FIELD_SUSPENDS_NO_LANE' : 'INSTANCE_AWAIT_NEEDS_GRAIN', m && m.span ? m.span.s : null, SyntaxError, r.name, m.name);
				throw e;
			}, { grainOf, diags: diagnostics, recover: !!opts.recover }, G.get(rec));
			const typed = checkImplements(rec, code, ifaces, diagnostics);
			const ir = buildIR(rec, code, opts, G.get(rec));

			for (const ops of [ir.ops, ir.staticOps || []]) {
				const p = ops.findIndex(o => o.op === 'PARTITION'), seeds = ops.filter(o => o.op === 'SEED');
				if (seeds.length > 1) throw new Error('seeds must collapse to one op');
				if (p >= 0 && ops.indexOf(seeds[0]) > p) throw new Error('SEED after the partition');
			}

			const kinds = { inst: new Map(), cls: new Map() };
			for (const m of rec.members) {
				if (m.kind !== 'field') continue;
				const tierWord = (m.mods || []).find(w => TIER_WORDS.has(w));
				const kind = [tierWord, (m.mods || []).includes('untracked') ? 'untracked' : null, m.mut && FIELD_DESCRIPTORS.has(m.mut) ? m.mut : null].filter(Boolean).join(' ');
				if (kind) for (const n of (m.names && m.names.length ? m.names : [m.name]).filter(Boolean))
					kinds[m.static ? 'cls' : 'inst'].set(emitName(n), kind);
			}

			const methodDesc = [];
			for (const kind of DESCRIPTOR_WORDS)
				for (const st of [false, true]) {

					const names = rec.members
						.filter(m => (m.kind === 'method' || m.kind === 'accessor') &&
						             m.mut === kind && (m.name || m.key) && !!m.static === st)
						.map(m => m.name ? sq(emitName(m.name)) : m.key.trim());
					if (names.length) methodDesc.push({ kind, names, target: st ? 'this' : 'this.prototype' });
				}

			const rows = face => {
				const o = new Map();
				for (const g of methodDesc) if ((g.target === 'this') === (face === 'cls')) o.set(g.kind, g.names);

				return o.size ? '{' + [...o].map(([k, v]) => `${/^[a-z]+$/.test(k) ? k : sq(k)}:[${v.join(',')}]`).join(',') + '}' : null;
			};
			const line = text => ({ op: 'LINE', text, at: null });
			ir.staticOps = ir.staticOps || [];
			const front = [];
			describeOps(ir.ops, kinds.inst);
			const top = describeOps(ir.staticOps, kinds.cls);
			if (typed) for (const nm of rec.implements) front.push(line(`${rt('implement')}(this, ${nm});`));
			if (rec.usings && rec.usings.length)
				for (const u of rec.usings.map(u => parseUsings(spans, u.from, u.to + 1, code)[0]).filter(Boolean)) front.push(line(`${rt('mixin')}(this, ${u.name});`));

			for (const st of [false, true]) {
				const roles = rec.members.filter(m => m.kind === 'method' && m.name && (m.role || m.volatile) && !!m.static === st);
				if (!roles.length) continue;
				if (!st) ir.armOnly = true;
				const lit = '{' + roles.map(m => `${/^[A-Za-z_][A-Za-z0-9_]*$/.test(m.name) ? m.name : sq(m.name)}:${sq([m.volatile ? 'volatile' : null, m.role].filter(Boolean).join(' '))}`).join(',') + '}';
				front.push(line(`${rt('roles')}(${st ? 'this' : 'this.prototype'}, ${lit});`));
			}
			const mi = rows('inst'), mc = rows('cls');
			if (mi) front.push(line(`${rt('redescribe')}(this.prototype, ${mi});`));
			if (mc) front.push(line(`${rt('redescribe')}(this, ${mc});`));

			{
				const ov = rec.members.filter(m => m.override);
				if (ov.length) front.push(line(`${rt('override')}(this.prototype, [${ov.map(m => m.name ? sq(emitName(m.name)) : m.key.trim()).join(', ')}]);`));
			}
			ir.staticOps.splice(top, 0, ...front);

			if (rec.usings && rec.usings.length) {
				const body = code.slice(rec.body.s, rec.body.e);
				const all = rec.usings.map(u => parseUsings(spans, u.from, u.to + 1, code)[0]).filter(Boolean);

				const parts = all.map((u, i) => {
					const M = USING_MOD[u.mod];
					if (!M) return null;
					const r = USING_ASM[M.op](u.name, u.args, i);
					const wrap = t => t && (M.soft ? `try { ${t} } catch (e) {}` : t);
					return { pre: wrap(r.pre), post: wrap(r.post) };
				}).filter(Boolean);
				ir.usings = parts.map(p2 => p2.pre).filter(Boolean);
				ir.usingsPost = parts.map(p2 => p2.post).filter(Boolean);
			}

			const ats = [];

			const cut = (rec.faults || []).map(f => locate(f, rec)).sort((a, b) => a.at - b.at);
			const lead = code.slice(code.lastIndexOf('\n', rec.head.s - 1) + 1, rec.head.s);
			const own = /^[ \t]*$/.test(lead);
			if (ats && own) for (const f of cut) ats.push(f.at);
			const notes = cut.map(f => noteOf(f) + (own ? '\n' + lead : ' ')).join('');
			for (const m of rec.members) if (m.span) members.set(m.span.s, m);
			edits.push({ s: rec.head.s, e: rec.body.e + 1, text: notes + emitClass(ir, opts, ats), ats });
			diagnostics.splice(mark, 0, ...cut.map(diagOf));
		} catch (err) {
			if (!(err instanceof SyntaxError || err instanceof TypeError)) throw err;
			locate(err, rec);
			if (!opts.recover) {
				err.message += ` (line ${err.line})`;
				throw err;
			}

			const i = err === rec.fault ? -1 : rec.members.findIndex(m => m.span && err.at >= m.span.s && err.at <= m.span.e);
			if (i >= 0) {
				rec.members.splice(i, 1);
				(rec.faults || (rec.faults = [])).push(err);
				diagnostics.length = mark;
				ci--;
				continue;
			}
			const all = [...(rec.faults || []), err].map(f => locate(f, rec)).sort((a, b) => a.at - b.at);
			diagnostics.push(...all.map(diagOf));
			edits.push({ s: rec.head.s, e: rec.body.e + 1, text: all.map(noteOf).join('\n'), ats: opts.sourceMap ? [] : null });
		}
	}

	let out = code;
	for (const ed of edits.slice().sort((a, b) => b.s - a.s))
		out = out.slice(0, ed.s) + ed.text + out.slice(ed.e);
	out = assertClean(restoreComments(out, comments));

	out = rewriteDeletes(out);

	const manifests = new Map();
	for (const pk of packages.values()) if (pk.manifest) manifests.set(pk.name, pk.manifest.value);
	if (opts.manifest && manifests.size) writeManifest([...manifests.values()][0], opts.manifest, diagnostics);

	const src = restoreComments(code, comments);

	const regions = [];
	let cursor = 0;
	for (const ed of edits.slice().sort((a, b) => a.s - b.s)) {
		regions.push({ text: restoreComments(code.slice(cursor, ed.s), comments), at: cursor, e: ed.s });
		regions.push({ text: restoreComments(ed.text, comments), at: ed.s, e: ed.e, ats: ed.ats });
		cursor = ed.e;
	}
	regions.push({ text: restoreComments(code.slice(cursor), comments), at: cursor, e: code.length });

	if (opts.verify !== false) verifyEmit(out, src, regions, lineAt, opts, diagnostics, code, members);
	if (!opts.sourceMap) return { code: out, diagnostics, packages: manifests, version: Superset.version };
	return { code: out, diagnostics, packages: manifests, version: Superset.version, map: buildMap(regions, src, opts, lineAt) };
}

function verifyEmit(out, src, regions, lineAt, opts, diagnostics, code, members) {
	const parse = parserFor();
	if (!parse) return;
	let err = null;
	try { parse(out); } catch (e) { err = e; }
	if (!err) return;
	const clean = e => String(e && e.message || e).replace(/\s*\(\d+:\d+\)$/, '');
	const why = clean(err);
	const loc = err.loc && typeof err.loc.line === 'number' ? err.loc : null;
	const outText = loc ? String(out.split('\n')[loc.line - 1] || '') : '';
	const b = loc ? blameOf(regions, loc, outText, code, members, lineAt, parse, clean) : null;
	const say = n => String(src.split('\n')[n] || '').trim().slice(0, 120);
	if (b && b.author) {
		const m2 = wording('JS_DOES_NOT_PARSE', b.why || why, say(b.line), b.word);
		if (opts.recover) { diagnostics.push({ level: 'error', line: b.line + 1, at: b.at, name: 'SyntaxError', message: m2 }); return; }
		const e2 = new SyntaxError(wording('AT_LINE', m2, b.line + 1));
		e2.at = b.at; e2.line = b.line + 1;
		throw e2;
	}
	const at = b ? b.at : 0, line = b ? b.line + 1 : 1;
	const msg = wording('EMIT_DOES_NOT_PARSE', loc ? wording('COMPILED_LINE', loc.line, outText.trim().slice(0, 120)) : '', why);
	if (opts.recover) { diagnostics.push({ level: 'error', line, at, name: 'InternalError', message: msg }); return; }
	const e = new SyntaxError(wording('AT_LINE', msg, line));
	e.at = at; e.line = line; e.internal = true;
	throw e;
}

function placeOf(regions, line, col) {
	let n = 1, c = 0, hit = null;
	for (const r of regions) {
		const parts = r.text.split('\n');
		for (let i = 0; i < parts.length; i++) {
			if (i > 0) { n++; c = 0; }
			if (n > line) return hit;
			if (n === line && col >= c) hit = { r, i, col: col - c };
			c += parts[i].length;
		}
	}
	return hit;
}

function needleAt(line, col) {
	const t = [...line.matchAll(/[\w$ -￿]+|\S/g)];
	if (!t.length) return null;
	let k = t.findIndex(m => m.index + m[0].length > col);
	if (k < 0) k = t.length - 1;
	const s = k > 0 ? t[k - 1].index : t[k].index;
	return { text: line.slice(s, t[k].index + t[k][0].length), token: t[k][0], tokenAt: t[k].index - s };
}

const REWRITTEN = new Set(['try', 'or', 'do', 'as']);
const CONTEXTUAL = new Set(['super', 'await', 'yield', 'arguments', 'return', 'this', 'new', 'target']);
const VERBATIM = new Set(['method', 'accessor', 'staticBlock']);

function blameOf(regions, loc, outText, code, members, lineAt, parse, clean) {
	const hit = placeOf(regions, loc.line, loc.column || 0);
	if (!hit) return null;
	const { r, i, col } = hit;
	const eol = s => { const n = code.indexOf('\n', s); return n < 0 ? code.length : n; };
	if (!r.ats || !r.ats.length) {
		const line = lineAt(r.at) + i;
		let s = r.at;
		for (let k = 0; k < i; k++) s = eol(s) + 1;
		const part = code.slice(s, eol(s));
		return { author: true, line, at: //.test(part) ? s : s + Math.min(col, part.length) };
	}
	const start = r.ats[i] != null ? r.ats[i] : r.at;
	const m = members.get(start) || [...members.values()].find(x => !VERBATIM.has(x.kind) ? false : x.span && x.span.s < start && start <= x.span.e);
	const end = m && m.span ? Math.max(m.span.e + 1, start) : r.ats.reduce((a, x) => x != null && x > start && x < a ? x : a, r.e);

	const values = mm => {
		let read = 0, skipped = 0;
		for (const x of [mm.init, mm.fallback]) {
			if (!x || x.e <= x.s) continue;
			const raw = code.slice(x.s, x.e);
			if ((mm.doBlock && x === mm.init) || /\b(?:try|or|do|as)\b|#[\w$]/.test(raw)) { skipped++; continue; }
			const text = raw.replace(/\d+/g, c => ' '.repeat(c.length));
			const pre = 'class øV { async *øv() { return (\n';
			try { parse(pre + text + '\n); } }'); read++; }
			catch (e) {
				const at = x.s + (typeof e.pos === 'number' ? Math.max(0, Math.min(text.length, e.pos - pre.length)) : 0);
				return { fails: { author: true, line: lineAt(at), at, why: clean(e) } };
			}
		}
		return { read: read > 0 && !skipped };
	};
	if (m && !VERBATIM.has(m.kind)) {
		const v = values(m);
		if (v.fails) return v.fails;

		if (v.read) return { author: false, line: lineAt(start), at: start };
	}

	const nd = needleAt(outText, loc.column || 0);
	if (nd) {
		const k = code.slice(start, end).indexOf(nd.text);
		if (k >= 0) {
			const at = start + k + nd.tokenAt;
			const doubt = REWRITTEN.has(nd.token) || (!(m && VERBATIM.has(m.kind)) && CONTEXTUAL.has(nd.token));
			return { author: true, line: lineAt(at), at, word: doubt ? nd.token : null };
		}
	}

	const others = [...members.values()].filter(x => x !== m && x.span && x.span.s >= r.at && x.span.s < r.e && !VERBATIM.has(x.kind))
		.sort((a, b) => a.span.s - b.span.s);
	for (const mm of others) { const v = values(mm); if (v.fails) return v.fails; }
	return { author: false, line: lineAt(start), at: start };
}

let PARSER = null, PARSER_FROM = null;
function parserFor() {
	if (typeof Superset.parse === 'function') return Superset.parse;
	const a = global.acorn;
	if (a && typeof a.parse === 'function') {
		if (PARSER_FROM !== a) { PARSER_FROM = a; PARSER = parserFrom(a); }
		return PARSER;
	}
	return null;
}

function parserFrom(acorn) {
	const base = { ecmaVersion: 'latest', allowHashBang: true, allowReturnOutsideFunction: true };
	return text => {
		try { acorn.parse(text, Object.assign({ sourceType: 'module' }, base)); return; } catch (e) { var first = e; }
		try { acorn.parse(text, Object.assign({ sourceType: 'script', allowAwaitOutsideFunction: true }, base)); }
		catch (e) { throw /^[ \t]*(?:import|export)\b/m.test(text) ? first : e; }
	};
}

class Superset {
	static version = 12.4;

	constructor(source, opts = {}) {
		const r = compile(String(source), opts);
		this.code = r.code;
		this.diagnostics = r.diagnostics;
		this.version = r.version;
		if (r.map !== undefined) this.map = r.map;
		Object.freeze(this);
	}

	toString() { return this.code; }
	get ok() { return !this.diagnostics || this.diagnostics.length === 0; }
}
Object.assign(Superset, { compile, lex, findClasses, parseClasses, stripComments, restoreComments, runtime: RUNTIME, doGrain: DO_GRAIN, parserFrom, parse: null });

const __IVC = global[Symbol.for('Instance')];
if (typeof __IVC === 'function' && typeof __IVC.provide === 'function')
	__IVC.provide({ module: 'compiler', value: Superset, from: '0.89.j', to: '0.92.z' });
else
	global[Symbol.for('Instance.Compiler')] = Superset;

if (!Object.getOwnPropertyDescriptor(global, Symbol.for('Superset')))
	try { global[Symbol.for('Superset')] = Superset; } catch (e) {}
{
	const d = Object.getOwnPropertyDescriptor(global, 'Superset'), prior = d && d.value;
	if (typeof prior === 'function' && typeof prior.describe === 'function') Object.setPrototypeOf(Superset, prior);
	try { Object.defineProperty(global, 'Superset', { value: Superset, writable: true, configurable: true, enumerable: false }); } catch (e) {}
}

if (typeof module === 'object' && typeof module.exports === 'object') module.exports = Superset;

(function () {
	'use strict';

	const MARK = 'data-instance-capture';

	const QUEUED = Symbol('Instance.superset.queued');
	const doc = typeof document !== 'undefined' ? document : null;
	if (!doc) return;

	const CLASSIC = new Set(['', 'text/javascript', 'application/javascript', 'application/ecmascript',
		'application/x-ecmascript', 'application/x-javascript', 'text/ecmascript', 'text/javascript1.0',
		'text/javascript1.1', 'text/javascript1.2', 'text/javascript1.3', 'text/javascript1.4',
		'text/javascript1.5', 'text/jscript', 'text/livescript', 'text/x-ecmascript', 'text/x-javascript']);
	const INSTANCE = new Set(['text/instance', 'application/instance', 'instance', 'text/is']);

	const here = doc.currentScript;

	if (here && here.hasAttribute('nocapture')) return;

	const existing = doc.querySelector('template[' + MARK + ']');

	const SANDBOX = !!((here && here.hasAttribute('sandbox')) ||
	                   (existing && existing.hasAttribute('data-sandbox')));
	const GLOBAL = !SANDBOX;
	if (!existing && here && here.hasAttribute('override'))
		(console.warn || console.log)(wording('OVERRIDE_IS_DEFAULT', SANDBOX));

	const ALLOW = (() => {
		const v = here && here.hasAttribute('allow-bypass') ? here.getAttribute('allow-bypass')
			: existing && existing.hasAttribute('data-allow-bypass') ? existing.getAttribute('data-allow-bypass') : null;
		if (v === null) return '';
		const k = v.trim().toLowerCase();
		if (k === '') return 'any';
		if (k === 'external' || k === 'inline') return k;
		(console.warn || console.log)(wording('ALLOW_BYPASS_UNKNOWN', v));
		return '';
	})();

	const NONCE = here ? (here.nonce || here.getAttribute('nonce') || '') : '';

	const OPENER = '<template ' + MARK + (SANDBOX ? ' data-sandbox' : '') +
		(ALLOW ? ' data-allow-bypass' + (ALLOW === 'any' ? '' : '="' + ALLOW + '"') : '') + '>';
	let handed = null;
	try {
		if (typeof trustedTypes !== 'undefined' && trustedTypes && trustedTypes.createPolicy)
			var POLICY = trustedTypes.createPolicy('superset', {
				createHTML: s => { if (s !== OPENER) throw new TypeError(wording('TT_NOT_CAPTURE_TAG')); return s; },
				createScript: s => { if (s !== handed) throw new TypeError(wording('TT_NOT_COMPILER_OUTPUT')); handed = null; return s; },
			});
	} catch (e) {  }
	const asHTML = s => POLICY ? POLICY.createHTML(s) : s;
	const asScript = s => { if (!POLICY) return s; handed = s; return POLICY.createScript(s); };

	function refuse(key, ...args) {
		throw new Error(wording('CAPTURE_REFUSED', wording(key, ...args)));
	}

	if (!existing) {
		if (doc.readyState !== 'loading') refuse('CAPTURE_PARSER_DONE', doc.readyState);
		if (!here) refuse('CAPTURE_NO_CURRENT_SCRIPT');

		const isAsync = typeof here.async === 'boolean' ? here.async : here.hasAttribute('async');
		const isDefer = typeof here.defer === 'boolean' ? here.defer : here.hasAttribute('defer');
		if (isAsync || isDefer) refuse('CAPTURE_SCRIPT_DEFERRED', isAsync ? 'async' : 'defer');

		if (typeof Instance === 'undefined') refuse('CAPTURE_CORE_NOT_LOADED');

		try { doc.write(asHTML(OPENER)); }
		catch (e) {
			throw new Error(wording('CAPTURE_NOT_WRITTEN', (e && e.message) || e));
		}
	}

	const NATIVE = 0, DECLARED = 1, CLAIMED = 2;
	let warnedSuper = false;
	const typeOf = script => (script.getAttribute('type') || '').trim().toLowerCase();
	function route(script) {
		if (script[QUEUED]) return NATIVE;
		if (script.hasAttribute('bypass') || script.hasAttribute('data-bypass')) {
			const kind = script.hasAttribute('src') ? 'external' : 'inline';
			if (SANDBOX || ALLOW === 'any' || ALLOW === kind) return NATIVE;
			(console.warn || console.log)(wording('BYPASS_REFUSED', label(script), ALLOW));
		}
		if (script.hasAttribute('superset')) return DECLARED;
		if (script.hasAttribute('super')) {
			if (!warnedSuper) { warnedSuper = true;
				(console.warn || console.log)(wording('SUPER_IS_SUPERSET')); }
			return DECLARED;
		}
		const type = typeOf(script);
		if (/\.is(?:[?#]|$)/i.test(script.getAttribute('src') || '')) return DECLARED;
		if (INSTANCE.has(type)) return DECLARED;
		if (SANDBOX) return NATIVE;
		if (CLASSIC.has(type)) return CLAIMED;
		if (type === 'module') return script.hasAttribute('src') ? NATIVE : CLAIMED;
		return NATIVE;
	}

	const executes = script => { const type = typeOf(script);
		return CLASSIC.has(type) || type === 'module' || INSTANCE.has(type) ||
			script.hasAttribute('superset') || script.hasAttribute('super'); };
	const nonceOf = script => script.nonce || script.getAttribute('nonce') || '';

	function fetchSource(script) {
		if (typeof fetch !== 'function') return Promise.resolve({ error: new Error(wording('FETCH_UNAVAILABLE')) });
		const init = { mode: 'cors',
			credentials: script.getAttribute('crossorigin') === 'use-credentials' ? 'include' : 'same-origin' };
		const integrity = script.getAttribute('integrity');
		if (integrity) init.integrity = integrity;
		const referrer = script.getAttribute('referrerpolicy');
		if (referrer) init.referrerPolicy = referrer;
		return fetch(script.src, init)
			.then(res => { if (!res.ok) throw new Error(wording('FETCH_HTTP', res.status)); return res.text(); })
			.then(text => ({ text }), error => ({ error }));
	}

	const label = script => script.getAttribute('src') || 'an inline script';
	const reason = e => (e && e.message) || String(e);

	function bless(script) {
		if (POLICY && !script.hasAttribute('src') && script.textContent) script.textContent = asScript(script.textContent);
	}

	function handBack(script, why) {
		bless(script);
		(console.warn || console.log)(wording('HANDED_BACK', label(script), why, script.hasAttribute('integrity')));
		tuneOrdering(script);
	}

	function neutralize(script, why) {
		const name = label(script);

		while (script.firstChild) script.removeChild(script.firstChild);
		script.removeAttribute('src');
		(console.error || console.log)(wording('NEUTRALIZED', name, why));
	}

	const HEAD_TAGS = new Set(['LINK', 'META', 'STYLE', 'TITLE', 'BASE']);

	function hasTopLevelYield(js) {
		let depth = 0, i = 0;
		const t = /(\{|\}|\byield\b|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g;
		let m;
		while ((m = t.exec(js))) {
			const s = m[0];
			if (s === '{') depth++;
			else if (s === '}') depth--;
			else if (s === 'yield' && depth === 0) return true;
		}
		return false;
	}

	function toJS(src) {
		const js = Instance.compile(src);
		if (!hasTopLevelYield(js) && !hasTopLevelAwait(js)) return js;

		return '(async () => { const \u00f8g = (async function* () {\n' + js +
		       '\n})(); for await (const \u00f8 of \u00f8g); })();';
	}

	function tuneOrdering(script) {

		if (script.src && !script.hasAttribute('async')) script.async = false;
	}

	async function hydrate() {
		const cap = doc.querySelector('template[' + MARK + ']');
		if (!cap) return;

		cap.removeAttribute(MARK);
		const head = doc.head || doc.documentElement;
		const body = doc.body || doc.documentElement;

		const frag = doc.importNode(cap.content, true);

		const scripts = [...frag.querySelectorAll('script')];
		const routes = scripts.map(route);

		const refused = scripts.map(script => !!NONCE && executes(script) && nonceOf(script) !== NONCE);

		const sources = scripts.map((script, i) =>
			!refused[i] && routes[i] !== NATIVE && script.hasAttribute('src') ? fetchSource(script) : null);
		for (let i = 0; i < scripts.length; i++) {
			const script = scripts[i], how = routes[i];
			if (refused[i]) {
				neutralize(script, wording('NONCE_REFUSED'));
				continue;
			}
			if (how === NATIVE) {

				if (script.src) (console.warn || console.log)(wording('LOADED_AFTER_COMPILER', script.getAttribute('src')));
				if (executes(script)) bless(script);
				tuneOrdering(script); continue;
			}
			let src = script.textContent;
			if (sources[i]) {
				const got = await sources[i];
				if (got.error) {
					const why = wording('NOT_FETCHED', reason(got.error));
					if (how === CLAIMED) handBack(script, why);
					else neutralize(script, wording('NOT_RUN_INSTANCE_SOURCE', why));
					continue;
				}
				src = got.text;
			}

			const module = typeOf(script) === 'module';
			try {
				var js = module ? Instance.compile(src || '') : toJS(src || '');
				if (module && hasTopLevelYield(js)) throw new SyntaxError(wording('TOP_LEVEL_YIELD_IN_MODULE'));
			}
			catch (e) {
				if (how === CLAIMED) handBack(script, wording('DID_NOT_COMPILE', reason(e)));
				else neutralize(script, wording('FAILED', reason(e)));
				continue;
			}

			if (POLICY || sources[i] || js !== script.textContent) script.textContent = asScript(js);

			script.removeAttribute('src');
			if (!module) script.removeAttribute('type');
			script.removeAttribute('integrity');
			Object.defineProperty(script, QUEUED, { value: true });
			tuneOrdering(script);
		}

		for (const el of [...frag.children])
			if (HEAD_TAGS.has(el.tagName)) head.appendChild(el);

		cap.remove();
		body.appendChild(frag);
		doc.dispatchEvent(new Event('instance:hydrated'));
	}

	if (doc.readyState === 'loading') {
		doc.addEventListener('readystatechange', function onReady() {
			if (doc.readyState === 'loading') return;
			doc.removeEventListener('readystatechange', onReady);
			hydrate();
		});
		doc.addEventListener('DOMContentLoaded', hydrate, { once: true });
	}
	else hydrate();

	if (typeof Instance !== 'undefined' && Instance)
		try { Object.defineProperty(Instance, 'hydrate', { value: hydrate }); } catch (_) {}
})();

return Superset;

})(typeof globalThis !== 'undefined' ? globalThis : window);


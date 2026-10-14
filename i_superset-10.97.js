/* Instance Superset 10.97 */
;
(function compiler(global) {
'use strict';

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

/* doc:T-WIDTH */
const PUNCT_WIDTHS = Object.keys(PUNCT_BY_WIDTH).map(Number).sort((a, b) => b - a);

const RE_KW = new Set([
	'return', 'typeof', 'case', 'do', 'delete', 'void', 'in', 'instanceof',
	'new', 'yield', 'await', 'throw', 'else', 'of', 'default', 'for'
]);

/* token neighbours that are never undefined: jump(a, i, n) is a[i + n] or an
 * empty object, so `next(t, i).w` reads safely at either end of the array */
function jump(a, i, n) { return a[i + n] || {}; }
function next(a, i) { return jump(a, i, 1); }
function prev(a, i) { return jump(a, i, -1); }


/* doc:T-METACHAR */
/* a string as a regex source that matches it literally */
function escRe(s) { return String(s).replace(/[$^*+?.()|[\]{}\\]/g, '\\$&'); }
/* past the flag letters of a regex literal whose closing `/` ends at `i`;
 * returns the index after them */
function flags(src, i, n) { while (i < n && /[a-z]/.test(src[i])) i++; return i; }
/* after punctuator `p`, does the lexer stand after a VALUE (so a `/` next is
 * division)? A closing bracket ends a value; `++`/`--` leave it as it was. */
function valueAfterPunct(p, prevValue) {
	if (p === '++' || p === '--') return prevValue;
	return p === ')' || p === ']' || p === '}';
}
/* the comments out of a source, each replaced by a numbered marker
 * (\uE000 n \uE001) that restoreComments puts back. Returns { code, comments }.
 * The public entry; the editor's diagnostics use it too. */
function stripComments(src, comments = []) {
	const r = scan(String(src), comments);
	return { code: r.code, comments: r.comments };
}
/* tokenise a fragment; asserts the source has no stray mask characters */
function lex(code) {
	const c = String(code);
	return assertClean(scan(c).spans, c);
}
/* lex, or null when the text does not lex — for the many places that read a
 * fragment and fall back to leaving it as written (was `try { t = lex(x) } catch
 * (e) { return … }`, spelled 27 times) */
function lexOr(code) { try { return lex(code); } catch (e) { return null; } }
/* MASK THE COMMENTS. lex() strips comments and its offsets index the STRIPPED
 * text; blanking each comment to whitespace of its own shape first leaves
 * nothing to strip, so every offset the tokens carry indexes `src` itself.
 * Newlines are kept, so line numbers hold too. */
function maskComments(src) {
	const { code: stripped, comments } = stripComments(src);
	return stripped.replace(/\uE000(\d+)\uE001(\n*)/g, (_, id, nls) => {
		const c = comments[Number(id)];
		return c.replace(/[^\n]/g, ' ') + nls.slice((c.match(/\n/g) || []).length);
	});
}
/* APPLY TEXT EDITS: each { s, e, text } replaces text[s, e); edits are applied in
 * ascending order of `s` and must not overlap. One splice for every rewriter
 * (was spelled eight times, four of them over the output string in descending
 * order, which gives the same text when no two edits overlap). */
function splice(text, edits) {
	let out = '', pos = 0;
	for (const e of edits.slice().sort((a, b) => a.s - b.s)) { out += text.slice(pos, e.s) + e.text; pos = e.e; }
	return out + text.slice(pos);
}

/* doc:C-CAPTURE */
/* NO EVAL, ANYWHERE IN THE COMPILER. The Function constructor is eval: a strict
 * CSP refuses it, and every refusal is a violation report a security team reads
 * as "this library evals". Both places that used it read code instead.
 *
 * TOP-LEVEL AWAIT. A block that awaits at top level needs an async body to run
 * in. A brace count cannot find one — in `async () => await x` the await sits at
 * depth zero without being top-level — so the token stream is walked, tracking
 * the two ways code leaves the top level: a body in braces (function, method,
 * arrow block, class), and an arrow's EXPRESSION body, which ends at a `,` `;`
 * `:` or closing bracket on its own level, or where a newline lets ASI end it. */
const TLA_BLOCK_HEADS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);
const TLA_OPERAND = new Set(['await', 'typeof', 'void', 'delete', 'new', 'return', 'throw', 'yield',
	'in', 'of', 'instanceof', 'case', 'else', 'do', 'extends']);
/* does this script await at TOP LEVEL — outside every function body, method,
 * class body and arrow (block or expression body)? Decides whether a compiled
 * block must be run as an async body. The walk is the one described above. */
function hasTopLevelAwait(js) {
	if (!/\bawait\b/.test(js)) return false;
	try { var text = maskComments(js), t = lex(text); }
	catch (e) { return false; }            /* unlexable: the browser reports it */
	const ends = k => k && ((k.w !== undefined && !TLA_OPERAND.has(k.w)) || k.lit || k.num ||
		k.c === ')' || k.c === ']' || k.c === '}');
	const stack = [], arrows = [];
	let fnDepth = 0, classAt = -1, parenHead = null;
	for (let i = 0; i < t.length; i++) {
		const k = t[i], prev = t[i - 1], next = t[i + 1];
		while (arrows.length) {               /* an expression-bodied arrow ends here? */
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

/* THE MANIFEST is data — validated before this point to strings, numbers,
 * true/false/null, arrays and plain objects — so it is read as data, from the
 * lexer's tokens. Keys are defined, never assigned, so `__proto__` is a key. */
function readLiteral(text) {
	const t = lex(text);
	let i = 0;
	const fail = () => { throw new SyntaxError('not a data literal'); };
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
/* doc:C-VSYNC */
/* THE BLOCKING LANE IS SPELLED `vsync`. It does not mean “synchronous” — it
 * means the face WAITS, which is a blocking ASYNC operation. `sync` read as its
 * opposite often enough to be worth the rename; `vsync` carries the right
 * intuition from graphics, where it names a wait for the next frame that does
 * not freeze the machine.
 *
 * The word is normalised to the internal lane name `sync` at the parse boundary,
 * so nothing downstream changes. Bare `sync` is refused, naming the fix. */
/* doc:C-WORDTABLE */
/* ONE ROW PER WORD. Every set below is a VIEW over this table, so a rename is a
 * key here and nothing else.
 *
 *   lane        the canonical INTERNAL name; absent means it is not a lane
 *   head        legal as a class-head grain
 *   strip       removed from the head when the class is emitted
 *   structural  shapes the member, does not answer when the value arrives
 *   descriptor  how the slot behaves
 *   accessor    JavaScript's own word, part of the member form
 *   reserved    spoken for, not built — refused BY NAME
 *   retiring    still accepted; names its replacement in diagnostics */
const WORDS = {
	setup:     { lane: 'sync',  head: true, strip: true },   /* the blocking lane (C-LANES2X2) */
	sync:      { lane: 'sync',  head: true, strip: true, retiring: 'setup' },
	/* doc:C-WORDTABLE */
	/* A deliberate alias, and the only one in the table. It carries no
	 * information `sync` does not — it is a joke that compiles. Never written
	 * in this document or the suite; an alias that leaks into canonical
	 * material stops being a joke and becomes a migration. */
	synch:     { lane: 'sync',  head: true, strip: true, retiring: 'setup' },
	layer:     { lane: 'sync',  head: true, strip: true, retired: 'setup' },
	delay:     { lane: 'join', reserved: true },   /* leaf tail — was `defer join`; not built */
	vsync:     { lane: 'sync',  head: true, strip: true, retired: 'setup' },
	bsync:     { lane: 'sync',  head: true, strip: true, retired: 'setup' },

	async:     { lane: 'async', head: true, strip: true },
	defer:     { lane: 'defer', head: true },
	batch:     { lane: 'batch', retiring: 'setup async' },
	using:     { lane: 'using' },
	mixed:     { head: true, strip: true },
	iterable:  { structural: true, strip: true },
	untracked: { structural: true, strip: true },
	try:       { structural: true },
	memo:      { structural: true },
	indexed:   { structural: true },   /* `memo`'s participle spelling: commutes, may follow the lane */
	let:       { descriptor: true },
	const:     { descriptor: true },
	enum:      { descriptor: true },
	pin:       { descriptor: true },                     /* visible, locked, mutable — was `var` (C-PIN) */
	var:       { descriptor: true, retiring: 'pin' },
	ply:       { descriptor: true },
	azo:       { descriptor: true },
	get:       { accessor: true, fieldDescriptor: true },   /* a getter before `(`, a descriptor before `=` / `as` */
	set:       { accessor: true, fieldDescriptor: true },   /* a setter before `(`, the per-class constant before a name (C-SHADOW) */
	export:    { strip: true },
	default:   { strip: true },
	main:      { strip: true },
	watch:     { reserved: true },
	latch:     { reserved: true },
	join:      { reserved: true },
};
/* the set of WORDS whose table row satisfies `f` — every word class below is
 * read off the one table, never listed twice */
const _pick = f => new Set(Object.keys(WORDS).filter(w => f(WORDS[w])));
const GRAINS = _pick(r => r.head);
const FIELD_MODS = _pick(r => r.lane);
const STRUCTURAL = _pick(r => r.structural && r.strip);
const RESERVED_LANES = _pick(r => r.reserved);
/* doc:C-DESCRIPTOR */
/* The descriptor WORDS. What each one MEANS — its enumerable, configurable and
 * writable row — lives in the runtime's DESCRIPTORS table, which is the one
 * place behaviour is decided; the compiler only passes the keyword through. */
const DESCRIPTOR_WORDS = _pick(r => r.descriptor);
/* every word that can describe a FIELD: the descriptors, plus `get`, which the
 * modifier loop reads as an accessor word and a field path converts (C-GETFIELD) */
const FIELD_DESCRIPTORS = _pick(r => r.descriptor || r.fieldDescriptor);
/* doc:C-PIN */
/* A retiring descriptor spelling normalises to its replacement at the parse
 * boundary, so the runtime table holds one word per row. */
const DESC_ALIAS = Object.fromEntries(Object.entries(WORDS)
	.filter(([w, r]) => r.descriptor && r.retiring).map(([w, r]) => [w, r.retiring]));
/* a descriptor word as the runtime table spells it: a retiring alias → its replacement */
const canonDesc = w => (Object.prototype.hasOwnProperty.call(DESC_ALIAS, w) ? DESC_ALIAS[w] : w);
const HEAD_STRIP = _pick(r => r.strip);
/* a string literal in the output: single quotes, as the house style writes them */
const sq = s => "'" + String(s).replace(/[\\']/g, '\\$&') + "'";
/* every refusal: the message, and where in the source it points */
const err = (msg, at, Kind = SyntaxError) => { const e = new Kind(msg); if (at != null) e.at = at; return e; };
const LANE_ALIAS = Object.fromEntries(Object.entries(WORDS)
	.filter(([w, r]) => r.lane && r.lane !== w).map(([w, r]) => [w, r.lane]));
/* doc:C-VSYNC */
/* ONE normalisation, reading the table: a surface spelling maps to the internal
 * lane name, which diagnostics print as it is. */
const canonLane = w => (Object.prototype.hasOwnProperty.call(LANE_ALIAS, w) ? LANE_ALIAS[w] : w);
/* does lane word `w` block the constructor — is it `sync` or one of its spellings? */
const isBlocking = w => canonLane(w) === 'sync';
/* doc:C-WORDTABLE */
/* A retiring spelling still compiles, and names its replacement when it cannot.
 * `sync` is the one refused outright at the class head, where it has always
 * read as `synchronous` and never meant it. */
function laneWord(w, at) {
	const r = WORDS[w];
	if (r && r.retired) { throw err('`' + w + '` was retired \u2014 write `' + r.retired + '`.', at); }
	return canonLane(w);
}

/* doc:C-COMPOUND */
/* `sync` after a lane that already blocks adds nothing — accepted, and folds
 * into the base lane, the way `memo defer` folds into `defer`. */
/* doc:C-LANES2X2 */
/* The 2×2, read left to right: the first word says how the run meets the
 * constructor, the second how its lines meet each other. `setup async` is
 * joined with its lines landing as they come (batch); `async setup` is
 * detached with its lines in turn (the waterfall). The older spellings on the
 * second line still compile while they retire. */
const COMPOUND_LANES = new Set(['setup async', 'async setup', 'defer async', 'yield setup', 'defer setup',
	'defer batch', 'async sync', 'yield sync', 'defer sync']);

const ACCESSOR_KW = new Set(['get', 'set']);
/* doc:T-JUNKFIELD */
/* spoken for by a ruling, not yet built. Refused BY NAME so the failure
 * lands on the declaration instead of on a property nobody declared. */
/* doc:C-COMPOUND */
/* Compound lanes: ONE lane value, spelled with a space. The pair is the unit,
 * and nothing may be written between its halves. */
const PAIR = { '{': '}', '[': ']', '(': ')' };

/* the GRAIN of a class, in every form the emit asks for. `head`: the class's
 * declared grain word, or 'cap' (none). `link`: how the constructor meets
 * `super(…)` — read off the super call's form (`await`/`yield`/`void`), else the
 * constructor's own lane word, else 'cap'. `mode`: the super-call form, or the
 * grain's default form, or 'plain'. `cls`/`inst`: the static and instance faces'
 * grain — declared, or 'mixed' when the face has a fan field, else 'sync'.
 * `dInst`: what the constructor itself declares. `parts`: ctorParts. One per class. */
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
const SIGILS = /^[@&?$\u03a3\u0394\u03a6\u00f8#]/;
const WORD = { '@': 'sync', '&': 'defer', '?': 'async' };   /* doc:C-VSYNC */
const EXTENDS = /\bextends\b/;
/* doc:C-RUNTIME */
/* THE NAME THE EMIT CALLS THE RUNTIME BY — one switch, kept as an object so it
 * can be flipped back: 'ø' (the shorthand) or 'Superset'. The core binds both;
 * any other name needs a binding of its own. Public as `Superset.runtime`. */
const RUNTIME = { ref: '\u00f8' };
/* a runtime call site by name: rt('fan') is `ø.fan` (or `Superset.fan`, by the switch above) */
const rt = name => RUNTIME.ref + '.' + name;
/* doc:T-MULTIAWAIT */

/* doc:C-IFACE */

/* doc:C-PACKAGE */

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
/* doc:C-MANIFEST */

const JSON_WORDS = new Set(['true', 'false', 'null']);
/* is this object-literal text JSON-valued — only strings, numbers, true/false/
 * null, brackets, commas and plain keys? Null when it is; else { bad, at } naming
 * the first token that cannot be written to package.json. */
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
	/*
	try {
		return foreach( lex(text), function(v, prev, next, i, s) {
			const w = v.w, c = v.c; // alternatively, perhaps: this instead of 'v'
			if (v.lit || v.num) return;
			if (c && '{}[]:,'.includes(c)) return;
			if (w && JSON_WORDS.has(w)) return;
			if (w && next && next.c === ':') return;
			return [{ bad: w || c, at: v.s }];
		});
	} catch (e) { return { bad: 'unparseable' } }

	try {
		return foreach( lex(text), function(prev, next, i, s) {
			const w = this.w, c = this.c; // alternative: this instead of 'v'
			if (this.lit || this.num) return;
			if (c && '{}[]:,'.includes(c)) return;
			if (w && JSON_WORDS.has(w)) return;
			if (w && next && next.c === ':') return;
			return { bad: w || c, at: this.s };
		});
	} catch (e) { return { bad: 'unparseable' } }
	*/

	return null;
}
/* the `public static get manifest()` getter: must return a JSON-valued object
 * literal. `manifest: N` desugars to manifest_version and is consumed. */
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
	if (first?.w !== 'return') throw new SyntaxError(
		`package ${name}: the manifest body must RETURN an object literal \u2014 ` +
		`package.json is JSON, so it cannot be computed.`);
	let last = close - 1;
	if (t[last] && t[last].c === ';') last--;
	const objText = body.slice(t[open + 2] ? t[open + 2].s : t[close].s, t[last] ? t[last].e : t[close].s).trim();
	if (!/^\{/.test(objText)) throw new SyntaxError(
		`package ${name}: the manifest must return an OBJECT LITERAL, not ${objText.slice(0, 24)}\u2026`);
	const bad = manifestLiteral(objText);
	if (bad) throw new SyntaxError(
		`package ${name}: the manifest is written to package.json, which is JSON \u2014 ` +
		`'${bad.bad}' cannot appear in it. Only strings, numbers, true/false/null, ` +
		`arrays and plain objects.`);
	try { var value = readLiteral(objText); } catch (e) { 
		throw new SyntaxError(`package ${name}: the manifest is not a valid object literal.`);
	}

	const schema = 'manifest' in value ? value.manifest
	             : ('manifest_version' in value ? value.manifest_version : 1);
	delete value.manifest; 
	delete value.manifest_version;
	return { schema, value };
}

/* write the manifest object to `path` as package.json. Node only — elsewhere a
 * warning diagnostic. Returns 'created' | 'updated' | 'unchanged', or false. */
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

/* `package P extends Q implements I { … }` -> a record with its body range,
 * async-constructor flag and manifest */
function parsePackages(spans, code) {
	const out = new Map();
	for (let i = 0; i < spans.length; i++) {
		if (spans[i].w !== 'package') continue;
		if (spans[i - 1]?.w === 'using') continue;
		const name = spans[i + 1]?.w;
		if (!name) continue;
		let j = i + 2, base = null, impl = [];

		if (spans[j]?.w === 'is') {
			throw err(
				`package ${name}: write 'extends' rather than 'is' \u2014 a package inherits a real ` +
				`prototype. 'is' is the contract relation, on interfaces.`, spans[j].s);
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
/* `package P extends Q { fields; methods; constructor(a) { … } }` -> a plain class
 * whose static [Symbol.for('Instance.package')] INSTALLER assigns the fields to
 * `this` (the host) and runs the constructor body there — `await`ing the base's
 * installer first when the constructor is async. Methods are copied verbatim. */
function emitPackage(pk, code) {

	const body = code.slice(pk.bodyS, pk.bodyE).replace(/\bpublic\s+(?=static\b)/g, '');
	const rec = { name: pk.name, members: [], ctor: null, grain: null, implements: [] };
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
/* every `[try] [await] using package Name(args)` line in spans[from, to) ->
 * { name, args, mod: 'plain' | 'try' | 'await' | 'try await', span } */
function parseUsings(spans, from, to, code) {
	const out = [];
	for (let k = from; k < to; k++) {
		let b = k, mods = [];
		if (spans[b]?.w === 'try') { mods.push('try'); b++; }
		if (spans[b]?.w === 'await') { mods.push('await'); b++; }
		if (spans[b]?.w !== 'using' || spans[b + 1]?.w !== 'package') continue;
		const name = spans[b + 2]?.w;
		if (!name) { throw err('`using package` needs a name.', spans[b].s); }
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
/* one `using package` line -> its installer call by the USING tables: { pre } for
 * a plain install; { pre, post } when awaited (the post yields the handle, after
 * the partition). A `try` wraps each in a catch that swallows. Null for an
 * unknown modifier word. */
function emitUsing(u, i) {
	const M = USING_MOD[u.mod];
	if (!M) return null;
	const r = USING_ASM[M.op](u.name, u.args, i);
	const wrap = t => t && (M.soft ? `try { ${t} } catch (e) {}` : t);
	return { pre: wrap(r.pre), post: wrap(r.post) };
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
/* `interface I is J implements K { … }` -> a record with typed members */
function parseInterfaces(spans, code) {

	const out = new Map();
	for (let i = 0; i < spans.length; i++) {
		if (spans[i].w !== 'interface') continue;
		const name = spans[i + 1]?.w;
		if (!name) continue;

		let j = i + 2, bases = [];
		if (spans[j]?.w === 'extends') {
			throw err(
				`interface ${name}: write 'is' rather than 'extends' \u2014 ` +
				`'interface ${name} is ${spans[j + 1]?.w || '\u2026'}'.`, spans[j].s);
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
			while (spans[k] && spans[k].w && (GRAINS.has(spans[k].w) || FIELD_MODS.has(spans[k].w) || spans[k].w === 'static')
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
/* an interface record -> a plain class carrying its fields (and extending its
 * first base), so the name exists at run time; its methods are a compile-time
 * contract only, checked by checkImplements */
function emitInterface(f) {

	const tok = (t) => Array.isArray(t) ? '[' + t.join(', ') + ']' : t;
	const rows = f.members
		.filter(m => m.kind === 'field')
		.map(m => `    ${m.statik ? 'static ' : ''}${m.name}${m.type ? ' = ' + tok(m.type) : ';'}`.replace(/([^;])$/, '$1;'));
	return `class ${f.name}${f.bases.length ? ' extends ' + f.bases[0] : ''} {\n${rows.join('\n')}\n}\n`;
}
/* every member an interface requires, its bases' first (depth-first, each
 * interface visited once), so checkImplements sees the whole contract */
function ifaceMembers(iface, all, seen) {
	seen = seen || new Set();
	if (seen.has(iface.name)) return [];
	seen.add(iface.name);
	let out = [];
	for (const b of iface.bases) { const p = all.get(b); if (p) out = out.concat(ifaceMembers(p, all, seen)); }
	return out.concat(iface.members);
}
/* does this class satisfy each interface it implements — every member, exact
 * tier, exact grain? */
function checkImplements(rec, code, ifaces, diags) {
	if (!rec.implements || !rec.implements.length) return null;
	const need = [];
	for (const nm of rec.implements) {
		const iface = ifaces.get(nm);
		if (!iface) throw new SyntaxError(
			`Instance: class ${rec.name} implements '${nm}', which is not an interface here.`);
		for (const m of ifaceMembers(iface, ifaces)) need.push({ ...m, from: nm });
	}
	const typed = [];
	for (const m of need) {
		const have = rec.members.find(x => x.name === m.name && !!x.static === !!m.statik) ||
		             (m.name === 'constructor' && rec.ctor);
		if (!have) throw new SyntaxError(
			`Instance: class ${rec.name} \u2014 '${m.from}' requires ${m.statik ? 'static ' : ''}` +
			`'${m.name}'${m.kind === 'method' ? '()' : ''}, which is missing.`);
		if (m.kind === 'method' && have.kind === 'field') throw new SyntaxError(
			`Instance: class ${rec.name} \u2014 '${m.from}' requires '${m.name}' to be a method.`);

		const tier = (n) => (String(n).match(/^[$\u0394\u03a3\u03a6\u00f8]+/) || [''])[0];
		if (tier(m.name) !== tier(have.name || '')) throw new SyntaxError(
			`Instance: class ${rec.name} \u2014 '${m.from}' requires tier '${tier(m.name) || '(bare)'}' ` +
			`on '${m.name}', found '${tier(have.name) || '(bare)'}'.`);

		const want = m.mods.find(x => GRAINS.has(x));
		if (want) {
			const got = (have.mods || []).find(x => GRAINS.has(x)) || rec.grain;
			if (got !== want) throw new SyntaxError(
				`Instance: class ${rec.name} \u2014 '${m.from}' requires '${want}' on '${m.name}', found '${got || 'none'}'.`);
		}
		if (m.type && m.kind === 'field') {
			for (const one of (Array.isArray(m.type) ? m.type : [m.type]))
				if (!TYPE_REF[one] && !ifaces.has(one)) throw new SyntaxError(
					`Instance: class ${rec.name} \u2014 '${one}' is not a known type token.`);
			typed.push({ name: m.name, type: m.type });
		}
	}
	return typed.length ? typed : null;
}
/* doc:C-GOTO */

/* doc:C-REGISTER */
/* goto's names are per LEVEL and per FRAME, so they are minted once and looked
 * up — a jump and its target must spell the same label. */
const GOTO_REG = { lvl: new Map(), frame: null };
/* the two registers of a goto LEVEL: `L`, the label of its loop, and `S`, its
 * state variable (which case runs next) */
function gotoLabel(lvl) {
	if (!GOTO_REG.lvl.has(lvl)) GOTO_REG.lvl.set(lvl, { L: reg('label'), S: reg('label') });
	return GOTO_REG.lvl.get(lvl);
}
/* the one FRAME label a method's whole machine sits in — minted on first use, for
 * a `goto super` from a block that has no parent block to go to */
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
/* a table row, following string aliases: GOTO_ACT.void is 'return', which is a row */
const deref = (tbl, k) => { let v = tbl[k]; while (typeof v === 'string') v = tbl[v]; return v; };
/* the labelled blocks of a body as a tree: every `name: { … }` at this scope, with
 * its offsets, inner text and nested labelled blocks (`kids`). Null when there
 * are none or the body does not parse. A label inside a nested function is not
 * this scope's and is not in the tree. */
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
/* walk the tree giving every block its level, parent, siblings and index; fills
 * `sink` (label name → block) and returns it */
function gotoIndex(tree, level, parent, sink) {
	tree.forEach((n, i) => {
		n.level = level; n.parent = parent; n.sibs = tree; n.idx = i;
		sink.set(n.name, n);
		if (n.kids.length) gotoIndex(n.kids, level + 1, n, sink);
	});
	return sink;
}
/* one `goto [action] [target]` -> the text that performs it: a JUMP sets the
 * level's state and continues its loop, an EXIT breaks it, FRAME continues the
 * method's frame loop (`goto super` from a top-level block; marks ctx.fn so the
 * frame is emitted). `susp` adds a `yield` first. Returns { text }, or { err }
 * naming the bad action, label or referent. */
function gotoJump(node, act, target, index, susp, ctx) {
	const A = deref(GOTO_ACT, act);
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
/* rewrite every own-scope `goto …` in `text` to its jump (gotoJump); nested
 * functions are left alone. Returns { out, ends }, `ends` being the last
 * terminator seen — 'goto', 'return' or 'throw' — or null when the text falls off
 * its end; { err } on a bad goto. */
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
/* the sibling blocks of one level -> their state machine:
 *   let øS = 'first'; øL: while (true) { switch (øS) { case 'a': {…} case 'b': {…} } }
 * Each case is the block's text with its gotos rewritten; a block with children
 * wraps the children's machine in its own text. A block that ends without a
 * terminator is refused, so no case can fall through into the next. */
function gotoEmit(nodes, index, ctx) {
	const level = nodes[0].level;
	const cases = [];
	for (const n of nodes) {
		let body;
		if (n.kids.length) {
			const pre = n.text.slice(0, n.kids[0].s);
			const post = n.text.slice(n.kids[n.kids.length - 1].e);
			const rp = gotoRewrite(pre, n, index, ctx), rq = gotoRewrite(post, n, index, ctx);
			if (!rp || rp.err) throw new SyntaxError(`goto: in '${n.name}' \u2014 ${(rp && rp.err) || 'parse'}`);
			if (!rq || rq.err) throw new SyntaxError(`goto: in '${n.name}' \u2014 ${(rq && rq.err) || 'parse'}`);
			body = rp.out + '\n' + gotoEmit(n.kids, index, ctx) + '\n' + rq.out;
			if (!rq.ends) throw new SyntaxError(
				`goto: block '${n.name}' ends without a terminator \u2014 write 'goto <label>;', ` +
				`'goto continue;', 'goto break;', 'goto return;', or return/throw.`);
		} else {
			const r = gotoRewrite(n.text, n, index, ctx);
			if (!r || r.err) throw new SyntaxError(`goto: in block '${n.name}' \u2014 ${(r && r.err) || 'parse'}`);
			if (!r.ends) throw new SyntaxError(
				`goto: block '${n.name}' ends without a terminator \u2014 write 'goto <label>;', ` +
				`'goto continue;', 'goto break;', 'goto return;', or return/throw.`);
			body = r.out;
		}
		cases.push(`case ${JSON.stringify(n.name)}: {${body}}`);
	}
	return `let ${gotoLabel(level).S} = ${JSON.stringify(nodes[0].name)};\n${gotoLabel(level).L}: while (true) { switch (${gotoLabel(level).S}) {\n` +
		cases.join('\n') + `\n} }`;
}
/* rewrite a method whose body has labelled blocks and `goto` into the
 * loop-plus-switch machine. Every jump is braced; `goto yield` needs `*m()`. */
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
		if (!isGen) throw new SyntaxError('goto: `goto yield` suspends, so this member must be a generator \u2014 write `*name()`.');
	}
	const index = gotoIndex(tree, 0, null, new Map());
	const names = [...index.keys()];
	if (names.length !== new Set(names).size) throw new SyntaxError('goto: duplicate label');
	const pre = body.slice(0, tree[0].s), post = body.slice(tree[tree.length - 1].e);
	const ctx = { fn: false };
	const machine = gotoEmit(tree, index, ctx);

	return text.slice(0, open + 1) +
		(ctx.fn ? gotoFrame() + ': while (true) {\n' : '') + pre + '\n' + machine + '\n' + post +
		(ctx.fn ? '\nbreak ' + gotoFrame() + ';\n}\n' : '') + text.slice(open + 1 + body.length);
}
/* skip a nested function or arrow whose `function` or `=>` is token i: past the
 * body's closing brace, or past an expression-bodied arrow's expression (which
 * ends at a `,` `;` or closing bracket on its own level). Returns the index of
 * the first token that is not part of it. */
function skipFn(t, i) {

	if (t[i].w === 'function') {
		while (i < t.length && t[i].c !== '{') { if (t[i].c === '(') { const c = matchPair(t, i); if (c < 0) return i + 1; i = c; } i++; }
		const c = matchPair(t, i); return c < 0 ? t.length : c + 1;
	}
	if (t[i].c === '=>') {
		if (t[i + 1] && t[i + 1].c === '{') { const c = matchPair(t, i + 1); return c < 0 ? t.length : c + 1; }
		let d = 0, k = i + 1;
		while (k < t.length) {
			const c = t[k].c;
			if (c === '(' || c === '[' || c === '{') d++;
			else if (c === ')' || c === ']' || c === '}') { if (d === 0) return k; d--; }
			else if ((c === ',' || c === ';') && d === 0) return k;
			k++;
		}
		return k;
	}
	return i + 1;
}
/* tokens of a body EXCLUDING those inside nested functions and arrows — the
 * ones that belong to this scope. `own` is the index list, `t` the full array. */
function ownTokens(text) {

	const t = lexOr(text); if (!t) return null;
	const own = [];
	for (let i = 0; i < t.length; ) {
		if (t[i].w === 'function' || t[i].c === '=>') { i = skipFn(t, i); continue; }
		own.push(i); i++;
	}
	return { t, own };
}
/* doc:C-REGISTER */
/* INTERMEDIATE NAMES. Every synthetic binding the emit introduces is minted
 * here, never spelled inline. The shape is  ø <word> _ <name>  — a sigil that
 * cannot collide with an author identifier in practice, the WORD for what the
 * register is (the lane, for a lane's handle), and the author's name for what it
 * stands for: `ødefer_db` is the defer of `db`. A register that stands for
 * nothing an author named — a gate, a goto level — is the word and a number,
 * `ødefer0`, `ølabel1`; a second register of the same word for the same name
 * counts up, `øiterator_rows_2`. Table-driven, like GOTO_ASM: add a row and the
 * language has a new register kind. (RULED 2026-10-12: the words; the old form
 * `ø0j_db` — sequence number and one letter — read as gibberish.)
 *
 *   øtmp0            transient   freed after the next statement; never crosses a yield
 *   øvalue_x         value       pinned across a suspension for a waiting parent
 *   øarray_rows      array       an aggregated structure (a drain accumulator)
 *   ølabel0          label       a synthetic block label for goto / break routing
 *   østatic_x        static      minted inside the static face, so the two never mix
 *   øerror0          error       a catch binding
 *   øiterator_rows   iterator    a loop cursor or iterator-protocol handle
 *   ødefer0          gate        a deferred gate: `defer await warm()`
 *   ødefer_db        join        an acquire's handle: its start, and its join
 *   øbatch_x         batch       a `setup async` member's handle
 */
const REG_KIND = {
	transient: 'tmp', value: 'value', array: 'array', label: 'label',
	static: 'static', error: 'error', iterator: 'iterator', gate: 'defer', join: 'defer',
	/* doc:C-BATCH */
	batch: 'batch',
};
let ANON_N = 0;
const REG_BY_KEY = new Map(), REG_SEEN = new Map();   /* every name minted this compile → how many times */
/* a fresh register namespace, at the start of each compile */
function regReset() { ANON_N = 0; REG_BY_KEY.clear(); REG_SEEN.clear(); }
/* doc:C-TRACENAME */
/* The settlement generator carries the class's NAME, so a throw inside it reads
 * `øFeed` or `øFeed_Static` in the stack, not `at <anonymous>`. An unnamed class
 * gets a per-compile sequence, so the same source always produces the same
 * names. A named function EXPRESSION binds its name only inside itself. */
function traceName(rec, face) {
	const base = rec.name ? '\u00f8' + rec.name : '\u00f8anonymous_' + (++ANON_N);
	return face === 'static' ? base + '_Static' : base;
}
/* a register that must be spelled the SAME in two places — a gate's start and
 * its join — is minted once and looked up by key, so emit order cannot matter. */
function regFor(key, kind, name) {
	if (!REG_BY_KEY.has(key)) REG_BY_KEY.set(key, reg(kind, name));
	return REG_BY_KEY.get(key);
}
/* mint one register of `kind` (a REG_KIND key), for the author's `name` when it
 * stands for one: ødefer_db, øtmp0, øiterator_rows_2. Each spelling is minted
 * once per compile; REG_SEEN counts a repeat up. */
function reg(kind, name) {
	const word = REG_KIND[kind];
	if (word === undefined) throw new Error('reg: unknown register kind ' + kind);
	/* A register that STANDS FOR something the author wrote carries that name, so
	 * `\u00f8defer_rows` in a stack or a debugger says which field it belongs to. A
	 * field name is already a valid identifier, so appending it is always legal;
	 * the sigils and the tier prefix are stripped first. Registers that stand for
	 * nothing an author named \u2014 a gate binds no name, a goto state register is one
	 * per LEVEL \u2014 take a number instead; so does a second register of one word
	 * for one name, since two bindings cannot share a spelling. */
	const tag = name ? String(name).replace(/^[@&?]+/, '').replace(/[^\p{ID_Continue}$]/gu, '') : '';
	const base = '\u00f8' + word + (tag ? '_' + tag : '');
	const seen = REG_SEEN.get(base) || 0;
	REG_SEEN.set(base, seen + 1);
	if (!tag) return base + seen;
	return seen === 0 ? base : base + '_' + (seen + 1);
}
/* doc:C-TRYOP */
/* recognise a soft initialiser — `try [await] <operand>` or `try [await] { … }
 * [catch (e) { … }] [finally { … }]` — and return its descriptor: `body` (the
 * operand, or the block's contents), `tail` (what follows the operand, e.g.
 * `?? []`), `cat` and `fin` (the clauses, { param, body }), `bare` (not braced).
 * `whole` means an LHS try — the entire initialiser is the operand, no tail is
 * split off. Null when the text does not lead with `try`; a `catch` or `finally`
 * with no block to attach to is refused. */
function blockInit(text, whole) {
	const L = leading(text);
	if (!L.t) return null;
	const isTry = L.kws[0] === 'try', isAwait = L.has('await');
	const first = L.t.find(k => k.s >= L.at);
	const braced = first && first.c === '{';
	if (!isTry) {
		if (L.kws[0] === 'await' && braced) throw new SyntaxError(
			'a block operand belongs to `try`: write `try { \u2026 }` or `try await { \u2026 }`. ' +
			'(An object literal here needs parentheses: `await ({ \u2026 })`.)');
		return null;
	}
	const pfx = isAwait ? 'await ' : '';
	if (!braced) {
		const rest = L.opd;
		if (!rest) throw new SyntaxError('`try` needs an operand.');
		if (first && (first.w === 'catch' || first.w === 'finally')) throw new SyntaxError(
			'a `catch` or `finally` clause needs a block to attach to: write ' +
			'`try ' + pfx + '{ \u2026 } catch (e) { \u2026 }`.');
		if (whole) return { body: rest, tail: '', cat: null, fin: null, bare: true };
		const split = unaryOperand(rest);
		if (split === null) return null;
		const opd = rest.slice(0, split).trim(), tail = rest.slice(split).trim();
		const tt = leading(tail);
		if (tt.t && tt.t.some(k => k.w === 'catch' || k.w === 'finally')) throw new SyntaxError(
			'a `catch` or `finally` clause needs a block to attach to: write ' +
			'`try ' + pfx + '{ ' + opd + ' } ' + tail + '`.');
		return { body: pfx + opd, tail, cat: null, fin: null, bare: true };
	}
	/* braced: the operand is a block; clauses may follow it */
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
	return { body: text.slice(open + 1, close - 1), tail, cat, fin };
}
const ASI_CONTINUES = new Set(['instanceof', 'in', 'catch', 'finally', 'else']);
const ASI_OPENS = new Set(['await', 'yield', 'new', 'typeof', 'void', 'delete', 'return', 'try']);
/* where a field without a semicolon ends: at a token that begins a new line
 * and cannot continue the expression, when the previous token could end one */
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
/* doc:C-DESTRUCT */
/* A DESTRUCTURING FIELD binds several names from one settled value:
 *
 *     { users, metrics } = await fetchDashboard();
 *
 * The pattern is REWRITTEN to target `this` — `({ users: this.users } = v)`.
 * Emitting the pattern as written would assign to bindings that do not exist
 * (ReferenceError in strict mode), which is the whole difficulty.
 * `patternTargets` does the rewrite and reports the names, so the seed phase can
 * advertise every key before the partition. */
/* doc:C-DESTRUCT */
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
		if (pv && pv.c === ':') continue;                    /* already handled as an alias */
		if (nx && nx.c === ':') {
			const al = t[i + 2];
			if (al && al.w) { names.push(al.w); edits.push({ s: al.s, e: al.e, text: 'this.' + al.w }); i += 2; }
			continue;   /* `a: { b }` falls through: the inner names are rewritten in place */
		}
		/* shorthand `{ users }` -> `{ users: this.users }`; array `[a]` -> `[this.a]` */
		names.push(w);
		edits.push({ s: t[i].s, e: t[i].e, text: stack[stack.length - 1] ? 'this.' + w : w + ': this.' + w });
	}
	if (!names.length) return null;
	return { names, target: splice(text, edits) };
}
/* where a unary operand ENDS: a name, literal or bracketed group — after an
 * optional `await`, `void` or `typeof` — plus its member and call chain, the
 * same extent `typeof` has. Returns the offset in `text` of the first token
 * after it (text.length when the operand is the whole text), or null when the
 * text has no operand or does not lex. */
function unaryOperand(text) {
	const t = lexOr(text); if (!t) return null;
	let i = 0;
	if (!t.length) return null;
	if (t[i].w === 'await' || t[i].w === 'void' || t[i].w === 'typeof') i++;
	if (!t[i]) return null;
	if (t[i].c === '(' || t[i].c === '[') { const c = matchPair(t, i); if (c < 0) return null; i = c + 1; }
	else if (t[i].w || t[i].num || t[i].lit) i++;
	else return null;
	while (i < t.length) {
		if (t[i].c === '.' && t[i + 1] && t[i + 1].w) { i += 2; continue; }
		if (t[i].c === '(' || t[i].c === '[') { const c = matchPair(t, i); if (c < 0) break; i = c + 1; continue; }
		break;
	}
	return i >= t.length ? text.length : t[i].s;
}
/* doc:C-BLOCKINIT */
/* the emit for a soft field, as lines: `try { ølabel_x: { … var øvalue_x = … } }
 * catch { … }` and `this.x = øvalue_x`. A bare operand becomes one yield; a block
 * has its awaits converted, its returns rewritten as breaks, and its clauses
 * attached. The value register is a `var`, declared where it first lands (C-VAR). */
function labelledBlock(soft, ctx) {
	const { body, tail, cat, fin, bare } = soft;
	const { id, name, noYield } = ctx;
	if (bare) {
		const V = reg('value', name), B = reg('label', name);
		/* doc:C-VAR — the value lands in a `var`, inside the try; the catch has nothing left to reset */
		const handler = cat ? `catch ${cat.param || '(e)'} ${cat.body}` : 'catch (e) {}';
		return [`try { ${B}: { var ${V} = ${noYield ? body : 'yield ' + rhs(leading(body).kws[0] === 'await' ? body : 'await ' + body)}; } } ${handler}`,
			`this.${name} = ${V}${tail ? ' ' + tail : ''};`];
	}

	const info = ownTokens(body);
	if (!info) return null;
	const { t, own } = info;
	const V = reg('value', name), B = reg('label', name);
	/* doc:C-VAR */
	/* the register is declared where the value FIRST lands. `var` is function
	 * scoped, so every later write, the catch and the line after the `try` all
	 * name the one binding: put() spells the first write `var V`, the rest `V`. */
	let decl = 'var ';
	const put = () => { const d = decl; decl = ''; return d + V; };
	const edits = [], skip = [];
	const inSkip = (p2) => skip.some(([a, b]) => p2 >= a && p2 < b);
	for (const i of own) {
		if (t[i].w === 'await') { if (!inSkip(t[i].s)) edits.push({ s: t[i].s, e: t[i].e, text: 'yield' }); }
		else if (t[i].w === 'return') {

			let k = i + 1, d = 0, end = body.length;
			for (; k < t.length; k++) {
				const c = t[k].c;
				if (c === '(' || c === '[' || c === '{') d++;
				else if (c === ')' || c === ']' || c === '}') { if (d === 0) { end = t[k].s; break; } d--; }
				else if (c === ';' && d === 0) { end = t[k].s; break; }
			}
			const expr = body.slice(t[i].e, end).trim();
			const empty = expr === '';

			const multi = !empty && !noYield &&
				awaitCount(expr) > 1;
			if (multi) {
				edits.push({ s: t[i].s, e: end, text: `{ ${put()} = yield ${rhs('await ' + expr)}` });
				edits.push({ s: end, e: end, text: `; break ${B}; }` });
				skip.push([t[i].s, end]);
			} else {
				edits.push({ s: t[i].s, e: t[i].e, text: empty ? `{ break ${B}` : `{ ${put()} =` });
				edits.push({ s: end, e: end, text: empty ? ' }' : `; break ${B}; }` });
			}
		}
	}
	let out = splice(body, edits);

	const hasReturn = own.some(i => t[i].w === 'return');
	if (!hasReturn) {
		const semis = own.filter(i => t[i].c === ';');
		const first = own.find(i => t[i].w || t[i].c);
		const labelish = first !== undefined && t[first].w && t[own[own.indexOf(first) + 1]] && t[own[own.indexOf(first) + 1]].c === ':';
		const blockish = first !== undefined && t[first].c === '{';
		const simple = semis.length <= 1 && !labelish && !blockish &&
			!own.some(i => ['const', 'let', 'var', 'if', 'for', 'while', 'switch', 'try', 'do'].includes(t[i].w));

		if (simple) {
			const orig = body.trim().replace(/;\s*$/, '');
			out = `${put()} = ${noYield ? orig : 'yield ' + rhs(leading(orig).kws[0] === 'await' ? orig : 'await ' + orig)}`;
		}
	}

	let handler = 'catch (e) {}';   /* doc:C-VAR — a failure lands before any write, so the register is still undefined */
	if (cat) {
		const inner = cat.body.slice(1, -1);
		const ci = ownTokens(inner);
		let cb = inner;
		if (ci) {
			const ce = [];
			for (const i of ci.own) {

				if (ci.t[i].w === 'await') { ce.push({ s: ci.t[i].s, e: ci.t[i].e, text: 'yield' }); continue; }
				if (ci.t[i].w !== 'return') continue;
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
				const semis = ci.own.filter(i => ci.t[i].c === ';');
				const first = ci.own[0];
				const simple = first !== undefined && semis.length <= 1 &&
					!ci.own.some(i => ['const','let','var','if','for','while','switch','try','do','throw'].includes(ci.t[i].w));
				if (simple && inner.trim()) cb = `${put()} = ${inner.trim().replace(/;\s*$/, '')}`;
			}
		}
		handler = `catch ${cat.param || '(e)'} {${cb}}`;
	}
	let finBody = fin && fin.body;
	if (finBody) {
		const fi = ownTokens(finBody.slice(1, -1));
		if (fi) {
			const fe = fi.own.filter(i => fi.t[i].w === 'await').map(i => ({ s: fi.t[i].s, e: fi.t[i].e, text: 'yield' }));
			finBody = '{' + splice(finBody.slice(1, -1), fe) + '}';
		}
	}
	/* doc:C-VAR — nothing wrote it: the `try` declares it, so the line after still has a binding */
	return [`try { ${decl ? `var ${V}; ` : ''}${B}: {${out}} } ${handler}${finBody ? ' finally ' + finBody : ''}`,
		`this.${name} = ${V}${tail ? ' ' + tail : ''};`];
}
/* doc:T-AWAITPAREN */
/* is the whole text one `await <operand>` — `await f()`, `await a.b[c](d)` — with
 * nothing after the operand? The operand walk is unaryOperand's; the text is
 * whole when that walk reaches its end. (Was a second copy of the walk.) */
function wholeAwait(text) {
	const t = lexOr(text);
	return !!t && t.length > 1 && t[0].w === 'await' && unaryOperand(text) === text.length;
}
const LEAD_KW = new Set(['try', 'await', 'yield', 'for', 'defer']);
/* the keywords that LEAD a text (`try`, `await`, `for`, `yield`, `defer`), and
 * where the operand begins after them. Replaces every `/^\s*try\b/` regex. */
function leading(text) {
	const t = lexOr(String(text)); if (!t) return { t: null, kws: [], at: 0, opd: String(text) };
	const kws = [];
	let i = 0;
	while (t[i] && t[i].w && LEAD_KW.has(t[i].w)) { kws.push(t[i].w); i++; }
	const at = t[i] ? t[i].s : String(text).length;
	return { t, kws, at, opd: String(text).slice(at).trim(), has: (k) => kws.includes(k) };
}
/* how many own-scope `await`s a text has — not `.await` member names, not inside
 * nested functions */
function awaitCount(text) {
	const o = ownTokens(String(text));
	if (!o) return 0;
	return o.own.filter(i => o.t[i].w === 'await' && !(i > 0 && o.t[i - 1].c === '.')).length;
}
/* does this text contain an own-scope `await` (or the word asked for) — not a
 * member name, not a key, not inside a nested function? */
function hasAwait(text, w = 'await') {
	const o = ownTokens(String(text));
	if (!o) return false;
	return o.own.some(i => o.t[i].w === w &&
		!(i > 0 && o.t[i - 1].c === '.') && !(o.t[i + 1] && o.t[i + 1].c === ':'));
}
/* an initialiser as the RIGHT-HAND SIDE of `this.x = yield …`: a `yield v` is
 * already a handle, so v; a whole `await f()` is f() — the yield awaits it; any
 * other text that awaits inside becomes `(async () => text)()`, so one yield
 * settles all of it; text without an await is itself. */
function rhs(v) {
	const text = String(v), L = leading(text);
	if (L.kws[0] === 'yield') return L.opd;
	if (wholeAwait(text)) {
		const bare = L.kws[0] === 'await' ? L.opd : text;
		if (!hasAwait(bare)) return bare;
	}
	return hasAwait(text) ? `(async () => ${text})()` : text;
}
/* doc:C-AS */
/* A field BINDS at `=` or at `as`. Every place that asks "is this a binding?"
 * asks here — including the check that tells `static { a, b } as x` (a
 * pattern) from `static { … }` (JavaScript's static block). */
function isBind(t) { return !!t && (t.c === '=' || t.w === 'as'); }
/* doc:T-DRAINSRC */
/* the SOURCE expression of a drain, parenthesised — `(expr)` — evaluated inside
 * the generator. An awaited source, or `unwrap` (`as`), is `(yield expr)`, so a
 * promise of an iterable is drained too. `await for` is refused by name. */
function src(v, unwrap) {
	const raw = String(v).trim(), L = leading(raw);
	if (L.kws[0] === 'await' && L.kws[1] === 'for') throw new SyntaxError(
		'`await for` is not a form: write `await ' + L.opd + '`. The plain await ' +
		'drains the same sources AND a promise of an iterable, which `await for` cannot.');
	/* doc:C-AS — `rows[]* as stream()` drains what the source PRODUCES */
	if (L.kws[0] === 'await' || unwrap) return '(yield ' + rhs(raw) + ')';
	return '(' + raw + ')';
}
/* doc:C-DRAINS */
/* the drain is the runtime's generator, delegated to: `this.rows = yield* ø.drain(src)`
 * fills a new array (or `{}`), `yield* ø.drain(src, this.rows)` fills the field */
const drainInto = (srcExpr, into) => `yield* ${rt('drain')}(${srcExpr}${into ? ', ' + into : ''})`;
/* doc:C-RUNTIME */
/* the fan call: `ø.fan(this, 'x', p[, mode])`. A destructuring fan names every
 * bound name and lands through its pattern — `ø.fan(this, ['a', 'b'], p, _ => {
 * ({ a: this.a, b: this.b } = _); })` — so the runtime can poison each of them on
 * rejection; a soft pattern reads from an empty source rather than throwing. */
const fanCall = (n, value, o, mode) => {
	const pattern = o && o.pattern;
	const args = [pattern ? `[${o.names.map(x => sq(emitName(x))).join(', ')}]` : sq(n), value];
	if (mode) args.push(sq(mode));
	if (pattern) args.push(`_ => { (${pattern} = _${o.soft ? ' ?? ' + (/^\[/.test(pattern) ? '[]' : '{}') : ''}); }`);
	return `${rt('fan')}(this, ${args.join(', ')});`;
};
/* doc:C-BATCH */
/* the barrier of a run, at its last member: one call names every member — its
 * field, its handle (minted where the start was emitted, so the same key finds
 * it) and its words — and the yield waits for all of them */
const batchBarrier = o => `yield ${rt('batch')}(this, ${o.batchRun.map(x => {
	const words = [x.soft && 'try', x.memo && 'indexed'].filter(Boolean).join(' ');
	return `[${sq(x.name)}, ${regFor(x.key, x.kind, x.name)}${words ? ', ' + sq(words) : ''}]`;
}).join(', ')});`;
const FIELD = [

	/* doc:C-DRAINS */
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
	/* doc:C-BATCH */
	/* A contiguous same-face run fires together and writes FCFS, in place; the
	 * LAST member of the run carries the barrier. Starts are emitted INLINE
	 * rather than hoisted, because hoisting is global and would start a run
	 * sitting behind an earlier run's barrier. */
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
		emit: (n, v, o) => o && o.soft
			? `try { yield ${rhs(v)}; } catch (e) {}`
			: `yield ${rhs(v)};` },
	/* doc:C-COMPOUND */
	/* `defer batch` is both halves and neither alone: the START is where the member
	 * stands, as `defer`'s is (T-ORDER), so the work begins there; the WRITE is
	 * the batch runtime's, so members land FCFS instead of in source order; and
	 * the barrier sits at the LOCAL TAIL, where the deferred assignments already
	 * were. Nothing new is invented — the two existing mechanisms are simply not
	 * the ones that normally pair. */
	{ lc: 'deferbatch', susp: true, comp: null, slot: 'acquire', mirror: true,
		pre:  (n, v, o) => `const ${regFor('join:' + n, 'join', n)} = ${rhs(v)}; // @defer-start`,
		emit: (n, v, o) => o.batchLast ? batchBarrier(o) : '' },   // the members' writes are the barrier's; only the last emits a line
	{ lc: 'defer',   susp: true,  comp: null,    slot: 'acquire', mirror: true,
		pre:  (n, v, o) => `const ${regFor('join:' + n, 'join', n)} = ${rhs(v)}; // @defer-start`,
		emit: (n) => `this.${n} = yield ${regFor('join:' + n, 'join', n)};` },
	{ lc: 'async',   susp: null,  comp: 'drain', slot: 'fan',   mirror: true,
		emit: (n, v, o) => o && o.obj
			? `this.${n} = {}; ${rt('inflight')}(this, (async () => { for await (const _ of ${src(v)}) this.${n}[_[0]] = _[1]; })());`
			: `this.${n} = []; ${rt('inflight')}(this, (async () => { for await (const _ of ${src(v)}) this.${n}.push(_); })());` },
	/* doc:C-WATERFALL */
	/* `async delay` — the background waterfall. Detached, so nobody waits for
	 * it; ordered, so each one STARTS only once the previous `async delay` on
	 * this element has resolved. The right-hand side is passed as a THUNK, not
	 * a promise: every other lane evaluates its expression where it stands, and
	 * this is the one lane that must not. It is the mirror of `memo`, which
	 * orders writes and deliberately leaves execution alone.
	 *
	 * The chain is per lane, so a waterfall never holds up a plain `async`.
	 * A field that never resolves stalls every later one in its lane — inherent
	 * to a waterfall, and invisible at the call site. */
	{ lc: 'asyncdelay', susp: null, comp: null, slot: 'fan', mirror: true,
		emit: (n, v, o) => fanCall(n, `() => ${rhs(v)}`, o, 'delay') },
	/* doc:C-MEMO */
	/* memo on a DETACHED lane. The promise is built at the call site, so the
	 * work still starts here and still finishes when it finishes; only the
	 * WRITE is held back to its turn in source order. */
	/* doc:C-RUNTIME */
	/* a fan is ONE call: the runtime lands the value, poisons on rejection and
	 * registers the write in flight — the emit spells no sentinel (as for BLANK) */
	{ lc: 'async',   susp: null,  comp: null,    slot: 'fan',   mirror: true, memo: true,
		emit: (n, v, o) => fanCall(n, rhs(v), o, 'indexed') },
	{ lc: 'async',   susp: null,  comp: null,    slot: 'fan',   mirror: true,
		emit: (n, v, o) => fanCall(n, rhs(v), o) },
	{ lc: null,      susp: null,  comp: 'spread', slot: 'plain', mirror: true,
		emit: (n, v, o) => o && o.obj ? `this.${n} = { ...(${String(v).replace(/^sync\s+/, '')}) };`
			: `this.${n} = [...${String(v).replace(/^sync\s+/, '')}];` },
	/* doc:C-TRYOP */

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
/* the FIELD-table slot a member settles in: 'plain', 'spine' (blocks), 'acquire'
 * (a defer: starts in place, joins at the tail) or 'fan' (async: never joined) */
function slotOf(m, code) { return rowFor(m, code).slot; }
const ADMITS = { sync: ['sync', 'defer'], mixed: ['sync', 'defer', 'async'], async: ['async'] };
const SLOT_LANE = { fan: 'async', acquire: 'defer' };
/* string and template literals blanked to `""`, so a text search cannot match inside one */
function stripLits(c) { return c.replace(/`(?:[^`\\]|\\[\s\S])*`|'(?:[^'\\]|\\[\s\S])*'|"(?:[^"\\]|\\[\s\S])*"/g, '""'); }
/* a named field's initialiser with its string literals blanked — what the two
 * walls in check() read for `this.x` references — or null for any other member */
const fieldBody = (f, code) => (f.kind === 'field' && f.name != null && f.init) ? stripLits(code.slice(f.init.s, f.init.e)) : null;
/* a field name without its lane sigil (`@x` → `x`), as diagnostics spell it */
function sigilBare(n) { return String(n).replace(/^[@&?]+/, ''); }
const DIAGNOSTICS = {
	lifecycle: (cls, field) =>
		`Instance: class ${cls} \u2014 field '${field}' suspends but declares no lifecycle. ` +
		`Write 'sync ${field} = \u2026' to make the class wait for it, or ` +
		`'async ${field} = \u2026' to let it settle in the background.`,
	grain: (cls) =>
		`Instance: class ${cls} \u2014 an instance field uses 'await' (a pending field at 'new'); ` +
		`'${cls}' must be declared 'mixed class' or 'async class'.`
};
const PENDING = "Symbol.for('??')";
/* doc:C-BLANK */
const BLANK = "Symbol.for('..')";   /* a declaration with no initialiser: the field exists, nothing is written */
/* a parsed member -> its settle op: EMIT, DYNKEY, or FIELD with the initialiser
 * text, its FIELD-table row and its flags (pattern, soft, memo, batch run,
 * unwrap). `pre` marks an acquire's START, emitted in place before its join. */
function mkField(m, init, code, pre) {
	/* doc:C-AWAITTHIS */
	if (m.rendezvous) init = rt('landed') + '(this)';
	if (m.kind === 'emit') return { op: 'EMIT', init, star: !!m.star, at: m.span };
	/* doc:T-DYNKEY */
	if (m.kind === 'dynkey') return { op: 'DYNKEY', key: m.key, init, unwrap: !!m.unwrap, at: m.span };
	return ({ op: pre ? 'FIELD_PRE' : 'FIELD',
	name: m.name, names: m.names, pattern: m.pattern,
	init, row: rowFor(m, code), obj: m.comprehension === 'object', at: m.span, soft: !!m.soft, emit: !!m.emit,
	/* doc:C-BATCH */
	memo: !!m.memo, batchRun: m.batchRun, batchLast: !!m.batchLast, unwrap: !!m.unwrap });
}
/* the class head as the emit writes it: `class Name extends Base` — the grain and
 * structural words stripped, `class*` read as `class`, the implements clause dropped */
function headText(rec, code) {
	const text = code.slice(rec.head.s, rec.head.e);
	const t = lexOr(text); if (!t) return text.trim();
	let i = 0;
	while (t[i] && t[i].w && HEAD_STRIP.has(t[i].w)) i++;
	const cls = t[i];
	if (!cls || cls.w !== 'class') return text.trim();
	let j = i + 1;
	if (t[j] && t[j].c === '*') j++;                       // class* -> class
	const impl = t.findIndex((k, x) => x > j && k.w === 'implements');
	const end = impl >= 0 ? t[impl].s : text.length;
	return ('class ' + text.slice(t[j] ? t[j].s : end, end)).trim();
}
const DETACH_TOKEN = "Symbol.for('Instance.detach')";
/* what the partition hands the runtime for a super-call form: `this` for an
 * awaited super, the detach token for a void one, nothing for a yielded one */
function handshakeFor(mode) { return mode === 'await' ? 'this' : mode === 'void' ? DETACH_TOKEN : null; }
const IND = '    ';
/* a member name as the output spells it: the lane sigil dropped (`@x` → `x`; `#p` stays) */
function emitName(n) { return n == null ? null : n.replace(/^[@&?]+/, ''); }
/* is this a #private name, once its sigil is off? */
function isPrivate(n) { return emitName(n)[0] === '#'; }
/* constructor text for the settlement generator: every `await` becomes `yield`,
 * unless the text is itself an `async` function (its awaits are its own) */
function yieldify(text) {
	const ht = lexOr(text); if (!ht) return text;
	const brace = ht.findIndex(k => k.c === '{');
	if (ht.slice(0, brace < 0 ? ht.length : brace).some(k => k.w === 'async')) return text;
	return text.replace(/\bawait\s+/g, 'yield ');
}
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/* the class records of a source — parsed, not compiled. The public entry for
 * tools that read the structure (the editor's outline). */
function findClasses(src) {
	const { code, spans } = scan(String(src));
	return parseClasses(assertClean(spans, code), code);
}

/* doc:T-DIVISION */
/* the end of a string or regex literal opening at `i`: past the closing quote,
 * or past the closing `/` and its flags (a `/` inside a [class] does not close).
 * An unterminated literal ends at the newline. Returns the index after it. */
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

/* the end of an identifier starting at `i` — or, `numeric`, of a number literal
 * with its `.`, digits, exponent and sign. Returns the index after it. */
function run(src, i, numeric) {
	const n = src.length;
	if (!numeric) { while (++i < n && ID_CONT.test(src[i])); return i; }
	while (++i < n && /[\w.]/.test(src[i]))
		if ((src[i] === 'e' || src[i] === 'E') && /[+-]/.test(src[i + 1] || '')) i++;
	return i;
}

/* doc:T-TEMPLATE */
/* past a template literal opening at `i`, or — `interp` — to the `}` that closes
 * an interpolation already open at `i`, skipping nested strings, templates and
 * comments on the way. The text is not tokenised; template() does that. */
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

/* can a `/` here begin a REGEX? After a value (a name, number, literal or closing
 * bracket) it is division; after a keyword in RE_KW, an operator or at the start
 * it opens a literal; after `++`/`--` it depends on whether they were postfix. */
function regexAllowed(prevValue, prevWord, prevPunct) {
	if (prevWord != null) return RE_KW.has(prevWord);
	if (prevPunct === '++' || prevPunct === '--') return !prevValue;
	if (prevPunct != null) return !(prevPunct === ')' || prevPunct === ']' || prevPunct === '}');
	return !prevValue;
}

/* doc:T-COMMENT */

/* THE LEXER. One pass over the source: strips comments into `comments`, leaving
 * a numbered marker in each one's place, and returns { code, spans } where each
 * span is a token with its offset — a word (.w), a punctuator (.c), a number
 * (.num) or a literal (.lit).
 * Template interpolations are tokenised and merged in. Every decision in this
 * compiler reads spans; nothing below re-scans text with a regex. */
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

		if (c === '"' || c === "'" || (c === '/' && regexAllowed(prevValue, prevWord, prevPunct))) {
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

		if (ID_START.test(c) || (/[@&?]/.test(c) && ID_START.test(src[i + 1] || ''))) {
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

		/* doc:T-OPTCHAIN */
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
		prevValue = valueAfterPunct(p, prevValue);
	}

	return { code: out, comments, spans };
}

/* doc:T-TEMPLATEAWAIT */
/* copy a template literal opening at `i` out through `write`, scanning each
 * `${ … }` with the lexer so its tokens are real (an `await` inside one counts);
 * `inner` receives each interpolation's scan, for the spans. Returns the index
 * after the closing backtick. */
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

/* put the comments back: every marker (\uE000 n \uE001) becomes comments[n].
 * A marker carries the newlines of its comment, so those are not doubled. */
function restoreComments(code, comments) {

	return code.replace(new RegExp(M_OPEN + '(\\d+)' + M_CLOSE + '(\\n*)', 'g'), (_, id, nls) => {
		const c = comments[Number(id)];
		if (c === undefined) throw new Error('unknown comment marker: ' + id);
		return c + nls.slice((c.match(/\n/g) || []).length);
	});
}

/* the lexer's invariants, as plain Errors: given `code`, the spans `x` are in
 * order, non-empty and marker-free; without it, `x` is output text and no marker
 * survives in it. Returns `x`. */
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

/* doc:T-ESCAPE */

/* find every class head: its grain, structural modifiers, name, extends,
 * implements and body range. Returns a record per class; parseBody fills the
 * members. Nested classes are handled later by nestWrap, per member. Under
 * `recover` a member the walk refuses is cut and its refusal kept on the class
 * record — `faults`, or `fault` when the refusal is the class's — instead of
 * thrown (C-RECOVER). */
function parseClasses(spans, code, recover) {
	const classes = [];
	for (let i = 0; i < spans.length; i++) {
		if (spans[i].w !== 'class') continue;

		let grain = null;
		let headStart = spans[i].s;

		const starCls = next(spans, i).c === '*' ? 1 : 0;
		const structuralCls = new Set(starCls ? ['iterable'] : []);
		/* doc:C-MAINCLASS */

		let _b = i, isMain = false;
		/* doc:C-STATICCTOR */
		/* `try` on the class head would soften the class face (P-6). It is not
		 * built; as written it left `try` outside the class and emitted `try class`. */
		for (let _t = i; _t > 0; _t--) {
			const pw = prev(spans, _t).w;
			if (pw === 'try') {
				throw err('`try` on the class head is not built yet (P-6: it would soften the class face). ' +
					'Write `try` on each static member for now.', prev(spans, _t).s);
			}
			if (!(STRUCTURAL.has(pw) || GRAINS.has(pw) || pw === 'main')) break;
		}
		while (_b > 0 && (STRUCTURAL.has(prev(spans, _b).w) || prev(spans, _b).w === 'main')) {
			if (prev(spans, _b).w === 'main') isMain = true; else structuralCls.add(prev(spans, _b).w);
			headStart = prev(spans, _b).s; _b--;
		}
		if (_b > 0 && GRAINS.has(prev(spans, _b).w)) {
			grain = laneWord(prev(spans, _b).w, prev(spans, _b).s);
			headStart = prev(spans, _b).s;
			_b--;
		}
		if (_b > 1 && prev(spans, _b).w === 'default' && prev(spans, _b - 1).w === 'export') {
			isMain = true;
			headStart = prev(spans, _b - 1).s;
		}

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
			head: { s: headStart, e: spans[j].s },
			body: { s: spans[j].e, e: spans[close].s },
			ctor: null,
			sctor: null,
			members: []
		};
		/* doc:C-RECOVER */
		/* UNDER RECOVER THE WALK GOES ROUND WHAT IT REFUSES. The member it could not
		 * read is cut: its refusal is kept on the class, and the walk resumes where
		 * the member ends — its `;`, or the line where ASI ends it, the boundaries
		 * the walk itself reads (initEnd). A refusal inside a CONSTRUCTOR is the
		 * class's instead (`rec.fault`): the grain and the handshake may stand on
		 * it, and the class without it would be refused for things the author did
		 * not write. Without recover the first refusal throws, as it always has. */
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
		classes.push(rec);
		i = close;
	}
	return classes;
}

/* doc:T-NESTPAREN */
/* the index of the `)` closing the `(` at `from` in a STRING (not tokens),
 * counting nesting; `from` itself when it never closes */
function closeParen(t, from) {
	let d = 0;
	for (let i = from; i < t.length; i++) {
		if (t[i] === '(') d++;
		else if (t[i] === ')' && !--d) return i;
	}
	return from;
}
/* the index of the token closing the bracket at `open` — `(` `[` or `{` —
 * counting nesting, searching up to `to`; -1 when `open` is not a bracket or it
 * never closes */
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

/* doc:T-OPENTARGET */
/* the first token in spans[from, to) that is punctuator `ch` at bracket depth 0, or -1 */
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

/* doc:T-PARAMBRACE */
/* where a method ends: the `}` matching its body's brace — the first `{` at depth
 * 0 from `at`, so a brace in a default parameter does not count. -1 if none. */
function methodEnd(spans, at, to) {
	const b = topLevel(spans, at, to, '{');
	return b < 0 ? -1 : matchPair(spans, b, to);
}

/* walk a class body: fields (with lanes, sigils, comprehensions, LHS try),
 * methods, accessors, static blocks, gates, and `using package` lines. A field
 * ends at `;` or at a newline where ASI would end it. `cursor`, when given, is
 * kept current for parseClasses' recovery: `k` is the first token of the member
 * being read, `ctor` whether that member is a constructor (C-RECOVER). */
function parseBody(spans, from, to, rec, code, cursor) {
	/* doc:T-ASI */
	/* where an initialiser that begins after token `b` ends, and where the next
	 * member starts: at its `;`, or at a new line that cannot continue it */
	const initEnd = b => {
		const semi = topLevel(spans, b + 1, to, ';');
		const asi = fieldNeedsASI(spans, b + 1, semi < 0 ? to : semi, code);
		if (asi >= 0) return { e: spans[asi].s, next: asi };
		const p = semi < 0 ? to : semi;
		return { e: semi >= 0 ? spans[semi].s : prev(spans, p).e || spans[b].e, next: semi >= 0 ? p + 1 : p };
	};
	let k = from;
	while (k < to) {
		if (cursor) { cursor.k = k; cursor.ctor = false; }   /* doc:C-RECOVER */
		const t = spans[k];
		if (t.c === ';') { k++; continue; }

		/* doc:C-IMPLICIT */
		/* `'use implicit';` at the TOP of a class body makes vsync the default lane
		 * for a suspending cached field. It is a DIRECTIVE, not a member: emitting it
		 * would define a property named "use implicit". Only valid as the first
		 * member — a reader must never scroll to learn which rules are in force. */
		if (/^['"]use implicit['"]$/.test(code.slice(t.s, t.e).trim())) {
			if (rec.members.length || rec.ctor) {
				throw err("`'use implicit'` must be the first member of the class body.", t.s);
			}
			rec.implicitLane = true;
			k++;
			if (spans[k] && spans[k].c === ';') k++;
			continue;
		}

		/* doc:C-DESTRUCT */
		/* `static { … }` is JavaScript's static BLOCK; `static { … } = x` is a
		 * destructuring field, and a SyntaxError in JS, so the space is free. One
		 * token of lookahead past the closing brace tells them apart. */
		/* doc:C-TRYSTATIC */
		/* `static try { … }` — a static block that tolerates failure. An author's
		 * own `catch` / `finally` are kept; without one, a bare catch is supplied.
		 * `static { a, b } = …` is a destructuring FIELD, told apart by the `=` after
		 * the brace. `static` and `try` commute, so both orders are taken here. */
		if (jump(spans, k, 2).c === '{' &&
		    ((t.w === 'static' && next(spans, k).w === 'try') ||
		     (t.w === 'try' && next(spans, k).w === 'static'))) {
			const bOpen = k + 2;
			const bEnd = matchPair(spans, bOpen);
			if (bEnd >= 0 && !isBind(next(spans, bEnd))) {
				let end = bEnd;
				/* absorb an author's catch / finally */
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

		/* doc:C-PACKAGE */

		{
			let b = k;
			if (spans[b]?.w === 'try') b++;
			if (spans[b]?.w === 'await') b++;

			if (spans[b]?.w === 'using' && spans[b + 1]?.w && spans[b + 1]?.w !== 'package') {
				throw err('`using` must name a package: write `using package ' + spans[b + 1].w + ';`.', spans[b].s);
			}
			if (spans[b]?.w === 'using' && spans[b + 1]?.w === 'package') {
				const stop = topLevel(spans, b, to, ';');
				const end = stop < 0 ? to : stop;
				(rec.usings || (rec.usings = [])).push({ from: k, to: end });
				k = stop < 0 ? end : stop + 1;
				continue;
			}
		}

		/* doc:C-BARRIER */

		{
			/* doc:T-SOFTFACE */
			let b = k, st = false, word = null, soft = false;
			if (spans[b] && spans[b].w === 'static' && next(spans, b).w !== undefined) { st = true; b++; }
			if (spans[b] && spans[b].w === 'try' && next(spans, b).w !== undefined) { soft = true; b++; }
			if (spans[b] && GRAINS.has(spans[b].w) && next(spans, b).w === 'await') { word = spans[b].w; b++; }
			if (spans[b] && spans[b].w === 'await' && next(spans, b).c !== '(') {
				const stop = topLevel(spans, b + 1, to, ';');
				const end = stop < 0 ? to : stop;

				if (topLevel(spans, b + 1, end, '=') >= 0) {
					throw err('LHS await is only legal as a sequencing declaration, ' +
						'not as a field assignment. Drop the `=` to make it a barrier (`await \u2026;`), ' +
						'or bind a field to what it produces with `as` (`x as \u2026;`).', spans[b].s);
				}

				/* doc:C-AWAITTHIS */
				/* `await this` is a SEQUENCE POINT: every fan declared above settles before
				 * anything below starts. Taken literally it would yield the element itself,
				 * which is thenable during settlement — the element waiting on its own
				 * construction, forever. `defer` would move the wait to the tail, where every
				 * fan of the face has started and a bare `await this;` already waits for all
				 * of them; that is refused as a second spelling. */
				const rendezvous = end === b + 2 && spans[b + 1] && spans[b + 1].w === 'this';
				if (rendezvous && word === 'defer') {
					throw err('`await this` waits for the fans declared ABOVE it, where it stands. `defer` would move ' +
						'the wait to the tail, where a bare `await this;` already waits for every fan. Place `await this;` where the wait belongs.', spans[k].s);
				}
				if (word !== null && word !== 'defer') {
					throw err('an `await` member binds nothing, so `' + word +
						'` has nothing to describe. A bare `await \u2026;` already blocks here; ' +
						'`await defer \u2026;` starts it now and blocks at the tail.', spans[k].s);
				}
				rec.members.push({ kind: 'field', name: null, bare: true, soft, mods: word ? [word] : [], static: st, rendezvous,
					comprehension: null,
					init: { s: spans[b].s, e: (spans[end - 1] || spans[b]).e },
					span: { s: spans[k].s, e: (spans[end - 1] || spans[b]).e } });
				k = stop < 0 ? end : stop + 1;
				continue;
			}
		}

		const startTok = spans[k];
		const mods = [];
		let isStatic = false;
		/* doc:C-TRYLHS */

		/* doc:C-TLY */
		/* `yield* src;` — delegate an iterable into the settlement stream. `yield*
		 * await src()` awaits the source first; both drain through the same emit. */
		if (spans[k].w === 'yield' && spans[k + 1] && spans[k + 1].c === '*') {
			const semi = topLevel(spans, k + 2, to, ';');
			const end = semi < 0 ? to : semi;
			rec.members.push({ kind: 'emit', name: null, bare: true, emit: true, star: true,
				mods: [], static: isStatic,
				init: { s: spans[k + 2] ? spans[k + 2].s : spans[k + 1].e, e: prev(spans, end).e },
				span: { s: spans[k].s, e: prev(spans, end).e } });
			k = semi < 0 ? end : semi + 1;
			continue;
		}
		/* doc:C-TLY */
		/* doc:C-COLUMN */
		/* the modifier column, verbs first: static · try · yield · lane · name.
		 * `try` decides whether there is anything, `yield` where it goes, the lane
		 * when. Lane closest to the name, as the sigils already are. */
		/* doc:C-CACHED */
		/* `let` / `const` sit NEAREST THE NAME, where JS already puts them relative
		 * to an identifier. They are a fourth axis, orthogonal to the others: try
		 * asks whether it fails soft, yield whether it also streams, the lane when
		 * it settles, and this whether it can be written again. */
		let lhsTry = false, lhsYield = false, lhsMemo = false, mut = null;
		/* doc:C-COMPOUND */
		/* `laneSeen` is the lane already named; `laneAdjacent` says the word just
		 * consumed was that lane. Together they tell a COMPOUND (two lane words,
		 * touching) from two lanes, and either from a lane split by a descriptor.
		 * Order between the descriptor and the lane stays free; order INSIDE the
		 * lane does not, because the pair is one value. */
		let laneSeen = null, laneAdjacent = false;
		/* doc:C-STATICLEFT */
		/* Only `try` may stand to the LEFT of `static`. Every other modifier
		 * describes a named member — a lane says who waits for a value, a
		 * descriptor says how a slot behaves — and a bare `static { … }` block has
		 * no value and no slot for them to describe. `try` is the one word that
		 * also composes with the block, so it is the one word with a claim to the
		 * outer position. */
		let seenNonTry = null;
		while (k < to && spans[k].w &&
		       (spans[k].w === 'static' || spans[k].w === 'try' || spans[k].w === 'yield' ||
		        spans[k].w === 'memo' || spans[k].w === 'indexed' ||
		        DESCRIPTOR_WORDS.has(spans[k].w) ||
		        FIELD_MODS.has(spans[k].w) ||
		        GRAINS.has(spans[k].w) || STRUCTURAL.has(spans[k].w) || ACCESSOR_KW.has(spans[k].w)) &&
		       spans[k + 1] && (spans[k + 1].w || spans[k + 1].c === '*' || spans[k + 1].c === '[' ||
		                        spans[k + 1].c === '{' || spans[k + 1].c === '?' || spans[k + 1].c === '&')) {
			if (spans[k].w === 'static') {
				/* doc:C-STATICLEFT */
				if (seenNonTry) {
					throw err('`' + seenNonTry + '` must follow `static`, not precede it \u2014 ' +
						'only `try` may stand to the left of `static`, because `try` is the one ' +
						'modifier that also composes with a bare `static { \u2026 }` block.', spans[k].s);
				}
				isStatic = true;
			}
			else if (spans[k].w === 'try') lhsTry = true;
			/* doc:C-DESCRIPTOR */
			/* doc:C-ENUM */
			/* The descriptor slot is ONE word, chosen from DESCRIPTOR_WORDS. What it
			 * means is its row in the runtime's DESCRIPTORS table: `let` and `pin` are
			 * writable, `const` and `enum` sealed; `pin` and `enum` are the visible ones. */
			else if (DESCRIPTOR_WORDS.has(spans[k].w)) {
				if (mut) { throw err('a field names one descriptor \u2014 ' + [...FIELD_DESCRIPTORS].map(w => '`' + w + '`').join(', ') + ' \u2014 not more than one.', spans[k].s); }
				mut = canonDesc(spans[k].w);
				/* doc:C-PIN */
				if (mut !== spans[k].w) (rec.retiring = rec.retiring || []).push({ word: spans[k].w, to: mut, at: spans[k].s });
			}
			/* doc:C-MEMO */
			else if (spans[k].w === 'indexed') {
				/* doc:C-MEMO */
				/* `indexed` is memo's participle spelling: it describes HOW the writes land,
				 * so like `untracked` it commutes and may follow the lane. */
				lhsMemo = true;
			}
			else if (spans[k].w === 'memo') {
				if (lhsMemo) { throw err('`memo` may lead a declaration once.', spans[k].s); }
				if (mods.some(w => FIELD_MODS.has(w))) {
					throw err('`memo` must come BEFORE the lane it reorders \u2014 write `memo ' + mods.find(w => FIELD_MODS.has(w)) + '`.', spans[k].s);
				}
				lhsMemo = true;
			}
			else if (spans[k].w === 'yield') {
				if (lhsYield) { throw err('`yield` may lead a declaration once.', spans[k].s); }
				if (mods.length) { throw err('the modifier order is `static try yield <lane> name`.', spans[k].s); }
				lhsYield = true;
			}
			else mods.push(spans[k].w);
			/* doc:C-COMPOUND */
			const _w = spans[k].w;
			if (_w !== 'using' && FIELD_MODS.has(_w)) {
				if (WORDS[_w] && WORDS[_w].reserved) {
					throw err('`' + _w + '` is reserved for a future lane and is not built yet.', spans[k].s);
				}
				laneWord(_w, spans[k].s);               /* a retired spelling is refused here, by name */
				if (laneSeen) {
					const pair = laneSeen + ' ' + _w;
					if (!laneAdjacent) {
						throw err('the lane slot is CONTIGUOUS \u2014 `' + pair + '` is one lane spelled with a space, so nothing may be written between its halves. Put the descriptor before or after the pair.', spans[k].s);
					}
					if (!COMPOUND_LANES.has(pair)) {
						throw err('a field names ONE lane \u2014 `' + pair + '` is not a compound. Keep `' + laneSeen + '` or `' + _w + '`, not both.', spans[k].s);
					}
					if (pair !== 'defer batch' && !COMPOUND_LANES.has(pair)) {
						throw err('`' + pair + '` is a compound lane and is not built yet.', spans[k].s);
					}
				}
				laneSeen = _w; laneAdjacent = true;
			} else laneAdjacent = false;
			if (spans[k].w !== 'static' && spans[k].w !== 'try') seenNonTry = seenNonTry || spans[k].w;
			k++;
		}
		/* doc:T-JUNKFIELD */
		/* A SIGNATURE WORD CANNOT NAME A FIELD BOUND WITH `as`. Before `as` the
		 * column reads every word it knows as a modifier, so `const indexed as f()`
		 * took `indexed` for the participle and left `as` as the name — and the
		 * refusal that followed named `as`, or `memo`, never the word or the cause.
		 * A walk that stops at an `as` that BINDS — an expression follows it on its
		 * line — had the name in the word before it: refuse that word, by name.
		 * `as` before `=`, `(` or a line break is a name and stays one; so is a
		 * signature word before `=`, which the column does not read as a modifier. */
		{
			const as = spans[k], nx = spans[k + 1], word = spans[k - 1];
			if (as && as.w === 'as' && word && word.w && word.s >= startTok.s && k + 1 < to && nx &&
			    (nx.w || nx.lit || nx.num) && !/\n/.test(code.slice(as.e, nx.s))) {
				throw err('`' + word.w + '` is a signature word, so it cannot name a field bound with `as` \u2014 ' +
					'before `as` it reads as a modifier, and `as` is left as the name. Rename the field.', word.s);
			}
		}
		/* doc:C-LANES2X2 */
		/* THE TWO-WORD LANES NORMALISE ONCE, HERE, to the words every site below
		 * already knows — the way `yield` is normalised just after. Word order is
		 * meaning, so it is read here and nowhere else: `setup async` is `batch`,
		 * `defer async` is `defer batch`, `async setup` is `async sync`, and every
		 * blocking spelling, `setup` among them, is `sync`. */
		for (let i = 0; i < mods.length; i++) if (isBlocking(mods[i])) mods[i] = 'sync';
		for (let i = 1; i < mods.length; i++) {
			if (mods[i] !== 'async') continue;
			if (mods[i - 1] === 'sync') { mods.splice(i - 1, 2, 'batch'); break; }
			if (mods[i - 1] === 'defer') { mods[i] = 'batch'; break; }
		}
		/* doc:C-YIELDLANE */
		/* `yield` CARRIES THE BLOCKING LANE when no other lane is named. The emit
		 * for a blocking field was always `this.x = yield expr` — the word was
		 * sitting in the output the whole time. A field that emits must block to
		 * have something to emit, so `yield const x = await f()` is exactly
		 * `yield vsync const x = await f()` and is normalised to it here, once,
		 * rather than taught to every site downstream. An explicit lane still
		 * wins: `yield async` stays detached. */
		/* doc:C-MEMO */
		/* A bare `static { \u2026 }` has no value and no slot, so a lane's modifier
		 * has nothing to describe. Refused rather than ignored. */
		if ((lhsMemo || mods.includes('batch')) && spans[k] && spans[k].c === '{') {
			const close = matchPair(spans, k);
			if (close < 0 || !(spans[close + 1] && spans[close + 1].c === '=')) {
				throw err('`' + (lhsMemo ? 'memo' : 'batch') + '` does not compose with a static block \u2014 a block has no value to order.', spans[k].s);
			}
		}
		if (lhsYield && !mods.some(w => w !== 'using' && FIELD_MODS.has(w))) mods.push('sync');
		/* doc:C-MEMO */
		if (lhsMemo && !mods.some(w => w !== 'using' && FIELD_MODS.has(w))) {
			throw err('`memo` reorders a lane and has nothing to reorder on its own \u2014 name a lane, or drop it.', spans[k] ? spans[k].s : 0);
		}
		/* doc:C-TLY */
		/* `yield expr;` at class level — an emission that binds nothing */
		if (spans[k].w === 'yield' && spans[k + 1] && !(spans[k + 1].c === '=' )) {
			const semi = topLevel(spans, k + 1, to, ';');
			const eq = topLevel(spans, k + 1, semi < 0 ? to : semi, '=');
			if (eq < 0) {
				const end = semi < 0 ? to : semi;
				rec.members.push({ kind: 'emit', name: null, bare: true, emit: true,
					mods: [], static: isStatic,
					init: { s: spans[k].e, e: prev(spans, end).e },
					span: { s: spans[k].s, e: prev(spans, end).e } });
				k = semi < 0 ? end : semi + 1;
				continue;
			}
		}

		if (k >= to) break;

		let star = false;
		if (spans[k] && spans[k].c === '*') { star = true; k++; }

		/* doc:C-DESTRUCT */
		/* `[a, b] = …` is a PATTERN; `[expr] = …` is a computed key. A top-level
		 * comma tells them apart, and only a pattern binds more than one name. */
		if (spans[k] && spans[k].c === '[') {
			const cl = matchPair(spans, k, to);
			if (cl >= 0 && isBind(next(spans, cl)) && topLevel(spans, k + 1, cl, ',') >= 0) {
				const pt = patternTargets(code.slice(spans[k].s, spans[cl].e));
				if (pt) {
					mut = accessorWordOnField(mods, mut, pt.names[0], spans[k].s);
					const sg = prev(spans, k).c;
					const pmods = sg === '?' ? [...mods, 'async'] : sg === '&' ? [...mods, 'defer'] : mods;
					const eq = cl + 1;
					const pAs = spans[eq].w === 'as';
					if (pAs && !pmods.some(w => w !== 'using' && FIELD_MODS.has(w))) pmods.push('sync');
					const st = topLevel(spans, eq + 1, to, ';');
					const qq = st < 0 ? to : st;
					const fe = st >= 0 ? prev(spans, st).e : prev(spans, qq).e;
					rec.members.push({ kind: 'field', name: pt.names[0], names: pt.names,
						pattern: pt.target, mods: pmods, static: isStatic, soft: lhsTry, emit: lhsYield, memo: lhsMemo, mut,
						unwrap: pAs, init: { s: spans[eq].e, e: fe }, span: { s: startTok.s, e: fe } });
					k = st >= 0 ? st + 1 : qq;
					continue;
				}
			}
		}
		if (spans[k] && spans[k].c === '[') {
			const jm = matchPair(spans, k, to);
			const j = jm < 0 ? to : jm;

			if (next(spans, j).c === '(') {
				const end = methodEnd(spans, j + 1, to);
				if (end < 0) break;
				rec.members.push({ kind: 'method', name: null, mods, static: isStatic,
					init: null, span: { s: startTok.s, e: spans[end].e } });
				k = end + 1;
				continue;
			}

			/* doc:T-FIELDKEY */
			/* A COMPUTED KEY RUNS WITH ITS FIELD, not with the class: in its place in
			 * the face's generator — on every `new` for an instance field, once for a
			 * static — with `this` meaning what it means in the value. JavaScript runs
			 * it once, at definition, under the surrounding `this`. Only the spine is
			 * built for it; any other modifier would need the key held across a wait. */
			const keyText = code.slice(spans[k].e, spans[j].s);
			const sig = prev(spans, k).c;
			const lane = mods.find(w => FIELD_MODS.has(w) && w !== 'sync') || (sig === '?' ? 'async' : sig === '&' ? 'defer' : null);
			/* doc:T-DYNKEY */
			if (hasAwait(keyText) && (lane || lhsTry)) throw err(`a computed key that suspends is legal only on the spine: ` +
				(lhsTry ? 'a failed key would name the field "undefined"' : `a${/^[aeiou]/.test(lane) ? 'n' : ''} ${lane} field needs a key to park its sentinel under`) + '.', startTok.s);
			const extra = lane || (lhsTry ? 'try' : lhsYield ? 'yield' : lhsMemo ? 'memo' : mut) || mods.find(w => w !== 'sync');
			if (extra) throw err('a computed key takes no modifier but `static` and `setup`: `' + extra + '` is not built for one yet.', startTok.s);
			const bind = spans[j + 1], end = isBind(bind) ? initEnd(j + 1) : null;
			rec.members.push({ kind: 'dynkey', name: null, key: keyText, mods, static: isStatic, unwrap: !!end && bind.w === 'as',
				init: end ? { s: bind.e, e: end.e } : null, span: { s: startTok.s, e: end ? end.e : spans[j].e } });
			k = end ? end.next : j + 1 + (bind && bind.c === ';' ? 1 : 0);
			continue;
		}

		/* doc:C-DESTRUCT */
		if (spans[k] && (spans[k].c === '{' || spans[k].c === '[')) {
			const close = matchPair(spans, k, to);
			if (close >= 0 && isBind(next(spans, close))) {
				const patText = code.slice(spans[k].s, spans[close].e);
				const pt = patternTargets(patText);
				if (pt) {
					mut = accessorWordOnField(mods, mut, pt.names[0], spans[k].s);
					const sg = prev(spans, k).c;
					const pmods = sg === '?' ? [...mods, 'async'] : sg === '&' ? [...mods, 'defer'] : mods;
					const eq = close + 1;
					const pAs = spans[eq].w === 'as';
					if (pAs && !pmods.some(w => w !== 'using' && FIELD_MODS.has(w))) pmods.push('sync');
					const stop2 = topLevel(spans, eq + 1, to, ';');
					const q2 = stop2 < 0 ? to : stop2;
					const fEnd = stop2 >= 0 ? prev(spans, stop2).e : prev(spans, q2).e;
					rec.members.push({ kind: 'field', name: pt.names[0], names: pt.names,
						pattern: pt.target, mods: pmods, static: isStatic, soft: lhsTry, emit: lhsYield, memo: lhsMemo, mut,
						unwrap: pAs, init: { s: spans[eq].e, e: fEnd }, span: { s: startTok.s, e: fEnd } });
					k = stop2 >= 0 ? stop2 + 1 : q2;
					continue;
				}
			}
		}
		const nameTok = spans[k];
		if (!nameTok.w) { k++; continue; }
		const name = nameTok.w;
		k++;
		/* doc:C-SIGIL */

		if (name.length > 2 && /^[$\u0394\u03a3\u03a6\u00f8]/.test(name) && /[$\u0394\u03a3\u03a6\u00f8]$/.test(name))
			{ throw err('Double-sided sigils are banned: `' + name + '` carries both a prefix and a suffix run.', nameTok.s, TypeError); }

		if (name === 'constructor' && spans[k]?.c === '*') { mods.push('iterable'); k++; }

		let comprehension = null;
		const _cb = spans[k]?.c;
		if ((_cb === '[' || _cb === '{') && next(spans, k).c === (_cb === '[' ? ']' : '}')) {

			if (jump(spans, k, 2).c !== '*') {
				throw err(
					'the bare comprehension is retired: spell `' + name + (_cb === '[' ? '[]*' : '{}*') +
					'` — the star is the drain/spread marker now (hard supersede).', nameTok.s);
			}
			comprehension = _cb === '[' ? 'array' : 'object';
			k += 3;
		}

		if (spans[k] && spans[k].c === '(') {
			const end = methodEnd(spans, k, to);
			if (end < 0) break;
			/* doc:C-SOFTMETHOD */
			const m = { kind: ACCESSOR_KW.has(mods[mods.length - 1]) ? 'accessor' : 'method',
				name, mods, static: isStatic, init: null, soft: lhsTry, mut,
				span: { s: startTok.s, e: spans[end].e } };
			/* doc:C-SETLANE */
			if (m.kind === 'accessor' && mods[mods.length - 1] === 'set') {
				const lane0 = mods.find(w => isBlocking(w) || w === 'defer' || w === 'async');
				const lane = canonLane(lane0);
				if (lane) { m.setLane = lane; m.soft = lhsTry; }
			}
			if (name === 'constructor') {
				if (cursor) cursor.ctor = true;   /* doc:C-RECOVER — a refusal from here is the class's */
				/* doc:C-STATICCTOR */
				/* The class face has a constructor of its own: `static constructor*()`
				 * runs when the class is defined, on the class, through the same hook
				 * the instance constructor uses. One per face. */
				const face = isStatic ? 'sctor' : 'ctor';
				m.kind = face;
				if (rec[face]) {
					throw err(`Instance: class ${rec.name || '?'} \u2014 one ${isStatic ? 'static ' : ''}constructor per class.`, startTok.s);
				}
				if (isStatic) {
					const word = mods.find(w => w !== 'iterable' && (FIELD_MODS.has(w) || GRAINS.has(w)));
					if (word) {
						throw err(`Instance: class ${rec.name || '?'} \u2014 a static constructor takes no ` +
							`lane word; the class head declares the class side's grain. Write '${canonLane(word) === 'sync' ? 'setup' : canonLane(word)} class* ${rec.name || ''}'.`.replace(/ '$/, "'"), startTok.s);
					}
				}
				/* doc:C-TLY */
				/* A `yield` in the CONSTRUCTOR BODY emits, so the constructor must say
				 * it iterates — the same rule the class head follows. `yield super()`
				 * is the settlement handshake, not an emission, and is exempt. */
				m.star = star || mods.includes('iterable');
				if (!m.star) {
					const bt = lexOr(code.slice(spans[k].s, spans[end].e)) ?? [];
					const own = ownTokens(code.slice(spans[k].s, spans[end].e));
					const mine = own ? new Set(own.own.map(i => own.t[i].s)) : null;
					const emits = bt.some((tk, i) => tk.w === 'yield' && (!mine || mine.has(tk.s)) &&
						!(bt[i + 1] && bt[i + 1].w === 'super'));
					if (emits) {
						throw err(
							`Instance: class ${rec.name || '?'} \u2014 the ${isStatic ? 'static ' : ''}constructor emits, so it must ` +
							`say it iterates: write \`${isStatic ? 'static ' : ''}constructor*()\`.`, startTok.s);
					}
				}
				rec[face] = m;
			}
			else rec.members.push(m);
			k = end + 1;
			continue;
		}

		/* doc:C-AS */
		/* `as` binds a field to what its right-hand side PRODUCES — unwrapped —
		 * where `=` binds it to the expression's value as written. It is the
		 * `= await` pair fused into one operator, and it implies the blocking lane
		 * when no other lane is named. Because it is a TOKEN, the compiler knows at
		 * parse time which fields suspend: the partition stays compile-time and the
		 * synchronous prefix keeps every `=` field. */
		const isAs = !!(spans[k] && spans[k].w === 'as');
		if (spans[k] && (spans[k].c === '=' || isAs)) {
			const initStart = spans[k].e;
			/* doc:T-ASI */
			const end = initEnd(k);
			/* doc:C-GETFIELD */
			let unwrap = false;
			mut = accessorWordOnField(mods, mut, name, nameTok.s);
			/* doc:C-AS */
			if (isAs) {
				if (!mods.some(w => w !== 'using' && FIELD_MODS.has(w))) mods.push('sync');
				unwrap = true;
			}
			rec.members.push({ kind: 'field', name, mods, static: isStatic, soft: lhsTry, emit: lhsYield, memo: lhsMemo, mut, comprehension,
				unwrap, init: { s: initStart, e: end.e }, span: { s: nameTok.s, e: end.e } });
			k = end.next;
			continue;
		}

		/* doc:T-JUNKFIELD */
		/* A bare field whose name is followed by another WORD on the SAME LINE is
		 * not a field. It is an unknown word sitting in the modifier column, and
		 * the declaration behind it has been parsed as a separate member — which
		 * compiles clean and silently mints `this.<word> = undefined`. A NEWLINE
		 * between them is the ordinary two-member case and stays legal. */
		const afterBare = spans[k];
		if (afterBare && afterBare.w && !/\n/.test(code.slice(nameTok.e, afterBare.s))) {
			throw err(RESERVED_LANES.has(name)
				? '`' + name + '` is reserved for a future lane and is not built yet \u2014 as written it '
				  + 'declares a field named `' + name + '` and leaves `' + afterBare.w + '` to start its own.'
				: '`' + name + '` is not a modifier \u2014 as written it declares a bare field named `'
				  + name + '`, and `' + afterBare.w + '` begins a SEPARATE member. Put it on its own line if that was the intent.', nameTok.s);
		}
		/* doc:C-BLANK */
		/* a BLANK declaration keeps its accessor-word descriptor (`static set x;`) */
		mut = accessorWordOnField(mods, mut, name, nameTok.s);
		rec.members.push({ kind: 'field', name, mods, static: isStatic, soft: lhsTry, emit: lhsYield, memo: lhsMemo, mut, comprehension, init: null,
			span: { s: nameTok.s, e: nameTok.e } });
	}
}

/* doc:T-SUSPGREP */

/* does a field's initialiser suspend — an own-scope await or yield? */
function suspends(member, code) {
	/* doc:C-AS */
	if (member.unwrap) return true;
	if (!member.init) return false;
	const t = lexOr(code.slice(member.init.s, member.init.e)); if (!t) return false;
	/* doc:T-NESTEDAWAIT */

	const own = ownTokens(code.slice(member.init.s, member.init.e));
	const mine = own ? new Set(own.own.map(i => own.t[i].s)) : null;
	for (let i = 0; i < t.length; i++) {
		if (t[i].w !== 'await' && t[i].w !== 'yield') continue;
		if (mine && !mine.has(t[i].s)) continue;
		if (i > 0 && t[i - 1].c === '.') continue;
		if (t[i + 1] && t[i + 1].c === ':') continue;
		return true;
	}
	return false;
}

/* the lane a member declares: sync / async / defer, from its word or sigil */
function lifecycleOf(member) {
	/* doc:C-SIGILS */
	if (member.name != null) {
		if (member.name[0] === '@') return 'sync';
		if (member.name[0] === '&') return 'defer';
		if (member.name[0] === '?') return 'async';
	}
	for (const m of member.mods) {
		/* doc:C-WATERFALL */
		if (m === 'async' && member.mods.some(isBlocking)) return 'asyncdelay';
		/* doc:C-COMPOUND */
		if (m === 'defer') return member.mods.includes('batch') ? 'deferbatch' : 'defer';
		if (isBlocking(m)) return 'sync';
		if (FIELD_MODS.has(m)) return m;
	}
	return null;
}

/* doc:C-GRAIN */
/* doc:C-FLIP */

/* doc:C-UNMARKED */

/* doc:T-STATICASYNC */

/* pick the FIELD table row for a member: lane, suspension, comprehension,
 * tier, softness. The table is the language; this is the lookup. */
function rowFor(m, code) {
	/* doc:C-SYNCDEFAULT */

	const sp = suspends(m, code);
	const lc = lifecycleOf(m) || (sp && !m.bare ? 'sync' : null);
	const comp = m.comprehension ? (sp ? 'drain' : 'spread') : null;
	const tier = m.name != null && TIER.test(String(m.name).replace(/^[@&?]+/, ''));
	const soft = !!m.soft || (m.init && leading(code.slice(m.init.s, m.init.e)).kws[0] === 'try');
	return FIELD.find(r =>
		/* doc:C-MEMO */
		(r.memo === undefined || !!r.memo === !!m.memo) &&
		(!!r.soft === !!(soft && !sp)) &&
		(!!r.bare === !!m.bare) &&
		(r.lc === null || r.lc === lc) &&
		(r.susp === null || r.susp === sp) &&
		(r.tier === undefined || r.tier === tier) &&
		r.comp === comp) || FIELD[FIELD.length - 1];
}

/* doc:C-RECOVER */

/* the class-level rules: a suspending field obliges a grain (C-DECLARE), a
 * lifecycle word needs an await (C-FANAWAIT), containment (C-CONTAIN), the
 * sibling wall, the constructor's form. Under recover, violations are collected. */
function check(rec, code, fail, ctx, g) {
	const soft = ctx && ctx.recover;
	const bad = (msg, at) => {
		if (!soft) throw err(msg, at);
		(ctx.diags || []).push({ level: 'error', at, message: msg, name: 'SyntaxError' });
	};
	const grainOf = ctx.grainOf || {};
	const diags = ctx.diags || [];

	for (const m of rec.members) {
		if (m.kind !== 'field' || !m.static || !m.init || m.name == null) continue;
		const sg = m.name[0];
		if (WORD[sg]) throw new SyntaxError(
			`Instance: class ${rec.name} \u2014 sigil modifiers are instance-side shorthand; ` +
			`statics keep the words. Write 'static ${WORD[sg]} ${m.name.slice(1)} = \u2026'.`);
	}

	/* doc:C-DECLARE */

	/* doc:C-TLY */
	/* emitting requires the declaration to SAY it iterates — a `yield` in a
	 * non-star class is a value to nobody, exactly as `goto yield` in a
	 * non-generator method is. */
	if (rec.members.some(m => m.emit) && !(rec.structural && rec.structural.has('iterable'))) {
		const m0 = rec.members.find(m => m.emit);
		throw err(`Instance: class ${rec.name || '?'} \u2014 this member emits, so the class must say it ` +
			`iterates: write \`class* ${rec.name || ''}\`.`, m0.span ? m0.span.s : rec.head.s);
	}
	/* doc:C-CACHED */
	/* A CACHED FIELD MUST NAME ITS LANE. `const x = await f()` halts the whole
	 * settlement lane while `const x = f()` does not, and the two differ by one
	 * word that is easy to miss with `const` already in the column. So the lane is
	 * required here even though C-SYNCDEFAULT makes it optional elsewhere.
	 * [DEPRECATION] C-SYNCDEFAULT is expected to be withdrawn entirely, making the
	 * lane mandatory on every suspending field. This is the first step. */
	for (const m of rec.members) {
		if (rec.implicitLane) break;
		if (m.kind !== 'field' || !m.mut || !m.name) continue;
		if (!suspends(m, code) || lifecycleOf(m)) continue;
		throw err(`Instance: class ${rec.name || '?'} \u2014 cached field '${m.name}' suspends, so it must ` +
			`name its lane or bind with \`as\`: write \`${m.mut} ${m.name} as \u2026\` for its value, ` +
			`or \`sync ${m.mut} ${m.name} = await \u2026\` (or async / defer).`, m.span ? m.span.s : rec.head.s);
	}
	const grained = m => m.kind === 'field' && m.name != null &&
		(lifecycleOf(m) !== null || suspends(m, code));
	const statedFields = { cls: rec.members.some(m => grained(m) && m.static),
	                       inst: rec.members.some(m => grained(m) && !m.static) };
	if (statedFields.cls && !rec.grain) throw new SyntaxError(
		`Instance: class ${rec.name || '(anonymous)'} \u2014 a static declares a lifecycle, but the ` +
		`class head declares no grain. Write 'setup class', 'mixed class' or 'async class' \u2014 ` +
		`the head is what the consumer reads.`);

	/* doc:C-PIN */
	for (const r of rec.retiring || []) diags.push({ level: 'warn',
		message: `class ${rec.name || '(anonymous)'}: \`${r.word}\` is retiring \u2014 write \`${r.to}\`.` });

	/* doc:C-STATICCTOR */
	/* The static constructor: no parameters and no arguments, because nothing
	 * calls it and `super()` only joins the parent (P-6 holds the alternative).
	 * Its `super()` form must agree with the head, nothing may suspend before
	 * it, and a `static { }` block beside it has nowhere else to go. */
	if (rec.sctor) {
		const sp = ctorParts(rec, code, rec.sctor);
		const who = `Instance: class ${rec.name || '(anonymous)'} \u2014 `;
		const at = rec.sctor.span.s;
		const say = msg => err(who + msg, at);
		if (sp.params) throw say(`a static constructor takes no parameters: nothing calls it. ` +
			`Configure a subclass through a static method or a field it declares.`);
		if (sp.superArgs) throw say(`'super()' on the class face takes no arguments. It waits for ` +
			`'${rec.ext}' to settle; it does not run its static constructor again (P-6).`);
		if (sp.superArgs !== null && !rec.ext) throw say(`'super()' in a static constructor needs an 'extends'.`);
		if (sp.superArgs !== null && !sp.superForm) throw say(`a bare 'super()' on the class face says nothing ` +
			`about waiting. Write 'yield super()' (joined) or 'await super()' (ordered).`);
		if (sp.superForm === 'void') throw say(`'void super()' on the class face is not built yet.`);
		if (hasAwait(sp.prefix)) throw say(`nothing may suspend before 'super()' in a static constructor: ` +
			`'${rec.ext}' has not settled yet. Move the await after it.`);
		if ((sp.superForm || hasAwait(sp.tail)) && !rec.grain) throw say(`the static constructor ` +
			`${sp.superForm ? 'joins its parent' : 'suspends'}, but the class head declares no grain. ` +
			`Write 'setup class*' or 'mixed class*' \u2014 the head is what the consumer reads.`);
		if (sp.superForm === 'yield' && rec.grain === 'sync') throw say(`a 'setup class' orders the class ` +
			`side after its parent, so write 'await super()' \u2014 or declare the class 'mixed'.`);
		if (sp.superForm && rec.grain === 'async') throw say(`an 'async class' detaches its class side, ` +
			`so there is nothing for '${sp.superForm} super()' to wait on. Drop the call, or declare the class 'mixed'.`);
		const blk = rec.members.find(m => m.kind === 'staticBlock');
		if (blk) throw err(who + `a class with a static constructor has one place where its ` +
			`class side runs. Fold the 'static { \u2026 }' block into it.`, blk.span.s);
	}

	/* doc:C-SHADOW */
	/* `const` and `enum` are ONE value for the hierarchy: a subclass may not
	 * declare its own. `set` is the per-class constant, and any writable or
	 * pliable row shadows as JavaScript's own fields do. Checked here when the
	 * parent is in view; a `try` on the child's declaration makes it a warning. */
	{
		const pr = rec.ext && grainOf[rec.ext] && grainOf[rec.ext].rec;
		if (pr) for (const m of rec.members) {
			if (m.kind !== 'field' || m.name == null) continue;
			const theirs = pr.members.find(x => x.kind === 'field' && x.name === m.name && !!x.static === !!m.static);
			if (!theirs) continue;
			if (theirs.mut === 'set' && !m.static) {
				/* every level writes the same element, and its seal is one bit */
				throw err(`Instance: class ${rec.name || '(anonymous)'}: '${emitName(m.name)}' is set in ${rec.ext}, ` +
					`and a per-level \`set\` on the INSTANCE face is not built yet (C-SHADOW). Declare it \`let\` for now.`, m.span ? m.span.s : rec.head.s);
			}
			if (theirs.mut !== 'const' && theirs.mut !== 'enum') continue;
			const msg = `class ${rec.name || '(anonymous)'}: '${emitName(m.name)}' is ${theirs.mut} in ${rec.ext} \u2014 ` +
				`one value for the hierarchy, so a subclass may not declare its own. Declare it 'set' in ` +
				`${rec.ext} for one value per class.`;
			if (m.soft) { diags.push({ level: 'warn', message: msg + ' (soft: the write will fail softly)' }); continue; }
			throw err('Instance: ' + msg, m.span ? m.span.s : rec.head.s);
		}
	}
	if (statedFields.inst) {

		const ctorSays = (rec.ctor && (rec.ctor.mods.some(x => GRAINS.has(x))
			|| (g.parts && g.parts.superForm))) || !!rec.grain;
		if (!ctorSays) throw new SyntaxError(
			`Instance: class ${rec.name || '(anonymous)'} \u2014 a field declares a lifecycle, but neither ` +
			`the ${rec.ctor ? 'constructor' : 'synthesized constructor'} nor the class head declares a grain. ` +
			`Mark the class ('sync class', 'mixed class', 'async class')` +
			(rec.ctor ? `, the constructor ('sync constructor'), or the call ('await super()').` : `.`));
	}

	for (const m of rec.members) {

		if (m.kind !== 'field' || !(suspends(m, code) || lifecycleOf(m))) continue;

		if (m.bare) continue;

		/* doc:C-FANAWAIT */

		if (lifecycleOf(m) && m.init && !suspends(m, code)) {
			bad(`Instance: class ${rec.name || '(anonymous)'} \u2014 field '${m.name}' declares a ` +
				`lifecycle, so its value must arrive later, but the right-hand side never ` +
				`suspends. Write '${m.name} = await \u2026', or drop the lifecycle word.`, m.span && m.span.s);
			continue;
		}
		/* doc:C-CONTAIN */
		const raw = m.static ? rec.grain : (rec.ctor && rec.ctor.mods.map(canonLane).find(x => ADMITS[x])) || rec.grain;
		const side = raw && ADMITS[raw] ? raw : 'mixed';
		const lane = SLOT_LANE[slotOf(m, code)] || 'sync';
		if (!ADMITS[side].includes(lane))
			throw new SyntaxError(
				`Instance: class ${rec.name} \u2014 a '${side}' class admits ` +
				`${ADMITS[side].join('/')} fields, and '${m.name}' is '${lane}'. ` +
				(lane === 'async'
					? `A fan is not covered by 'await new ${rec.name}()', so the class must say ` +
					  `'mixed' \u2014 that is what the word means.`
					: `An 'async' class promises nothing joins; declare it 'mixed' to hold both.`));
	}

	/* doc:C-CAP */
	const parent = rec.ext ? grainOf[rec.ext] : undefined;
	const parentGrain = parent && parent.link;
	const childLink = g.link;

	/* doc:C-INHERIT */

	const declared = { class: rec.grain, instance: g.dInst };
	for (const [face, theirs] of [
		['class', parent && parent.cls], ['instance', parent && parent.inst]]) {

		const mine = declared[face];
		if (mine !== 'sync' || !theirs || theirs === 'sync') continue;
		throw new SyntaxError(
			`Instance: class ${rec.name} \u2014 its ${face} side is '${mine}' but '${rec.ext}' is ` +
			`'${theirs}'. A 'sync' class promises 'await' delivers everything, and an ` +
			`inherited fan would still be in flight when it resolves.` +
			` Declare ${rec.name} 'mixed' to inherit ${rec.ext}'s timeline honestly.`);
	}
	/* doc:C-SYNC-PARENT */
	if (parent && parent.dcls === 'sync' && childLink !== 'sync')
		throw new SyntaxError(
			`Instance: class ${rec.name} \u2014 '${rec.ext}' is a 'sync class', which orders its ` +
			`inheritance chain, so a child must 'await super()'. Found ` +
			`${FORM[childLink] ? `'${FORM[childLink]} super()'` : "a bare 'super()'"}` +
			`, which would run this level against '${rec.ext}' state that has not settled. ` +
			`Write 'await super()', or make '${rec.ext}' a 'mixed class' if its chain need ` +
			`not be ordered.`);

	/* doc:C-MATRIX */
	if ((childLink === 'sync' || childLink === 'mixed') && parentGrain === 'async')
		throw new SyntaxError(
			`Instance: class ${rec.name} \u2014 '${rec.ext}' is an 'async class': its fields are ` +
			`fans and none of them join, so there is no settlement for ` +
			`'${FORM[childLink]} super()' to wait on. Detach with ` +
			`'void super()', or make '${rec.ext}' a 'sync' or 'mixed' class if its state ` +
			`should be joinable.`);

	/* doc:C-CONSERVE */
	/* doc:C-CONSERVE */

	/* doc:T-FIELDPARAM */
	/* doc:T-ORDER */
	const settleRank = (() => {
		const fields = rec.members.filter(m => m.kind === 'field' || m.kind === 'dynkey');
		const { pre, post, tail, acq } = settleOrder(fields, code, false);
		const order = [...pre, ...tail];

		const assign = new Map(), init = new Map(), src = new Map();
		fields.forEach((m, i) => src.set(m, i));
		order.forEach((m, i) => assign.set(m, i));
		/* an acquire's expression runs where it stands (T-ORDER): every member above it
		 * that is not itself an acquire has landed by then, and nothing below it has */
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
			bad(`Instance: class ${rec.name} \u2014 field '${f.name}' reads 'this.${sigilBare(g.name)}', ` +
				`which settles ${g === f ? 'as part of the same assignment' : 'later'}. It would be ` +
				`undefined here. Declare '${sigilBare(g.name)}' before '${sigilBare(f.name)}' as a 'sync' field, ` +
				`or move the dependent work into '${sigilBare(g.name)}' itself.`, f.span && f.span.s);
			continue member;
		}
	}

	const cp = g.parts;
	if (cp && cp.params.trim()) {
		const paramNames = [];
		for (const seg of splitTop(cp.params)) {
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
					bad(
						`Instance: class ${rec.name} \u2014 field '${f.name}' references constructor ` +
						`parameter '${pn}'. Plain JS field initialisers cannot see constructor ` +
						`parameters; assign it in the constructor body instead: ` +
						`this.${f.name} = ${pn};`, f.span && f.span.s);
					continue param;
				}
		}
	}

	const I = typeof globalThis !== 'undefined' ? globalThis.Instance : undefined;
	if (rec.ext && I && typeof I.isIntrinsic === 'function') {
		for (const m of rec.members) {
			if (m.kind !== 'field' || m.static || m.name == null || SIGILS.test(m.name)) continue;
			if (I.isIntrinsic(rec.ext, m.name)) diags.push({ level: 'warn',
				message: `class ${rec.name}: field '${m.name}' shadows a DOM property of ` +
					`<${rec.ext}> \u2014 the platform's '${m.name}' will no longer be set. Rename the ` +
					`field, or override deliberately with an accessor pair ` +
					`(get ${m.name}() { return super.${m.name} }).` });
		}
	}
	return rec;
}

/* a parameter list split at its top-level commas (none inside brackets) */
function splitTop(text) {
	const out = [];
	let d = 0, last = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '(' || c === '[' || c === '{') d++;
		else if (c === ')' || c === ']' || c === '}') d--;
		else if (c === ',' && d === 0) { out.push(text.slice(last, i)); last = i + 1; }
	}
	out.push(text.slice(last));
	return out;
}

/* the constructor (or the static constructor, `m0`) taken apart: `params`, and
 * its body as `prefix` (before the super call), `superArgs`, `superForm` (the
 * `yield`, `await` or `void` before `super(`, else null) and `tail` (after it).
 * Null when there is none. */
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

/* doc:C-IR */

/* class record -> IR: ordered ops (seeds, partition, field settles, gates),
 * verbatim members after their wraps (nested classes, try, untracked, goto),
 * statics, and the super-call mode. */
function buildIR(rec, code, opts = {}, g = grains(rec, code)) {
	const _structural = {
		cls:  !!(rec.structural && rec.structural.size),
		inst: !!(rec.ctor && rec.ctor.mods && rec.ctor.mods.includes('iterable'))
	};
	const ops = [];
	/* doc:C-BATCH */
	/* A run is contiguity ON ONE FACE. Any intervening member ends it — but the
	 * OTHER FACE never intervenes, so the scan skips it rather than breaking on
	 * it. A `static batch` line sitting inside an instance run leaves that run
	 * intact and opens a run of its own. */
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
	/* doc:C-SOFTMETHOD */
	/* `try` on a METHOD is permanent: every call is soft. The word cannot stay in
	 * the text (the expression rewriter would read `try fn()` as a tried call), so
	 * it is lifted and reapplied to the BODY. A generator takes a direct
	 * try/catch, since an arrow cannot hold its `yield`s; everything else goes
	 * through Superset.soft, which attaches the recovery to a RETURNED promise —
	 * `try { return p }` in an async function does not catch p's rejection. */
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

	/* doc:C-METHODDESC */
	/* A descriptor on a METHOD describes the SLOT, not a stored value, so it
	 * cannot ride in the text — `static const connect() {}` is not JavaScript,
	 * and passing it through emitted invalid output with no diagnostic. The word
	 * is lifted here and reapplied after the class exists, which is the only
	 * moment the method property is there to redescribe.
	 *
	 * `get` and `set` share the descriptor slot but are NOT lifted: they are
	 * JavaScript's own words and the emit needs them where they stand. */
	const descStrip = (t, mut) => {
		if (!mut || mut === 'get' || mut === 'set') return t;
		const k = lexOr(t); if (!k) return t;
		const i = k.findIndex(x => x.w === mut);
		if (i < 0) return t;
		return (t.slice(0, k[i].s) + t.slice(k[i].e)).replace(/^\s+/, '').replace(/^(\S+) {2,}/, '$1 ');
	};

	const verbatim = rec.members
		.filter(m => m.kind === 'method' || m.kind === 'accessor' || m.kind === 'staticBlock')
		.map(m => {
			let raw = code.slice(m.span.s, m.span.e);
			/* doc:C-TRYSTATIC */
			if (m.softBlock) raw = 'static { try ' + m.softBlock + ' }';
			/* doc:C-SETLANE */
			if (m.setLane) {
				const rebuilt = laneSetter(raw, m.name, m.setLane, m.soft);
				if (rebuilt) raw = rebuilt;
			}
			raw = descStrip(raw, m.mut);
			return { text: gotoWrap(untrackWrap(tryWrap(localLane(nestWrap(softWrap(raw, m.soft), opts))))), before: m.span.s < anchor };
		});

	const mode = g.mode;
	ops.push({ op: 'SUPER_CALL', mode, at: rec.head });

	/* doc:C-STATICCTOR */
	/* The static constructor rides the instance constructor's ops. Its `super()`
	 * form picks the handshake the way the instance form does; without one the
	 * class head decides, as it always has for statics. The partition is forced
	 * whenever the body suspends or joins, because the driver reads the FIRST
	 * yield as the handshake — an author's `await` must never be that yield. */
	const sp = ctorParts(rec, code, rec.sctor);
	const sForm = sp && sp.superForm;
	const staticOps = settleOps(statics, code,
		sForm ? handshakeFor(sForm) : rec.grain === 'mixed' ? null : rec.grain === 'async' ? DETACH_TOKEN : 'this',
		!!(sp && (sp.superArgs !== null || hasAwait(sp.tail))), false, false);
	/* The body sits where JavaScript would run it: after the field initialisers
	 * declared above it. The part before `super()` goes in ahead of the seed and
	 * the partition; the rest follows the settles. */
	if (sp && sp.prefix) {
		const at = staticOps.findIndex(o => o.op === 'SEED' || o.op === 'PARTITION');
		staticOps.splice(at < 0 ? staticOps.length : at, 0, { op: 'CTOR_PREFIX', text: sp.prefix, at: rec.sctor.span });
	}
	if (sp && sp.tail) staticOps.push({ op: 'CTOR_TAIL', text: sp.tail, at: rec.sctor.span });

	const cp = g.parts;
	if (cp && cp.prefix) ops.push({ op: 'CTOR_PREFIX', text: cp.prefix, at: rec.ctor.span });
	ops.push(...settleOps(fields, code, handshakeFor(mode),
		rec.grain === 'mixed' || rec.grain === 'sync' || rec.grain === 'async' || mode === 'void', true,
		mode === 'await'));
	if (cp && cp.tail) ops.push({ op: 'CTOR_TAIL', text: cp.tail, at: rec.ctor.span });

	return { name: rec.name, grain: rec.grain, structural: (_structural.cls || _structural.inst) ? _structural : null, ctor: cp, head: headText(rec, code),
		ops, staticOps, verbatim, sourceEmpty, source,
		headAt: rec.head.s, ctorAt: rec.ctor ? rec.ctor.span.s : rec.head.s };
}

/* doc:T-VOIDSUPER */

/* doc:T-ORDER */
/* THE ORDER, computed once: the emit and the sibling wall both read it. Up to
 * the first blocker, source order. From it on, source order with every
 * acquire's write moved to the tail, so a `defer` joins only after every other
 * member of its face is defined — fans included: started, not necessarily
 * landed (C-CASCADE). A computed key is a field in its place (T-FIELDKEY), a
 * blocker when it suspends (T-DYNKEY); a DELEGATING emission suspends, a plain
 * one is a call. */
function settleOrder(list, code, split0) {
	const blocks = m => m.kind === 'dynkey' ? !!m.unwrap || hasAwait(m.key) || (!!m.init && hasAwait(code.slice(m.init.s, m.init.e)))
		: m.kind === 'emit' ? !!m.star || hasAwait(code.slice(m.init.s, m.init.e)) : ['spine', 'acquire'].includes(slotOf(m, code));
	const acq = m => m.kind === 'field' && slotOf(m, code) === 'acquire';
	const at = split0 ? 0 : list.findIndex(blocks);
	const pre = at < 0 ? list : list.slice(0, at), post = at < 0 ? [] : list.slice(at);
	return { pre, post, acq, tail: [...post.filter(m => !acq(m)), ...post.filter(acq)] };
}

/* doc:C-ONESIDE */
/* the SETTLE ops of one face, in order: the members before the first blocker as
 * plain fields; the acquire starts that lead the blocked part; the SEED; the
 * PARTITION; every blocked member in its place (an acquire as its start); the
 * acquires' joins at the tail. Batch runs are marked first, so the last member of
 * each carries the barrier. `forced` puts a partition in even with nothing after
 * it; `handsOut && syncLink` splits at the top (C-ONESIDE). */
function settleOps(all, code, handshake, forced, handsOut, syncLink) {
	const ops = [];
	/* doc:C-BATCH */
	/* A run is contiguity ON THIS FACE. Any intervening member ends it, and
	 * the other face is not intervening — it is not in this list at all. */
	{
		let run = null;
		for (const m of all) {
			if ((m.mods || []).includes('batch')) {
				if (!run) run = { last: null, members: [] };
				m.batchLast = false; run.last = m; m.batchRun = run.members;
				/* the member as the barrier will name it: its field, the key its handle was
				 * minted under (the same key the start uses), and its words */
				const n = emitName(m.name), defer = (m.mods || []).includes('defer');
				run.members.push({ name: n, soft: !!m.soft, memo: !!m.memo,
					key: defer ? 'join:' + n : 'batch:' + (m.span ? m.span.s : 0), kind: defer ? 'join' : 'batch' });
			} else if (run) { run.last.batchLast = true; run = null; }
		}
		if (run) run.last.batchLast = true;
	}
	const text = m => (m.init ? code.slice(m.init.s, m.init.e).trim() : BLANK);
	/* doc:C-ONESIDE */
	const { pre, post, acq } = settleOrder(all, code, handsOut && syncLink);

	for (const m of pre) ops.push(mkField(m, text(m), code));

	/* doc:T-ORDER */
	/* AN ACQUIRE STARTS WHERE IT STANDS (RULED 2026-10-12 — as <script defer> fetches
	 * where its tag stands and runs after the document, in order). Its start is a
	 * plain binding, so one above every blocker of its face still runs in the
	 * synchronous prefix, before the seed; one below a blocker starts once that
	 * blocker has landed, so it may read it. Only the JOIN moves to the tail. Before
	 * this ruling every start was hoisted to the top of the hook, which reordered
	 * the source silently and made a defer unable to read any sibling at all. */
	const firstBlock = post.findIndex(m => !acq(m));
	const lead = firstBlock < 0 ? post : post.slice(0, firstBlock);
	for (const m of lead) ops.push(mkField(m, text(m), code, true));
	/* doc:C-SEED */
	const seeded = post.filter(m => m.kind === 'field' && slotOf(m, code) !== 'fan' && !m.bare);
	if (seeded.length) ops.push({ op: 'SEED', names: seeded.flatMap(m => m.names || [m.name]), value: PENDING,
		at: seeded[0].span });

	if (!post.length) {
		if (forced) ops.push({ op: 'PARTITION', handshake, at: null });
		return ops;
	}
	ops.push({ op: 'PARTITION', handshake, at: null });
	for (const m of post.slice(lead.length)) ops.push(mkField(m, text(m), code, acq(m)));   // blockers settle and acquires start, each in its place
	for (const m of post) if (acq(m)) ops.push(mkField(m, text(m), code));                 // the joins, at the tail, in source order
	return ops;
}

/* does this op SUSPEND the hook — is a describe segment cut here? The partition;
 * a blocking or acquiring field (a batch run only at its barrier); an emit or
 * key that awaits; a constructor statement that awaits or yields. */
function opSuspends(o) {
	switch (o.op) {
		case 'PARTITION': return true;
		case 'FIELD': return (o.row.slot === 'spine' || o.row.slot === 'acquire') && (!/batch$/.test(o.row.lc || '') || o.batchLast);
		case 'EMIT': return o.star || hasAwait(o.init);
		case 'DYNKEY': return o.unwrap || hasAwait(o.key) || hasAwait(o.init);
		case 'CTOR_PREFIX': case 'CTOR_TAIL': return hasAwait(o.text) || hasAwait(o.text, 'yield');
	}
	return false;
}
/* a rows Map (kind → names) as an object literal — `{let:['a'],'untracked let':['b']}`
 * — the argument of ø.redescribe for method slots, which are rows on the prototype */
const rowsText = rows => '{' + [...rows].map(([k, v]) => `${/^[a-z]+$/.test(k) ? k : sq(k)}:[${v.map(n => sq(n)).join(',')}]`).join(',') + '}';
/* doc:C-DEFINE */
/* A PLAIN WRITE WITH A ROW IS ONE CALL, named by its descriptor —
 * `ø.let(this, 'n', v)` — which describes and writes; an awaited value is
 * `yield`ed INSIDE the call, so the write still lands where `this.n = yield v`
 * landed it. Everything else
 * that carries a row — a pattern, a tee, a soft or block initialiser, a batch,
 * a fan, a private cell — keeps a row line in its segment, spelled the same
 * way with its names as a list: `ø.let(this, ['a', 'b'])` describes and writes
 * nothing, and the value arrives by its own path. A row with a participle
 * names its kind to `define`, as its write would. A `defer`'s join is a single
 * awaited write at the tail, so it is one call there. */
const definable = o => o.op === 'FIELD' && !o.pattern && !o.emit && !o.soft && !isPrivate(emitName(o.name)) &&
	(o.row.slot === 'plain' || o.row.slot === 'spine' || (o.row.slot === 'acquire' && o.row.lc === 'defer')) &&
	o.row.lc !== 'batch' && !o.row.comp && !o.row.bare && !o.row.tier &&
	leading(String(o.init)).kws[0] !== 'try';
/* the row line of a segment: one call per kind, by its word, on one line */
const rowCall = (kind, names) => FIELD_DESCRIPTORS.has(kind)
	? `${rt(kind)}(this, [${names.map(n => sq(n)).join(', ')}]);`
	: `${rt('define')}(this, ${sq(kind)}, [${names.map(n => sq(n)).join(', ')}]);`;
/* every row of a segment on one line, one call per kind */
const rowLine = rows => [...rows].map(([k, v]) => rowCall(k, v)).join(' ');
/* doc:C-CASCADE */
/* A ROW IS DESCRIBED AT ITS DEFINITION. The ops are cut at every suspension —
 * the partition, a blocking field, a batch barrier, a suspending emit, key or
 * constructor statement — and each segment opens with the rows of the fields
 * it defines, so nothing past a blocker is described until the blocker clears.
 * `kinds` maps each field name to its row kind. A field whose write can carry
 * its row (definable) is marked `o.define`, and renderOps spells it as the one
 * call; every other name goes on its segment's row line, a LINE op spliced into
 * `ops`; a name no op defines goes at the top. Returns 1 when a line went in at
 * the top of the hook, 0 otherwise — where "after the first describe" is. */
function describeOps(ops, kinds) {
	const segs = [{ at: 0, rows: new Map() }];
	const put = (r, k, n) => r.has(k) ? r.get(k).push(n) : r.set(k, [n]);
	ops.forEach((o, i) => {
		if (o.op === 'FIELD') for (const n of (o.names || [o.name]).filter(Boolean).map(emitName))
			if (kinds.has(n)) { if (definable(o)) o.define = kinds.get(n); else put(segs[segs.length - 1].rows, kinds.get(n), n); kinds.delete(n); }
		if (opSuspends(o)) segs.push({ at: i + 1, rows: new Map() });
	});
	for (const [n, k] of kinds) put(segs[0].rows, k, n);
	for (let s = segs.length - 1; s >= 0; s--) if (segs[s].rows.size)
		ops.splice(segs[s].at, 0, { op: 'LINE', text: rowLine(segs[s].rows), at: null });
	return segs[0].rows.size ? 1 : 0;
}

/* two invariants of the IR, on each face: one seed op, and before the partition */
function assertYieldRule(ir) {
	for (const ops of [ir.ops, ir.staticOps || []]) {
		const p = ops.findIndex(o => o.op === 'PARTITION'), seeds = ops.filter(o => o.op === 'SEED');
		if (seeds.length > 1) throw new Error('seeds must collapse to one op');
		if (p >= 0 && ops.indexOf(seeds[0]) > p) throw new Error('SEED after the partition');
	}
	return ir;
}

/* doc:C-EMIT */

/* IR -> JavaScript text for one class */
function emitClass(ir, opts = {}, ats = null) {
	/* doc:C-ANON */

	/* doc:T-UNTOUCHED */
	if (!ir.name) {
		const featureless = !(ir.ops || []).length && !(ir.staticOps || []).length
			&& !ir.ctor && !(ir.verbatim || []).length && !ir.grain;
		if (featureless && ir.source) return ir.source;

	}

	if (!EXTENDS.test(ir.head) && ir.source) return ir.source;

	const grainTag = ir.grain ? ' // @' + ir.grain : '';
	const body = renderOps(ir.ops, 3, ir.usings, ir.usingsPost);
	const statics = renderOps(ir.staticOps || [], 3);   // the same depth as the instance hook: both sit two blocks in

	return assemble(ir, body, statics, grainTag, ats, traceName(ir));
}

/* ops -> lines inside the hook: package installers first, then seeds, the
 * partition, async-package joins, then fields; a register whose one use is the
 * next line is folded into that line (C-REGISTER) */
function renderOps(ops, depth, usings, post) {
	const body = [];
	let cur = null;
	const push = text => body.push({ t: IND.repeat(depth) + text, at: cur });

	for (const u of (usings || [])) for (const line of u.split('\n')) push(line);

	for (const o of ops) {
		cur = o.at && o.at.s != null ? o.at.s : null;
		switch (o.op) {
			case 'SUPER_CALL':
				break;
			case 'SEED':
				push(seed(o) + ' // @seed');
				break;
			case 'FIELD': {
				/* doc:C-DESTRUCT */
				/* The row owns TIME — how the field settles (sync, fan, acquire, soft).
				 * The tee and the pattern own SPACE — where the value goes. Both are
				 * POST-TRANSFORMS over the row's output, keyed off the assignment
				 * boundary `this.<name> = `, so no lane needs to know about either.
				 * Tee first, pattern second: the pattern consumes the boundary. */
				let text = o.row.emit(emitName(o.name), o.init, o);
				const nm = emitName(o.name);
				const atBoundary = (t2, fn) => {
					const lines = String(t2).split('\n');
					for (let i = lines.length - 1; i >= 0; i--) {
						const L = lines[i], at = L.indexOf('this.' + nm + ' = ');
						/* skip a SEED, but test AT the boundary: a fan's line carries the
						 * poison sentinel in its rejection handler and is still the line we
						 * want. */
						if (at < 0) continue;
						if (L.slice(at + ('this.' + nm + ' = ').length).startsWith('Symbol.for')) continue;
						const vs = at + ('this.' + nm + ' = ').length;
						/* the value ends at ITS OWN `;` at depth 0, not at the end of the
						 * line — a fan's assignment sits inside an arrow body, with the
						 * rejection handler still to come. */
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
				if (o.emit)
					text = atBoundary(text, (L, at, vs, ve) =>
						L.slice(0, vs) + rt('emit') + '(this, ' + L.slice(vs, ve) + ')' + L.slice(ve));
				/* doc:C-DEFINE */
				/* The descriptor word IS the method: `ø.let(this, 'x', 1)`. A row with a
				 * participle has no word of its own and names its kind to `define`. A
				 * blank declaration passes no value, as it wrote none (C-BLANK). */
				if (o.define) {
					const m = String(text).match(/^this\.(\S+) = (yield )?([\s\S]*);$/);
					const word = FIELD_DESCRIPTORS.has(o.define);
					text = m ? `${rt(word ? o.define : 'define')}(this, ${[...(word ? [] : [sq(o.define)]), sq(nm),
							...(o.init === BLANK ? [] : [(m[2] || '') + m[3]])].join(', ')});`
						: `${rowCall(o.define, [nm])}\n${text}`;
				}
				if (o.init === BLANK) text += ' // @blank';
				if (o.pattern && o.row.slot !== 'fan') {   // a fan lands through its pattern inside its own call
					cur = o.at;
					/* a soft failure gives undefined, and destructuring undefined throws —
					 * an empty source lands every name undefined instead. */
					const fb = o.soft ? ' ?? ' + (/^\[/.test(o.pattern) ? '[]' : '{}') : '';
					text = atBoundary(text, (L, at, vs, ve) =>
						L.slice(0, at) + `(${o.pattern} = ${L.slice(vs, ve)}${fb})` + L.slice(ve));
				}
				if (String(text) !== '') for (const line of String(text).split('\n')) push(line);
				break;
			}
			case 'FIELD_PRE':
				push(o.row.pre(emitName(o.name), o.init, o));
				break;
			case 'EMIT':
				cur = o.at;
				if (o.star) {
					const srcx = hasAwait(o.init) ? 'yield ' + rhs(o.init) : o.init;
					push(`${drainInto(`(${srcx})`, `_ => ${rt('emit')}(this, _)`)};`);   // a tee of every item the source produces
				} else push(`${rt('emit')}(this, ${hasAwait(o.init) ? 'yield ' + rhs(o.init) : o.init});`);
				break;
			case 'DYNKEY':
				cur = o.at;
				/* doc:T-FIELDKEY — the key in its place, with the face's `this` */
				push(`this[${hasAwait(o.key) ? 'yield ' + rhs(o.key) : o.key.trim()}] = ${o.unwrap || hasAwait(o.init) ? 'yield ' + rhs(o.init) : o.init};` +
					(o.init === BLANK ? ' // @blank' : ''));
				break;
			case 'PARTITION':
				push(`yield (yield${o.handshake ? ' ' + o.handshake : ''});` +
					' '.repeat(20) + '// @partition');

				for (const t of (post || [])) for (const line of t.split('\n')) push(line);
				break;
			case 'LINE':
				push(o.text);
				break;
			case 'CTOR_PREFIX':
			case 'CTOR_TAIL':

				for (const line of yieldify(o.text).split('\n')) push(line.trim());
				break;
			default:
				throw new Error('v9 emit: unknown op ' + o.op);
		}
	}
	/* doc:C-REGISTER */
	/* A REGISTER USED ONCE, ON THE NEXT LINE, IS NOT MINTED. A start that binds a
	 * value its very next line spends — `const ødefer0 = warm(); // @defer-start`,
	 * then `yield ødefer0;` — is that value in place: `yield warm();`. Anything
	 * between the two keeps the register, a row line included: a start stands
	 * where it stands, and folding it past a line would move it. So does a soft
	 * join, whose `try` would then also catch the start's own throw, and a line
	 * that gathers several registers (a barrier over a run), which keeps them all. */
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

/* put the pieces in class order: head, static blocks, constructor with the
 * hook, verbatim members, private accessors */
function assemble(ir, body, statics, grainTag, ats, tn) {

	const fmt = v => rewriteMember(v.text).split('\n')
		.map((l, i) => (i ? l : IND + l.trim())).join('\n');
	const vAll = ir.verbatim || [];

	const vBefore = vAll.map(v => ({ t: fmt(v), at: v.at != null ? v.at : null }));
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
		if (out.length > 1) out.push(L('', C));   // a blank line sets the constructor off from the members above it
		out.push(L(IND + `constructor(${params}) {${grainTag}`, C));
		out.push(L(IND.repeat(2) + sup, C));
		/* doc:C-HOOK */
		out.push(L(IND.repeat(2) + `this[Symbol.new](function* ${tn}() {`, C));
		out.push(...body);
		out.push(L(IND.repeat(2) + '});', C));
		out.push(L(IND + '}', C));
	}

	out.push(...vAfter);
	if (statics.length) {
		if (out.length > 1) out.push(L('', H));   // and the static face from the instance face
		out.push(L(IND + 'static {', H));
		out.push(L(IND.repeat(2) + `this[Symbol.new](function* ${tn}_Static() {`, H));
		out.push(...statics);
		out.push(L(IND.repeat(2) + '});', H));
		out.push(L(IND + '}', H));
	}
	out.push(L('}', H));
	return flatten(out, ats);
}

/* doc:T-IDENT */
/* doc:C-TRYEXPR */
const STMT_BEFORE = new Set([';', '{', '}']);
const STMT_WORDS = new Set(['else', 'do', 'finally']);
/* the block VALUE rule, for a `try { … }` body wrapped as an IIFE: a body that is
 * one expression statement returns it (`return expr;`); a body with a `return`,
 * or more than one statement, is used as written */
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
/* rewrite expression-position `try` inside a member body as an IIFE. A try
 * at a statement boundary is JavaScript's own and is left alone. */
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
		edits.push({ s: t[i].s, e: t[end] ? t[end].s : text.length, text: (asy ? 'await ' : '') + iife });
		i = end - 1;
	}
	return edits.length ? splice(text, edits) : text;
}
/* doc:C-GETFIELD */
/* `get` before a FIELD is a descriptor — the hidden, pliable constant — and
 * before a METHOD it is JavaScript's getter. The modifier loop cannot tell which
 * until it sees what follows the name, so a field or pattern path converts it
 * here, and so is `set`, which before a field is `const`. Returns the field's
 * descriptor, removing the word from its modifier list. */
function accessorWordOnField(mods, mut, name, at) {
	const acc = mods.find(w => ACCESSOR_KW.has(w));
	if (!acc) return mut;
	if (mut) {
		throw err('a field names one descriptor \u2014 ' + [...FIELD_DESCRIPTORS].map(w => '`' + w + '`').join(', ') + ' \u2014 not more than one.', at);
	}
	mods.splice(mods.indexOf(acc), 1);
	/* doc:C-SHADOW */
	/* `set` before a FIELD is the per-class constant: `const`'s row, with one
	 * difference — a subclass may declare its own. Before a METHOD it stays
	 * JavaScript's setter: that path never reaches here. */
	return acc;
}
/* doc:C-NESTED */
/* compile any class declared inside a member body, in place */
/* doc:C-LOCALLANE */
/* `let sync x = e` / `const sync x = e` — the LEXICAL LOCK. Halts THIS frame
 * until e resolves, binding the value rather than the promise.
 *
 * Only `sync` generalises out of settlement. `async` would mean “do not await”,
 * which is `let x = e` — an alias for nothing. `defer` means “start now, join at
 * the tail”, and a local binding has no tail. Both are refused with the reason,
 * rather than given a second meaning that only holds locally. */
function localLane(text) {
	const t = lexOr(text); if (!t) return text;
	const edits = [];
	for (let i = 0; i < t.length; i++) {
		const w = t[i].w;
		if (w !== 'let' && w !== 'const') continue;
		const lane = t[i + 1] && t[i + 1].w;
		if (!isBlocking(lane) && lane !== 'async' && lane !== 'defer') continue;
		const nm = t[i + 2];
		if (!nm || !nm.w) continue;
		if (!(t[i + 3] && t[i + 3].c === '=')) continue;
		if (!isBlocking(lane)) {
			throw err(lane === 'async'
				? '`' + w + ' async ' + nm.w + '` would not await, which is `' + w + ' ' + nm.w + '` — write that.'
				: '`' + w + ' defer ' + nm.w + '`: defer joins at the SETTLEMENT tail, and a local binding has none.', t[i].s);
		}
		edits.push({ s: t[i + 1].s, e: t[i + 2].s, text: '' });
		edits.push({ s: t[i + 3].e, e: t[i + 3].e, text: ' await' });
	}
	return edits.length ? splice(text, edits) : text;
}
/* a member body that contains a `class` is compiled on its own — a nested
 * Instance class compiles like a top-level one, without a source map or
 * manifest; text with no class in it is returned as is */
function nestWrap(text, opts) {
	const t = lexOr(text); if (!t) return text;
	if (!t.some(k => k.w === 'class')) return text;
	const r = compile(text, { ...opts, sourceMap: false, manifest: null });
	return r.code;
}
/* doc:C-SETLANE */
/* `[try] [sync|defer|async] set name(v)` — a MUTATION LANE.
 *
 * The body is split at the first TOP-LEVEL await, exactly where a class body
 * splits at its partition:
 *
 *   set query(val) {
 *     this.local = val;                 <- PREFIX: runs on every assignment, now
 *     await api.search(val);            <- REMAINDER: entered into the lane
 *   }
 *
 * The prefix is not scheduled, so an optimistic update lands immediately under
 * every policy — not only for the first write, which is what happens if the
 * whole body is queued. */
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
	/* find the first OWN-SCOPE await at depth 0 of the body */
	const info = ownTokens(body);
	let cut = -1;
	if (info) {
		let d = 0;
		for (let i = 0; i < info.t.length; i++) {
			const c = info.t[i].c;
			if (c === '{' || c === '(' || c === '[') { d++; continue; }
			if (c === '}' || c === ')' || c === ']') { d--; continue; }
			if (d === 0 && info.t[i].w === 'await' && info.own.includes(i)) {
				/* rewind to the start of the statement holding it */
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
/* `[static] async get name() { … }` -> a plain getter returning an async IIFE's
 * promise, since JavaScript has no async accessor; any other member text is
 * returned as is */
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

/* doc:C-SEED */
/* ONE call seeds a face: `Superset.pending(this, 'a', 'b')`, every name a TDZ
 * binding (C-CASCADE). A #private name has no string to pass, so it seeds
 * through its own accessor. */
function seed(o) {
	const names = o.names.map(emitName), pub = names.filter(n => !isPrivate(n));
	return [...(pub.length ? [`${rt('pending')}(this, ${pub.map(n => sq(n)).join(', ')});`] : []),
		...names.filter(isPrivate).map(n => `this.${n} = ${o.value};`)].join('\n' + IND.repeat(3));
}

/* the accessor pair behind every #private FIELD of the class, on both faces: a
 * Symbol key, `get #name()` reading the runtime cell (a pending value reads as
 * undefined) and `set #name(v)` writing it. A #private name has no string to
 * define it by, so it is reactive through these. One pair per name; the lines. */
function privateAccessors(ir) {

	const seen = new Set();
	const out = [];
	for (const [st, ops] of [['', ir.ops || []], ['static ', ir.staticOps || []]]) {
		for (const o of ops) {
			const names = o.op === 'SEED' ? o.names : (o.name ? [o.name] : []);
			for (const raw of names) {
				const n = emitName(raw);
				const pm = n.match(/^([$\u0394\u03a3]{1,2})?#(.+)$/);
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

/* the emitted lines ({ t: text, at: source offset }) joined into one string;
 * given `ats`, one source offset per OUTPUT line is pushed to it for the map */
function flatten(out, ats) {
	const lines = [];
	for (const o of out) for (const l of String(o.t).split('\n')) {
		lines.push(l);
		if (ats) ats.push(o.at == null ? null : o.at);
	}
	return lines.join('\n');
}

/* a signed integer as a source-map VLQ: base64, five bits a digit, the sign in
 * the low bit */
function vlq(n) {
	let v = n < 0 ? ((-n) << 1) | 1 : n << 1, out = '';
	do { let d = v & 31; v >>>= 5; if (v > 0) d |= 32; out += B64[d]; } while (v > 0);
	return out;
}

/* a function from an offset in `src` to its 0-based line (a binary search over
 * the line starts) */
function lineIndex(src) {
	const nl = [0];
	for (let i = 0; i < src.length; i++) if (src[i] === '\n') nl.push(i + 1);
	return (off) => {
		let lo = 0, hi = nl.length - 1;
		while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (nl[mid] <= off) lo = mid; else hi = mid - 1; }
		return lo;
	};
}

/* doc:T-MAPBYTES */
/* the source map, version 3, LINE-grained: the output is the regions in order
 * (untouched source text, each at its own offset, and emitted text with one
 * source offset per line in `ats`), so every output line maps to the source line
 * it came from; columns are 0. `opts.file`, `opts.source` and
 * `opts.inlineSources` name the files and whether the source rides along. */
function buildMap(regions, src, opts) {
	const lineOf = lineIndex(src);
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

/* doc:C-PROTOCOL */

/* THE ENTRY POINT. source -> { code, diagnostics, packages, [map] }.
 * Scan once; parse interfaces, packages and classes from the spans; check each
 * class; build its IR; emit; splice the emits back over the source ranges. */
/* doc:C-DELETE */
/* THE DELETE OPERATOR AND Reflect.deleteProperty ARE OBSERVED BY REWRITE.
 * `delete el.x` runs the element's own [[Delete]], which looks only at its own
 * properties and runs no user code: no prototype is consulted, and a DOM node
 * cannot itself be a proxy. So a reactive field removed by delete is invisible
 * at runtime \u2014 but not to the compiler. Every member delete becomes
 * Superset.delete(obj, key, strict): native semantics, then the field's
 * subscribers are told. A COMPUTED key needs nothing special \u2014 the key
 * expression moves into an argument, evaluated once, at the same moment, in the
 * same scope. Strictness is read at runtime by `function(){return !this}()`,
 * which inherits the strictness of the code around it.
 * NOT rewritten, left to native: `delete identifier`, `delete super.x`, a
 * parenthesised operand, an optional link before the last one, and any Reflect
 * reached through an alias or a computed name \u2014 finding those means tracking
 * values through the program, which is a different tool. */
function rewriteDeletes(code) {
	if (!/\bdelete\b|\bdeleteProperty\b/.test(code)) return code;
	try { var t = lex(maskComments(code)); }   /* offsets index `code` itself: the comments are masked, not stripped */
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
		if (t[i + 1] && t[i + 1].c === ':') continue;                       /* a key named delete */
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
		if (!last || last.call) continue;                                    /* not a property reference */
		if (segs.slice(0, -1).some(g => g.opt)) continue;                    /* an optional link before the last */
		const obj = code.slice(t[i + 1].s, last.s);
		edits.push({ s: t[i].s, e: last.e, text: last.opt
			? rt('delete') + '(' + obj + ', () => (' + last.key + '), ' + STRICT + ', true)'
			: rt('delete') + '(' + obj + ', ' + last.key + ', ' + STRICT + ')' });
		i = j - 1;
	}
	return edits.length ? splice(code, edits) : code;
}
/* THE COMPILE: source text -> { code, diagnostics, packages, version[, map] }.
 * Scan the comments out; parse interfaces, packages and classes; per class:
 * check, build the IR, describe its rows, emit; splice every emitted text over
 * its source range, put the comments back, rewrite `delete`; write the manifest
 * when asked. A SyntaxError is thrown with its line, or — `opts.recover` —
 * collected as a diagnostic: the member it stands in is cut and noted above its
 * class, or the class gives way to the note when the refusal is the class's, so
 * the editor keeps compiling the rest (C-RECOVER). */
function compile(source, opts = {}) {
	/* one sequence per COMPILE, not per class: gotoWrap mints during buildIR,
	 * before any class is emitted, so a per-class reset would make the numbers
	 * depend on leftover state and differ between runs of the same source. */
	regReset();

	const { code, comments, spans } = scan(String(source));
	const diagnostics = [];
	try { var ifaces = parseInterfaces(spans, code), packages = parsePackages(spans, code), classes = parseClasses(spans, code, !!opts.recover); }
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
		rec                                      /* doc:C-SHADOW \u2014 the parent's members, when in view */
	};

	/* doc:T-DIAGPOS */

	const lineAt = lineIndex(code);
	const locate = (e, rec) => {
		const at = e.at !== undefined ? e.at : rec.head.s;
		e.line = lineAt(at) + 1;
		e.at = at;
		return e;
	};

	const edits = [];

	for (const f of ifaces.values())
		edits.push({ s: f.s, e: f.e + 1, text: emitInterface(f), ats: null });
	for (const pk of packages.values())
		edits.push({ s: pk.s, e: pk.e + 1, text: emitPackage(pk, code), ats: null });
	/* doc:C-RECOVER */
	/* a refusal as one line of output — its kind, its line, its message, with a
	 * comment-closer in the message defused — and as a diagnostic */
	const noteOf = e => `/* ${e.constructor.name} @line ${e.line}: ${String(e.message).replace(/\*\//g, '*\\/').replace(/\s*\n\s*/g, ' ')} */`;
	const diagOf = e => ({ level: 'error', line: e.line, at: e.at, name: e.constructor.name, message: e.message });
	for (let ci = 0; ci < classes.length; ci++) {
		const rec = classes[ci], mark = diagnostics.length;
		try {
			if (rec.fault) throw rec.fault;   /* doc:C-RECOVER — the walk refused a constructor: the class's */
			check(rec, code, (r, m, why) => {
				const e = new SyntaxError(why === 'lifecycle'
					? DIAGNOSTICS.lifecycle(r.name, m.name)
					: DIAGNOSTICS.grain(r.name));
				if (m && m.span) e.at = m.span.s;
				throw e;
			}, { grainOf, diags: diagnostics, recover: !!opts.recover }, G.get(rec));
			const typed = checkImplements(rec, code, ifaces, diagnostics);
			const ir = assertYieldRule(buildIR(rec, code, opts, G.get(rec)));
			/* doc:C-DESCRIPTOR */
			/* Every declared FIELD is described by its keyword, per face. A
			 * destructuring pattern describes every name it binds, not only the first. */
			/* doc:C-UNTRACKED */
			/* `untracked` on a FIELD is a participle on its row: the runtime tunes the
			 * cell's T axis, so the kind is `'untracked let'`, or `'untracked'` alone. */
			const kinds = { inst: new Map(), cls: new Map() };
			for (const m of rec.members) {
				if (m.kind !== 'field') continue;
				const kind = (((m.mods || []).includes('untracked') ? 'untracked ' : '') + (m.mut && FIELD_DESCRIPTORS.has(m.mut) ? m.mut : '')).trim();
				if (kind) for (const n of (m.names && m.names.length ? m.names : [m.name]).filter(Boolean))
					kinds[m.static ? 'cls' : 'inst'].set(emitName(n), kind);
			}
			/* doc:C-METHODDESC */
			const methodDesc = [];
			for (const kind of DESCRIPTOR_WORDS)
				for (const st of [false, true]) {
					const names = rec.members
						.filter(m => (m.kind === 'method' || m.kind === 'accessor') &&
						             m.mut === kind && m.name && !!m.static === st)
						.map(m => emitName(m.name));
					if (names.length) methodDesc.push({ kind, names, target: st ? 'this' : 'this.prototype' });
				}
			/* doc:C-RUNTIME */
			/* EACH FACE DESCRIBES ITSELF, inside its own hook: instance rows on the
			 * element, static rows on the class, each where its fields are defined
			 * (C-CASCADE). Interfaces, package mixins and method slots are class-level
			 * facts and open the static hook, after its first describe. */
			const rows = face => {
				const o = new Map();
				for (const g of methodDesc) if ((g.target === 'this') === (face === 'cls')) o.set(g.kind, g.names);
				return o.size ? rowsText(o) : null;
			};
			const line = text => ({ op: 'LINE', text, at: null });
			ir.staticOps = ir.staticOps || [];
			const front = [];
			describeOps(ir.ops, kinds.inst);
			const top = describeOps(ir.staticOps, kinds.cls);
			if (typed) for (const nm of rec.implements) front.push(line(`${rt('implement')}(this, ${nm});`));
			if (rec.usings && rec.usings.length)
				for (const u of rec.usings.map(u => parseUsings(spans, u.from, u.to + 1, code)[0]).filter(Boolean)) front.push(line(`${rt('mixin')}(this, ${u.name});`));
			const mi = rows('inst'), mc = rows('cls');
			if (mi) front.push(line(`${rt('redescribe')}(this.prototype, ${mi});`));
			if (mc) front.push(line(`${rt('redescribe')}(this, ${mc});`));
			ir.staticOps.splice(top, 0, ...front);

			if (rec.usings && rec.usings.length) {
				const body = code.slice(rec.body.s, rec.body.e);
				const all = rec.usings.map(u => parseUsings(spans, u.from, u.to + 1, code)[0]).filter(Boolean);
				const parts = all.map((u, i) => emitUsing(u, i)).filter(Boolean);
				ir.usings = parts.map(p2 => p2.pre).filter(Boolean);
				ir.usingsPost = parts.map(p2 => p2.post).filter(Boolean);
			}
			const ats = opts.sourceMap ? [] : null;
			/* doc:C-RECOVER */
			/* THE MEMBERS CUT UNDER RECOVER ARE NOTED ABOVE THEIR CLASS, one line each at
			 * the class's indentation, and are its first diagnostics. A head that shares
			 * its line with code (`return class …`) takes them inline instead, so no
			 * line break lands where ASI could end a statement. One source offset per
			 * note line keeps the map aligned. */
			const cut = (rec.faults || []).map(f => locate(f, rec)).sort((a, b) => a.at - b.at);
			const lead = code.slice(code.lastIndexOf('\n', rec.head.s - 1) + 1, rec.head.s);
			const own = /^[ \t]*$/.test(lead);
			if (ats && own) for (const f of cut) ats.push(f.at);
			const notes = cut.map(f => noteOf(f) + (own ? '\n' + lead : ' ')).join('');
			edits.push({ s: rec.head.s, e: rec.body.e + 1, text: notes + emitClass(ir, opts, ats), ats });
			diagnostics.splice(mark, 0, ...cut.map(diagOf));
		} catch (err) {
			if (!(err instanceof SyntaxError || err instanceof TypeError)) throw err;
			locate(err, rec);
			if (!opts.recover) {
				err.message += ` (line ${err.line})`;
				throw err;
			}
			/* doc:C-RECOVER */
			/* A REFUSAL INSIDE A MEMBER COSTS THAT MEMBER. The member whose span holds
			 * the refusal is cut, the refusal joins the class's faults, this round's
			 * diagnostics are dropped, and the class is compiled again without it —
			 * each round cuts one member, so it ends. The grains stay as the source
			 * wrote them, so no class is judged against what recovery left. A refusal
			 * in no member — a constructor, the head, no position — is the class's:
			 * the class gives way to its notes (T-DIAGPOS). */
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
	/* doc:C-DELETE */
	out = rewriteDeletes(out);
	/* doc:C-MANIFEST */
	const manifests = new Map();
	for (const pk of packages.values()) if (pk.manifest) manifests.set(pk.name, pk.manifest.value);
	if (opts.manifest && manifests.size) writeManifest([...manifests.values()][0], opts.manifest, diagnostics);
	if (!opts.sourceMap) return { code: out, diagnostics, packages: manifests, version: Superset.version };

	const src = restoreComments(code, comments);
	const regions = [];
	let cursor = 0;
	for (const ed of edits.slice().sort((a, b) => a.s - b.s)) {
		regions.push({ text: src.slice(cursor, ed.s), at: cursor });
		regions.push({ text: restoreComments(ed.text, comments), at: ed.s, ats: ed.ats });
		cursor = ed.e;
	}
	regions.push({ text: src.slice(cursor), at: cursor });
	return { code: out, diagnostics, packages: manifests, version: Superset.version, map: buildMap(regions, src, opts) };
}

/* doc:C-RUNTIME */
/* The compiler IS a class — `new Superset(src)` is the compilation — and the
 * runtime half the core publishes under the same name sits behind it, so the
 * one global answers for both: `Superset.compile` and `Superset.soft`. Either
 * may load first (the core's body is gated on its extensions); whichever comes
 * second does the splice. Without the core, at a build-time compile, it stands
 * alone. */
class Superset {
	static version = 10.97;

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
Object.assign(Superset, { compile, lex, findClasses, parseClasses, stripComments, restoreComments, runtime: RUNTIME });

const __IVC = global[Symbol.for('Instance')];
if (typeof __IVC === 'function' && typeof __IVC.provide === 'function')
	__IVC.provide({ module: 'compiler', value: Superset, from: '0.89.j', to: '0.89.z' });
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

/* doc:C-CAPTURE */
/* ═══ DOCUMENT CAPTURE — the compiler owns the page from the line it is imported ═══
 *
 *   <script src="i_superset-10.97.js"></script>          ← last in <head>; owns the page from here
 *   <script>  mixed class Tab extends Div { … }  </script>   ← Instance source
 *
 * GLOBAL BY DEFAULT: every JavaScript script after the tag is compiled. `sandbox`
 * on the tag narrows that to blocks that opt in with `superset`; an Instance type
 * or a `.is` source is always compiled, a data block never.
 *
 * At import, during parsing, an UNCLOSED <template> is written: everything after
 * it is inert template content until EOF closes it. At `interactive` the capture
 * is walked as REAL NODES (the parser already tokenised the page), the Instance
 * blocks are compiled, and the page is put back. The price is that nothing after
 * the import renders or preloads before then. Capture works only from a
 * parser-blocking classic script during parsing; anything else REFUSES LOUDLY,
 * because a silent non-capture is a page of syntax errors. */
/* doc:C-CAPTURE */
(function () {
	'use strict';

	const MARK = 'data-instance-capture';

	/* QUEUED marks a block this pass has already taken: a module-private symbol,
	 * never `Symbol.for`, installed non-enumerable — bookkeeping that stays out of
	 * the document (an attribute would serialise into outerHTML and reach CSS).
	 * It does not survive importNode, so the rewrite pass clones FIRST. */
	const QUEUED = Symbol('Instance.superset.queued');
	const doc = typeof document !== 'undefined' ? document : null;
	if (!doc) return;                       /* no document — nothing to own */

	/* What the browser runs as a classic script: no type, or a JavaScript MIME
	 * type (the HTML spec's list). `module` is JavaScript too, run as a module.
	 * Anything else — importmap, speculationrules, JSON, a template — is a data
	 * block the browser never executes, and the capture never touches it. */
	const CLASSIC = new Set(['', 'text/javascript', 'application/javascript', 'application/ecmascript',
		'application/x-ecmascript', 'application/x-javascript', 'text/ecmascript', 'text/javascript1.0',
		'text/javascript1.1', 'text/javascript1.2', 'text/javascript1.3', 'text/javascript1.4',
		'text/javascript1.5', 'text/jscript', 'text/livescript', 'text/x-ecmascript', 'text/x-javascript']);
	const INSTANCE = new Set(['text/instance', 'application/instance', 'instance', 'text/is']);

	/* ── the capture, synchronous, during parse ───────────────────────────── */

	const here = doc.currentScript;
	/* ON BY DEFAULT. Loading the compiler during parsing captures the rest of the
	 * page. A page that hosts Instance source as DATA rather than code — the suite
	 * is one: its blocks are test cases a harness runs — opts out with
	 * `nocapture` on the compiler tag. */
	if (here && here.hasAttribute('nocapture')) return;

	/* A SECOND IMPORT MUST NOT CAPTURE TWICE. The second write would open a
	 * template INSIDE the first capture, nesting the page in itself, and the
	 * inner one would never be found. If a capture already exists this import
	 * only attaches the hydrator — which is also what makes the hydration half
	 * testable without a live parser. */
	const existing = doc.querySelector('template[' + MARK + ']');
	/* GLOBAL BY DEFAULT. A plain compiler tag owns every untyped script after
	 * it; `sandbox` narrows the compiler to blocks that opt in with `superset`.
	 * The mode is recorded on the capture itself, so a second import — which
	 * only attaches the hydrator — reads the same answer. */
	const SANDBOX = !!((here && here.hasAttribute('sandbox')) ||
	                   (existing && existing.hasAttribute('data-sandbox')));
	const GLOBAL = !SANDBOX;
	if (!existing && here && here.hasAttribute('override'))
		(console.warn || console.log)('[Instance] `override` on the compiler tag is the default now \u2014 it can be removed' +
			(SANDBOX ? ', and it contradicts `sandbox`, which wins.' : '.'));
	/* BYPASS. `bypass` (or `data-bypass`) on a script asks the compiler to leave it
	 * alone, and wins over `superset`. Under `sandbox` it is always honoured. In
	 * global mode the compiler owns the page, so bypass is REFUSED unless the
	 * compiler tag allows it: `allow-bypass` for any script, `allow-bypass="external"`
	 * or `"inline"` for one kind. A value it does not know allows nothing.
	 *
	 * Bypass skips COMPILING — never the nonce gate, never Trusted Types. A bypassed
	 * script goes back exactly as the parser would have run it and no more trusted
	 * than that; otherwise `<script bypass src=…>` would be the very laundering the
	 * nonce gate exists to stop. The setting is recorded on the capture, like the
	 * mode, for a second import to read. */
	const ALLOW = (() => {
		const v = here && here.hasAttribute('allow-bypass') ? here.getAttribute('allow-bypass')
			: existing && existing.hasAttribute('data-allow-bypass') ? existing.getAttribute('data-allow-bypass') : null;
		if (v === null) return '';
		const k = v.trim().toLowerCase();
		if (k === '') return 'any';
		if (k === 'external' || k === 'inline') return k;
		(console.warn || console.log)('[Instance] allow-bypass="' + v + '" is not a value the compiler knows \u2014 ' +
			'nothing may bypass. Use allow-bypass, allow-bypass="external" or allow-bypass="inline".');
		return '';
	})();

	/* NONCE. Under a nonce-based CSP the compiler tag carries the page's nonce, and
	 * so does every script the server meant to run. It is read through the IDL
	 * property: once a tag is inserted the browser blanks the attribute and keeps
	 * the value internally. It is never written anywhere — a nonce in an attribute
	 * is a nonce exfiltrated. */
	const NONCE = here ? (here.nonce || here.getAttribute('nonce') || '') : '';

	/* TRUSTED TYPES. Under `require-trusted-types-for 'script'` two of the
	 * compiler's own writes are sinks: the capture's document.write, and compiled
	 * text going into a script element. Both go through ONE named policy,
	 * `superset`, which the page's trusted-types directive must allow. The policy
	 * is private to this closure, and narrow even so: createHTML accepts only the
	 * capture tag, and createScript only the text the compiler handed it on the
	 * line before — so the policy is no use to anyone who somehow obtained it. */
	const OPENER = '<template ' + MARK + (SANDBOX ? ' data-sandbox' : '') +
		(ALLOW ? ' data-allow-bypass' + (ALLOW === 'any' ? '' : '="' + ALLOW + '"') : '') + '>';
	let handed = null;
	try {
		if (typeof trustedTypes !== 'undefined' && trustedTypes && trustedTypes.createPolicy)
			var POLICY = trustedTypes.createPolicy('superset', {
				createHTML: s => { if (s !== OPENER) throw new TypeError('[Instance] superset policy: not the capture tag'); return s; },
				createScript: s => { if (s !== handed) throw new TypeError('[Instance] superset policy: not compiler output'); handed = null; return s; },
			});
	} catch (e) { /* the name is not allowed, or this is a second import; a write that needs it will say so */ }
	const asHTML = s => POLICY ? POLICY.createHTML(s) : s;
	const asScript = s => { if (!POLICY) return s; handed = s; return POLICY.createScript(s); };

	function refuse(why) {
		throw new Error('[Instance] superset: ' + why + ' \u2014 the page was NOT captured, so ' +
			'every Instance block after this point will run as JavaScript and throw. ' +
			'Load this file as a plain parser-blocking script in <head>: ' +
			'no async, no defer, no injection after load.');
	}

	if (!existing) {
		if (doc.readyState !== 'loading') refuse('the parser has already finished (readyState=' + doc.readyState + ')');
		if (!here) refuse('there is no document.currentScript');
		/* `async` is read as the NATIVE boolean where there is one, and as the
		 * attribute otherwise. Instance's DSL installs an element METHOD named
		 * `async`; where a script element has no native property (jsdom implements
		 * none) that method shows through — a function, truthy, read as "this
		 * script is async" — and the guard refused a perfectly good page. */
		const isAsync = typeof here.async === 'boolean' ? here.async : here.hasAttribute('async');
		const isDefer = typeof here.defer === 'boolean' ? here.defer : here.hasAttribute('defer');
		if (isAsync || isDefer) refuse('this script is ' + (isAsync ? 'async' : 'defer'));
		/* The compiler captures EVERYTHING after it. A script it captured would be put
		 * back at hydration — and inline blocks run on insertion without waiting for
		 * external ones, so an Instance block could run before the core arrived. The
		 * compiler therefore loads LAST: core, Chimera, DSL, then the compiler. */
		if (typeof Instance === 'undefined') refuse('the core is not loaded yet \u2014 load i_core, i_chimera and i_dsl BEFORE the compiler, which captures everything after it');

		/* The tag is written OPEN on purpose. Closing it here would capture
		 * nothing; the parser closes it at EOF, which is exactly the extent we
		 * want. */
		try { doc.write(asHTML(OPENER)); }
		catch (e) {
			throw new Error('[Instance] superset: the capture could not be written (' + ((e && e.message) || e) + '). ' +
				'Under Trusted Types, allow the `superset` policy in the trusted-types directive \u2014 it writes ' +
				'only this one tag and the scripts the compiler emits.');
		}
	}

	/* ── the hydration, at DOMContentLoaded ───────────────────────────────── */

	/* Whose is this captured <script> — ours to compile, or the browser's to run?
	 *   - `superset`, an Instance type, or a `.is` source → always ours (DECLARED)
	 *   - under `sandbox`, nothing else
	 *   - in global mode, all JavaScript (CLAIMED): untyped, any JavaScript type,
	 *     and inline modules. An EXTERNAL module stays native: fetched and inlined,
	 *     it would resolve its imports against the page instead of its own URL.
	 *   - a data block (importmap, JSON, a template …) → never ours, in any mode.
	 * On failure the two kinds part ways. A declared block that cannot be fetched
	 * or compiled must not run — it is not JavaScript. A claimed script is handed
	 * back to the browser to run as the plain script its author wrote. */
	const NATIVE = 0, DECLARED = 1, CLAIMED = 2;
	let warnedSuper = false;
	const typeOf = script => (script.getAttribute('type') || '').trim().toLowerCase();
	function route(script) {
		if (script[QUEUED]) return NATIVE;             /* already taken by this pass */
		if (script.hasAttribute('bypass') || script.hasAttribute('data-bypass')) {
			const kind = script.hasAttribute('src') ? 'external' : 'inline';
			if (SANDBOX || ALLOW === 'any' || ALLOW === kind) return NATIVE;
			(console.warn || console.log)('[Instance] bypass on ' + label(script) + ' was refused \u2014 ' +
				(ALLOW ? 'this page allows bypass for ' + ALLOW + ' scripts only'
				       : 'in global mode the compiler owns every script unless its tag says allow-bypass') +
				'. It is compiled like any other.');
		}
		if (script.hasAttribute('superset')) return DECLARED;
		if (script.hasAttribute('super')) {            /* the retiring name */
			if (!warnedSuper) { warnedSuper = true;
				(console.warn || console.log)('[Instance] <script super> is now <script superset> \u2014 the old name still works for now.'); }
			return DECLARED;
		}
		const type = typeOf(script);
		if (/\.is(?:[?#]|$)/i.test(script.getAttribute('src') || '')) return DECLARED;
		if (INSTANCE.has(type)) return DECLARED;
		if (SANDBOX) return NATIVE;
		if (CLASSIC.has(type)) return CLAIMED;
		if (type === 'module') return script.hasAttribute('src') ? NATIVE : CLAIMED;
		return NATIVE;                                 /* a data block */
	}
	/* Will the browser execute it? A data block is never run, so needs no nonce. */
	const executes = script => { const type = typeOf(script);
		return CLASSIC.has(type) || type === 'module' || INSTANCE.has(type) ||
			script.hasAttribute('superset') || script.hasAttribute('super'); };
	const nonceOf = script => script.nonce || script.getAttribute('nonce') || '';

	/* SRI. The fetch CARRIES `integrity`, so the browser enforces it natively on
	 * the compiler's own load — same parser, same strongest-hash rule, same
	 * refusal — and the compiler never sees bytes the browser would not have run.
	 * Credentials and referrer follow the tag. A failed fetch is handed back with
	 * `integrity` intact, and the browser's own check has the final word. */
	function fetchSource(script) {
		if (typeof fetch !== 'function') return Promise.resolve({ error: new Error('fetch is unavailable') });
		const init = { mode: 'cors',
			credentials: script.getAttribute('crossorigin') === 'use-credentials' ? 'include' : 'same-origin' };
		const integrity = script.getAttribute('integrity');
		if (integrity) init.integrity = integrity;
		const referrer = script.getAttribute('referrerpolicy');
		if (referrer) init.referrerPolicy = referrer;
		return fetch(script.src, init)
			.then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.text(); })
			.then(text => ({ text }), error => ({ error }));
	}

	const label = script => script.getAttribute('src') || 'an inline script';
	const reason = e => (e && e.message) || String(e);

	/* TRUST IS RE-ASSERTED, NEVER WIDENED. Under Trusted Types a script the parser
	 * wrote is trusted where it stands — but what hydration puts back is a CLONE,
	 * and a clone is not parser-inserted, so a captured script returned unchanged
	 * reads as tampered and is blocked (measured: Chrome refuses it as "modified
	 * without use of TrustedScript assignment"). So every inline script that passed
	 * the nonce gate gets its own text back through the policy: the same text, the
	 * same trust the parser gave it, and no more. The same text also means the same
	 * hash, so a hash-based CSP still matches. */
	function bless(script) {
		if (POLICY && !script.hasAttribute('src') && script.textContent) script.textContent = asScript(script.textContent);
	}

	/* A claimed script that cannot be made ours goes back exactly as written. */
	function handBack(script, why) {
		bless(script);
		(console.warn || console.log)('[Instance] ' + label(script) + ' ' + why +
			' \u2014 handed back to the browser, which runs it as plain JavaScript' +
			(script.hasAttribute('integrity') ? ' under its own integrity check' : '') +
			'. Deletes in it are not observed.');
		tuneOrdering(script);
	}

	/* A declared block that cannot be compiled must not run at all. */
	function neutralize(script, why) {
		const name = label(script);             /* before `src` goes */
		/* Children are REMOVED, not overwritten: an empty, src-less script is one the
		 * browser never prepares, so no Trusted Types check is ever reached. */
		while (script.firstChild) script.removeChild(script.firstChild);
		script.removeAttribute('src');
		(console.error || console.log)('[Instance] superset: ' + name + ' ' + why);
	}

	/* Head-only elements go to <head> wherever they were captured; everything
	 * else goes to <body>. The capture usually opens in <head>, and the parser
	 * drops the <body> start tag inside a template, so position cannot be
	 * recovered from the fragment — the element's own kind is what is left. */
	const HEAD_TAGS = new Set(['LINK', 'META', 'STYLE', 'TITLE', 'BASE']);

	/* TOP-LEVEL YIELD needs a generator to live in; run()'s async arrow is a
	 * SyntaxError for it (measured). Wrap ONLY when there is a top-level yield,
	 * because the wrapper is not free: declarations inside a generator are
	 * function-scoped, so a class declared in a wrapped block is NOT visible to
	 * the next block, while an unwrapped one is. Paying that for every script
	 * would quietly change what a page means. */
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

	/* doc:C-CAPTURE */
	function toJS(src) {
		const js = Instance.compile(src);
		if (!hasTopLevelYield(js) && !hasTopLevelAwait(js)) return js;
		/* A top-level yield needs a generator to live in, and a generator needs
		 * draining. The cost is scope: declarations inside are function-scoped,
		 * so a class declared in a wrapped block is NOT visible to the next one,
		 * while an unwrapped block declares at page scope. That is why the
		 * wrapper is applied only where a top-level yield is actually present. */
		return '(async () => { const \u00f8g = (async function* () {\n' + js +
		       '\n})(); for await (const \u00f8 of \u00f8g); })();';
	}

	/* ORDERING IS THE BROWSER'S JOB. The scripts are rewritten while detached and
	 * the fragment is appended ONCE; the standard execution rules then produce the
	 * order the page asked for. Capture shifts the whole script timeline to
	 * hydration — inherent, nothing inside a capture runs before it closes — but
	 * relative order is exact: inline scripts in tree order, `defer`/`async`
	 * ignored on inline scripts as the spec ignores them, an external classic
	 * script put back on the in-order list below. */
	function tuneOrdering(script) {
		/* A dynamically inserted external script defaults to async-like: it runs
		 * whenever it lands. `async = false` puts it back on the in-order list,
		 * which is what a parser-inserted classic or deferred script does. An
		 * explicitly `async` script is left alone — it asked not to be ordered. */
		if (script.src && !script.hasAttribute('async')) script.async = false;
	}

	async function hydrate() {
		const cap = doc.querySelector('template[' + MARK + ']');
		if (!cap) return;                       /* nothing captured — nothing to do */
		/* CLAIM THE CAPTURE BEFORE THE FIRST AWAIT. hydrate() is wired to two
		 * signals, and a second import attaches a hydrator of its own; removing the
		 * capture is what makes the later callers no-ops. But the capture is only
		 * removed after phase 1, and phase 1 awaits fetches — so a call arriving
		 * mid-fetch found it still there and hydrated the page a second time,
		 * running every script twice. Unmarking it synchronously, here, ends that:
		 * every other caller's query now finds nothing. */
		cap.removeAttribute(MARK);
		const head = doc.head || doc.documentElement;
		const body = doc.body || doc.documentElement;

		/* Clone into THIS document. Still detached, so still inert: nothing runs
		 * and nothing loads until the append at the bottom. */
		const frag = doc.importNode(cap.content, true);

		/* ── phase 1: rewrite, while nothing is live ─────────────────────────
		 * Every block that is ours becomes ordinary JavaScript, inline. Fetching
		 * happens HERE, before anything is in the document, so the append stays
		 * synchronous and the browser sees one complete tree. */
		const scripts = [...frag.querySelectorAll('script')];
		const routes = scripts.map(route);
		/* NOTHING GAINS TRUST BY BEING PUT BACK. Under 'strict-dynamic' a script
		 * inserted BY a trusted script is trusted too — that is how a loader loads.
		 * Hydration re-inserts every captured script, so without this check a
		 * parser-inserted script the policy would have refused — an injected
		 * <script src> with no nonce — would come back trusted, laundered by the
		 * capture. So when the compiler carries a nonce, every captured script that
		 * would execute must carry the same one, or it is put back inert: exactly
		 * what the parser would have done with it. */
		const refused = scripts.map(script => !!NONCE && executes(script) && nonceOf(script) !== NONCE);
		/* Every fetch starts at once and is consumed in tree order below, so the
		 * page waits for its slowest script rather than for the sum of them. A
		 * page with no external block of ours starts none — and takes no await,
		 * so it still hydrates synchronously. */
		const sources = scripts.map((script, i) =>
			!refused[i] && routes[i] !== NATIVE && script.hasAttribute('src') ? fetchSource(script) : null);
		for (let i = 0; i < scripts.length; i++) {
			const script = scripts[i], how = routes[i];
			if (refused[i]) {
				neutralize(script, 'carries no nonce, or the wrong one \u2014 under this page\'s policy the ' +
					'parser would have refused it, so it is put back inert');
				continue;
			}
			if (how === NATIVE) {
				/* An EXTERNAL script in the capture is a race, not an error: at the append
				 * an inline block runs on insertion and does not wait for it. Said loudly,
				 * once per script, with the fix — load it before the compiler. */
				if (script.src) (console.warn || console.log)('[Instance] capture: ' + script.getAttribute('src') +
					' was loaded AFTER the compiler, so it was captured — inline blocks may run before it arrives. ' +
					'Load it before the compiler, which belongs last.');
				if (executes(script)) bless(script);
				tuneOrdering(script); continue;
			}
			let src = script.textContent;
			if (sources[i]) {
				const got = await sources[i];
				if (got.error) {
					const why = 'could not be fetched (' + reason(got.error) +
						' \u2014 a network or CORS failure, file://, or an integrity mismatch)';
					if (how === CLAIMED) handBack(script, why);
					else neutralize(script, why + '; it is Instance source, so it was not run');
					continue;
				}
				src = got.text;
			}
			/* A module keeps its type and needs no wrapper: top-level await is native
			 * there, and a function wrapper would break its imports and exports. */
			const module = typeOf(script) === 'module';
			try {
				var js = module ? Instance.compile(src || '') : toJS(src || '');
				if (module && hasTopLevelYield(js)) throw new SyntaxError('a top-level yield cannot live in a module');
			}
			catch (e) {
				if (how === CLAIMED) handBack(script, 'did not compile (' + reason(e) + ')');
				else neutralize(script, 'failed: ' + reason(e));
				continue;
			}
			/* Text the compiler left unchanged is not rewritten — unless Trusted Types is
			 * on, where even unchanged text must be re-asserted (see bless). Either way
			 * the content is the same, so a hash-based CSP still matches it. */
			if (POLICY || sources[i] || js !== script.textContent) script.textContent = asScript(js);
			/* These removals are NOT bookkeeping, they are what makes the block run.
			 * A leftover `src` would have the browser fetch and execute the ORIGINAL
			 * source, and a leftover Instance `type` is a data block the browser
			 * refuses to execute at all — removing it is also what stops core's scan
			 * finding an already-run block. `integrity` was verified by the fetch and
			 * means nothing on an inline script. `superset` STAYS: it is the author's
			 * intent, it reads correctly in devtools, and re-entry is answered by the
			 * mark rather than by destroying the source. */
			script.removeAttribute('src');
			if (!module) script.removeAttribute('type');
			script.removeAttribute('integrity');
			Object.defineProperty(script, QUEUED, { value: true });
			tuneOrdering(script);
		}

		/* Head-only elements are routed before the append. They carry no script,
		 * so moving them cannot disturb execution order — and the capture usually
		 * opens inside <head>, where the parser has already dropped the <body>
		 * start tag, so an element's own kind is all that is left to route by. */
		for (const el of [...frag.children])
			if (HEAD_TAGS.has(el.tagName)) head.appendChild(el);

		/* ── phase 2: one append; the browser is the scheduler from here ───── */
		/* The scaffolding goes FIRST. Inline scripts run during the append, so a
		 * template removed afterwards was still in the document for every restored
		 * script — visible to querySelector, to anything walking <head>. By the
		 * time a restored script runs, the page must read as the author wrote it.
		 * `frag` is an importNode clone, so it does not depend on `cap`. */
		cap.remove();
		body.appendChild(frag);
		doc.dispatchEvent(new Event('instance:hydrated'));
	}

	/* HYDRATE AT `interactive`, NOT AT DOMContentLoaded. `interactive` is the slot
	 * a deferred script occupies — the last moment before DCL — so the captured
	 * blocks go back in front of the event they are contracted to precede, and
	 * the page's own DCL listeners see the hydrated page. (An EXTERNAL block's
	 * fetch can still carry the append past DCL; an all-inline page hydrates
	 * synchronously inside the readystatechange handler.) DOMContentLoaded stays
	 * wired as a backstop; hydrate() is idempotent, so whichever fires first wins. */
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

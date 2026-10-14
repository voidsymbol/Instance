/**!
* @license FSL-1.1
* @description Direct Element Architecture — Instance 0.89.c
*/
/* ═══════════════════════════════════════════════════════════════════════════
 * Instance BIOS6 core — elements, registry, router, events, chain, the loader.
 *
 * No imports: every extension registers under a REGISTRY SYMBOL and EXTMAP names
 * the symbol, so the resolver looks each up at boot, after all scripts have run.
 * Core must still load LAST — it defines Symbol.new, and a .is class evaluated
 * before it would coerce that computed key to the string "undefined" and lose
 * its hook silently. The guard below makes that a real error.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';
/* [0.89.d] The load-order guard that stood here is GONE, and its absence is the
   point. It threw unless Chimera/Compiler/DSL were already registered when core
   loaded — which under CORE-FIRST is every time, because core is now the file
   that installs the broker they register into.

   Its job moved into the gate: phase 2 does not run until the CORE group of the
   EXTMAP table resolves, and if it never does, the backstop names what is missing
   at DOMContentLoaded. That reports strictly more than the guard did — the guard
   knew only that something was absent AT ITS OWN LOAD, which is no longer a
   meaningful moment. It also demanded COMPILER, which core provably does not
   need: boot, class construction, and signals all measured fine without it. */
/* ═══════════════════════════════════════════════════════════════════════════
 * IVC PROLOGUE — hoisted above everything, and that position is the whole point.
 *
 * The broker used to live inside DOM_UEFI_086d, i.e. inside CORE. That was fine
 * while core was the last file loaded, and wrong the moment the registration
 * policy started to matter: in THIS file chimera, the compiler and the DSL are
 * physically ABOVE core, so they ran before any broker existed and every one of
 * them took its fallback branch. The split build, where core loads first, took
 * the broker branch instead. Two builds, two code paths, one board — which is
 * exactly the arrangement that hides a defect in whichever path is not being read.
 *
 * Hoisted, there is one path. Every module finds a broker, in both builds, and a
 * module that legitimately cannot run without Instance (the DSL) can THROW on a
 * missing broker instead of silently publishing to a symbol nobody will read.
 *
 * build-modules.py prepends this same segment to the core module, because in the
 * split it is core that loads first and has to install it. One source, two
 * destinations — never two copies.
 * ═══════════════════════════════════════════════════════════════════════════ */
;(function () {
'use strict';
// ── IVC — Instance Version Controller ─────────────────────────────── (author-spec, Pass Q7)
//
// Exposes Instance on the global scope via a well-known Symbol so that:
//   1. Multiple versions of Instance can coexist without collision
//   2. User code can retrieve the active Instance without a named global:
//        const Instance = globalThis[Symbol.for('Instance')]();
//   3. Classes can be reassigned without const (no rewrite needed):
//        class CatDiv extends Div { ... }
//        CatDiv = Instance.extend(CatDiv);   // ← let/var or bare assignment
//   4. VERSION + SUB-DOMAIN routing — the module dependency channel:
//        globalThis[Symbol.for('Instance')]('0.89.d', 'namespaces')
//        globalThis[Symbol.for('Instance')]('latest',  'namespaces')
//        globalThis[Symbol.for('Instance')]('0.89')     // prefix → newest 0.89.*
//        globalThis[Symbol.for('Instance')]()           // newest, no sub-domain
//
// WHY THIS AND NOT A SYMBOL PER KIT. `Symbol.for('Instance/Namespaces')` is ONE
// global slot: two Instance builds in a directory overwrite each other's kit and
// the loser fails at a distance, inside a module that reads correct. Routing every
// module read through one broker keyed by VERSION makes that collision impossible
// to express — a module names the build it was written against, or says 'latest'.
//
// TOTAL, NEVER THROWS. A miss returns undefined, like §8a's _tr(). The caller
// decides whether absence is fatal, and a module that cannot run without its host
// throws its own named error — which reads better than one thrown from in here.
//
// NOTE: the registered symbol is double-duty by design — the SAME
// Symbol.for('Instance') keys the compiler's per-level definition hook on
// ELEMENT chains; holders differ (globalThis vs prototypes), so no collision.
/* ── IVC, as a CLASS ─────────────────────────────────────────────────────────
 * This was `function makeIVC()` returning a closure with six captured variables
 * and eleven properties bolted onto the returned function afterwards. The state
 * was real state — a registry, a pending bucket, a provider table, listeners, a
 * readiness deferral — and a closure is a class with the declaration filed off:
 * you cannot see the shape without reading the whole body, and every member
 * arrived by assignment rather than by declaration.
 *
 * As a class the state is DECLARED. Private statics mean the registry cannot be
 * reached from outside, which the closure also gave — but here it says so.
 *
 * THE BROKER STAYS CALLABLE. `Symbol.for('Instance')('latest', 'namespaces')` is
 * the published API and every module uses it, so the class cannot BE the broker;
 * a class is not callable. The bridge at the bottom builds one function whose
 * properties are this class's statics, generated by reflection rather than by a
 * hand-kept list — add a static here and it appears on the broker.
 * ═══════════════════════════════════════════════════════════════════════════ */
class IVC {

	static #REG     = new Map();   // version → { instance, domains: Map }
	static #PROV    = new Map();   // module name → { value, from, to }
	static #LISTEN  = Object.create(null);
	static #pending = new Map();   // sub-domains published DURING a build, sealed by register()
	static #settle  = null;
	static #ready   = new Promise(r => { IVC.#settle = r; });

	/* Segment-wise: numeric against numeric compares as NUMBERS, so 0.9 < 0.89 the
	 * way the version line means it and not the way string order would. Mixed or
	 * alphabetic segments fall back to lexical, which is what orders .c before .d. */
	static cmp(a, b) {
		const A = String(a).split('.'), B = String(b).split('.');
		for (let i = 0; i < Math.max(A.length, B.length); i++) {
			const x = A[i] ?? '', y = B[i] ?? '';
			const num = /^\d+$/.test(x) && /^\d+$/.test(y);
			const d = num ? (+x - +y) : (x < y ? -1 : x > y ? 1 : 0);
			if (d) return d < 0 ? -1 : 1;
		}
		return 0;
	}
	static #newest(ks) { return ks.length ? ks.slice().sort(IVC.cmp)[ks.length - 1] : undefined; }

	/* absent | 'latest' | '*' → newest · exact key → itself · '0.89' → newest 0.89.* */
	static #pick(spec) {
		const ks = [...IVC.#REG.keys()];
		if (spec == null || typeof spec !== 'string' || spec === 'latest' || spec === '*') return IVC.#newest(ks);
		if (IVC.#REG.has(spec)) return spec;
		return IVC.#newest(ks.filter(k => k.startsWith(spec + '.')));
	}

	/* THE CALL. Everything else on the broker is a named method; this is what the
	 * broker IS when invoked, and the bridge routes the bare call here. */
	static resolve(version, domain) {
		const v = IVC.#pick(version);
		if (v === undefined) return undefined;
		const rec = IVC.#REG.get(v);
		return domain == null ? rec.instance : rec.domains.get(String(domain));
	}

	/* ── the PROVIDER channel ─────────────────────────────────────────────────
	 * Distinct from #REG on purpose. #REG holds BUILDS (version → Instance); #PROV
	 * holds MODULES that have declared themselves, which happens before any build
	 * is sealed — chimera provides itself while core is still in phase 1 and has no
	 * version to attach to. register() mirrors #PROV into the build's domains.
	 *
	 * The declaration carries a COMPATIBILITY RANGE, and that is the part worth
	 * having: chimera 18.3 against Instance 0.91 says so AT BOOT, naming both,
	 * instead of failing somewhere in the arena an hour later. It WARNS rather than
	 * throws — outside the range is a `probably`, and core's own gate covers the
	 * `certainly`. */
	static provide(decl) {
		if (!decl || typeof decl !== 'object') return IVC;
		const name = String(decl.module || decl.name || '').toLowerCase();
		if (!name) return IVC;
		IVC.#PROV.set(name, { value: decl.value, from: decl.from || null, to: decl.to || null });
		/* a module declaring itself AFTER a build was sealed still becomes one of its
		 * domains — under core-first the compiler does exactly that. */
		if (IVC.#REG.size) IVC.adopt('latest');
		/* Contained so one bad extension cannot stop the others — but core's BOOT GATE
		 * is a listener, and swallowing ITS throw turns a hard boot failure into a
		 * console line with `Instance === undefined` and no exception anywhere. Every
		 * listener still runs; the first failure is rethrown after the loop. */
		let first = null;
		for (const fn of (IVC.#LISTEN.provide || []))
			try { fn(name); } catch (e) { console.error('[Instance] IVC provide listener threw:', e); first = first || e; }
		if (first) throw first;
		return IVC;
	}
	/* lower-cased on both sides: the EXTMAP table says 'Chimera', the destructure
	 * wants CHIMERA, the domain is 'chimera'. Under a GATED boot a mis-cased key does
	 * not throw, it WAITS — so one canonical form is not cosmetic here. */
	static provides(name) { const p = IVC.#PROV.get(String(name).toLowerCase()); return p ? p.value : undefined; }
	static declared(name) { return IVC.#PROV.get(String(name).toLowerCase()) || null; }
	static on(evt, fn)    { (IVC.#LISTEN[evt] || (IVC.#LISTEN[evt] = [])).push(fn); return IVC; }

	/* mirror every declared module into this build, and check its range */
	static adopt(version) {
		const v = IVC.#pick(version); if (v === undefined) return IVC;
		const rec = IVC.#REG.get(v);
		for (const [name, p] of IVC.#PROV) {
			if (p.value !== undefined) rec.domains.set(name, p.value);
			if (p.from && IVC.cmp(v, p.from) < 0 || p.to && IVC.cmp(v, p.to) > 0) console.warn(
				'[Instance] module "' + name + '" declares Instance ' + p.from + ' \u2026 ' + p.to +
				' but this build is ' + v + ' \u2014 loaded anyway; behaviour is not claimed.');
		}
		return IVC;
	}

	/* Publish a sub-domain. No version → the build currently under construction,
	 * because BIOS6 runs before its own version string exists; an explicit version →
	 * that record, which is how a MODULE contributes a domain after core sealed. */
	static domain(name, value, version) {
		const v = version == null ? null : IVC.#pick(version);
		if (v == null) IVC.#pending.set(String(name), value);
		else if (IVC.#REG.has(v)) IVC.#REG.get(v).domains.set(String(name), value);
		return value;
	}

	static register(version, instance) {
		const key = String(version);
		const rec = IVC.#REG.get(key) || { instance, domains: new Map() };
		rec.instance = instance;
		for (const [k, val] of IVC.#pending) rec.domains.set(k, val);
		IVC.#REG.set(key, rec);
		IVC.#pending = new Map();
		IVC.adopt(key);                       // declared modules become this build's domains
		if (IVC.#settle) { const f = IVC.#settle; IVC.#settle = null; f(instance); }
		return IVC;
	}

	/* READINESS. The gate means core's script can finish with no Instance yet, so the
	 * moment of boot is no longer "when this file ended" and nothing outside the frame
	 * can see it. The broker outlives both phases, so it holds the signal. */
	static ready(version) { return IVC.#REG.size ? Promise.resolve(IVC.resolve(version)) : IVC.#ready; }

	static versions()      { return [...IVC.#REG.keys()].sort(IVC.cmp); }
	static domains(version){ const v = IVC.#pick(version); return v === undefined ? [] : [...IVC.#REG.get(v).domains.keys()]; }
	static has(version, domain) { return IVC.resolve(version, domain) !== undefined; }
	static IVC = 2;               // capability marker — a 0.89.c-or-older broker has none
}

/* ── the callable façade ──────────────────────────────────────────────────────
 * NOT the old makeIVC(). That was 122 lines and WAS the broker: a closure holding
 * the registry, with eleven properties bolted onto the returned function. This is
 * nine lines that wrap the class above, and it exists for one reason — the
 * published API is a CALL, `Symbol.for('Instance')('latest', 'namespaces')`, and a
 * class is not callable.
 *
 * The surface is generated by reflection off the class, so a static added up there
 * appears here with no edit. It is the one hand-kept list this design could have
 * had and does not. */
function makeBroker() {
	const broker = (version, domain) => IVC.resolve(version, domain);
	for (const k of Object.getOwnPropertyNames(IVC)) {
		if (k === 'length' || k === 'name' || k === 'prototype' || k === 'resolve') continue;
		const v = IVC[k];
		broker[k] = typeof v === 'function' ? v.bind(IVC) : v;
	}
	return broker;
}

/* FIRST-WINS, and installed BEFORE factory() runs: BIOS6 publishes its sub-domains
 * during construction, so the slot has to be there already. A later Instance build
 * finds this broker and registers INTO it — the getter is non-configurable, so it
 * cannot be replaced. An OLDER broker with no .register cannot be handed off to;
 * say so plainly and keep a private one rather than pretend the handoff worked. */
const _slot  = Reflect.getOwnPropertyDescriptor(globalThis, Symbol.for('Instance'));
const _found = _slot && typeof _slot.get === 'function' ? _slot.get() : null;
/* BROKER, not the class. `IVC` is the class declared above; this is the callable
 * façade over it — or a broker an EARLIER build already installed, which is what
 * first-wins means. The two are deliberately different bindings: handing off to a
 * previous build means using ITS façade, not this build's class. */
const BROKER = (typeof _found === 'function' && typeof _found.register === 'function') ? _found : makeBroker();
if (_found && BROKER !== _found) console.warn(
	'[Instance] the Symbol.for("Instance") slot is held by a pre-IVC broker — this build is reachable as globalThis.Instance but NOT through version routing.');
if (!_slot)
	Reflect.defineProperty(globalThis, Symbol.for('Instance'), {
		get()        { return BROKER; },
		configurable: false,
		enumerable:   false,
	});

})();

/* ===== BIOS6 core / Instance runtime ===== */
// Instance-0.86 — DOM_UEFI runtime (self-settling thenable elements; sigil reactivity; await-new construction)
var __INSTANCE__ = (function DOM_UEFI_086d(factory, build) {

	const EXTMAP = Object.create(null);

	// ═══ §EXT  EXTENSION RESOLUTION PIPELINE  (ported from 0.76.0) ═══
	//   build.EXTMAP is resolved here via a `for await` async generator, BEFORE the
	//   rest of the factory runs. Load order is GUARANTEED sequential. By value type:
	//     string          → dynamic import()   (needs static server + CORS)
	//     async generator → iterated; last yield = the extension
	//     Promise         → awaited
	//     null/undefined  → skipped silently
	//     anything else   → used directly (inline object/class/fn, zero cost)
	/* [0.89.c] SYNCHRONOUS. This was an async generator so a string entry could be
	 * `await import(val)`-ed, plus branches for async generators and thenables. All
	 * three are gone: a module URL needs CORS and dies on file://, while the SYMBOL
	 * channel — a <script src> that registers itself, looked up here — has neither
	 * problem and is not async. Dropping them makes the WHOLE BOOT synchronous, so
	 * `Instance` exists the moment core.js finishes and a module loaded after it can
	 * simply write `class Router extends Instance`. An async extension is still
	 * possible: it registers its symbol whenever ready, and Instance.define() takes
	 * classes after boot. */
	/* ── RESOLUTION ────────────────────────────────────────────────────────────
	 * Three value forms, and the LOOKUP CHAIN is what makes them migratable:
	 *
	 *   true    resolve by KEY NAME, trying, in order:
	 *             1. the IVC provider channel   — the module found a broker
	 *             2. Symbol.for('Instance.KEY') — the namespaced channel (slash: legacy)
	 *             3. Symbol.for('Key')          — the module's standalone fallback
	 *   symbol  that global slot, exactly as before
	 *   null    skipped silently
	 *
	 * All three paths stay live ON PURPOSE. In the MONOLITH chimera is physically
	 * above core, so it runs before the broker exists and takes its own standalone
	 * branch — path 3. Split and core-first, it finds the broker — path 1. One
	 * table has to serve both, so resolution asks rather than assumes.
	 *
	 * CORE is a GROUPING IN THE SOURCE TABLE ONLY. It flattens here, because
	 * BIOS6 destructures `{ COMPILER, CHIMERA, DSL }` straight off `build` — the
	 * nesting says "required before boot", it does not survive into the object. */
	/* CANDIDATES, not one guess. Derive-the-casing looks obvious and is wrong the
	 * first time you try it: 'DSL' pascal-cases to 'Dsl', which matches no symbol
	 * anyone registered. The IVC channel is case-folded; the SYMBOLS are not, and
	 * they were named by hand across three files. So try the spellings that exist
	 * — as written in the table, Pascal, and upper — and stop at the first hit. */
	function candidates(raw) {
		const pascal = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
		const seen = new Set([raw, pascal, raw.toUpperCase()]);
		return [...seen];
	}
	function lookup(raw) {
		const B = GLOBAL[Symbol.for('Instance')];
		if (typeof B === 'function' && B.provides) {         // 1. the IVC provider channel
			const v = B.provides(raw);
			if (v != null) return v;
		}
		/* Symbol.for('Instance.Name') — a DOT — is the house form; every module in the
		 * tree now publishes under it. The SLASH is kept because it costs one `??` and
		 * covers a module built before the rename: nothing here registers that way, but
		 * a stale file on someone's disk would otherwise fail as 'the module is broken'
		 * rather than 'the name moved'. That mistake already cost a whole monolith board
		 * once, when the compiler took the dot and the chain only asked for the slash. */
		for (const c of candidates(raw)) {                   // 2. namespaced  3. standalone
			const v = GLOBAL[Symbol.for('Instance.' + c)]
			       ?? GLOBAL[Symbol.for('Instance/' + c)]   // legacy spelling
			       ?? GLOBAL[Symbol.for(c)];
			if (v != null) return v;
		}
		return null;
	}
	function* entries(extmap, group) {
		for (const [key, val] of Object.entries(extmap)) {
			if (key.startsWith('_')) continue;
			if (val !== null && typeof val === 'object' && !Array.isArray(val)) { yield* entries(val, key); continue; }
			yield [key.toUpperCase(), val, group, key];      // UPPER for `build`, raw for lookup
		}
	}
	function* resolver(extmap = {}) {
		for (const [key, val, group, raw] of entries(extmap)) {
			if (val == null) continue;
			try {
				if (val === true) {
					const reg = lookup(raw);
					if (reg == null) {
						if (group === 'CORE') throw new Error(
							'required extension "' + key + '" is not registered \u2014 it declares nothing through the IVC broker, Symbol.for(\'Instance/' + key + '\'), or Symbol.for(\'' + key + '\')');
						continue;                       // optional: absent is fine
					}
					yield [key, reg];
				}
				else if (typeof val === 'symbol') {
					const reg = GLOBAL[val];
					if (reg == null) throw new Error(
						'nothing registered under ' + String(val) + ' \u2014 load the module before Instance, or null the slot to skip it');
					yield [key, reg];
				}
				else yield [key, val];
			} catch (e) {
				console.log('[Instance] \u2717 Extension "' + key + '" failed to load:', e);
			}
		}
	}
	/* the CORE group IS the requirement set — no second list to drift from it */
	function required(extmap) { return Object.keys((extmap && extmap.CORE) || {}).map(k => k.toUpperCase()); }
	
	/** 
	* @description Polyfill. Arity 2, non-enumerable, native [[Construct]] stripped. No cross-pollination.
	* Prototype: WeakMap | Map .getOrInsert{Computed}
	*/
	const GLOBAL = ((_) => typeof globalThis !== _ ? globalThis 
		: typeof window !== _ ? window 
		: typeof self !== _ ? self 
		: typeof global !== _ ? global 
		: this ?? new Function('return this')()
	)(typeof void function($0, $1, $2) {
		const ensure = (proto, name) => {
			if (!Object.prototype.hasOwnProperty.call(proto, name)) {
				Object.defineProperty(proto, name, {
					value: {
						[$1](key, dv) { 
							return this.has(key) ? this.get(key) : (this.set(key, dv), dv);
						},
						[$2](key, fn) {
							if (this.has(key)) return this.get(key);
							if (typeof fn !== $0) throw new TypeError(`${$2} requires a ${$0}`);
							const computed = fn(key, this);
							this.set(key, computed);
							return computed;
						}
					}[name],
					writable: true, configurable: true, enumerable: false
				});
			}
		};
		for (const proto of [WeakMap.prototype, Map.prototype]) { ensure(proto, $1); ensure(proto, $2); }
	}('function', 'getOrInsert', 'getOrInsertComputed'));


	/* The broker was installed by the PROLOGUE at the top of this file (in the split,
	 * by the segment build-modules.py prepends to core). Read it; never re-create it. */
	const IVC = globalThis[Symbol.for('Instance')];

	/* ══ PHASE 2 — THE GATE ══════════════════════════════════════════════════════
	 * Everything above this line is phase 1: EXTMAP, the resolver, GLOBAL, and the
	 * IVC broker. It runs the moment core's script is fetched, so the broker exists
	 * before any other module can look for one. Everything below runs when the CORE
	 * group is satisfied — which may be right now (monolith: chimera and dsl are
	 * physically above core and already registered) or later (core-first: they load
	 * after and each provide() re-checks).
	 *
	 * FIRES INLINE, NEVER ON A TASK. This is the load-bearing constraint of the
	 * whole design. IVC.provide() calls its listeners synchronously, so boot still
	 * completes inside the last required module's own <script> — which is what keeps
	 * §2.4 true: `Instance` exists the moment that script ends, and the next one can
	 * write `class Router extends Instance` with no indirection. Defer this to a
	 * microtask or a promise and §2.4 reverses, silently, and the 22-line factory
	 * pipeline comes back.
	 * ═══════════════════════════════════════════════════════════════════════════ */
	let Instance = null;
	let _booted  = false;

	/* the CORE group IS the requirement set (see the EXTMAP table) — nothing else
	 * lists these, so the table and the gate cannot drift apart. */
	const REQUIRED = required(build);
	const missing  = () => REQUIRED.filter(k => lookup(k) == null);

	const _isClass = f => /^class[\s{]/.test(Function.prototype.toString.call(f));
	function gate() {
		if (_booted) return Instance;
		const want = missing();
		if (want.length) return null;
		_booted = true;

		for (const [key, val] of resolver(build)) {
			/* [0.89.j] a FACTORY is called with GLOBAL; a CLASS is the module itself.
			 * Without the distinction any module published as a class dies here with
			 * "cannot be invoked without 'new'" (measured, on the compiler). */
			EXTMAP[key] = (typeof val === 'function' && !_isClass(val)) ? val(GLOBAL) : val;
			console.log('%cInstance Plugin "' + key + '" loaded', 'color: #a104ff');
		}
		Instance = factory(GLOBAL, EXTMAP, undefined);

		/* Seal this build into the registry. Everything BIOS6 published through
		 * IVC.domain() during factory() attaches to this version key here, and
		 * register() adopts every module that declared itself through provide(). */
		IVC.register(Instance.version || '0.0.0', Instance);

		Reflect.defineProperty(GLOBAL, 'Instance', { value: Instance, configurable: true });
		try { if (GLOBAL.jQuery && GLOBAL.jQuery.fn) Instance.mergeJQuery(GLOBAL.jQuery); } catch (e) {} // jQuery merge — ON BY DEFAULT when present (Pass Q7)
		try { Instance.initEvents(GLOBAL); } catch (e) {} // DOM-event vocabulary (Pass Q8)
		if (typeof define === 'function' && define.amd) define([], () => Instance);
		return Instance;
	}

	IVC.on('provide', gate);   // each declaration re-checks
	gate();                    // and evaluate NOW — the monolith is already complete

	/* NEVER HANG SILENTLY. A required module that 404s used to throw at core's
	 * load-order guard; under a gate it does nothing at all — no Instance, no
	 * error, a page that renders and sits there. Name what never arrived, because
	 * "boot blocked: chimera" is a five-minute fix and silence is an afternoon. */
	if (!_booted) {
		const _stuck = () => { if (!_booted) console.error(
			'[Instance] boot blocked \u2014 required extension(s) never registered: ' + missing().join(', ') +
			'. Load order is core \u2192 ' + REQUIRED.join(' \u2192 ') + ', or null the slot in EXTMAP to skip it.'); };
		if (typeof document !== 'undefined' && document.readyState === 'loading')
			document.addEventListener('DOMContentLoaded', _stuck, { once: true });
		else setTimeout(_stuck, 0);
	}

	return Instance;

}(function BIOS6(global, build) {


'use strict';

const ø = (o = {}) => ({ __proto__: null, ...o });

const REGISTRY = ø(); // ClassName → element class (every generated class)

const { COMPILER, CHIMERA, DSL: __DSL } = build;
let _lateCompiler;   // memo for a compiler that registered AFTER the boot gate fired
const { DSL, DSLError } = __DSL;
const { Signal, Substrate, reactive, layer, REACTIVE_STORE } = CHIMERA;
/* THE STORE SURFACE AS VERBS. Core never calls a method on a store; it calls
 * Chimera's host-first verbs with the store as the first argument — read(h, k),
 * write(h, k, v), has(h, k), remove(h, k), door(h, name, owner), dictOf(h). On a
 * Store handle each does what the method of the same meaning does. The point is
 * the host that CANNOT carry the Store prototype: an element or a class adopted as
 * its own node (the double unification) serves as its own store through these, and
 * only through these, since a method named `get` or `set` on either would be a
 * user field or static. One spelling for both faces, from the start. */
const sRead = Signal.read, sWrite = Signal.write, sHas = Signal.has, sRemove = Signal.remove,
      sDoor = Signal.door, dictOf = Signal.dictOf, sRawOf = Signal.rawOf, sRelease = Signal.release;
/* doc:C-ADOPT */
/* WHERE A HOST'S STORE IS. A host IS its store, on both faces: an element is
 * adopted as its own Chimera node at its mint, a class at its first static write
 * (adoptClass), so the node brand sits on the host itself and there is no side
 * table to consult. */
/* The brand test is the store's own REACTIVE_STORE property pointing at itself — an
 * own-property identity read, 1.6 ns in Chromium, where a private-name `in` check
 * costs 10 and the side table it replaced 8.4. A host without the brand reads it
 * through its chain: a SUBCLASS meets its parent's brand, which is not itself, so it
 * never answers with its parent's store; anything else reaches the Meta trap, which
 * answers REACTIVE_STORE with undefined on both faces (below), so there is no path
 * back here. A released host has no store: it reads as a plain one. */
const storeOf = host => (host !== null && (typeof host === 'object' || typeof host === 'function')
	&& host[REACTIVE_STORE] === host) ? host : undefined;   // release() removes the brand with the store
/* A CLASS BECOMES ITS OWN STORE at its first static write — the trap's first touch,
 * a subclass shadowing an inherited static, or the lift of a native sigil static —
 * as an element does at its mint. Once only: a class that carries a node already
 * (a released one keeps the dead brand) is left as it is, and its later writes land
 * as plain properties, as a disposed element's do. A class that cannot take new
 * properties is not adopted: it could not take the brand, nor the write that asked
 * for a store. */
function adoptClass(C) {
	if (Signal.isSignal(C) || !Reflect.isExtensible(C)) return;
	Signal.Store.adopt(C);
	markFreezable(C);
}

void new Substrate('L5'); // installs the arena

/**
* @description ── core Instance symbols: compiler-emitted hook keys + sentinels. These MUST precede the
*  Symbols class, which uses INSTANCE (Symbol.new) / EFFECTS as computed
*  method keys (evaluated at class-definition). EFFECTS is the explicit arm-hook — a const like
*  the INSTANCE family, NOT a minted slot, so its key resolves and no accessor clobbers it. ── 
*/
const INSTANCE = Symbol.for('Instance'); // the ONE construction symbol (hook key AND sync-link-token)
/* [0.89.c] Symbol.new — the public spelling. One symbol carries the whole protocol:
 * the per-level hook key the compiler emits. The partition token is NOT this
 * symbol — it is `this` (the element, or the class on the static side), so the
 * symbol carries exactly one meaning. Aliased to Symbol.for('Instance'):
 * identity, the global registry, and cross-realm behavior are unchanged. */
if (!Object.getOwnPropertyDescriptor(Symbol, 'new'))
	Object.defineProperty(Symbol, 'new', { get: () => INSTANCE, configurable: true });
const EFFECTS 		 = Symbol.for('Instance.effects');	// optional explicit effect-arm hook
const DISPOSE		 = Symbol.for('Instance.dispose');		// the disposal protocol, sync face (Pass Q4) — house analog of Symbol.dispose
const ASYNC_DISPOSE = Symbol.for('Instance.dispose.async');	// …async face — house analog of Symbol.asyncDispose (awaits @removal/@unmount transitions)
const PENDING		 = Symbol.for('??');		// a field that has not settled
/* doc:C-BLANK */
const BLANK			 = Symbol.for('..');		// a declared field nothing has written: reads undefined, never seals
/* ── THE PENDING BOUNDARY ─────────────────────────────────────────────────────
 * PENDING lives in the CELL; a VALUE READ never sees it.
 *
 * The sentinel exists so poisonPending and pendingKeys can tell an unsettled
 * field from an unset one — they peek the cell and compare identity, and that
 * still works untouched. What was wrong was letting the same symbol out through
 * the property read, where ordinary JavaScript does inconsistent things to it:
 *   `'v: ' + el.x`  THREW      `if (el.x)`  was true      `el.x ?? d`  gave the symbol
 * Loud on coercion, silent on every test. A reader could not predict which.
 *
 * So the two layers answer two different questions. The VALUE layer answers
 * "what is this field" — undefined, because there is nothing yet. The SIGNAL
 * layer answers "has it settled" — h.peek() still returns PENDING, which is
 * where the poisoner and any explicit check should be asking anyway. */
/* [RULED 0.89.j] ONE settlement law, one difference between the faces. A field
 * PAST a blocking async is not defined until that blocker settles, on either
 * face, in source order. The faces differ only in what a pre-settlement READ
 * does: an ELEMENT is handed to you by `new` and is thenable — pending is part
 * of that handshake, so the value layer answers `undefined` and you await. A
 * CLASS is reachable by name the moment its declaration evaluates, with no
 * handshake object to point at, so an unsettled static is a program error and
 * throws like an ordinary TDZ read. Consistently loud beats the old leak, which
 * was loud on coercion and silent on every test. */
/* ── INTERFACE GUARD ───────────────────────────────────────────────────────
 * A class registers its contract at declaration time; IFACES is keyed by the
 * CONSTRUCTOR, so there is one entry per class rather than per instance. A miss
 * walks the prototype chain ONCE and memoises the answer — including `null` for
 * "no interface here" — so a subclass inherits the contract and every later set
 * is a single WeakMap lookup.
 *
 * IFACE_TYPES is keyed by the constructor itself. `typeof` separates primitive from
 * boxed (so Number rejects new Number(5)) but collapses every object to
 * 'object'; Object.prototype.toString separates object kinds but cannot reject a
 * boxed primitive. Each row carries whichever applies. */
/* doc:C-CACHED */
/* DESC: each field's descriptor row. SEALED: which unwritable fields have taken
 * their one write. Separate so the seal moment is a single line that can move
 * behind a success test if sealing ever becomes seal-on-success-only. */
/* doc:C-SETLANE */
/* MUTATION LANES. An `async set` is a concurrency controller: a 0ms assignment
 * feeding a boundary that takes real time MUST have a collision policy, and
 * standard JS silently picks one (fire-all) without letting you name it.
 *
 *   sync  — FIFO. Every write runs, in order. Nothing is lost.
 *   defer — queue-latest. The in-flight write finishes, intermediates are
 *           dropped, the newest is run next.
 *   async — fan. Every write fires at once, order unmanaged.
 *
 * The setter's SYNCHRONOUS PREFIX is not scheduled — it runs on every
 * assignment, immediately. Only the suspending remainder enters the lane. That
 * is what makes optimistic UI work under every policy rather than only for the
 * first write.
 */
const LANES = new WeakMap();
function laneRun(host, name, policy, rest) {
	let byName = LANES.get(host);
	if (!byName) LANES.set(host, byName = new Map());
	let st = byName.get(name);
	if (!st) byName.set(name, st = { busy: null, queue: [], pending: null, has: false });
	if (policy === 'async') { Promise.resolve(rest()).catch(() => {}); return; }
	if (st.busy) {
		if (policy === 'sync') st.queue.push(rest);
		else { st.pending = rest; st.has = true; }        /* defer: newest wins */
		return;
	}
	const go = (fn) => {
		st.busy = Promise.resolve(fn()).catch(() => {}).then(() => {
			st.busy = null;
			if (policy === 'sync' && st.queue.length) return go(st.queue.shift());
			if (st.has) { st.has = false; return go(st.pending); }
		});
	};
	go(rest);
}
/* doc:C-DESCRIPTOR */
/* THE DESCRIPTOR TABLE. Each descriptor keyword is one ROW: whether its field
 * is Enumerable, Configurable and Writable. Seven keywords and the bare field
 * cover all eight cells, one word each; `set` shares `const`'s cell and differs
 * in SHADOWING (C-SHADOW):
 *
 *            E  C  W
 *   bare     ·  ✓  ✓   a native field — visible where the face shows it
 *   ply      ✗  ✓  ✓   hidden, pliable, mutable    — internal mockable state
 *   let      ✗  ✗  ✓   hidden, locked, mutable     — internal strict state
 *   pin      ✓  ✗  ✓   visible, locked, mutable    — public strict state (was `var`, C-PIN)
 *   get      ✗  ✓  ✗   hidden, pliable, constant   — internal mockable constant
 *   const    ✗  ✗  ✗   hidden, locked, constant    — ONE value for the hierarchy
 *   set      ✗  ✗  ✗   hidden, locked, constant    — one value PER CLASS: a subclass may declare its own
 *   azo      ✓  ✓  ✗   visible, pliable, constant  — public mockable constant
 *   enum     ✓  ✗  ✗   visible, locked, constant   — public strict constant, one for the hierarchy
 *
 * PLIABLE (configurable) is what a test needs: it can delete the field or
 * redefine it with Object.defineProperty. LOCKED fields refuse both.
 *
 * Before this table, ONE flag (CONSTS) drove both the descriptor's
 * configurability and the setter's seal, so C always equalled W and four of
 * the eight cells could not be expressed. Writability on an accessor is the
 * SETTER's behaviour — an accessor has no `writable` attribute — so W is
 * enforced by the seal below. Instance.describe also takes a raw { e, c, w }. */
const DESCRIPTORS = Object.freeze({
	/*                       enumerable  configurable  writable */
	ply:   Object.freeze({ e: false,    c: true,      w: true  }),
	let:   Object.freeze({ e: false,    c: false,     w: true  }),
	pin:   Object.freeze({ e: true,     c: false,     w: true  }),
	get:   Object.freeze({ e: false,    c: true,      w: false }),
	const: Object.freeze({ e: false,    c: false,     w: false }),
	set:   Object.freeze({ e: false,    c: false,     w: false, s: true }),   /* const's cell; `s`: a subclass may declare its own (C-SHADOW) */
	azo:   Object.freeze({ e: true,     c: true,      w: false }),
	enum:  Object.freeze({ e: true,     c: false,     w: false }),
});
/* A field with NO keyword is a NATIVE field: enumerable, configurable, writable,
 * on both faces, exactly as a class field is in JavaScript. Internal state says
 * so with a keyword — ply, let, get, const — or with #private or a sigil.
 * (Until 0.89.o elements hid bare fields; that was the only way to hide one at
 * all, and the keywords made it unnecessary. See the note at BARE KEYS.) */
const BARE_ROW = Object.freeze({ e: true, c: true, w: true });
const DESC = new WeakMap();   /* host -> Map(name -> { e, c, w }) */
const SEALED = new WeakMap();
/* the registration lands on the PROTOTYPE (one per class); the write arrives on
 * an INSTANCE. So the lookup climbs, a subclass inherits its parent's rows for
 * free, and the NEAREST registration wins. */
function fieldFlags(host, name) {
	for (let o = host; o; o = Object.getPrototypeOf(o)) {
		const m = DESC.get(o);
		if (m && m.has(name)) return m.get(name);
	}
	return null;
}
/* doc:C-RUNTIME */
/* Rows land on the object whose face they describe: the ELEMENT for instance
 * fields (described inside its own hook, every construction, the shared row
 * stored by reference), the CLASS for statics. A later level may tighten a row
 * an earlier level installed an accessor under — `ply` then `let` — so a
 * configurable own accessor is re-installed under the new row. */
function describeHost(host, names, row) {
	let m = DESC.get(host);
	if (!m) DESC.set(host, m = new Map());
	for (const n of names) {
		m.set(n, m.has(n) ? Object.assign({}, m.get(n), row) : row);
		if (typeof host === 'function' || isSeeded(host, n)) continue;
		const d = Object.getOwnPropertyDescriptor(host, n);
		if (d && d.get && d.configurable && ((row.e != null && d.enumerable !== row.e) || row.c === false))
			try { Object.defineProperty(host, n, bareDescriptor(n, row.e != null ? row.e : d.enumerable, row.c != null ? row.c : true, host)); } catch (e) {}
	}
	return host;
}
function isConstField(host, name) { const f = fieldFlags(host, name); return !!f && f.w === false; }
/* doc:C-CASCADE */
/* A SEEDED KEY IS A TDZ BINDING. The seed makes the key exist from the top of
 * the hook, shadowing anything inherited under its name the way `let` shadows
 * an outer binding from the top of its block. It is not DEFINED until its first
 * real write: until then it is hidden and pliable, and that write installs the
 * row the field was declared under. */
const SEEDED = new WeakMap();   /* host -> Set(name): seeded, not yet defined */
function seedKey(host, name) {
	defineProperty(host, name, bareDescriptor(name, false, true, host));
	let s = SEEDED.get(host);
	if (!s) SEEDED.set(host, s = new Set());
	s.add(name);
}
function isSeeded(host, name) { const s = SEEDED.get(host); return !!s && s.has(name); }
function defineKey(host, name) {
	SEEDED.get(host).delete(name);
	const row = fieldFlags(host, name) || BARE_ROW;
	const e = row.e != null ? row.e : typeof host === 'function', c = row.c != null ? row.c : true;
	const d = Object.getOwnPropertyDescriptor(host, name);
	if (d && d.configurable && (d.enumerable !== e || !c)) defineProperty(host, name, bareDescriptor(name, e, c, host));
}
/* doc:C-UNTRACKED */
/* A row's `t` is the kernel's T axis for the field's cell: 0 is UNTRACKED — reads
 * register no edge, writes trigger nothing. Applied to the cell the store minted. */
function tuneCell(host, ss, name) {
	const f = fieldFlags(host, name);
	if (!f || f.t !== 0 || !dictOf(ss) || typeof Signal.untracked !== 'function') return;
	const ref = dictOf(ss).get(name), h = ref != null ? Signal.deref(ref) : null;
	if (h) Signal.untracked(h);
}
/* doc:C-DELETE */
/* A field REMOVED by delete: tell its subscribers, through the same store write
* a normal assignment uses, that it is now undefined. This also makes the next
* read — which falls through to the shared proxy, since the own accessor is
* gone — return undefined rather than the value the store still held. */
function forgetField(host, key) {
	if (typeof key !== 'string') return;
	const ss = storeOf(host);
	const _dk = ss && dictOf(ss);
	if (!_dk || !_dk.has(key)) return;
	const sealed = SEALED.get(host); if (sealed) sealed.delete(key);
	try { sWrite(ss, key, undefined); } catch (e) { /* a frozen or detached store: nothing to tell */ }
}
/* ToPropertyKey, exactly and once: a computed property name performs it. */
const toPropertyKey = k => Reflect.ownKeys({ [k]: 0 })[0];
/* doc:C-ENUM */
/* `enum`, `pin` and `azo` are the VISIBLE rows (e === true); see DESCRIPTORS. */
/* doc:C-MEMO */
const MEMO = new WeakMap();   /* host -> Map(lane -> write queue) for `memo` */
/* doc:C-WATERFALL */
const WFALL = new WeakMap(); /* host -> Map(lane -> start chain) for `async delay` */
/* doc:C-AWAITTHIS */
const INFLIGHT = new WeakMap(); /* host -> Set(promise) — every fan still in flight */
function isEnumField(host, name) { const f = fieldFlags(host, name); return !!f && f.e === true; }
const EMITS = new WeakMap();
/* doc:C-TLY */
/* One queue per element. Emissions buffer until a consumer drains them, so
 * iterating late loses nothing — the pre-partition region runs synchronously
 * during `new`, well before any `for await` can attach. */
function emitQueue(el) {
	const key = el;
	if (key === null || (typeof key !== 'object' && typeof key !== 'function'))
		return { buf: [], waiters: [], done: true };
	let q = EMITS.get(key);
	if (!q) EMITS.set(key, q = { buf: [], waiters: [], done: false });
	return q;
}
function closeEmits(el) {
	const q = emitQueue(el);
	if (!q || q.done) return;
	q.done = true;
	while (q.waiters.length) q.waiters.shift()({ value: undefined, done: true });
}
const IFACES = new WeakMap();
const IFACE_TYPES = new Map([
	[Number, { t: 'number' }], [String, { t: 'string' }], [Boolean, { t: 'boolean' }],
	[Symbol, { t: 'symbol' }], [BigInt, { t: 'bigint' }], [Function, { t: 'function' }],
	[Object, { g: '[object Object]' }], [Array, { g: '[object Array]' }],
	[Date, { g: '[object Date]' }], [Map, { g: '[object Map]' }], [Set, { g: '[object Set]' }],
	[Promise, { g: '[object Promise]' }], [RegExp, { g: '[object RegExp]' }],
]);
function contractOf(C) {
	if (!C) return null;
	const hit = IFACES.get(C);
	if (hit !== undefined) return hit;
	let p = Object.getPrototypeOf(C), found = null;
	while (p && p !== Function.prototype) {
		const q = IFACES.get(p);
		if (q) { found = q; break; }
		if (q === null) break;
		p = Object.getPrototypeOf(p);
	}
	IFACES.set(C, found);
	return found;
}
/* SNAPSHOT BOTH FACES of an interface class, once. The INSTANCE face merges
 * through construction — one `new` yields the child's fields AND every
 * inherited one, in a single object. The STATIC face merges by walking the
 * class chain. The faces stay disjoint, so a name may appear on both without
 * collision, and neither can shadow the other. */
function ifaceSnapshot(I) {
	const inst = {}, stat = {};
	try { Object.assign(inst, new I()); } catch (e) {}
	for (let C = I; C && C !== Function.prototype; C = Object.getPrototypeOf(C))
		for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(C)))
			if (d.enumerable && !(k in stat)) stat[k] = d.value;
	return { inst, stat };
}
function typeOk(v, token) {
	const r = IFACE_TYPES.get(token);
	if (!r) return typeof token === 'function' ? v instanceof token : true;
	return r.t ? typeof v === r.t : Object.prototype.toString.call(v) === r.g;
}
function ifaceGuard(receiver, prop, value) {
	/* a write to the CLASS is the static face; anything else is the instance face */
	const onClass = typeof receiver === 'function';
	const contract = contractOf(onClass ? receiver : (receiver && receiver.constructor));
	if (!contract) return;
	const want = (onClass ? contract.stat : contract.inst)[prop];
	if (want === undefined) return;
	if (value === PENDING || value === POISONED || value === BLANK) return;      // settlement sentinels
	const list = Array.isArray(want) ? want : [want];
	for (const tok of list) if (typeOk(value, tok)) return;
	throw new TypeError(
		`${(receiver.constructor && receiver.constructor.name) || 'class'}.${prop} expects ` +
		`${list.map(k => (k && k.name) || String(k)).join(' | ')}, got ` +
		(value === null ? 'null' : typeof value === 'object'
			? Object.prototype.toString.call(value).slice(8, -1) : typeof value));
}
/* doc:C-CASCADE — the class face's TDZ, one message for every way in */
const tdz = (prop, C) => {
	const n = C.name || 'the class';
	throw new ReferenceError(`Cannot access static '${String(prop)}' of ${n} before it settles: a blocking async above it in the class body has not resolved. Write \`await ${n}\` first.`);
};
const unpend = (v, prop, receiver) => {
	if (v === BLANK) return undefined;
	if (v !== PENDING) return v;
	if (typeof receiver === 'function' && prop !== undefined) tdz(prop, receiver);
	return undefined;
};
const POISONED		 = Symbol.for('!!');		// a field whose settlement rejected

const INSTANCE_TYPES = new Set([ 'text/instance', 'application/instance', 'instance', 'text/is', '.is', 'data:text/javascript,']);


/* NO POLYFILL. Symbol.dispose and Symbol.asyncDispose used to be DEFINED here when
 * absent, non-configurably, and that is a lie other code acts on: `if (Symbol.dispose)`
 * is how a library asks whether the runtime supports explicit resource management, and
 * after this ran the answer was yes while `using x = …` was still a SyntaxError.
 * Non-configurable meant nothing downstream could even undo it.
 *
 * Measured in a jsdom realm: undefined before core, symbol after, `using` still
 * unparseable. Note it was never a reliable signal even natively — node 22 HAS
 * Symbol.dispose and still does not parse `using` — so the symbol answers a question
 * about a KEY, not about syntax. All the more reason not to forge the answer.
 *
 * The consumers already handle absence: the two class members below key off
 * `Symbol.dispose ?? Symbol.for('Instance.dispose.shim')`, which the polyfill had
 * turned into dead code, and the §aliasing block guards on `typeof === 'symbol'`.
 * DISPOSE stays the house protocol regardless; the native symbols only ALIAS onto it. */

/* ═══════════════════════════════════════════════════════════════════════════
 * ELEMENT-KEYED WEAK STATE — declared here, MINTED in ONE place: the Symbols
 * static block (§3, the BEHAVIORS loop). That loop is the single site where
 * every WeakMap/WeakSet keyed by an element is born; each store also gets a
 * symbol accessor on Instance (class + prototype) whose body dispatches on
 * typeof this — the house state pattern:
 *
 *     object[SYMBOL]  →  weakly-held store  →  switch (typeof this)
 *       'function' = the class  → class-wide semantics
 *       'object'   = an element → per-instance semantics
 *
 * The bindings below are the HOT-PATH aliases (direct closure reads for the
 * metaclass traps and event plumbing — a symbol accessor per $-read would
 * cost). They are `let` because assignment happens inside the mint loop;
 * nothing touches them before boot completes. Global Maps/Sets that must NOT
 * be GC'd (REGISTRY, APPS, _NAMESPACES, …) are ordinary consts — only
 * element-keyed state routes through the mint.
 *
 *   ARMED            WeakSet   elements whose effect methods are armed
 *   AWAITING         WeakMap   element → pending settle chain (virtual `then`)
 *   CONSTRUCTS       WeakMap   element → construction bookkeeping
 *   EFFECT_NAMES     WeakMap   element → named-effect registry
 *   LC_LISTENERS     WeakMap   element → Map(lifecycleKey → Set<fn>) (fan bodies)
 *   _EV              WeakMap   element → event bookkeeping (on/off tiers)
 *   _SUBS            WeakMap   element → Set<observer> (subscribe/notify)
 *   _NS_CACHE        WeakMap   element → namespace facade (form/input/…)
 *   _NS_CLEAN        WeakMap   element → Set<cleanup> (facade teardown)
 *   LC_MOUNTED / LC_DETACHED / LC_HANDLED_EXIT / LC_HANDLED_ENTER
 *                    WeakSet   Lifecycle phase existence flags
 *   ACTIVE_TR        WeakMap   element → Set<fullKey> — transition dedupe;
 *                              THIS IS the pre-provisioned ACTIVE_TRANSITIONS
 *                              slot (Pass L had duplicated it — folded)
 *   CLAIMED          WeakSet   adopted markup nodes (template-app adoption)
 * ═══════════════════════════════════════════════════════════════════════════ */
let ARMED, AWAITING, CONSTRUCTS, EFFECT_NAMES,
	LC_LISTENERS, _EV, _SUBS, _NS_CACHE, _NS_CLEAN,
	LC_MOUNTED, LC_DETACHED, LC_HANDLED_EXIT, LC_HANDLED_ENTER,
	ACTIVE_TR, CLAIMED;

/* ── feature state & data (hoisted — nothing below the Lifecycle install declares top-level state) ── */
/* ══ §10a PLATFORM — EXTENSION SEAM ══════════════════════════════════════════
 * The platform-gap vocabulary — <router>/<route>/<outlet> plus the eleven tags the
 * platform never shipped — lives in modules/i_platform-1.0.js. It DEFINES ELEMENT
 * CLASSES, which is why it read as unmovable: the record said the vocabulary must
 * be present when the document is read. What must be present then is the fourteen
 * NAMES in CORE_TAGS, which stay here; the CLASSES only have to reach CUSTOM_TAGS
 * before the boot ring fires at DOMContentLoaded. Measured in tools/boot-probe.js.
 *
 * `let _ROUTER` used to hold the class, assigned from inside §10. A `let` cannot be
 * assigned across a module boundary, so the slot becomes a LOOKUP — which is
 * strictly better: it is the shape §8a already uses, and it behaves identically in
 * both builds instead of needing a monolith path and a split path.
 *
 * I18N stays a STUB by ruling. Absent PLATFORM, `applyIntl` is simply missing and
 * <intl> degrades to inert text; EXTMAP's ['I18N'] slot is still open for the real
 * one. */
const _plat = () => {
	const B = global[Symbol.for('Instance')];
	return (typeof B === 'function' && B.provides && B.provides('platform')) || null;
};
const _router = () => { const P = _plat(); return (P && P.Router) || null; };
let COLLECTION_STATIC; // string-verb map for the Meta readStatic fallback — derived at the Collection class site (§7)
const _RT = {
	config: { base: '', history: 'push', scroll: true },
	tables: new Map(), guards: [], listeners: { navigate: new Set(), error: new Set() },
	current: { path: '/', query: {}, hash: '', params: {} },
	path: null, wired: false
};
const _DEBUG = { session: null, armed: new Set(), hold: 0 };  // [0.89.3-dbg] debug session · classes armed to be born paused
const SETTLE_CTL = new WeakMap();  // element -> manual settlement controller
const SETTLE_NODE = new WeakMap(); // [0.89.d] element -> Chimera settlement node (the graph drives it)
const PRIVATE_CELLS = new WeakMap(); // [0.89.d v2] element -> Map(symbol -> cell): reactive #fields, outside the string keyspace

/* ═══ [0.89.d] THE MANIFEST — what a class EXPOSES to third-party interop ═══════
 * Everything is virtualized (the store owns every bare write); `static manifest`
 * is the list of names a class chooses to EXPORT as prototype accessors, so
 * outsiders get `in`, `for..in`, get and set by the platform's own idioms —
 * exactly how `title` and `id` work on a native element (accessor on the
 * prototype; own keys stay []; `delete` vacuously true; frozen elements still
 * accept accessor writes — all three measured against real DOM behaviour).
 * `static manifest = false` (or none) exposes NOTHING: a sealed component.
 * The list is read as an OWN static, never inherited — a subclass exposes only
 * what it declares, while its parent's accessors still serve inherited names.
 * Names that would shadow a PLATFORM property are refused with a warning: a
 * silently severed attribute reflection is the `prefix` lesson.
 * The accessors MUST MIRROR the Meta trap lanes (tracking context, DERIVED
 * pairs, unpend) — they intercept the same reads one prototype earlier, so any
 * divergence is a semantics fork. */
/* ═══ [0.89.d v2] BARE KEYS ARE OWN ACCESSORS ═══════════════════════════════════
 * The first [[Set]] of a bare string key IS its declaration — and now it also
 * installs an own accessor pair on the element (shared function objects, one
 * pair per NAME across the realm). From then on reads and writes hit the
 * accessor directly and never reach the Meta trap: the trap is a one-time
 * declaration path, not a permanent tollbooth.
 * Semantics: `in` is per-element STATE (what this element actually declared),
 * `delete` removes the accessor natively, and a bare field ENUMERATES, exactly
 * as a native class field does — a custom element with `count = 0` shows it in
 * Object.keys and JSON, so this does too. Anything that should stay internal
 * says so: a descriptor keyword (ply, let, get, const), a sigil (virtual) or a
 * #private (invisible).
 * [0.89.o] Until here, an element HID its bare fields. That was a 50-50 call,
 * made because hiding was otherwise inexpressible; the descriptor keywords made
 * it unnecessary, and with bare hidden no keyword could give an element an
 * ordinary enumerable, configurable, writable field at all. The manifest is RETIRED —
 * with state semantics there is nothing left for a per-class list to govern.
 * Freeze parity is native: setters run on frozen elements (freeze guards data
 * properties), new keys refuse (defineProperty throws on a frozen receiver).
 * The getter/setter bodies MUST MIRROR the Meta trap lanes (dict/deref fast
 * lane, tracking context, DERIVED pairs, unpend) — proven under the manifest
 * era, reused verbatim. */
const INTRINSIC_CLASS_KEYS = new Set(['prototype','name','length','constructor','fields','transitions','shadow','manifest']);
/* SEAL IS NOT FREEZE, and once bare keys are accessors the platform cannot tell
 * you which happened: `Object.isFrozen` asks whether every own property is
 * non-configurable and every DATA property non-writable — an accessor has no
 * writability, so an all-accessor object reports FROZEN when merely SEALED.
 * Carry the missing dimension: one non-enumerable, symbol-keyed, WRITABLE data
 * property per reactive host. */
const FREEZE_PROBE = Symbol('Instance.frozen?');
function markFreezable(host) {
	try { if (!Object.getOwnPropertyDescriptor(host, FREEZE_PROBE))
		defineProperty(host, FREEZE_PROBE, { value: 0, writable: true, enumerable: false, configurable: true }); }
	catch (e) {}
}
function isReallyFrozen(host) {
	if (Reflect.isExtensible(host)) return false;              // O(1) gate: frozen is never extensible
	const p = Object.getOwnPropertyDescriptor(host, FREEZE_PROBE);
	return p ? !p.writable : Object.isFrozen(host);
}
const BARE_CACHE = [new Map(), new Map(), new Map(), new Map()]; // name -> shared descriptor, one map per (enumerable, configurable)
/* ENUMERABILITY COMES FROM THE ROW (see DESCRIPTORS and BARE_ROW). A bare field
 * is enumerable on both faces, like native `a = 1` and `static a = 1`; only a
 * raw row with `e: null` still defers to the face. */
function bareDescriptor(name, enumerable, configurable, host) {
	/* doc:C-CACHED */
	/* A DECLARED FIELD IS STRUCTURALLY PERMANENT: `configurable: false`, so the
	 * accessor cannot be replaced and `delete` fails. Runtime enforcement is not
	 * a toy — if it says const, it means const. The cache is keyed by name AND
	 * by (enumerable, configurable), so every combination is safe to share. */
	/* doc:C-ADOPT */
	/* A CLASS'S ACCESSOR IS ITS OWN. An element's accessors are shared through the
	 * cache: its fields are its own, and the accessor reads the element it runs on.
	 * A static is INHERITED, accessor and all, so its getter runs with `this` a
	 * subclass as often as the class that holds it, and the value is the holder's.
	 * So a class's accessor is made for it and closes over it: the accessor a
	 * lookup finds names the class that owns the property, and nothing climbs.
	 * (Measured in Node: a climb asking each class `Object.hasOwn(C, name)` on every
	 * static read pays 16 ns a class, a call V8 does not inline — an inherited read
	 * cost 240 ns that way, 179 this way.) One descriptor per static per class:
	 * classes are few, elements many. */
	const owner = typeof host === 'function' ? host : undefined;
	const _cache = owner === undefined ? BARE_CACHE[(enumerable ? 2 : 0) + (configurable ? 1 : 0)] : undefined;
	let d = _cache && _cache.get(name);
	if (d) return d;
	/* [0.89.i] THE STORE MAY BE ON AN ANCESTOR. Statics are inherited, and this
	 * accessor is inherited with them — but it read `storeOf(this)`, and `this`
	 * is the SUBCLASS, which has no store of its own. So `A.foo` gave 1 while
	 * `AB.foo` gave undefined, where native gives 1 for both.
	 * The fix climbed only from a subclass WITHOUT a store: one that had written any
	 * other static answered from its own store, which does not hold the key, so
	 * `AB.bar = 2` made `AB.foo` read undefined again. The rule is native's: the
	 * class that OWNS the property owns the value. Every class holding a static has
	 * its own accessor for it (installed at its first touch, its shadow, or its
	 * lift), and that accessor closes over its class (above), so the accessor a
	 * lookup found names the store, whoever `this` is — no climb, no probe of any
	 * store's contents, and so no key minted in a store that lacks it. An element's
	 * accessor reads the element it runs on: its fields are its own, and nothing
	 * inherits them. */
	const getter = function () {
		const ss = storeOf(owner !== undefined ? owner : this);
		if (!ss) return undefined;
		const _dr = DERIVED.get(this);
		if (_dr && _dr.has(name)) return unpend(_dr.get(name).get.call(this), name, this);
		const _dict = dictOf(ss);
		const _ref = _dict ? _dict.get(name) : null;
		const _h = _ref != null ? Signal.deref(_ref) : null;
		if (_h && typeof _h.get === 'function') {
			const __ao = Signal.activeOwner ? Signal.activeOwner() : undefined;
			return unpend((__ao !== undefined && __ao !== ss) ? _h.peek() : _h.get(), name, this);
		}
		return undefined;
	};
	d = {
		get: getter,
		set(value) {
			/* doc:C-SHADOW */
			/* A SUBCLASS WRITING AN INHERITED STATIC. The parent's own accessor caught
			 * the write before it could reach the trap, so it used to define a PLAIN
			 * property on the subclass: `B.x = 2` over A's `static const x` gave B a
			 * writable copy with no row. JavaScript's rule, by row: a writable or
			 * pliable property shadows (the subclass gets its own, under its own row,
			 * which climbs when it declared none); a locked constant refuses, unless
			 * the row is `set`, the per-class constant. The shadow is installed the
			 * way the trap installs a first touch: a store, the own accessor, the
			 * write through it. The test is OWNERSHIP, not the store: a subclass that
			 * already wrote another static has a store and still no `name` of its own.
			 * The accessor answers it — it is its class's own, so a class running it
			 * that is not that class inherited it. */
			if (typeof this === 'function' && this !== owner) {
				const row = fieldFlags(this, name) || BARE_ROW;
				if (!row.w && !row.c && !row.s)
					throw new TypeError('Assignment to constant field \'' + name + '\': one value for the hierarchy. Declare it `set` for one per class.');
				if (!storeOf(this)) adoptClass(this);
				{ const _s = SEALED.get(this); if (_s) _s.delete(name); }
				if (value === PENDING) seedKey(this, name);
				else defineProperty(this, name, bareDescriptor(name, row.e != null ? row.e : true, row.c != null ? row.c : true, this));
				this[name] = value;
				return;
			}
			/* doc:C-CACHED */
			/* A `const` FIELD SEALS ON ITS SETTLING WRITE. The seal is a BIT the setter
			 * consults, never a descriptor change: the accessor stays
			 * `configurable: false` with both lanes from definition to forever, so a
			 * const field is never briefly reconfigurable. The message echoes
			 * JavaScript's own — assigning a const is a TypeError there too. */
			const _sealed = SEALED.get(this);
			if (_sealed && _sealed.has(name))
				throw new TypeError('Assignment to constant field \'' + name + '\'.');
			/* the bare accessor is installed on first touch and every later write comes
			 * HERE, not through the set trap — so the interface guard must run at both
			 * sites or a bare typed field is checked once and never again (measured). */
			ifaceGuard(this, name, value);
			/* the SEED writes PENDING through this same setter, so sealing on the first
			 * write would seal the sentinel and reject the real value. A settlement
			 * sentinel never seals. */
			/* doc:C-BLANK */
			/* Nor does BLANK, which a declaration with no initialiser writes: the
			 * field exists, reads undefined, and its one write is still to come. */
			if (value !== PENDING && value !== POISONED && value !== BLANK && isConstField(this, name)) {
				if (!SEALED.has(this)) SEALED.set(this, new Set());
				SEALED.get(this).add(name);          /* move this behind a success test to seal-on-success */
			}
			/* doc:C-CASCADE — the first real write DEFINES a seeded key */
			if (value !== PENDING && value !== POISONED && isSeeded(this, name)) defineKey(this, name);
			const ss = storeOf(this);
			if (!ss) { Object.defineProperty(this, name, { value, writable: true, enumerable: true, configurable: true }); return; }
			/* FREEZE MEANS FROZEN, asked of THIS PROPERTY. An accessor's setter runs
		 * even on a frozen object, so a declared field would ignore a freeze that a
		 * data property honours. A DECLARED field is already non-configurable, so
		 * that alone proves nothing — the probe is what says whether the host was
		 * FROZEN or merely SEALED. Throws, not no-ops: the compiler's writes
		 * sit in class bodies, which are always strict. INTRINSICS never reach here
		 * — they route to the platform accessor — so `Object.freeze(div);
		 * div.title = 't'` keeps working, as the platform does. */
		const _own = Object.getOwnPropertyDescriptor(this, name);
		if (_own && !_own.configurable && isReallyFrozen(this))
			throw new TypeError("Cannot assign to read only property '" + name + "': the object is frozen");
		const _dr = DERIVED.get(this);
			if (_dr && _dr.has(name)) {
				const dd = _dr.get(name);
				if (dd.node) { dd.node.set(value); return; }
				if (dd.set) { dd.set.call(this, value); return; }
				throw new TypeError(`Cannot write derived field "${name}"`);
			}
			/* doc:C-UNTRACKED */
			/* the row may carry an AXIS. A fresh cell is tuned once, at its mint. */
			const _dw = dictOf(ss);
			const fresh = !(_dw && _dw.has(name));
			sWrite(ss, name, value);
			if (fresh) tuneCell(this, ss, name);
		},
		enumerable: !!enumerable, configurable: !!configurable
	};
	if (_cache) _cache.set(name, d);
	return d;
}
const _ENGINE = { on: false, treeBase: null, hp: null, ctors: new Map(), pairs: [] }; // pairs: [tagProto, Meta, apply(on)] — apply is the engine-mode chain splice (Pass Q6)
const _TAG_IFACES = new Map(); // IFACE_NAME → synthesized interface ctor — every tag gets its OWN prototype, never a shared one (Pass Q6)
const _IFACES = []; // every metaclass's method-layer iface — late merges (jQuery) retro-graft here (Pass Q7)

/* ── §DOM EVENTS (Pass Q8) — events are the PULSE face of signals ──────────────
 * new MouseDown({…}) mints a REAL native event and FIRES it (creation is
 * occurrence; dispatch is synchronous, so the returned event carries the outcome
 * — .defaultPrevented is readable). Bare MouseDown({…}) is the inert factory.
 * String-first-arg (new InputEvent('input', …)) is the native signature —
 * pure passthrough for foreign code. el.on(MouseDown, fn) subscribes through ONE
 * shared native listener per (target, type) — the PUMP — feeding a kernel pulse:
 * a primitive-seq store node (monotonic ⇒ dedup can never bite) delivered through
 * arm-swallowed effects (⇒ no replay) behind a run-queue drain (⇒ handlers are
 * ATOMIC; self/cross re-entrant fires deliver in order — pulseprobe 8/8,
 * domevents-isolation 28/28). Subscriptions on ELEMENTS register in a drain set
 * emptied by both dispose sweeps — events die with their element. */
const EVT_TYPE = Symbol.for('Instance.event.type');
const _EVT_PUMPS = new WeakMap(); // target → Map(type → { st, seq, last, q, running, count, unlisten })
const _EVT_SUBS  = new WeakMap(); // element → Set(disposer) — drained at dispose
const _EVT_IFACE = t =>
	/^mouse|^click$|^dblclick$|^contextmenu$/.test(t) ? 'MouseEvent'
	: /^key/.test(t) ? 'KeyboardEvent' : /^pointer/.test(t) ? 'PointerEvent'
	: /^touch/.test(t) ? 'TouchEvent'  : /^focus/.test(t) ? 'FocusEvent'
	: /^drag|^drop$/.test(t) ? 'DragEvent'
	: /^transition/.test(t) ? 'TransitionEvent' : /^animation/.test(t) ? 'AnimationEvent'
	: t === 'wheel' ? 'WheelEvent' : t === 'input' ? 'InputEvent' : t === 'submit' ? 'SubmitEvent'
	: t === 'storage' ? 'StorageEvent' : t === 'hashchange' ? 'HashChangeEvent'
	: t === 'popstate' ? 'PopStateEvent' : 'Event';

function _evtPump(target, type) {
	let m = _EVT_PUMPS.get(target);
	if (!m) _EVT_PUMPS.set(target, m = new Map());
	let p = m.get(type);
	if (!p) {
		const st = new Signal.Store();
		st.write('$seq', 0);
		p = { st, seq: 0, last: null, q: [], running: false, count: 0, unlisten: null, subs: new Set() };
		/* TWO delivery planes, deliberately (the consensus lesson):
		 *  · the SIGNAL face — every fire writes the $seq kernel node, so effects/
		 *    computeds can subscribe to the pulse like any signal (combinators live);
		 *  · the HANDLER face — fns deliver through the atomic run-queue Set,
		 *    UNTRACKED by construction: a handler reading $state must not become a
		 *    consensus dependency of its own event (it would fire every OTHER pulse). */
		const pump = ev => {
			p.q.push(ev);
			if (p.running) return;
			p.running = true;
			try {
				let guard = 0;
				while (p.q.length) {
					if (++guard > 4096) throw new Error('[Instance.Events] cascade overflow (>4096 nested fires)');
					p.last = p.q.shift();
					p.st.write('$seq', ++p.seq);                      // signal face first
					for (const fn of [...p.subs]) { try { fn.call(target, p.last, target); } catch (err) { setTimeout(() => { throw err; }, 0); } } // handler face: atomic, untracked, one bad handler can't kill the drain
				}
			} finally { p.running = false; }
		};
		target.addEventListener(type, pump);
		p.unlisten = () => target.removeEventListener(type, pump);
		m.set(type, p);
	}
	return p;
}
function _evtSubscribe(target, type, fn) {
	const p = _evtPump(target, type);
	p.count++;
	p.subs.add(fn); // handler face: no kernel effect ⇒ no tracking ⇒ consensus can never bite a handler
	let dead = false;
	const disposer = () => {
		if (dead) return; dead = true;
		p.subs.delete(fn);
		if (--p.count === 0) { try { p.unlisten(); } catch (e) {} const m = _EVT_PUMPS.get(target); if (m) m.delete(type); }
		const set = _EVT_SUBS.get(target); if (set) set.delete(disposer);
	};
	if (target && target.nodeType === 1) { // element targets ride the teardown spine
		let set = _EVT_SUBS.get(target);
		if (!set) _EVT_SUBS.set(target, set = new Set());
		set.add(disposer);
	}
	return disposer;
}
/* ── event HANDLES + combinators (Pass Q8b — author-spec: "Events are Signals") ──
 * Bare-call MouseDown(init) returns the inert native event DECORATED into a handle:
 * the init doubles as a subscription CONFIG (own-key equality filter), and the
 * combinator verbs derive new handles — map (transform + occurrence index),
 * combine (latest-pair, fires on either), sleep (per-occurrence delay),
 * chain (sequence: this-then-that). Handles subscribe via el.on(handle, cb) or
 * handle.on(el, cb); derivations are target-agnostic recipes bound at subscribe. */
const EVT_HANDLE = Symbol.for('Instance.event.handle');
const _specOf = x => x && x[EVT_HANDLE] ? x[EVT_HANDLE]
	: (typeof x === 'function' && typeof x[EVT_TYPE] === 'string') ? { kind: 'leaf', type: x[EVT_TYPE] }
	: null;
function _hSubscribe(spec, target, cb) {
	switch (spec.kind) {
		case 'leaf': {
			const cfg = spec.config;
			const fn = !cfg ? cb : (e, t) => { for (const k in cfg) { if (k === 'target' || k === 'bubbles' || k === 'cancelable' || k === 'composed') continue; if (e[k] !== cfg[k]) return; } cb(e, t); };
			return _evtSubscribe(target, spec.type, fn);
		}
		case 'map': { let i = 0; return _hSubscribe(spec.src, target, (v, t) => cb(spec.fn(v, i++), t)); }
		case 'sleep': {
			const ids = new Set();
			const off = _hSubscribe(spec.src, target, (v, t) => { const id = setTimeout(() => { ids.delete(id); cb(v, t); }, spec.ms); ids.add(id); });
			return () => { off(); for (const id of ids) clearTimeout(id); ids.clear(); };
		}
		case 'combine': {
			let a, b;
			const off1 = _hSubscribe(spec.src,   target, v => { a = v; cb(spec.fn(a, b), target); });
			const off2 = _hSubscribe(spec.other, target, v => { b = v; cb(spec.fn(a, b), target); });
			return () => { off1(); off2(); };
		}
		case 'chain': {
			let pend = null, has = false;
			const off1 = _hSubscribe(spec.src,   target, v => { pend = v; has = true; });
			const off2 = _hSubscribe(spec.other, target, v => { if (has) { const a = pend; has = false; pend = null; cb(spec.fn ? spec.fn(a, v) : [a, v], target); } });
			return () => { off1(); off2(); };
		}
	}
}
const _HANDLE_VERBS = ø({
	on(target, cb)    { return _hSubscribe(this[EVT_HANDLE], target, cb); },
	map(fn)           { return _mkHandle({ kind: 'map',     src: this[EVT_HANDLE], fn }); },
	combine(other, fn){ const o = _specOf(other); return o ? _mkHandle({ kind: 'combine', src: this[EVT_HANDLE], other: o, fn }) : this; },
	sleep(ms)         { return _mkHandle({ kind: 'sleep',   src: this[EVT_HANDLE], ms }); },
	chain(other, fn)  { const o = _specOf(other); return o ? _mkHandle({ kind: 'chain',   src: this[EVT_HANDLE], other: o, fn }) : this; },
});
function _mkHandle(spec, carrier) {
	const h = carrier || ø({});
	defineProperty(h, EVT_HANDLE, { value: spec, configurable: true });
	for (const k of ['on', 'map', 'combine', 'sleep', 'chain'])
		if (!(k in h) || carrier) defineProperty(h, k, { value: _HANDLE_VERBS[k], writable: true, configurable: true, enumerable: false });
	return h;
}

function _makeEventClass(name, type, CTX) {
	const Iface = CTX[_EVT_IFACE(type)] || CTX.Event;
	const carrier = function () {};
	defineProperty(carrier, 'name', { value: name, configurable: true });
	const mint = (init = {}) => { const { target, ...rest } = init; return new Iface(type, { bubbles: true, cancelable: true, composed: true, ...rest }); };
	return new Proxy(carrier, {
		construct(_, args) {
			if (typeof args[0] === 'string') return Reflect.construct(Iface, args); // native signature: passthrough, INERT
			const init = args[0] || {};
			const tgt = init.target || (JSDOM.EVENTS.scope.has(type) ? CTX : CTX.document);
			const ev = mint(init);
			tgt.dispatchEvent(ev); // creation IS occurrence — converges through the pump
			return ev;             // spent; the outcome is readable
		},
		apply(_, __, args) {
			if (typeof args[0] === 'string') return new Iface(args[0], args[1]);
			const init = args[0] || {};
			return _mkHandle({ kind: 'leaf', type, config: args[0] ? init : null }, mint(init)); // bare call: the inert native, DECORATED into a configured handle
		},
		get(t, prop, r) {
			if (prop === EVT_TYPE || prop === 'type') return type;
			if (prop === EVT_HANDLE) return { kind: 'leaf', type };
			if (prop === 'map' || prop === 'combine' || prop === 'sleep' || prop === 'chain')
				return _HANDLE_VERBS[prop].bind({ [EVT_HANDLE]: { kind: 'leaf', type } }); // class-level derivation — the unconfigured handle
			if (prop === Symbol.hasInstance) return ev => !!ev && ev.type === type && ev instanceof Iface;
			if (prop === 'on') return (target, fn) => _evtSubscribe(target, type, fn);
			return Reflect.get(t, prop, r);
		}
	});
}
const _SUPER  = { on: false, obs: null }; // ⚡⚡ super mode: declarative custom-element upgrades (requires engine mode)
const _NAMESPACES = new Map();
let _I18N = null;
let _fxSeq = 0;
// reportError when available (surfaces as a global `error` event, then returns normally — never throws to its
// caller); pre-2022 fallback rethrows on a fresh task so it still reaches window.onerror.
const _surface = (typeof globalThis !== 'undefined' && typeof globalThis.reportError === 'function') ? (err => globalThis.reportError(err)) : (err => setTimeout(() => { throw err; }, 0));
let _inOn = false;   // suppresses the ':addition' interceptor for our own on() registrations
const MINTED = new WeakMap(); // element → the class it was constructed as (new.target at mint) — the identity the registry and the this-chain answer with; el.constructor is unreliable for plain tag Metas (it resolves native)
const _MINTED_GLOBALS = new Set(); // every global the typeset definer created — the exact unmint list (Pass Q4)
let _ADOPT = null; // active adoption scope: `new Klass()` claims matching pre-populated markup here
let _UPGRADE = null; // one-shot in-place upgrade target — Instance.upgrade(node) parks the live node here; _adoptClaim consumes it before any scope query
const APPS = new Map(); // name → class — strong by design (app registry)
const CUSTOM_TAGS = new Map(); // tag → Instance-extender class — the declarative-upgrade index (auto-fed at rebase; Instance.define(Klass) feeds it explicitly)
const CORE_TAGS = new Set(['async','sync','static','email','tel','website','mailto','logout','reset','portal','intl','router','route','outlet']); // built-in vocabulary — upgraded UNCONDITIONALLY at boot; user tags ride ⚡⚡ super mode
const _ARRAY_MUTATORS = new Set(['push','pop','shift','unshift','splice','sort','reverse','fill','copyWithin']);
const _ARRAY_VERBS = new Map(Object.getOwnPropertyNames(Array.prototype)
	.filter(n => typeof Array.prototype[n] === 'function' && n !== 'constructor' && !_ARRAY_MUTATORS.has(n))
	.map(n => [n, function (...a) { return Array.prototype[n].apply(_liveList(this), a); }])); // derived once from Array.prototype; _liveList is a hoisted declaration, so top placement is safe
/* [0.89.c] the BUILT_INS transition presets moved to modules/i_transitions-1.0.js —
 * they are transition DATA, and the machinery that reads them left core. The
 * accessor below now reads through the extension seam so the public surface is
 * unchanged whether or not the extension is loaded. */

const {
	is, values, getOwnPropertyNames,
	getOwnPropertyDescriptor,
	getPrototypeOf, setPrototypeOf,
	defineProperty, defineProperties,
	defineProperty: def,
	keys: objKeys, create: $create,
	hasOwn, keys, entries, getOwnPropertyDescriptor: $ownDesc
} = Object;


/**
* @description Mimics a C-style `#ifndef` check at runtime.
*  Inspects an object and its prototype chain for a property collision. Avoids triggering getters.
*  If the property is missing, `can_define` is executed; otherwise, `can_not_define` is called.
*  NOTE: If an error occurs (e.g., prototype depth limit reached), the error 
*  is logged to the console and the function defaults to `can_not_define`.
* @param {Object} object - The target object to inspect.
* @param {string|symbol} property - The property name or key to check for.
* @param {Function} [can_define = function(){}] - Callback if the property is unique.
* @param {Function} [can_not_define = function(){}] - Callback if the property exists.
* @param {number} [MAX_DEPTH=50] - The maximum depth to search the prototype chain.
* @returns {*} The result of the executed callback.
*/
function ifndef(
	object, property, can_define = function(){}, can_not_define = function(){}, MAX_DEPTH = 50
) {
	try {
		var collision;
		let proto = object;
		let depth = 0;
		while (proto !== null) {
			if (++depth > MAX_DEPTH) throw new RangeError(`Max prototype depth of ${MAX_DEPTH} exceeded.`);
			if (Reflect.getOwnPropertyDescriptor(proto, property)) {
				collision = true;
				break;
			}
			proto = Reflect.getPrototypeOf(proto);
		}
	} catch (e) {
		if (e instanceof RangeError) console.warn('Performance / Security warning: ', e.message);
		else console.warn('Unexpected Error during ifndef check:', e);
		collision = true;
	} finally {
		return (!collision ? can_define : can_not_define).call(object, property, object);
	}
}

function createElement(tag, context) { // TDZ not a problem, createElement isn't run until after
	if (context === 'svg') tag = CAMEL_SVG[tag.toLowerCase()] || tag;
	else tag = tag.toLowerCase();
	if (!context || context === 'html') return doc.createElement(tag);
	return doc.createElementNS(XMLNS[context] || XMLNS.html, tag);
}


const doc = typeof document !== 'undefined' ? document : null;

function type(value) { return ({}).toString.call(value).slice(8, -1).toLowerCase(); }
const hasKey = (key, object) => hasOwn(object, key);

/**!
 * @class Interface
 * @license MIT
 * @description: Declarative class-splicing, and the splice itself ──
 * Subclass it and declare members exactly how they should land: statics → the target function,
	methods → target.prototype, descriptors mirrored 1:1 (static method → non-enumerable, static
	field → enumerable, getter → getter). The destination is the constructor arg, or a
	`static [Interface] = Fn` declaration on the subclass. `new Interface(...)` is the one public
	entry; the copy is the private #copy. The source decides the shape: a *class* installs its two
	surfaces (statics + prototype); a plain *object* grafts that object's own members straight onto
	the target — which is how a prototype is decorated onto a live instance.

	`[Interface]` works as a literal computed key via Symbol.toPrimitive: coercing the *base* class
	for a string property key yields a private symbol (the real key), so subclasses never learn the
	raw symbol — they just write `[Interface]`. Any other coercion (a subclass, or a non-string
	hint) returns the default, so `${SomeSubclass}` never throws. (`${Interface}` directly would,
	but that never happens in practice.)
*/
class Interface {

	static #DIRECTIVE = { 'static=>static': true, 'proto=>proto': true }; // bare-target default: mirror both surfaces 1:1
	static #SOURCE		= (() => { /* the default target, as a TDZ-safe thunk */ })();
	static #SYM			= Symbol('Interface');
	static #SKIP 		= new Set(['length', 'name', 'prototype']);
	static #SKIP_PROTO	= new Set(['constructor']);
	static #VERSION		= 0xffac;

	static #copyTo(to, from, skip) {
		for (const k of Reflect.ownKeys(from)) {
			if (!skip.has(k)) Object.defineProperty(to, k, Object.getOwnPropertyDescriptor(from, k));
		}
	}

	static #splice({ target, source, dir = Interface.#DIRECTIVE }) {

		if (!source) throw new TypeError('source must allow properties');
		if (typeof source === 'object') return this.#copyTo(target, source, this.#SKIP_PROTO); // plain object → graft onto target
		if (dir['static=>static']) this.#copyTo(target, source, this.#SKIP);
		if (dir['proto=>static'])  this.#copyTo(target, source.prototype, this.#SKIP_PROTO);
		if (dir['static=>proto'])  this.#copyTo(target.prototype, source, this.#SKIP);
		if (dir['proto=>proto'])   this.#copyTo(target.prototype, source.prototype, this.#SKIP_PROTO);

	}

	static [Symbol.toPrimitive](hint) {
		if (this === Interface) {
			if (hint === 'string') return this.#SYM; // marker symbol
			if (hint === 'number') return this.#VERSION; // version tag
			if (hint === 'default') return this.#SOURCE; // read the registered thunk (optional accessor)
		}
		return Function.prototype.toString.call(this);
	}

	constructor(first, second) {
		if (first === null) return this; // explicit no-splice — super(null): hand back the new.target instance, splice nothing
		const newt = new.target;
		const direct = newt === Interface;

		// setup form — new Interface(() => Target, null): register the default target thunk
		if (direct && typeof first === 'function' && second == null) {
			Interface.#SOURCE = first;
			return Interface;
		}

		// config-object form — { target, 'proto=>proto', 'proto=>static', … }: a directive-driven
		// splice. A bare target keeps the default directives, so existing callers (and a plain-object
		// graft target) are untouched.
		let directives = Interface.#DIRECTIVE;
		let targetArg = first;

		if (first && typeof first === 'object' && 'target' in first) {
			targetArg = first.target; directives = first;
		}

		// default semantics: resolve a target, splice the source(s) onto it
		const target = targetArg ?? (direct ? null : newt[Interface.#SYM]) ?? Interface.#SOURCE?.();
		const sources = direct ? [second] : [];

		if (target == null) throw new Error('[Interface]: no declared or implicit splice target.');
		if (!direct) for (let C = newt; C && C !== Interface; C = Object.getPrototypeOf(C)) sources.push(C);

		for (let n = sources.length; n--; ) {
			const source = sources[n];
			if (source == null || (typeof source !== 'function' && typeof source !== 'object')) {
				throw new Error('[Interface]: no source to splice');
			}
			Interface.#splice({ target, source, dir: directives });
		}
		return target;
	}
}

// --- ES6-DOM Hybrid Interface Table ------------------------------------

class JSDOM extends Interface {

	
	static #W3 = 'https://www.w3.org/';

	static #_ = (
		s, x, t = (x
			? 'sloppy|strict|literals|constants|cursed|nodejs' 
			: 'stable|baseline|experimental|deprecated|legacy|obsolete'
		).split('|'),
		o = {}
	) => (s
		.matchAll(/(\d):\[([^\]]*)\]\s*/g)
		.forEach(([,i,b]) => o[t[i]] = b ? b.split('|') : []),
		o.all = Object.values(o).flat().sort(), o
	);
	static #__ = s => s.split('|').reduce((a, v) => { a[v.toLowerCase()] = v; return a; }, {});
	static #___ = s => new Set(s.split('|'));

	/* ══ EVENT VOCABULARY ═══════════════════════════════════════════════════════
	 * One table with sub-domains, like ELEMENTS and DICTIONS. It was three separate
	 * statics — EVENTS/EVENTCASE/EVENTSCOPE — three things to find instead of one,
	 * and none of them used the helpers this class already has for exactly their
	 * shapes: #__ turns 'DblClick|…' into { dblclick: 'DblClick', … } and #___ turns
	 * a pipe run into a Set. Both literals were hand-maintained versions of those.
	 *
	 *   grammar  prefix → alternatives; initEvents() expands it into the class names
	 *   case     lowercase → Pascal, for the tags capitalise-the-first gets wrong
	 *   scope    events that fire on window rather than on an element
	 *   all      every expanded type, sorted — DERIVED, so it cannot drift
	 * ══════════════════════════════════════════════════════════════════════════ */
	static #EVTG = ø({
		'': ('click|dblclick|scroll|storage|hashchange|visibilitychange|beforeunload|' +
		     'unload|fullscreenchange|fullscreenerror|copy|cut|paste|contextmenu|input|' +
		     'submit|reset|select|wheel|resize|popstate|drop|abort|change|load'),
		focus: '|in|out', key: 'down|up|press',
		mouse: 'down|up|move|over|out|enter|leave',
		pointer: 'down|up|move|over|out|enter|leave|cancel',
		touch: 'start|end|move|cancel', drag: '|start|end|enter|leave|over',
		transition: 'start|end|cancel', animation: 'start|end|iteration' });
	static EVENTS = ø({
		grammar: this.#EVTG,
		case:    this.#__('DblClick|ContextMenu|HashChange|VisibilityChange|BeforeUnload|FullscreenChange|FullscreenError|PopState'),
		scope:   this.#___('storage|hashchange|popstate|beforeunload|unload|resize|load'),
		all:     Object.entries(this.#EVTG)
			.flatMap(([pre, alts]) => alts.split('|').map(x => pre + x)).filter(Boolean).sort()
	});

	static ISBADDIE = /^(?:Audio|Error|Image|Map|Math|Object|Option)$/; // 🌹 
	static XMLNSW3C = ø({ math: this.#W3 + '1998/Math/MathML', html: this.#W3 + '1999/xhtml', svg: this.#W3 + '2000/svg' });
	static SUPPORTS = ø({ html: 99.97, svg: 99.84, math: 91.57, '@': '16/3/26' });
	static ELEMENTS = ø({
	  core: this.#_(
		'0:[a|abbr|acronym|address|area|article|aside|audio|b|base|bdi|bdo|blockquote|' +
		'body|br|button|canvas|caption|cite|code|col|colgroup|data|datalist|dd|del|' +
		'details|dfn|dialog|div|dl|dt|em|embed|fieldset|figcaption|figure|footer|' +
		'form|head|header|hgroup|h1|h2|h3|h4|h5|h6|hr|html|i|iframe|img|input|ins|' +
		'kbd|label|legend|li|link|main|map|mark|menu|meta|meter|nav|noscript|' +
		'object|ol|optgroup|option|output|p|picture|pre|progress|q|rp|rt|ruby|s|' +
		'samp|script|section|select|slot|small|source|span|strong|style|sub|' +
		'summary|sup|svg|table|tbody|td|template|textarea|tfoot|th|thead|time|' +
		'title|tr|track|u|ul|var|video|wbr] 1:[search] 2:[fencedframe|geolocation|' +
		'selectedcontent] 3:[basefont|big|center|dir|font|nobr|rb|rtc|strike|tt]' +
		'4:[listing|marquee|noembed|noframes|plaintext|xmp] 5:[applet|blink|frame|' +
		'frameset|isindex|keygen|menuitem|multicol|nextid|param|spacer]'
	  ),
	  math: this.#_(
		'1:[annotation|annotation-xml|math|merror|mfrac|mi|mmultiscripts|mn|mo|mover|' +
		'mpadded|mphantom|mprescripts|mroot|mrow|ms|mspace|msqrt|mstyle|msub|msubsup|msup|' +
		'mtable|mtd|mtext|mtr|munder|munderover|none|semantics] 3:[maction|mfenced] 5:[menclose]'
	  ),
	  svg:  this.#_(
		'0:[a|animate|animateMotion|animateTransform|circle|clipPath|defs|desc|ellipse|' +
		'feBlend|feColorMatrix|feComponentTransfer|feComposite|feConvolveMatrix|' +
		'feDiffuseLighting|feDisplacementMap|feDistantLight|feDropShadow|feFlood|' +
		'feFuncA|feFuncB|feFuncG|feFuncR|feGaussianBlur|feImage|feMerge|feMergeNode|' +
		'feMorphology|feOffset|fePointLight|feSpecularLighting|feSpotLight|feTile|' +
		'feTurbulence|filter|foreignObject|g|image|line|linearGradient|marker|mask|' +
		'metadata|mpath|path|pattern|polygon|polyline|radialGradient|rect|set|stop|' +
		'style|svg|switch|symbol|text|textPath|title|tspan|use|view]'
	  )
	});

	static KEYWORDS = this.#_(
		'0:[break|case|catch|class|const|continue|debugger|default|delete|do|' +
		'else|export|extends|finally|for|function|if|import|in|instanceof|' +
		'new|return|super|switch|this|throw|try|typeof|var|void|while|with|yield]' +
		'1:[arguments|enum|eval|implements|interface|let|package|private|protected|' +
		'public|static] 2:[false|null|true] 3:[undefined|NaN|Infinity] 4:[async|await|' +
		'defer|get|set] 5:[__dirname|__filename|exports|global|module|process|require]', 1 // 1: x is true
	);

	static DICTIONS = ø({
		Pascalite: this.#__(
			'BDI|HTML|TBody|BDO|IFrame|TD|BR|KBD|TFoot|DD|LI|TH|DFN|OL|THead|DL|RB|' +
			'TR|DT|RP|TT|RT|UL|HGroup|RTC|WBR|SVG|XMP|HR'
		),
		Pascal: this.#__(
			'BaseFont|KeyGen|BlockQuote|MenuItem|ColGroup|NoFrames|DataList|NoScript|FencedFrame|OptGroup|' +
			'FieldSet|SelectedContent|FigCaption|TBody|FrameSet|TextArea|HGroup|TFoot|IFrame|THead'
		)
	});

	static TYPESETS = this.#___('initial|jquery|pascal|pascalite|uppercase|none');
	static ACRONYMS = this.#___('LI|UL|OL|DL|DT|DD|TD|TH|TR|TT|HR|BR|BDI|BDO|DFN|KBD|SVG|WBR|XMP|HTML|RB|RP|RT|RTC');
	
	static SYMBOLS = new Set([
		'UID', 'MOUNTED', 'ELEMENTS','METADATA', 'PROTO', 'SHADOW_ROOT', 'PENDING_ARGS',
		'SCOPED_STYLES_INJECTED', 'DESTROYING', 'PATCHED_EVENTS', 'FORM_STATE', 'MOUNT',
		'UNMOUNT', 'CONTEXT', 'PROXIES', 'REACTIVE_PROXY', 'REACTIVE_CHAIN', 'WORKER_PROXY', 
		'SOCKET_PROXY', 'LISTEN_PROXY', 'LAST_PARENT', 'LAST_SIBLING', 'PLACEMENT', 'LEAF'
	]);

	static LAZY_SYMBOLS = new Set([ // WeakMap getOrInsertComputed => new Map() || new Set()
		'OBSERVERS', 'LIFECYCLE', 'ACTIVE_TRANSITIONS', 'META_TRANSITION_HANDLERS',
		'ELEMENT_NS_STORE', 'INBOUND_HANDLERS', 'DELEGATES','NAMED_LISTENERS'
	]);

	static WELL_KNOWN_SYMBOLS = new Set([
		'asyncDispose', 'asyncIterator', 'dispose', 'hasInstance', 
		'isConcatSpreadable', 'iterator', 'match', 'matchAll', 
		'replace', 'search', 'species', 'split', 'toPrimitive', 
		'toStringTag', 'unscopables'
	]);

}


	/**
	 * Internal Symbol Configuration
	 * Mapping Symbol Keys to their Property Descriptor Factories
	 */

	const BEHAVIORS = ø({
		// 1. THE BITMASK (Ultra-fast boolean flags)
		STATUS: (store) => ø({
			get() { return store.get(this) ?? 0; },
			set(v) { store.set(this, v); }
		}),

		// 2. THE WEAKSET (Existence-based state)
		MOUNTED: (store) => ø({
			get() { return store.has(this); },
			set(v) { v ? store.add(this) : store.delete(this); }
		}),

		// 3. THE ATOMIC MERGE (Metadata lookups)
		CONTEXT: (store) => ø({
			get() {
				return store.getOrInsertComputed(this, () => ({ insertion: null, removal: null }));
			},
			set(v) {
				const current = store.getOrInsertComputed(this, () => ({ insertion: null, removal: null }));
				store.set(this, { ...current, ...v });
			}
		}),

		// 4. THE LOW LEVEL PROXIES (WebSocket, PostMessage, WebWorker)
		PROXIES: (store) => ø({
			value(type, factory) {
				const registry = store.getOrInsertComputed(this, () => new Map());
				if (type === DISPOSE) { // the drain command (Pass Q4): dispose calls this — terminate workers, close sockets, unlisten
					for (const v of registry.values()) { try { v && v.remove && v.remove(); } catch (e) {} }
					registry.clear();
					return;
				}
				return factory
					? registry.getOrInsertComputed(type, () => factory.call(this))
					: registry.get(type);
			},
			writable: false, configurable: true, enumerable: false
		}),

		MOUNT: (store) => ø({
			value(Klass) {
				switch (typeof this) {
					case 'object': {
						this[METADATA] = {
							constructor: Klass,
							native: Klass.native ?? null
						};
						this[ELEMENTS] = [this];

						// ── Shadow DOM ────────────────────────────────
						const shadowConfig = parseShadowStatic(Klass.shadow);
						if (shadowConfig) {
							const root = this.attachShadow({ mode: shadowConfig.mode });
							this[SHADOW_ROOT] = root;
							_injectShadowAssets(this, root, Klass);
							if (Klass.template) {
								const tmpl = document.createElement('template');
								tmpl.innerHTML = Klass.template;
								root.appendChild(tmpl.content.cloneNode(true));
							}
							if (keys(shadowConfig.parts).length)
								_applyParts(root, shadowConfig.parts);
						}

						// ── Inbound events ────────────────────────────
						const events = parseEventsStatic(Klass);
						if (keys(events).length) {
							wireInboundEvents(this, events);
							if (shadowConfig)
								def(this, 'trigger', {
									value: makeShadowTrigger(this, events),
									configurable: true,
									enumerable: false,
									writable: true
								});
						}

						return shadowConfig;
					}
					case 'function': {
						return;
					}
				}
			},
			writable: false, configurable: true, enumerable: false
		}),

		UNMOUNT: (store) => ø({
			value(ctx) {
				switch (typeof this) {
					case 'object': {
						const handlers = this[INBOUND_HANDLERS];
						if (handlers) {
							handlers.forEach((handler, name) => this.removeEventListener(name, handler));
							handlers.clear();
						}
						let Ctor = this[METADATA]?.constructor;
						while (Ctor && Ctor !== Function.prototype) {
							if (typeof Ctor === 'function' && owns(ELEMENTS, Ctor)) {
								const reg = Ctor[ELEMENTS];
								const idx = reg.indexOf(this);
								if (idx !== -1) reg.splice(idx, 1);
							}
							Ctor = getPrototypeOf(Ctor);
						}
						const effects = this[EFFECTS];

						effects?.forEach(d => d());
						effects?.clear();
						return;
					}
				}
			}
		})
	});


	/* Symbols: the element's entire symbol-keyed surface in ONE install — the compiler hooks
	 *  (INSTANCE family, EFFECTS), the minted off-element state accessors (the unrolled loop over
	 *  JSDOM.SYMBOLS / LAZY_SYMBOLS, WeakMap/WeakSet-backed), and the JS well-known surface. Every
	 *  well-known body dispatches on typeof this (function = the class, object = the element), so one
	 *  definition serves both faces — spliced proto=>proto + proto=>static. Replaces the former
	 *  Construct + WellKnownSymbols + Symlink trio. */

	class Symbols extends JSDOM {

		static {

			const ISSET = /^(?:ACTIVE_TRANSITIONS)$/;
			const { SYMBOLS, LAZY_SYMBOLS } = this;

			for (const key of [...SYMBOLS, ...LAZY_SYMBOLS]) {

				const Ctor = ISSET.test(key) ? Set : Map;

				const sym = (this[key] = Symbol(`Instance:${key.toLowerCase().replace(/_/g, '.')}`));

				/* THE MINT — the one place an element-keyed weak store is born.
				 * MOUNTED is existence-based (WeakSet); everything else keys a value. */
				const store = key === 'MOUNTED' ? new WeakSet() : new WeakMap();
				if (key === 'ACTIVE_TRANSITIONS') ACTIVE_TR = store; // hot alias — transition dedupe reads it directly

				const logic = ((preset, lazy) => preset || (lazy
					? store => ø({
						get()  { return store.getOrInsertComputed(this, () => new Ctor()) },
						set(v) { return v } // gaslight setter
					}) 
					: store => ø({
						get()  { return store.get(this) ?? null },
						set(v) { store.set(this, v) }
					})
				))(BEHAVIORS[key], LAZY_SYMBOLS.has(key))(store);

				const desc = ø({ configurable: true, enumerable: false });

				if ('value' in logic) {
					desc.value = logic.value;
					desc.writable = logic.writable ?? false;
				} else {
					desc.get = logic.get;
					desc.set = logic.set;
				}

				Object.defineProperty(this, sym, desc);
				Object.defineProperty(this.prototype, sym, desc);
			}

			/* ── the pass-state tables (D through N) — SAME mint, SAME accessor pattern.
			 * Each entry: [aliasAssign, symbolName, kind]. kind drives both the store
			 * ctor and the accessor preset:
			 *   'exists'  → WeakSet; accessor get = membership, set true/false = add/delete
			 *   'lazyMap' → WeakMap; accessor get = getOrInsert new Map (per-element table)
			 *   'lazySet' → WeakMap; accessor get = getOrInsert new Set
			 *   'plain'   → WeakMap; accessor get/set = raw value
			 * The alias functions assign the module-level hot-path bindings declared at
			 * the top of the file — see the ELEMENT-KEYED WEAK STATE banner. */
			for (const [assign, name, kind] of [
				[s => ARMED = s,            'ARMED',             'exists' ],
				[s => AWAITING = s,         'AWAITING',          'plain'  ],
				[s => CONSTRUCTS = s,       'CONSTRUCTS',        'plain'  ],
				[s => EFFECT_NAMES = s,     'EFFECT_NAMES',      'plain'  ],
				[s => LC_LISTENERS = s,     'LC_LISTENERS',      'lazyMap'],
				[s => _EV = s,              'EV',                'lazyMap'],
				[s => _SUBS = s,            'SUBS',              'lazySet'],
				[s => _NS_CACHE = s,        'NS_CACHE',          'plain'  ],
				[s => _NS_CLEAN = s,        'NS_CLEAN',          'lazySet'],
				[s => LC_MOUNTED = s,       'LC_MOUNTED',        'exists' ],
				[s => LC_DETACHED = s,      'LC_DETACHED',       'exists' ],
				[s => LC_HANDLED_EXIT = s,  'LC_HANDLED_EXIT',   'exists' ],
				[s => LC_HANDLED_ENTER = s, 'LC_HANDLED_ENTER',  'exists' ],
				[s => CLAIMED = s,          'CLAIMED',           'exists' ]
			]) {
				const store = kind === 'exists' ? new WeakSet() : new WeakMap();
				assign(store);
				const sym = (this[name] = Symbol(`Instance:${name.toLowerCase().replace(/_/g, '.')}`));
				const logic =
					kind === 'exists'  ? ø({ get() { return store.has(this); }, set(v) { v ? store.add(this) : store.delete(this); } })
					: kind === 'lazyMap' ? ø({ get() { return store.getOrInsertComputed(this, () => new Map()); }, set(v) { return v; } })
					: kind === 'lazySet' ? ø({ get() { return store.getOrInsertComputed(this, () => new Set()); }, set(v) { return v; } })
					:                      ø({ get() { return store.get(this) ?? null; }, set(v) { store.set(this, v); } });
				const desc = ø({ configurable: true, enumerable: false, get: logic.get, set: logic.set });
				Object.defineProperty(this, sym, desc);
				Object.defineProperty(this.prototype, sym, desc);
			}
		}

		/* [0.89.j] MONOMORPHIC PROTOCOL — one shape, both faces:
		 *     this[Symbol.new](function* () { … })
		 * The receiver carries the face (element here, class on the static twin);
		 * nothing else is passed. Level identity left the protocol: arming happens
		 * unconditionally per hook (WeakSet-guarded), poison scoping keys on the
		 * generator itself, and debug surfaces read the leaf off the element. */
		[INSTANCE](gen) {
			return instanceHook(this, gen);
		}

		/* ── per-element settlement control (see instanceHook) ───────────────────── */
		/* [0.89.5] Park at the next value the settlement is genuinely WAITING on —
		 * stepping over breakpoints and over the super-join, which are suspensions of the
		 * machinery rather than of the author's code. Returns false when the body ran to
		 * completion instead. */
		/* Construct with settlement held — deterministic, synchronous, per construction.
		 *     const row = Instance.held(() => new Row());
		 *     const all = Instance.held(() => data.map(d => new Row(d)));
		 * The elements are born with their sync fields populated and ?? where their async
		 * values will land; nothing settles until you drive or resume them. */
		static held(fn) {
			_DEBUG.hold++;
			try { return fn(); } finally { _DEBUG.hold--; }
		}
		static pause()  { _DEBUG.armed.add(this); return this; }   // arm: instances are born held
		static unpause(){ _DEBUG.armed.delete(this); return this; }

		/* Mid-flight pause: lands at the NEXT suspension point. Note this is advisory —
		 * an element that has already settled cannot be held. Use Instance.held() when you
		 * need the guarantee rather than the request. */
		pause()  { const c = SETTLE_CTL.get(this); if (c && !c.done) { c.paused = true; return this; } return this; }
		get settled() { const c = SETTLE_CTL.get(this); return !c || c.done; }
		/* [0.89.j] ITERABLE faces — INSTALLED, semantics UNSETTLED (ruling: install
		 * both faces always; what they yield is not final). v1: both faces walk the
		 * element's settled OWN entries as [key, value] pairs — the async face is a
		 * wrapper over the same snapshot, NOT yet a settlement stream. Do not pin
		 * ordering or streaming behavior on this. */
		/* doc:C-TLY */
		/* `class*` installs both faces and routes them here. The SYNC face walks the
		 * settled entries; the ASYNC face is the SETTLEMENT STREAM — the values a
		 * `yield` in the body emitted, in source order, as the body runs. A consumer
		 * that iterates late still sees them: emissions buffer until drained. */
		[Symbol.for('Instance.iterate')](face) {
			if (face === 'async') return this[Symbol.for('Instance.stream')]();
			const self = this;
			return (function* () {
				const ss = storeOf(self);
				const src = ss ? sRawOf(ss) : self;
				for (const k of Object.keys(src || {})) yield [k, self[k]];
			})();
		}

		/* doc:C-TLY */
		/* THE SETTLEMENT STREAM. `yield v` in a class body pushes v here as the body
		 * runs; `for await (const s of el)` drains it. Emission is a plain call, not
		 * a generator yield — it must not suspend, and the pump's protocol is left
		 * alone. Values buffer until a consumer arrives, so nothing is lost by
		 * iterating late; the stream ends when settlement does. */
		[Symbol.asyncIterator]() { return this[Symbol.for('Instance.stream')](); }

		async *[Symbol.for('Instance.stream')]() {
			const q = emitQueue(this);
			/* The stream ends when SETTLEMENT does. The element is thenable while it
			 * settles, so its own resolution is the close signal — no need to find
			 * every completion site in the machinery, and it is correct for a
			 * rejection too. */
			if (!q.closing) {
				q.closing = true;
				Promise.resolve(this).then(() => closeEmits(this), () => closeEmits(this));
			}
			for (;;) {
				if (q.buf.length) { yield q.buf.shift(); continue; }
				if (q.done) return;
				const r = await new Promise(res => q.waiters.push(res));
				if (r.done) return;
				yield r.value;
			}
		}
		static *[Symbol.for('Instance.iterate')]() { /* class face: UNSETTLED — yields nothing yet */ }

		get settling() { const c = SETTLE_CTL.get(this); return !!c && !c.done; }
		get paused()   { const c = SETTLE_CTL.get(this); return !!c && c.paused && !c.done; }
		get at()       { const c = SETTLE_CTL.get(this); return c ? c.at : null; }

		/* CHAINABLE. `next(v)` advances to the settlement's next genuine await and injects
		 * v as its value — the pending promise is never consulted. Breakpoints and the
		 * super-join are stepped over, so `m.pause().next(a).next(b)` feeds the author's
		 * awaits in declaration order. Use step() for the raw iterator protocol. */
		next(inject) {
			const c = SETTLE_CTL.get(this);
			if (!c || c.done) return this;
			c.paused = true;
			if (!_toAwait(c)) return this;               // ran to completion
			c.parked = false; c.pending = null; c.send = inject;
			_toAwait(c);                                  // park at the following await
			return this;
		}
		/* raw single step, iterator protocol — breakpoints included (the debugger's form) */
		step(inject) {
			const c = SETTLE_CTL.get(this);
			if (!c || c.done) return { done: true, value: undefined };
			c.paused = true; c.seq++;
			const send = c.first ? c.superInput : inject;
			c.first = false; c.parked = false;
			let r;
			try { r = c.it.next(send); }
			catch (e) { c.done = true; if (c.wake) c.wake(); closeEmits(this); throw e; }
			if (r.done) { c.done = true; if (c.wake) c.wake(); closeEmits(this); }
			else c.at = null;   /* doc:T-STRINGYIELD — a string is a value, never a position */
			return r;
		}
		throw(err) {
			const c = SETTLE_CTL.get(this);
			if (!c || c.done) throw err;
			c.paused = true; c.seq++;
			if (!c.parked) _toAwait(c);
			c.parked = false; c.first = false;
			let r;
			try { r = c.it.throw(err); }                  // raised AT the suspension
			catch (e) {
				/* the body did not catch it: the settlement FAILED. Hand the error to the
				 * chain so ?? cells poison and `await new` rejects, exactly as a real
				 * rejection would. */
				c.done = false; c.err = e; c.paused = false;
				if (c.wake) { const w = c.wake; c.wake = null; w(); }
				throw e;
			}
			if (r.done) { c.done = true; if (c.wake) c.wake(); closeEmits(this); }
			return this;
		}
		return(value) {
			const c = SETTLE_CTL.get(this);
			if (!c || c.done) return this;
			c.seq++;
			c.it.return(value);                           // `finally` runs here
			c.done = true; c.parked = false; if (c.wake) c.wake();
			return this;
		}
		resume() {
			const c = SETTLE_CTL.get(this);
			if (!c) return Promise.resolve(this);
			c.paused = false;                       // `parked` stays: the driver consumes it
			if (c.wake) { const w = c.wake; c.wake = null; w(); }
			return (c.settled || Promise.resolve()).then(() => this, () => this);
		}

		[EFFECTS]() { return effectDescriptors(this); } // descriptor provider — see armEffects (§effects)
	}



	/*  
	*  WellKnownSymbols: the JS well-known protocol surface, layered onto Symbols (extends it).
	*  Inherits the off-element mint + the compiler hooks; adds toStringTag / iterator / toPrimitive /
	*  hasInstance + the string-protocol stubs (split/search/replace/match/matchAll — kept as
	*  stubs by design; the empty species/dispose/asyncDispose/asyncIterator/unscopables
	*  stubs were pruned in Pass O: nothing consumed them, and class-level species is pinned
	*  on Instance itself). Installing this leaf walks WellKnownSymbols -> Symbols -> JSDOM,
	*  splicing the whole stack onto Instance.
	*/
	class WellKnownSymbols extends Symbols {

		get [Symbol.toStringTag]() {
			switch (typeof this) {
				case 'function': { return (this.id ?? 'Anonymous') + ' Class'; }
				case 'object': {
					const md = this[METADATA];
					return md
						? (md.constructor?.id ?? md.constructor?.name ?? this.tagName?.toLowerCase() ?? '')
						: (this.tagName?.toLowerCase() ?? '');
				}
			}
		}


		[Symbol.isConcatSpreadable]() {
			return true;
		}

		/* ── the disposal protocol (Pass Q4) — house analog of Symbol.dispose / Symbol.asyncDispose,
		 * living where the well-knowns live. One body, every face, dispatched on `typeof this`:
		 *   element[DISPOSE]()        → dispose the element (detach + reclaim; proxies drain in the sweep)
		 *   Class[DISPOSE]()          → the static face wins via the relay (registry self-destruct, then the
		 *                                class's own node) — this
		 *                                prototype branch is the safety net if a class ever reaches it
		 * Symbol.dispose / Symbol.asyncDispose alias onto these below, so `using el = new Div()` works. */
		[DISPOSE](unmint) {
			return typeof this === 'function' ? Instance[DISPOSE].call(this, unmint) : this.remove(true);
		}
		[ASYNC_DISPOSE](unmint) {
			return typeof this === 'function' ? Instance[ASYNC_DISPOSE].call(this, unmint) : Instance.disposeAsync(this);
		}
		[Symbol.dispose ?? Symbol.for('Instance.dispose.shim')]() { return this[DISPOSE](); }             // `using el = …` works where the platform has it
		[Symbol.asyncDispose ?? Symbol.for('Instance.asyncDispose.shim')]() { return this[ASYNC_DISPOSE](); } // `await using el = …`
		
		[Symbol.toPrimitive](hint) {
			switch (typeof this) {
				case 'object': {
					if (hint === 'string') {
						const md = this[METADATA];
						return md
							? (md.constructor?.id ?? md.constructor?.name ?? this.tagName?.toLowerCase() ?? '')
							: (this.tagName?.toLowerCase() ?? '');
					}
					if (hint === 'number') {
						const col = this[ELEMENTS];
						return col ? col.indexOf(this) : 0;
					}
					return this;
				}
				case 'function': {
					if (hint === 'string') return this.id ?? this.name ?? 'anonymous';
					if (hint === 'number') return this[ELEMENTS]?.length ?? 0;
					return this;
				}
			}
		}

		[Symbol.hasInstance](value) {
			return Function.prototype[Symbol.hasInstance].call(this, value);
		}

		/* ── the string protocol (Pass Q8b·search) — `query.search(el)` dispatches to
		 *    el[Symbol.search](query): the ELEMENT is the pattern, the query is the haystack.
		 *    Receiver-split by typeof this — a CLASS searches its live [ELEMENTS] collection
		 *    and returns a REGISTRY INDEX (pairs with Class[n]); an ELEMENT searches its own
		 *    text. The search engine is these five bodies. ── */
		/* ── the string protocol (Pass Q8b·search) — INTENTIONALLY Instance-semantic ──
		 *  `query.method(receiver)` → receiver[Symbol.method](query): the receiver is the
		 *  PATTERN, the query is the haystack. We diverge from RegExp on purpose because
		 *  the collection behavior is too useful to give up: query a class as if it were a
		 *  regex and it answers with its LIVING INSTANCES. Receiver nature splits meaning:
		 *    ELEMENT (text container) → the query tests THIS element's text
		 *    CLASS   (live collection) → the query tests EVERY instance in [ELEMENTS]
		 *  The five verbs, as collection operations:
		 *    search=predicate(Number) · match=filter(Collection) · matchAll=walker(lazy)
		 *    replace=mutator(writes DOM text) · split=partitioner([hits,misses])
		 *  All PURE except replace (the verb IS mutation). No hidden highlighting. */
		get flags() { return 'gi'; }                 // matchAll reads .flags before dispatch — must exist
		get global() { return true; }

		[Symbol.search](query) { // PREDICATE — engine locks return to Number; we make the Number meaningful
			const q = String(query == null ? '' : query).toLowerCase();
			if (typeof this === 'function') { // CLASS → registry index of the first matching instance (round-trips: Class[n])
				const reg = this[ELEMENTS]; if (!reg) return -1;
				for (let i = 0; i < reg.length; i++) { let t = ''; try { t = (reg[i].textContent || '').toLowerCase(); } catch (e) {} if (q && t.indexOf(q) !== -1) return i; }
				return -1;
			}
			let h = ''; try { h = (this.textContent || '').toLowerCase(); } catch (e) {} // ELEMENT → char offset of query in this text
			return q ? h.indexOf(q) : -1;
		}

		[Symbol.match](query) { // FILTER — the matching ELEMENTS (a live Collection), not text
			const q = String(query == null ? '' : query).toLowerCase();
			if (typeof this === 'function') { // CLASS → a Collection of matching instances (indexable, .where-able, live)
				const reg = this[ELEMENTS] || []; const out = [];
				for (let i = 0; i < reg.length; i++) { let t = ''; try { t = (reg[i].textContent || '').toLowerCase(); } catch (e) {} if (q && t.indexOf(q) !== -1) out.push(reg[i]); }
				return Instance.from ? Instance.from(out) : out;
			}
			let h = ''; try { h = (this.textContent || '').toLowerCase(); } catch (e) {} // ELEMENT → this element if it matches (a self-test), else null
			return (q && h.indexOf(q) !== -1) ? this : null;
		}

		*[Symbol.matchAll](query) { // WALKER — lazy; yields per match with detail
			const q = String(query == null ? '' : query).toLowerCase();
			if (typeof this === 'function') { // CLASS → each matching {element, index} (element + its registry slot)
				const reg = this[ELEMENTS] || [];
				for (let i = 0; i < reg.length; i++) { let t = ''; try { t = (reg[i].textContent || '').toLowerCase(); } catch (e) {} if (q && t.indexOf(q) !== -1) yield { element: reg[i], index: i, input: query }; }
				return;
			}
			if (!q) return; // ELEMENT → each {text, index} occurrence in this element's content
			let text = ''; try { text = this.textContent || ''; } catch (e) {} const h = text.toLowerCase();
			let from = 0, at; while ((at = h.indexOf(q, from)) !== -1) { yield { text: text.slice(at, at + q.length), index: at, input: text }; from = at + q.length; }
		}

		[Symbol.replace](query, replacement) { // MUTATOR — the one verb that writes: swaps matched TEXT in the live DOM
			const q = String(query == null ? '' : query);
			const ql = q.toLowerCase();
			const swap = (el) => { // replace matched text within one element's textContent
				let text = ''; try { text = el.textContent || ''; } catch (e) { return; }
				if (!q) return;
				const low = text.toLowerCase(); let res = '', from = 0, at;
				while ((at = low.indexOf(ql, from)) !== -1) { const seg = text.slice(at, at + q.length); res += text.slice(from, at) + (typeof replacement === 'function' ? replacement(seg, el) : String(replacement)); from = at + q.length; }
				if (from > 0) { try { el.textContent = res + text.slice(from); } catch (e) {} }
			};
			if (typeof this === 'function') { // CLASS → mutate every matching instance; return the Collection (chainable)
				const reg = this[ELEMENTS] || []; const hit = [];
				for (let i = 0; i < reg.length; i++) { let t = ''; try { t = (reg[i].textContent || '').toLowerCase(); } catch (e) {} if (ql && t.indexOf(ql) !== -1) { hit.push(reg[i]); swap(reg[i]); } }
				return Instance.from ? Instance.from(hit) : hit;
			}
			swap(this); return this; // ELEMENT → mutate this element's text; return the element (chainable)
		}

		[Symbol.split](query) { // PARTITIONER — two buckets
			const q = String(query == null ? '' : query).toLowerCase();
			if (typeof this === 'function') { // CLASS → [matching, nonmatching] instances
				const reg = this[ELEMENTS] || []; const hit = [], miss = [];
				for (let i = 0; i < reg.length; i++) { let t = ''; try { t = (reg[i].textContent || '').toLowerCase(); } catch (e) {} (q && t.indexOf(q) !== -1 ? hit : miss).push(reg[i]); }
				return Instance.from ? [Instance.from(hit), Instance.from(miss)] : [hit, miss];
			}
			let text = ''; try { text = this.textContent || ''; } catch (e) {} if (!q) return [text]; // ELEMENT → [before, after] around the FIRST match
			const low = text.toLowerCase(); const at = low.indexOf(q);
			return at === -1 ? [text] : [text.slice(0, at), text.slice(at + q.length)];
		}


		*[Symbol.iterator]() {
			const all = this[ELEMENTS];
			if (all) for (let i = 0; i < all.length; ) yield all[i++];
		}


	}

	// Symbol getters / setters (EFFECTS is the const hook above; REACTIVE_STORE stays Chimera's)
	const {
		UID, METADATA,
		REACTIVE_CHAIN,
		MOUNTED, ELEMENTS,
		OBSERVERS, PATCHED_EVENTS,
		REACTIVE_PROXY, LIFECYCLE,
		PROTO, SHADOW_ROOT,
		PENDING_ARGS, SCOPED_STYLES_INJECTED,
		WORKER_PROXY, SOCKET_PROXY, LISTEN_PROXY,
		FORM_STATE, PROXIES, // the callable-interface store binding (Pass Q4 — the '-> PROXIES' note, honored)
		LAST_PARENT, LAST_SIBLING,
		PLACEMENT, DESTROYING,
		ACTIVE_TRANSITIONS,
		META_TRANSITION_HANDLERS,
		ELEMENT_NS_STORE,
		INBOUND_HANDLERS,
		DELEGATES,
		MOUNT, UNMOUNT,
		NAMED_LISTENERS,
		LEAF // per-element leaf class — now a minted loop slot (was hand-wired off-element)
	} = Symbols;

	/*
	* §4 — script self-parser (reads autoclass / typeset / engine off <script>)
	*/
	class AttributeParser extends JSDOM {

		constructor(el, defaults) {
			super(null);
			return !el || !defaults ? this : this.parse(el, defaults);
		}

		static #SHORTHANDS = {
			core:		   'core.stable',
			stable:		   'core.stable',
			baseline:	   'core.baseline',
			experimental:  'core.experimental',
			deprecated:	   'core.deprecated',
			legacy:		   'core.legacy',
			obsolete:	   'core.obsolete'
		};

		static normalizeAttribute(attribute, element) {
			if (!(element && element.getAttribute) || typeof attribute !== 'string') return [];
			const dataKey = attribute.startsWith('data-') ? attribute : 'data-' + attribute;
			const bareKey = attribute.startsWith('data-') ? attribute.slice(5) : attribute;
			const read = k => (element.getAttribute(k) ?? '').normalize('NFC').toLowerCase();
			const split = raw => raw.split(/[\s,|]+/).map(token => token.trim()).filter(Boolean);
			return [...new Set([...split(read(dataKey)), ...split(read(bareKey))])];
		}

		static autoclass(script) {

			const ELEMENTS = this.ELEMENTS;
			const SHORTHANDS = this.#SHORTHANDS;
			const result = { core: [], math: [], svg: [] };
			const known = {
				core: new Set(ELEMENTS.core.all), 
				math: new Set(ELEMENTS.math.all), 
				svg:  new Set(ELEMENTS.svg.all)
			};

			const expand = (ns, bucket) => ELEMENTS[ns][bucket] || [];

			for (const token of this.normalizeAttribute('autoclass', script)) {
				if (token.includes('.')) {

					const dot = token.indexOf('.');
					const ns = token.slice(0, dot);
					const bucket = token.slice(dot + 1);

					if (!hasKey(ns, result)) continue;

					result[ns].push(
					...(hasKey(bucket, ELEMENTS[ns])
							? expand(ns, bucket) : known[ns].has(bucket)
								? [bucket] : []
						)
					);

					continue;
				}
				if (hasKey(token, SHORTHANDS)) {
					const [ns, bucket] = SHORTHANDS[token].split('.');
					result[ns].push(...expand(ns, bucket));
					continue;
				}
				if (known.core.has(token)) {
					result.core.push(token);
					continue;
				}
			}
			keys(result).forEach(ns => (result[ns] = [...new Set(result[ns])].sort()));

			if (!keys(result).some(ns => result[ns].length)) {
				result.core = expand('core', 'stable').slice();
			}

			return {
				core: new Set(result.core), math: new Set(result.math), svg: new Set(result.svg)
			};
		}

		sanitize(el, key, allowed) {
			const attr = (el?.getAttribute('data-' + key) ?? el?.getAttribute(key) ?? '')
				.normalize('NFC').toLowerCase().trim();
			const result = attr ? [...new Set(attr.split(/\s*,\s*/).filter(Boolean))] : [];
			return Array.isArray(allowed) ? result.filter(s => allowed.includes(s)) : result;
		}

		static types(script) {
			return Array.from(script?.attributes ?? []).flatMap(({ name, value }) => {
				const ln = name.toLowerCase();
				const base = ln.startsWith('data-')
					? ln.slice(5)
					: ln.startsWith('@')
						? ln.slice(1)
						: ln;
				const isTypeset = base === 'typeset';
				if (!isTypeset && !this.TYPESETS.has(base)) return [];
				return [isTypeset ? value : value ? base + '=' + value : base];
			}).join(', ');
		}

		static typeset(input, whitelist = this.TYPESETS) {
			const raw =
				typeof input === 'string'
					? input
					: input && input.attributes
						? this.types(input)
						: '';
			const seen = new Set();
			const list = whitelist && new Set(whitelist);
			const array = raw.split(',').flatMap(segment => {
				let [key, ...rest] = segment.split('=').map(s => s.trim().normalize('NFC'));
				if (!key) return [];
				key = key.toLowerCase();
				const value = rest.join('=') || null;
				const id = key + '|' + value;
				return (!list || list.has(key)) && !seen.has(id)
					? (seen.add(id), { key, value }) : [];
			});
			return array.length ? array : [{ key: 'pascalite', value: null }];
		}

		parse(el, defaults) {
			const settings = {};
			for (const [key, value] of entries(defaults)) {
				switch (type(value)) {
					case 'function': {
						if (!value.length) settings[key] = this.constructor[key].call(this.constructor, el);
						else settings[key] = value.call(el, el);
						break;
					}
					case 'object': {
						let [primary, alternatives] = entries(value)[0];
						let result = this.sanitize(el, key, [primary, ...alternatives]);
						settings[key] = result.length ? result : [primary];
						break;
					}
					case 'boolean': {
						settings[key] = value;
						break;
					}
					default: {
						settings[key] = value === !!value
							? !!(el?.hasAttribute('data-' + key) || el?.hasAttribute(key))
							: value;
					}
				}
			}
			settings.attributes = el?.attributes;
			settings.defaults = defaults;
			settings.script = [el];
			return Object.freeze(settings);
		}

		static engine(element) {
			return !!(
				element &&
				(element.hasAttribute('⚡') ||
					element.hasAttribute('data-engine') ||
					element.hasAttribute('engine'))
			);
		}

		static super(element) {
			// ⚡⚡ boot — mirrors engine(); the #initialize schema dispatches `super: () => {}`
			// here by name (parse → this.constructor['super']). Without this static the boot
			// crashes the instant document.currentScript is a real <script src> (i.e. any real
			// browser); Node/jsdom-injected scripts have a null currentScript and never reach it.
			return !!(
				element &&
				(element.hasAttribute('⚡⚡') ||
					element.hasAttribute('data-super') ||
					element.hasAttribute('super'))
			);
		}
	}

	/* ════════════════════════════════════════════════════════════════════════
	* §5 — Lexeme: identity-preserving naming transforms (tag → ClassName)
	* ════════════════════════════════════════════════════════════════════════ */

	class Lexeme extends String {

		static #TYPESETS = JSDOM.TYPESETS;
		static #DICTIONS = JSDOM.DICTIONS;

		constructor(text, convention = 'pascalite', id, alreadyTransformed) {
			super(text);
			convention = Lexeme.#TYPESETS.has(convention) ? convention : 'pascalite';
			defineProperty(this, 'id', { value: id ?? text.toUpperCase(), enumerable: true });
			defineProperty(this, 'original', { value: text, enumerable: true });
			defineProperty(this, 'convention', { value: convention, enumerable: true });
			return alreadyTransformed
				? this : convention === 'none'
					? this : this[convention]();
		}

		#lookup(convention, fallback) {
			const dictionary = Lexeme.#DICTIONS?.[convention];
			const key = this.toLowerCase();
			const entry = dictionary && hasOwn(dictionary, key) ? dictionary[key] : void 0;
			return this.#derive(entry ?? String(fallback));
		}
		#derive(value) { return new Lexeme(String(value), this.convention, this.id, true); }

		alias(convention) { return new Lexeme(this.original, convention, this.id); }
		suffixize(regex, str) { return regex.test(this) ? this.#derive(this + str) : this; }
		prefix(str) { return str ? this.#derive(str + this) : this; }
		initial() { return this.length
			? this.#derive(this[0].toUpperCase() + this.slice(1).toLowerCase())
			: this;
		}
		pascalite() { return this.#lookup('Pascalite', this.initial()); }
		uppercase() { return this.#derive(super.toUpperCase()); }
		pascal() { return this.#lookup('Pascal', this.pascalite()); }
		jquery() { return this.#derive('$' + this.initial()); }
		none() { return this; }
	}


	// ── DSL — Selector & Placement Parser ─────────────────────────────────
	//
	//   DSL.parse(string)               → AST
	//   DSL.targets(ast, root?)         → [...domElements]  pure query
	//   DSL.place(ast, element, target) → one element into one target
	//   DSL.route(ast, element, root?)  → convenience, single element
	//   DSL.pipe(string, element, root?)→ parse + route combined
	//
	/* ════════════════════════════════════════════════════════════════════════
	* §6 — DSL: selector & placement parser (inlined; identical to dsl-core.js
	* and the DSL test suite). Wired into the element constructor below: a string
	* arg led by '@' is a placement directive ("@#target", "@before .x",
	* "@first child of #list", …) that routes the element to a target; non-'@'
	* strings keep their existing meaning. Author handle: Instance.DSL.
	* ════════════════════════════════════════════════════════════════════════ */
	
	// TODO: update regex markers to accept unicode.

	const XMLNS = JSDOM.XMLNSW3C;
	/* svg tags whose canonical DOM name is camelCased (createElementNS is case-sensitive) */
	const CAMEL_SVG = JSDOM.ELEMENTS.svg.all.reduce(
		(map, tag) => (/[A-Z]/.test(tag) && (map[tag.toLowerCase()] = tag), map), ø()
	);

	// Kernel field-proxy + accessor math for V17
	// [session ②] Σ/ΣΣ added — the canonical consensus doors existed on kernel handles
	// (GraphNode's triad getters) but never on ELEMENTS, so `el.Σ` was undefined while
	// `el.$` (its own alias) worked. Door sets must agree across the boundary.
	const isAcc = p => typeof p === 'string' && /^(?:\${1,2}|Δ{1,2}|Σ{1,2}|Φ{1,2}|@|ø|ψ)$/.test(p);   // '_' retired
	/* [0.89.2] isRK is DEAD as a policy — under total virtualization EVERY non-intrinsic
	 * string set on an element is a declaration, and reads route by what the STORE holds,
	 * not by spelling. It survives only as 'carries a sigil' (hot vs cold value reads). */
	const isRK  = p => typeof p === 'string' && /^[$ΔΣ@øΦ]/.test(p) && !isAcc(p);
	const HANDLE_LANE = /^(\$\$?|ΣΣ|ΔΔ|ΦΦ|[ΣΔøΦ]|)\./;   // [0.89.o] '_' RETIRED — see below  // [split-lane] the prefix IS the door name; '' and '_' fold to the atomic-consensus door  // '.name' · '$.name' · '$$.name' · 'Σ.name' · 'ΔΔ.name' — the bracket string is the canonical (tier, key) token
	/* [0.89.o] THE '_' DOOR IS RETIRED. It was a FOURTH spelling of the atomic door
 * — '', 'ø' and 'Φ' already reach ss.ø — and it was the one spelling that
 * collides with the most common identifier in JavaScript. A door named '_'
 * means `el._` can never be an ordinary property, for no capability the other
 * three did not already provide. */
/* Φ and ΦΦ are the CANONICAL atomic doors — union and consensus. `$`, `$$`,
 * `ø` and the empty prefix are ALIASES, and resolve to the SAME door object, so
 * `el.Φ === el.$` holds. */
const doorOf = (ss, pfx) => sDoor(ss, (pfx === '' || pfx === 'ø' || pfx === 'Φ') ? '$' : pfx === 'ΦΦ' ? '$$' : pfx);

	/* [0.89.2] PRISTINE intrinsic probe. 'name in element' walks the LIVE chain, which in
	 * engine mode passes through the Meta (a function target) and leaks Function.prototype's
	 * name/length/call — 'name' is a completely plausible field. Resolve against the tag's
	 * pristine prototype pair captured at metaclass mint, lazily, cached per tag. */
	const _PRISTINE = new WeakMap();   // element -> { proto, parent, cache: Map(name -> boolean) }
	function registerPristine(element, tagProto, tagParent) { _PRISTINE.set(element, { proto: tagProto, parent: tagParent, cache: null }); }
	function INTRINSIC(element, name) {
		const p = _PRISTINE.get(element);
		if (!p) return name in element;                       // no metaclass record: live fallback
		let c = p.cache || (p.cache = new Map());
		let hit = c.get(name);
		if (hit === undefined) {
			hit = !!$ownDesc(p.proto, name);
			if (!hit) { let q = p.parent; while (q && !hit) { hit = !!$ownDesc(q, name); q = getPrototypeOf(q); } }
			c.set(name, hit);
		}
		return hit;
	}

	/* [0.89.2] DERIVED registry: element -> Map(declaredName -> record)
	 *   sigiled accessor  { get, set?, handle }  — a live Computed parked in the store dict
	 *   bare get+set pair { get, set, node }     — the MANUAL ATOMIC signal (set notifies) */
	/* [0.89.5] BINDINGS — element → Map(nativeProp → effect). A Signal handle assigned to
	 * a NATIVE property is a subscription, not a value: the effect keeps the DOM property
	 * in sync and the platform does its own coercion (we pass the raw value through, never
	 * String() it — `hidden` wants a boolean, `value` a string, `scrollTop` a number).
	 * Only handles bind. `el.count` is a VALUE, not a handle; `el['.count']` is the handle. */
	const BINDINGS = new WeakMap();
	function bindNative(element, prop, handle, iface) {
		let reg = BINDINGS.get(element);
		if (!reg) BINDINGS.set(element, reg = new Map());
		const prev = reg.get(prop);
		if (prev) { try { prev.dispose(); } catch (e) {} }
		const eff = new Signal.Effect(() => {
			let v; try { v = handle.get(); } catch (e) { return; }
			Reflect.set(iface, prop, v, element);          // raw — the DOM coerces, not us
		});
		reg.set(prop, eff);
		return true;
	}

	const DERIVED = new WeakMap();
	const ACCESSOR_NAMES = new Map();  // leafClass -> scan result (cached, like EFFECT_NAMES)
	const SIGIL_PREFIX_ACC = /^([$Δ]{1,2})(.+)$/;
	function accessorsOf(leafClass) {
		let list = ACCESSOR_NAMES.get(leafClass);
		if (list) return list;
		const protos = [], seen = new Set(['constructor']);
		for (let proto = leafClass.prototype; proto && proto !== Object.prototype; proto = getPrototypeOf(proto)) protos.unshift(proto);
		list = [];
		for (const proto of protos)
			for (const name of Object.getOwnPropertyNames(proto)) {
				if (seen.has(name)) continue;
				const d = $ownDesc(proto, name);
				if (!d || typeof d.get !== 'function') continue;
				seen.add(name);
				const m = SIGIL_PREFIX_ACC.exec(name);
				if (m) list.push({ name, kind: 'computed', canon: (m[1][0] === 'Δ' ? m[1] : m[1].replace(/\$/g, 'Σ')) + m[2], get: d.get, set: d.set || null });
				else if (typeof d.set === 'function') list.push({ name, kind: 'pair', get: d.get, set: d.set });
			}
		ACCESSOR_NAMES.set(leafClass, list);
		return list;
	}
	function armDerived(element) {
		const specs = accessorsOf(element[LEAF]);
		if (!specs.length) return;
		const ss = storeOf(element);
		let reg = DERIVED.get(element);
		if (!reg) DERIVED.set(element, reg = new Map());
		for (const spec of specs) {
			if (reg.has(spec.name)) continue;
			if (spec.kind === 'computed') {
				// runs when read (pull); the body's sigiled reads are HOT, so deps wire themselves
				const handle = new Signal.Computed(() => spec.get.call(element));
				if (ss) dictOf(ss).set(spec.canon, handle.ref);        // the door finds it: $.double
				reg.set(spec.name, { get: spec.get, set: spec.set, handle });
			} else {
				if (INTRINSIC(element, spec.name)) continue;         // platform override via super — not ours
				// MANUAL ATOMIC: reference-only reads, the SETTER is the notification point
				const node = new Signal({ get: () => spec.get.call(element), set: (v) => spec.set.call(element, v) });
				if (ss) dictOf(ss).set(spec.name, node.ref);            // this['.name'] finds the handle
				/* The class accessor sits ABOVE the Meta in the chain, so a plain
				 * `el.name = v` would run the raw setter and notify nobody. Shadow it at
				 * the instance: reads stay the quiet raw getter (reference only); writes
				 * route through the node — user setter runs, THEN the trigger fires. */
				Object.defineProperty(element, spec.name, {
					get: () => spec.get.call(element),
					set: (v) => node.set(v),
					configurable: true, enumerable: false
				});
				reg.set(spec.name, { get: spec.get, set: spec.set, node });
			}
		}
	}

	/* [0.89.2] fieldGet/fieldSet/hasField retired with the manifest — the only callers
	 * were the seeding loop and the list-driven poison walk, both now gone. */

	const SIGIL_SUFFIX = /[A-Za-z0-9_]([$ΔΣ]{1,3})$/; // an effect method: name ends in a sigil run
	const isUnionSigil = sigil => sigil.includes('Δ');

	/* effects: name$() / nameΔ() methods become Chimera effects, armed once at the
		* leaf so the first read already sees the snapshot (consensus lands once, no
		* flash). The trailing sigil picks the gate: $ → consensus, Δ → union. */

	function effectsOf(leafClass) {
		let list = EFFECT_NAMES.get(leafClass);
		if (list) return list;
		const protos = [], seen = new Set(['constructor']);
		for (let proto = leafClass.prototype; 
			proto && proto !== Object.prototype; 
			proto = getPrototypeOf(proto)
		) {
			protos.unshift(proto);
		}
		list = [];
		for (const proto of protos)
			for (const name of Object.getOwnPropertyNames(proto)) {
				if (seen.has(name)) continue;
				const match = SIGIL_SUFFIX.exec(name);
				if (match && typeof proto[name] === 'function') {
					seen.add(name);
					list.push({ name, union: isUnionSigil(match[1]) });
				}
			}
		EFFECT_NAMES.set(leafClass, list);
		return list;
	}

	/* [EFFECTS] hook contract (0.87.6): returns an ORDERED array of descriptors
	 *   { at: 'new' | 'mount' | '@lifecycle' | '<event-name>', fn?, name?, union? }
	 * 'new'          → minted immediately at leaf construction (the historical behavior)
	 * 'mount'/'@…'   → minted when that lifecycle key first fires ('@mount' is once-ever)
	 * anything else  → minted on the FIRST DOM event of that (normalized) type on the element
	 * Body: fn.call(element, element) when fn is given, else element[name]().
	 * Once minted, each is a live Chimera effect (re-runs on dependency change) until dispose.
	 * The default hook maps suffix methods name$/nameΔ to { at:'new', name, union } —
	 * the trailing sigil sets the gate: $ → consensus (AND), Δ → union (OR). Override
	 * [EFFECTS]() to supply a custom list (extend via super[EFFECTS]()). */
	function effectDescriptors(element) {
		return effectsOf(element[LEAF]).map(({ name, union }) => ({ at: 'new', name, union }));
	}

	function mintEffect(element, d, i) {
		const store = storeOf(element);
		const body = typeof d.fn === 'function' ? () => d.fn.call(element, element) : () => element[d.name]();
		const effectNode = new Signal.Effect(body, { union: !!d.union });
		dictOf(store).set(`${d.name ?? d.at + ':' + i}$$effect`, effectNode.ref); // parked under a reserved suffix
	}

	function armEffects(element) {
		if (ARMED.has(element)) return element;
		ARMED.add(element);
		const list = typeof element[EFFECTS] === 'function' ? element[EFFECTS]() : element[EFFECTS];
		if (!Array.isArray(list)) return element;
		list.forEach((d, i) => {
			if (!d || (typeof d.fn !== 'function' && typeof element[d.name] !== 'function')) return;
			const at = d.at ?? 'new';
			if (at === 'new') return mintEffect(element, d, i);
			let done = false;
			const arm = () => { if (done) return; done = true; mintEffect(element, d, i); };
			const lc = at[0] === '@' ? at : (at === 'mount' || at === 'unmount' || at === 'reattach' || at === 'removal' ? '@' + at : null);
			if (lc) _lcAdd(element, lc, arm);
			else element.addEventListener(_normEvent(at), arm, { once: true });
		});
		return element;
	}

	/* ════════════════════════════════════════════════════════════════════════
	* §5 — THE CONSTRUCTION MODEL: the [INSTANCE] hook handler
	*   Runs once per level on the shared element, parent before child. Reads the
	*   parent's settlement off the element, feeds `_super_` per super-mode, settles
	*   its own fields, and republishes the chain for the child and for `await new`.
	* ════════════════════════════════════════════════════════════════════════ */
	/* [0.89.2] VALUE-BASED poisoning: no list — a failed settlement flips every cell
	 * still reading ?? to !!, on the store (elements) or on own props (the static face).
	 * Blast radius is the ELEMENT, deliberately: 'the construction chain is broken' is
	 * what POISONED means; a sibling level's later settle overwrites it (self-healing). */
	const SignalDeref = (ref) => { try { return Signal.deref(ref); } catch (e) { return null; } };
	const PENDING_LEVEL = new WeakMap();   // element -> Map(key -> the Level that seeded it)

	/* [0.89.2] Which cells currently read ??. Cheap: only async classes ever have any.
	 * THE RAW LANE, not peek: PENDING is a stored sentinel, never a computed one, and
	 * peeking a formula computes it. The scan ran at every `new`, so a formula installed
	 * in a compiled constructor ran once at construction while the same formula on a
	 * store stayed lazy until read (measured). raw() reads the lane without a compute. */
	const rawOf = h => (h && typeof h.raw === 'function') ? h.raw() : (h && typeof h.peek === 'function') ? h.peek() : undefined;
	function pendingKeys(ss) {
		const out = new Set();
		for (const [k, ref] of dictOf(ss)) {
			const h = SignalDeref(ref);
			if (!h) continue;
			let v; try { v = rawOf(h); } catch (e) { continue; }
			if (v === PENDING) out.add(k);
		}
		return out;
	}

	/* [0.89.2] Poisoning is VALUE-BASED and PER-LEVEL. No manifest is needed for either:
	 * the values say which cells are pending, and the seed-time diff (instanceHook step 1)
	 * says which level seeded each one. A failing level poisons only what it seeded, so a
	 * sibling level's in-flight fields keep waiting instead of being collaterally killed. */
	function poisonPending(element, Level) {
		const ss = storeOf(element);
		if (ss) {
			const owned = PENDING_LEVEL.get(element);
			for (const [k, ref] of dictOf(ss)) {
				if (Level && owned && owned.has(k) && owned.get(k) !== Level) continue;  // another level's field
				const h = SignalDeref(ref);
				if (!h) continue;
				let v; try { v = rawOf(h); } catch (e) { continue; }
				if (v === PENDING) { try { h.set(POISONED); } catch (e) {} }
			}
			return;
		}
		for (const key of Object.getOwnPropertyNames(element)) {
			try { if (element[key] === PENDING) element[key] = POISONED; } catch (e) {}
		}
	}
	/* [0.89.d] MOVED HERE from the foot of §8 EVENTS, where it was filed and did not
	 * belong. It touches no event machinery — AWAITING, bindThenable, makeChainable are
	 * all core — and all three callers sit in §9 CHAIN: sleep(), init(), async(). It is
	 * settlement plumbing: queue this element's work behind whatever it is already
	 * awaiting, rebind the thenable, hand back a chainable.
	 *
	 * Third time this shape has turned up. _nsFire sat in the namespaces paragraph and
	 * was core's event fan; _httpGET/_looksLikeURL sat in the element vocabulary and were
	 * network utilities. Each was found the same way — the seam analyser flagged an
	 * export, and the export turned out to be something that should never have been in
	 * that region at all. Moving it takes §8 EVENTS to ZERO exports. */
	function _seq(el, work) { const prev = AWAITING.get(el) ?? Promise.resolve(); bindThenable(el, prev.then(() => work).catch(() => {})); return Instance.makeChainable(work.then(() => el)); }

	function bindThenable(element, settleChain) {
		AWAITING.set(element, settleChain); // off-element: the metaclass proxy serves a virtual `then` while awaiting
	}

	function thenFor(element) {
		// virtual `then`; delete BEFORE resolving so `await el` does not re-enter el.then
		return (onFulfilled, onRejected) =>
			AWAITING.get(element)
				.then(
					() => { AWAITING.delete(element); return element; },
					(error) => { AWAITING.delete(element); throw error; }
				)
				.then(onFulfilled, onRejected);
	}


	/* [0.89.5] advance a held settlement to its next genuine await */
	function _toAwait(c) {
		for (;;) {
			if (c.done) return false;
			if (c.parked) return true;
			let r;
			c.seq++;
			try { r = c.it.next(c.first ? c.superInput : c.send); }
			catch (e) { c.done = true; if (c.wake) c.wake(); closeEmits(this); throw e; }
			c.first = false; c.send = undefined;
			if (r.done) { c.done = true; if (c.wake) c.wake(); closeEmits(this); return false; }
			const v = r.value;
			/* doc:T-STRINGYIELD */
			/* A yielded STRING is a value like any other. The per-field name-yields that
			 * once used this channel as position markers are retired — the compiler
			 * refuses to emit them — so a string here is always something a field is
			 * waiting on. Treating it as a marker resumed the generator with undefined:
			 * `const label as 'text'` bound undefined while `as 5` bound 5. */
			if (v === c.superInput) { continue; }        // the super join: machinery, not authored code
			c.parked = true; c.pending = v; c.at = null;
			return true;
		}
	}

	/* [0.89.c] ZERO-ALLOCATION SYNC PATH. `Promise.resolve()` with no argument mints a
	 * FRESH promise every call. Three sites minted one defensively on every construction —
	 * and a fully sync class consumes none of them: the prefix runs to `done`, `runner` is
	 * null, `superInput` is computed and discarded. A bare `new Div()` allocated 0 while a
	 * compiled sync class allocated 4. These are only ever awaited — never resolved with a
	 * value, never compared by identity — so ONE shared resolved promise serves them all. */
	const RESOLVED = Promise.resolve();

	/* [0.89.j] Class.pause() covers the whole chain: any armed class anywhere in
	 * the element's constructor chain holds the settlement. (Under the two-arg
	 * protocol only the exact level matched — a base-class pause silently missed
	 * subclass instances.) */
	const DETACH = Symbol.for('Instance.detach'); // [0.89.j] hoisted: both faces read it

	function armedInChain(element) {
		if (!_DEBUG.armed.size) return false;
		for (let C = element.constructor; typeof C === 'function'; C = Object.getPrototypeOf(C))
			if (_DEBUG.armed.has(C)) return true;
		return false;
	}

	function instanceHook(element, gen) {
		/* [0.89.d v2] CLASS-FIELD MIGRATION SWEEP. A hand-written class field lands
		 * via DefineOwnProperty as an own DATA property — bypassing the store, so it
		 * would be silently non-reactive (the Lit trap, unfixable from a base class;
		 * fixable HERE because each level's hook runs after that level's fields).
		 * Lift every own configurable string-keyed data property: delete the shadow,
		 * re-[[Set]] — bare names route to the own-accessor path, sigiled names to
		 * their tier lanes. Compiled classes emit no fields, so this is a no-op. */
		{
			for (const n of Object.getOwnPropertyNames(element)) {
				const od = Object.getOwnPropertyDescriptor(element, n);
				if (od && 'value' in od && od.configurable && od.enumerable) {
					const v = od.value;
					try { delete element[n]; element[n] = v; } catch (_) {}
				}
			}
		}

		let state = CONSTRUCTS.get(element);
		if (!state) CONSTRUCTS.set(element, (state = { parentChain: RESOLVED, levels: [] }));

		const parentChain = state.parentChain;

		/* 1. snapshot — the sync prefix lands now (emitted ?? seeds first, in declaration
		 * order). The level's OWN pending cells are captured by diffing across the call:
		 * whatever newly reads ?? was seeded here. That is per-level scoping with no
		 * manifest and no compiler involvement — the runtime can simply see it. */
		/* [0.89.c] GENERATOR ONLY — the classic (snapshotFn, settleFn) pair is gone.
		 * `it.next()` runs the sync prefix SYNCHRONOUSLY and stops at the partition; a
		 * class with no async part is `done` right there. The SUPER MODE is no longer a
		 * symbol choice: the partition's inner yield hands out Symbol.new to request the
		 * parent chain (sync link) or nothing for a resolved input (mixed); no partition at
		 * all is the cap. One symbol, one face, the grain readable in the emitted body. */
		let _it = null, _prefixDone = true, _stopped = null;

		const _ssP = storeOf(element);
		const _beforeP = _ssP ? pendingKeys(_ssP) : null;
		const isBP = v => typeof v === 'string';   // sync-region breakpoints carry the field name
		if (typeof gen === 'function') {
			_it = gen.call(element);
			/* [0.89.3-dbg] A DEBUG SESSION claims the iterator instead of driving it: the
			 * chain suspends at its first breakpoint and the stepper takes over. Otherwise
			 * breakpoints are stepped straight through — production emits none at all, so
			 * this loop costs nothing there. */
			if (_DEBUG.session) {
				/* claimed: the stepper drives; the mode is read off the partition when
				 * stepping reaches it (superMode below stays 'mixed' until then). */
				_DEBUG.session.levels.push({ Level: element.constructor, it: _it, element, done: false });
				_prefixDone = false;
			} else {
				let r = _it.next();
				while (!r.done && isBP(r.value)) r = _it.next();
				_stopped = r;
				_prefixDone = r.done;
			}
		}
		if (_ssP) {
			const after = pendingKeys(_ssP);
			if (after.size) {
				let owned = PENDING_LEVEL.get(element);
				if (!owned) PENDING_LEVEL.set(element, owned = new Map());
				for (const k of after) if (!_beforeP.has(k)) owned.set(k, gen);  // [0.89.j] per-call token: seeding and poisoning share this closure
			}
		}

		/* 2b. arm reactive effects once, at the leaf (its hook runs last) so the read
			*     is the subscription and effects re-run as ?? fields settle */
		/* [0.89.j] arm per hook, guarded (armEffects: ARMED WeakSet; armDerived: per-name
		 * registry) — the leaf test needed level identity the protocol no longer carries */
		armDerived(element); armEffects(element);

		/* 3. settlement — feed `_super_`:
			*      sync    → the parent's chain (compiled `await _super_` really waits)
			*      mixed   → already-resolved (own settles eagerly; parent added below)
			*      cap     → unused (no `await _super_` emitted) */
		/* [0.89.c] the link is READ OFF THE PARTITION: yielded receiver = sync.
		 * [0.89.i] …and a yielded DETACH token = async link, emitted by `void super()`.
		 * That cell had no link word: a level with a partition was always sync or mixed,
		 * both of which put the parent in the chain, and `cap` only fires when there
		 * is nothing to settle at all. So OWN SETTLEMENT WITHOUT JOINING THE PARENT
		 * was unreachable rather than merely unspelled. It needs no chain branch —
		 * only `mixed` aggregates, so the detached link falls to `ownSettle` already. */
		/* [0.89.j / RULED] one axis with the compiler: the labels ARE the grain
		 * words — the take/forward/detach vocabulary is deleted on both sides. */
		const superMode = _prefixDone ? 'cap'
			: (_stopped && _stopped.value === element) ? 'sync'
			: (_stopped && _stopped.value === DETACH) ? 'async' : 'mixed';
		const superInput = _prefixDone ? RESOLVED : (superMode === 'sync' ? parentChain : RESOLVED);   // cap never reads it
		/* Drive the generator's remainder: each `yield v` hands v out, the driver awaits it
		 * and sends the settled value back in. The partition yield receives `_super_`. */
		const drive = async (it, sup) => {
			let r = it.next(sup);
			while (!r.done) {
				if (isBP(r.value)) { r = it.next(); continue; }   // step through breakpoints
				const v = await r.value;
				r = it.next(v);
			}
		};
		const runner = _prefixDone ? null : () => drive(_it, superInput);
		/* ═══ [0.89.d] CHIMERA-DRIVEN SETTLEMENT ══════════════════════════════════════
		 * The graph engine drives the remainder instead of the bespoke auto loop: one
		 * driver for fields AND settlement, every suspension publishes (settling UI and
		 * the debugger become subscribers), and failure enters the graph as a value.
		 * The PUMP translates echo semantics into send semantics: Chimera always feeds
		 * back the resolution of what was yielded; the partition needs superInput
		 * INJECTED on the first resume. The pump closes over it, filters breakpoint
		 * strings, and forwards REJECTIONS into the inner iterator via throw — the
		 * author's try/catch gets first refusal, exactly like a native await (stock
		 * delivered the throw in the DRIVER frame, bypassing the author's catch:
		 * measured, and pinned as fixed in the suite). Manual-control paths (debug
		 * session, held) keep the classic driver. */
		const chimeraDrive = () => new Promise((res, rej) => {
			const inner = _it, sup = superInput;
			const pump = function* () {
				try {
					let r = inner.next(sup);
					while (!r.done) {
						/* doc:T-STRINGYIELD — a string after the partition is a VALUE; it resolves to itself */
						let v;
						/* [0.89.o] A NON-THENABLE MUST STILL RESUME. Chimera resumes an Effect
						 * from a thenable's resolution, so yielding a plain value gave it nothing
						 * to resolve and the settlement HUNG FOREVER — `sync x = await nada()`
						 * where nada() returns undefined, or `await 7`, or `await x?.y` on a miss.
						 * Wrapping costs exactly what JS charges for `await 1`: one microtask.
						 * Thenables take the other branch untouched — and `Promise.resolve(p) === p`
						 * for a native promise anyway — so no working path changes. */
						try { v = yield (_isThenable(r.value) ? r.value : Promise.resolve(r.value)); }
						catch (e) { r = inner.throw(e); continue; }   /* author-first */
						r = inner.next(v);
					}
					const c0 = SETTLE_CTL.get(element); if (c0) c0.done = true;
					res(r.value);
					return r.value;
				} catch (fatal) {
					const c1 = SETTLE_CTL.get(element); if (c1) { c1.done = true; c1.err = fatal; }
					poisonPending(element, gen);
					rej(fatal);
					throw fatal;                                    /* the node caches the throw */
				}
			};
			SETTLE_NODE.set(element, new Signal.Effect(pump));
		});
		/* [0.89.3-dbg] MANUAL SETTLEMENT — PER ELEMENT.
		 * Every async element gets a controller. The auto-driver checks it before each
		 * suspension, so control is not a compile-time or class-level decision: it is a
		 * property of THIS element, changeable at any point in its settlement.
		 *
		 * `new` returns synchronously and the driver starts on a microtask, so the caller
		 * always has a synchronous window to seize an element before it settles:
		 *     const a = new Tabby(), b = new Tabby();
		 *     a.pause();                  // a is held; b settles normally
		 * and mid-flight works too — pause() lands at the next suspension point.
		 *     el.next(v)   step, INJECTING v as the value of the pending yield
		 *     el.throw(e)  raise e AT the suspension; the body's try/catch may recover
		 *     el.return()  abandon; `finally` runs, the gate closes, await new resolves
		 *     el.resume()  hand the remainder back to the auto-driver */
		let ownSettle;
		const wantsManual = _DEBUG.session || _DEBUG.hold > 0 || armedInChain(element);
		if (!_prefixDone && !wantsManual) {
			/* the settling/settled surface reads SETTLE_CTL — a minimal record keeps the
			 * element answering while the graph does the driving */
			SETTLE_CTL.set(element, {
				it: _it, superInput, first: false, done: false, paused: false, wake: null,
				send: undefined, at: null, Level: element.constructor, seq: 0, parked: false, pending: null,
				err: null, chimera: true
			});
			ownSettle = chimeraDrive();
			SETTLE_CTL.get(element).settled = ownSettle;
			ownSettle.catch(() => {});
		} else if (!_prefixDone) {
			const ctl = {
				it: _it, superInput, first: true, done: false,
				/* Held-ness is decided SYNCHRONOUSLY, here, inside the constructor — never by
				 * racing the settlement's microtask. `Instance.held(fn)` raises a counter
				 * for the duration of a synchronous construction, so every element born
				 * inside it is held deterministically, whatever the scheduler does. */
				paused: _DEBUG.hold > 0 || armedInChain(element), wake: null, send: undefined, at: null, Level: element.constructor,
				seq: 0, parked: false, pending: null, err: null
			};
			SETTLE_CTL.set(element, ctl);
			const auto = async () => {
				for (;;) {
					if (ctl.err) { const e = ctl.err; ctl.err = null; throw e; }   // injected via throw()
					if (ctl.done) return;
					if (ctl.paused) { await new Promise(r => { ctl.wake = r; }); continue; }
					/* Manual stepping may have left the coroutine parked ON an awaitable it
					 * never consumed. Take it over rather than resuming with undefined —
					 * that is what `next(a)` then `resume()` must mean: the fed value for
					 * the first await, the REAL value for the rest. */
					if (ctl.parked) {
						const pSeq = ctl.seq;
						const pv = await ctl.pending;
						if (ctl.seq !== pSeq || ctl.done) continue;
						ctl.parked = false; ctl.pending = null; ctl.send = pv;
						continue;
					}
					let r;
					try { r = ctl.it.next(ctl.first ? ctl.superInput : ctl.send); }
					catch (e) { ctl.done = true; throw e; }
					ctl.first = false; ctl.send = undefined;
					if (r.done) { ctl.done = true; return; }
					ctl.at = null;   /* doc:T-STRINGYIELD — a string is a value to resolve, never a position marker */
					const mySeq = ctl.seq;
					const v = await r.value;
					// a manual step during the await takes ownership; abandon this resume
					if (ctl.seq !== mySeq || ctl.done) continue;
					ctl.send = v;
				}
			};
			ownSettle = Promise.resolve().then(auto).catch(error => {
				poisonPending(element, gen);
				throw error;
			});
			ctl.settled = ownSettle;
		} else {
			ownSettle = runner
				? Promise.resolve()
						.then(runner)
						.catch(error => {
							poisonPending(element, gen);
							throw error;
						})
				: RESOLVED;
		}

		/* 4. chain republished to child / await-new:
			*      cap, sync → own;  mixed → own + parent (await-new aggregates the parent) */
		const chain =
			superMode === 'mixed'
				? Promise.all([ownSettle, parentChain]).then(() => {})
				: ownSettle;
		chain.catch(() => {}); // park: bare `new` of a failing settlement must not crash
		state.parentChain = chain;
		state.levels.push({ superMode, ownSettle, chain });

		/* 5. the element is a self-settling thenable bound to the latest chain */
		bindThenable(element, chain);
		return element;
	}

	/* ── helpers (live just above the Instance class) ─────────────────────────
		* The kernel/slot layer above already provides createElement, the slot
		* WeakMaps (AWAITING, …), instanceHook, armEffects, thenFor, DSL,
		* Lexeme, JSDOM, AttributeParser, Signal, the INSTANCE/EFFECTS symbols and
		* the destructured Object/Reflect aliases. ifndef + THIS_SCRIPT are the two
		* doc-era helpers worth keeping module-scope (createElement stays module-scope too). */

	const THIS_SCRIPT = (typeof document !== 'undefined' && document.currentScript) || null; // the bootstrapping <script>, for #config

	/* a sensible default so Div/Span/… exist even before any autoclass scan */
	const DEFAULT_SET = {
		core: new Set(JSDOM.ELEMENTS.core.stable),
		math: new Set(),
		svg: new Set()
	};

	/* ════════════════════════════════════════════════════════════════════════
	* §6 — element base + metaclass (proxy-free: this IS the element)
	*   Class-encapsulated: #metaclass builds the per-class Meta proxy; #initialize
	*   generates the configured shape synchronously at load (ifndef-guarded,
	*   alias-aware); define/defineAll are the manual generation API.
	* ════════════════════════════════════════════════════════════════════════ */
	/* ── §PROXY INTERFACES (Pass Q4, 0.73 port — author-spec) ─────────────────────
	 * The callable-proxy pattern over `this[PROXIES](type, factory)`: first access
	 * builds the interface (memoized per element per type in the weak-scoped store);
	 * the returned value is CALLABLE (apply = the primary verb) and carries its verb
	 * surface via get. Dispose drains every built interface (the PROXIES teardown
	 * command) — workers terminate, sockets close, listeners unbind, with the element.
	 * Doctrine: object[SYMBOL] → weak-scoped store → typeof this → machinery. */
	class ProxyInterface {
		get worker() {
			return this[PROXIES]('worker', function () {
				const el = this;
				let _worker = null, _url = null;
				const spawn = (fn) => {
					const src = `self.onmessage = function(e) { self.postMessage((${fn.toString()})(e.data)); }`;
					_url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
					_worker = new Worker(_url);
					return _worker;
				};
				const iface = {
					run(fn, data) {
						return Instance.makeChainable(new Promise((resolve, reject) => {
							const w = _worker ?? spawn(fn);
							w.onmessage = e => resolve(e.data);
							w.onerror = e => reject(e);
							w.postMessage(data);
						}));
					},
					post(data)     { _worker?.postMessage(data); return el; },
					on(event, cb)  { _worker?.addEventListener(event, cb); return el; },
					off(event, cb) { _worker?.removeEventListener(event, cb); return el; },
					remove() {
						_worker?.terminate();
						if (_url) URL.revokeObjectURL(_url);
						_worker = null; _url = null;
						return el;
					}
				};
				return new Proxy(function worker() {}, {
					apply(_, __, [fn, data]) { return iface.run(fn, data); },
					get(_, prop) { return iface[prop]; }
				});
			});
		}
		get socket() {
			return this[PROXIES]('socket', function () {
				const el = this;
				let _socket = null;
				const iface = {
					send(data)     { _socket?.send(typeof data === 'string' ? data : JSON.stringify(data)); return el; },
					on(event, cb)  { _socket?.addEventListener(event, cb); return el; },
					off(event, cb) { _socket?.removeEventListener(event, cb); return el; },
					close()  { _socket?.close(); _socket = null; return el; },
					remove() { this.close(); return el; }
				};
				let p; // apply returns the callable proxy for chaining (author sketch's `return this` would return the trap handler)
				p = new Proxy(function socket() {}, {
					apply(_, __, [url, protocols]) {
						_socket = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
						return p;
					},
					get(_, prop) { return iface[prop]; }
				});
				return p;
			});
		}
		get listen() {
			return this[PROXIES]('listen', function () {
				const el = this;
				const channels = new Map();
				const dispatch = (e) => {
					const { channel, data } = e.data ?? {};
					if (!channel) return;
					channels.get(channel)?.forEach(cb => cb(data, e));
				};
				const iface = {
					off(channel, cb) { channels.get(channel)?.delete(cb); return el; },
					post(channel, data, target = '*') {
						window.postMessage({ channel, data }, target);
						return el;
					},
					remove() {
						window.removeEventListener('message', dispatch);
						channels.clear();
						return el;
					}
				};
				let p;
				p = new Proxy(function listen() {}, {
					apply(_, __, [channel, cb]) {
						if (!channels.size) window.addEventListener('message', dispatch);
						if (!channels.has(channel)) channels.set(channel, new Set());
						channels.get(channel).add(cb);
						return p;
					},
					get(_, prop) { return iface[prop]; }
				});
				return p;
			});
		}
	}

	class Instance {

		static get this() { return globalThis; } // canonical this-chain root: Instance.this → the global (Pass Q3)

		/*
		static [Symbol.hasInstance](instance) { // Pass Q5: `el instanceof Instance` — the brand is the mint, not a proto-chain link (the iface is a COPY of Instance.prototype, never Instance.prototype itself)
			if (instance === null || (typeof instance !== 'object' && typeof instance !== 'function')) return false;
			if (MINTED.has(instance)) return true;              // a minted element
			try { 
				for (let p = instance; typeof p === 'function'; p = getPrototypeOf(p)) {
					if (p?.name && REGISTRY[p.name] === p) return true;
			 	}
			} catch (e) {} // a Meta (or a user subclass thereof) — walk the function chain to a registered class
			if (instance[INSTANCE]) return true;
			return false;
		}
		*/
		static [Symbol.hasInstance](value) {
			if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
			const self = this;

			// Walk the superclass chain of a constructor, checking for:
			//   - exact match (for Div, etc.)
			//   - if self is Instance, any registered class in the chain is a brand match
			const isSubclassOf = (ctor) => {
				let current = ctor;
				while (current) {
					if (current === self) return true;
					// Brand check for Instance: any ancestor that is a registered class qualifies.
					if (self === Instance && REGISTRY[current.name] === current) return true;
					current = Object.getPrototypeOf(current);
					if (current === Function.prototype) break;
				}
				return false;
			};

			// If value is a class (function), check its superclass chain.
			if (typeof value === 'function') {
				return isSubclassOf(value);
			}

			// If value is an element (object), get its leaf class and check that chain.
			if (typeof value === 'object') {
				const ctor = MINTED.get(value) || value[LEAF] || (value[METADATA] && value[METADATA].constructor);
				if (ctor && typeof ctor === 'function') {
					return isSubclassOf(ctor);
				}
				// Fallback to native instanceof for non‑Instance objects (native elements, plain objects).
				try {
					return Function.prototype[Symbol.hasInstance].call(self, value);
				} catch (_) {
					return false;
				}
			}
			return false;
		}
		
		static DISPOSE = DISPOSE; // the symbols' public handles: KRow[Instance.DISPOSE]()
		static ASYNC_DISPOSE = ASYNC_DISPOSE;

		/* ── teardown (Pass Q4) — one body, every face, symbol-keyed (`this[DISPOSE]`):
		 *   KRow[DISPOSE]() / KRow.teardown()      → dispose THIS class's live instances (self-destruct; inherited via the symbol-static relay),
		 *   KRow.dispose() with no element            then the class ITSELF: its own node is released (C-ADOPT), as a disposed element's is
		 *   Instance.teardown()                     → dispose every managed element in the document, then Signal.teardown() (arena re-init — ALL handles invalidated)
		 *   Instance.teardown(true)                 → …and unmint: delete every global the typeset definer created, plus Instance itself. Only sane if you own the whole window. */
		static [DISPOSE](unmint = false) {
			if (this === Instance) {
				const doc = globalThis.document;
				if (doc && doc.documentElement) for (const el of [...doc.querySelectorAll('*')]) { try { if (el[LEAF]) el.remove(true); } catch (e) {} }
				try { typeof Signal !== 'undefined' && Signal.teardown && Signal.teardown(); } catch (e) {}
				if (unmint) {
					for (const k of _MINTED_GLOBALS) { try { delete globalThis[k]; } catch (e) {} }
					_MINTED_GLOBALS.clear();
					for (const k of ['Instance', 'InstanceReady']) { try { delete globalThis[k]; } catch (e) {} }
				}
				return true;
			}
			for (const el of [...(this[ELEMENTS] ?? [])]) { try { el.remove(true); } catch (e) {} } // class face: the live registry, disposed
			Instance.#reclaim(this);   // …and the class itself: its own node (C-ADOPT)
			return this;
		}
		static async [ASYNC_DISPOSE](unmint = false) { // the async twin: awaits @removal/@unmount transitions per element
			if (this === Instance) {
				const doc = globalThis.document;
				if (doc && doc.documentElement) for (const el of [...doc.querySelectorAll('*')]) { try { if (el[LEAF]) await this.disposeAsync(el); } catch (e) {} }
				try { typeof Signal !== 'undefined' && Signal.teardown && Signal.teardown(); } catch (e) {}
				if (unmint) {
					for (const k of _MINTED_GLOBALS) { try { delete globalThis[k]; } catch (e) {} }
					_MINTED_GLOBALS.clear();
					for (const k of ['Instance', 'InstanceReady']) { try { delete globalThis[k]; } catch (e) {} }
				}
				return true;
			}
			for (const el of [...(this[ELEMENTS] ?? [])]) { try { await this.disposeAsync(el); } catch (e) {} }
			Instance.#reclaim(this);   // …and the class itself: its own node (C-ADOPT)
			return this;
		}
		static teardown(unmint) { return this[DISPOSE](unmint); }
		static teardownAsync(unmint) { return this[ASYNC_DISPOSE](unmint); }

		static extend(K) { return K; } // IVC-era hook (Pass Q7): identity today — the seam where version-gated class rewriting will land; enables `CatDiv = Instance.extend(CatDiv)` reassignment without const

		static Events = ø({}); // every event class, ALWAYS reachable here (even where the global name stayed native)

		static initEvents(CTX = globalThis) { // Pass Q8 — mint the event vocabulary (idempotent; boot calls it after typeset so collision checks see the real registry)
			if (this.Events.__minted) return this.Events;
			const pas = x => JSDOM.EVENTS.case[x] || (x ? x[0].toUpperCase() + x.slice(1) : '');
			for (const [prefix, alts] of Object.entries(JSDOM.EVENTS.grammar)) {
				for (const alt of alts.split('|')) {
					if (prefix === '' && alt === '') continue;
					const type = prefix + alt;
					let name = prefix === '' ? pas(type) : pas(prefix) + pas(alt);
					/* COLLISION → 'Event' postfix. CORE_TAGS is consulted alongside REGISTRY,
					 * and that is not belt-and-braces: REGISTRY holds element CLASSES, which
					 * PLATFORM now registers from a module loading AFTER this runs. In the
					 * monolith <reset>'s class already existed here so 'reset' postfixed to
					 * ResetEvent; split, it did not, and the same source minted a bare `Reset`.
					 * The collision is between NAMES, so check the names — CORE_TAGS stays in
					 * core precisely because it is the vocabulary, and it is complete before
					 * anything registers a class against it. */
					if (REGISTRY[name] || CORE_TAGS.has(name.toLowerCase()) || _MINTED_GLOBALS.has(name) || name in CTX) name += 'Event';
					const Klass = _makeEventClass(name, type, CTX);
					defineProperty(this.Events, name, { value: Klass, enumerable: true, configurable: true });
					ifndef(CTX, name, () => { _MINTED_GLOBALS.add(name); return Reflect.defineProperty(CTX, name, { value: Klass, writable: true, configurable: true, enumerable: false }); });
				}
			}
			defineProperty(this.Events, '__minted', { value: true, configurable: true });
			return this.Events;
		}

		/* ── mergeJQuery (Pass Q7 — the 0.73 jQueryInterface, remade) ────────────────
		 * ON BY DEFAULT when jQuery is present at boot; call manually if it loads late.
		 * Grafts every jQuery.fn verb onto every element — HOUSE WINS on collisions:
		 * anything already answered by Instance or the native chain (on/off/remove/
		 * find/first/…) is skipped, so Instance semantics are never surrendered.
		 * Chaining unwraps: a jQuery call returning the same single-element set hands
		 * back the ELEMENT (Instance chaining continues); sets and scalars pass
		 * through untouched. Idempotent — grafted names are visible on the probe. */
		static mergeJQuery(jq = globalThis.jQuery) {
			if (!jq || !jq.fn) return Instance;
			const probe = globalThis.document ? globalThis.document.createElement('div') : {};
			for (const name of Object.getOwnPropertyNames(jq.fn)) {
				if (name === 'constructor' || name === 'init' || name === 'jquery' || name === 'length') continue;
				if (typeof jq.fn[name] !== 'function') continue;
				if (name in Instance.prototype || name in probe) continue; // house + native win
				const fn = function (...args) {
					const wrapped = jq(this);
					const out = wrapped[name](...args);
					return (out === wrapped || (out instanceof jq && out.length === 1 && out[0] === this)) ? this : out;
				};
				try { defineProperty(fn, 'name', { value: name, configurable: true }); } catch (e) {}
				const desc = { value: fn, configurable: true, enumerable: false, writable: true };
				defineProperty(Instance.prototype, name, desc);              // future metas copy it at creation
				for (const f of _IFACES) if (!(name in f)) defineProperty(f, name, desc); // existing metas retro-graft
			}
			return Instance;
		}

		static {
			for (const k of ['worker', 'socket', 'listen']) // the callable proxy interfaces ride Instance.prototype → the iface relay → every element
				defineProperty(this.prototype, k, $ownDesc(ProxyInterface.prototype, k));
		}

		static get router() { return _router(); }

		static get _builtinTransitions() { const TR = _tr(); return (TR && TR.presets) || {}; }

		static app(name) { return APPS.get(name); }

		/* ═══ [0.89.j] Instance.settle RETIRED, with the *[Symbol.new] member format ═══
		 * One protocol, one style: hand-written classes author the emit shape itself —
		 *     this[Symbol.new](function* () { … })              // ctor; closures carry params
		 *     static { this[Symbol.new](function* () { … }) }   // class side
		 *     this[Symbol.new](null)                            // field-less: sweep + arming only
		 * The member format created the shadowing hazard settle existed to bypass; with
		 * both gone the hazard is unreachable in new code, and legacy code is LOUD —
		 * its settle call site throws (settle is not a function), and an undriven
		 * member simply never runs. */


		/* class-side face of the compiler's per-level hook: static blocks emit
		 * this[Symbol.new](function* () { … }) at DEFINITION time.
		 * The instance-side face lives on Instance.prototype; this static one was
		 * missing in 0.87 — latent for every compiled class with static fields
		 * (surfaced by app scripts, Pass N). Metas inherit it via the own-symbol
		 * relay in #metaclass; root-extenders resolve it directly. */
		static [INSTANCE](gen) {
			/* [0.89.j] MONOMORPHIC PROTOCOL — the class IS the receiver:
			 * `static { this[Symbol.new](function* () { … }) }`. */
			const Klass = this, staticFn = gen;
			/* [0.89.8] The settlement half used to be DROPPED. This signature took two
			 * arguments while the compiler has always emitted three — (Klass, syncFn,
			 * asyncFn) — so `static await $x = f()` seeded its ?? and then nothing ever
			 * resolved it: the cell read Symbol(??) forever, with no error anywhere.
			 * Latent since the static face was added in 0.87.
			 *
			 * Statics have no store and no parent chain, so this is the whole thing:
			 * run the eager prefix at class-eval time, then drive the async remainder.
			 * A failure poisons the class's own pending cells, mirroring the element
			 * path. The promise is parked on the class so `await Klass` can join it. */
			/* [0.89.c] GENERATOR SHAPE — the same one instanceHook took in 0.89.3.
			 * `static { this[Symbol.new](function* () { … yield … }) }`: it.next()
			 * runs the sync prefix SYNCHRONOUSLY and stops at the partition yield; a class
			 * with no async statics is `done` right there and never allocates another step.
			 * [0.89.c] GENERATOR ONLY — the legacy (staticFn, settleFn) pair is gone. Statics
			 * have no store and no per-level pending diff, so the driver is the whole thing. */
			let _it = null, _stopped = null;
			if (typeof staticFn === 'function') {
				_it = staticFn.call(Klass);
				let r = _it.next();
				while (!r.done && typeof r.value === 'string') r = _it.next();   // step through breakpoints
				_stopped = r;
			}
			/* Resume from the result the prefix STOPPED on, so the value an author's
			 * `yield X` produced is awaited and sent back in — the partition's bare
			 * `yield` rides the same path with an undefined value. */
			/* SUPER JOIN. Statics inherit: `class B extends A` where A has blocking statics
			 * means B's own statics may read A's. The partition is emitted as `yield (yield)`
			 * exactly as in the ctor — the inner yield RECEIVES the parent's settlement, the
			 * outer hands it back out for the driver to await — so a subclass static that
			 * depends on a parent static no longer caches the parent's ?? seed forever. */
			/* [0.89.c] TOKEN PROTOCOL, same as the ctor: the partition yielding Symbol.new
			 * [0.89.c] TOKEN PROTOCOL: a partition yielding `this` asks to gate on the
			 * parent class's settlement (statics inherit); bare asks
			 * for a resolved input. The parent's thenable IS its static settlement. */
			const _parent = Object.getPrototypeOf(Klass);
			const _takes = _stopped && !_stopped.done && _stopped.value === Klass;
			/* [0.89.i] THE CLASS SIDE HAD TWO MODES WHERE THE INSTANCE SIDE HAS THREE.
			 * `_takes` waited for the parent and everything else resolved immediately with
			 * NO aggregation — so `mixed class` statics were effectively detached and
			 * indistinguishable from `async class` ones. Forward means parallel AND
			 * joined, so the parent belongs in the republished chain even though the
			 * generator does not wait on it. Detach is the one that genuinely drops it. */
			const _detaches = _stopped && !_stopped.done && _stopped.value === DETACH;
			const _superIn = _takes && _parent && typeof _parent.then === 'function' ? _parent : Promise.resolve();
			/* [0.89.o] A REJECTION IS RAISED AT THE SUSPENSION, author-first — the same
			 * contract the instance side has always had. This loop used to `await
			 * r.value` bare, so a rejection threw in the DRIVER and escaped the
			 * generator entirely: an emitted `try { yield bad(); } catch (e) {}` in a
			 * static block ran its catch and the class face rejected anyway. A soft
			 * gate was soft on the instance face and hard on the class face, from
			 * identical emitted code. */
			const drive = async (it, sup) => {
				let r = it.next(sup);                          // resume the partition with its requested input
				while (!r.done) {
					/* doc:T-STRINGYIELD — a string after the partition is a VALUE; it resolves to itself */
					let v;
					try { v = await r.value; }
					catch (e) { r = it.throw(e); continue; }     /* author-first */
					r = it.next(v);
				}
			};
			const runner = !_stopped || _stopped.done ? null : () => drive(_it, _superIn);
			if (runner) {
				const settled = Promise.resolve()
					.then(runner)
					.catch(error => { poisonPending(Klass, gen); throw error; });
				settled.catch(() => {});                       // never an unhandled rejection
				/* the same binder the instance face uses — `await Klass` now joins the
				 * class's settlement, and the thenable evaporates once it resolves */
				const _chain = (!_takes && !_detaches && _parent && typeof _parent.then === 'function')
					? Promise.all([settled, _parent]).then(function () {})   // mixed: joined, in parallel
					: settled;                                               // sync (already transitive) or detach
				_chain.catch(function () {});
				bindThenable(Klass, _chain);
			}
			return Klass;
		}

		static get _i18n() { return _I18N; }
		static i18n(translations) {
			_I18N = translations || null;
			/* braces are load-bearing: the old body was a single statement, and hoisting the
			 * seam lookup out of the forEach turned it into two. */
			if (typeof document !== 'undefined') {
				const __intl = (_plat() || {}).applyIntl;   // I18N stub: absent PLATFORM, <intl> stays inert text
				document.querySelectorAll('intl[key]').forEach(el => { this.upgrade(el); if (__intl) __intl(el); }); // upgrade is idempotent — covers <intl> minted after boot; re-apply for dictionary swaps
			}
			return Instance;
		}

		/* ── upgrade — wake a raw, already-parsed element in place. The declarative
		 * mirror of `new Klass()`: the node rides the adoption slot (the element IS
		 * the instance — proto-splice + store + registry, no fresh createElement),
		 * and if it's already connected the enter transition fires NOW (@insertion,
		 * @mount once, @rendered post-paint) — the connection event it would have
		 * needed already passed. Disconnected nodes stay cold: the Lifecycle
		 * observer runs enter when they actually land. Idempotent: an element that
		 * is already an instance (LEAF set) returns itself untouched. */
		static upgrade(node) {
			if (!node || node.nodeType !== 1) return null;
			if (node[LEAF]) return node; // already an instance — nothing to do
			const Klass = CUSTOM_TAGS.get(node.localName);
			if (!Klass) return null;
			_UPGRADE = node;
			let el;
			try { el = new Klass(); } finally { _UPGRADE = null; } // constructor consumes the one-shot via _adoptClaim
			if (doc && doc.contains(el)) this.enter(el);
			return el;
		}

		/* ── ⚡⚡ SUPER MODE — declarative custom elements, document-wide. Engine
		 * mode redirects native constructors; super mode goes the other way: raw
		 * markup whose tag matches a registered Instance class is upgraded in
		 * place — at superup for everything already parsed, then live via one
		 * childList observer. Requires engine mode (superup auto-powers-up;
		 * powerdown force-supers-down — ⚡⚡ never runs without ⚡). The CORE_TAGS
		 * ring is NOT gated by this: the built-in vocabulary boots unconditionally;
		 * super mode extends the same machinery to user-defined classes. */
		static superup() {
			if (_SUPER.on) return Instance;
			this.powerup(); // ⚡⚡ cannot run without ⚡
			_SUPER.on = true;
			if (doc) {
				_superSweep(doc);
				const root = doc.body || doc.documentElement;
				if (root && typeof MutationObserver !== 'undefined') {
					_SUPER.obs = new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(_superWalk)));
					_SUPER.obs.observe(root, { childList: true, subtree: true });
				}
			}
			this.debug('info', '[Instance] ⚡⚡ super mode — declarative custom elements live');
			return Instance;
		}
		static superdown() {
			if (!_SUPER.on) return Instance;
			_SUPER.on = false;
			if (_SUPER.obs) { _SUPER.obs.disconnect(); _SUPER.obs = null; }
			this.debug('info', '[Instance] ⚡⚡ super mode off — existing instances stay live');
			return Instance;
		}

		static powerup() {
			if (_ENGINE.on) return Instance;
			_ENGINE.on = true;
			_installTree();
			for (const pair of _ENGINE.pairs) pair[2] ? pair[2](true) : _engineSwapCtor(pair[0], pair[1]);
			this.debug('info', '[Instance] ⚡ engine powered up — live tree + native constructors redirected');
			return Instance;
		}

		static powerdown() {
			if (_SUPER.on) this.superdown(); // invariant: ⚡⚡ never outlives ⚡
			/* [0.89.2] Structure is intrinsic and stays put; ⚡ down restores only the
			 * native constructor identity. Live elements keep their chain, their store,
			 * and their fields — powering down is no longer a demolition. */
			_ENGINE.ctors.forEach((original, proto) => {
				if (original) { Object.defineProperty(proto, 'constructor', original); }
				else          { delete proto.constructor; }
			});
			_ENGINE.ctors.clear();
			_uninstallTree();
			_ENGINE.on = false;
			this.debug('info', '[Instance] ⚡ engine powered down — native constructors restored');
			return Instance;
		}

		
		static #once;
		static #boot;                 // the BOOT HANDLE — one per realm, however many callers await it
		static #debugger;

		static debug(...args) {
			if (Instance.#debugger) console.warn(...args);
			else return null;
		}
		static debugMode(on = true) {
			Instance.#debugger = !!on;
			return Instance.#debugger;
		}
		static #warn(...args) {
			console.warn(...args);
		}

		static {
			Object.defineProperties(this, {
				[Symbol.species]: { configurable: false }, // kept: species lets elements survive native methods (map/filter) as their own class
				mode: { value: 'strict' },
				id: { value: 'INSTANCE' },
				expando: {
					value: ('Instance' + (+new Date() + Math.random())).replace(/\./g, '')
				},
				UID: {
					writable: true,
					configurable: true,
					value(key = '') {
						return Symbol(String(key));
					}
				},
				/* [0.89.3-dbg] Construction debugger. `Instance.debugConstruct(() => new Card())`
				 * runs the constructor with every level's coroutine CLAIMED rather than driven,
				 * then hands back a stepper. Requires classes compiled with { step: true }. */
				debugConstruct: {
					writable: true, configurable: true,
					value(fn) {
						/* [0.89.j] the protocol no longer names levels, but the SESSION can:
						 * claims arrive base→leaf, one per hook-emitting level, so arrival k
						 * of N maps into the element's constructor chain at N-1-k. Best-effort
						 * by design: a hand-written hook-less shim level shifts the naming by
						 * one, never the order or the count. */
						const levelName = (rec, all) => {
							const mine = all.filter(l => l.element === rec.element);
							const k = mine.indexOf(rec);
							const chain = [];
							for (let C = rec.element && rec.element.constructor;
								typeof C === 'function' && chain.length < 64; C = Object.getPrototypeOf(C)) chain.push(C);
							const C = k > -1 ? chain[mine.length - 1 - k] : null;
							return String((C && C.name) || (rec.Level && rec.Level.name) || rec.Level);
						};
						const session = { levels: [], log: [] };
						_DEBUG.session = session;
						let element;
						try { element = fn(); } finally { _DEBUG.session = null; }
						let li = 0, pending = null;
						return {
							element,
							levels: session.levels.map(l => levelName(l, session.levels)),
							log: session.log,
							/* advance to the next breakpoint anywhere in the chain */
							step() {
								while (li < session.levels.length) {
									const lv = session.levels[li];
									const r = lv.it.next(pending);
									pending = undefined;
									if (r.done) { lv.done = true; li++; continue; }
									if (typeof r.value === 'string') {
										const bp = { name: r.value, level: levelName(lv, session.levels) };
										session.log.push(bp); return { done: false, at: bp, element };
									}
									// the partition yield: this level's sync part is finished
									session.log.push({ kind: 'partition', level: levelName(lv, session.levels) });
									li++;
									return { done: false, at: { kind: 'partition', level: levelName(lv, session.levels) }, element };
								}
								return { done: true, element };
							},
							runToEnd() { let r; do { r = this.step(); } while (!r.done); return element; }
						};
					}
				},
				/* [0.89.2] class name → { tag, ns }, filled by #metaclass as tags are minted. */
				tagOf: { writable: false, configurable: true, value: new Map() },
				/* [0.89.2] INTRINSIC(className, field) — is `field` a real DOM property of the
				 * element `className` mints? Probed once per tag against a throwaway PRISTINE
				 * element (never a live Instance: the Meta's function target leaks 'name' and
				 * 'length' from Function.prototype). Returns false for unknown classes, so an
				 * unresolvable base is silently permitted rather than falsely refused. */
				isIntrinsic: {
					writable: true, configurable: true,
					value(className, field) {
						const rec = Instance.tagOf.get(String(className));
						if (!rec) return false;
						let cache = Instance.isIntrinsic._c || (Instance.isIntrinsic._c = new Map());
						let set = cache.get(className);
						if (!set) {
							/* Walk the PRISTINE pair captured at mint, never a live element: in
							 * engine mode the tag's own prototype is spliced onto the Meta, so a
							 * live walk collects the Meta's function properties ('name','length')
							 * and reports them as intrinsic. Caught by the contract suite. */
							set = new Set();
							if (rec.proto) for (const n of Object.getOwnPropertyNames(rec.proto)) set.add(n);
							for (let p = rec.parent; p && p !== Object.prototype; p = Object.getPrototypeOf(p))
								for (const n of Object.getOwnPropertyNames(p)) set.add(n);
							cache.set(className, set);
						}
						return set.has(String(field));
					}
				},
				UNS: {
					writable: true,
					configurable: true,
					value(prefix) {
						const ns = Instance.UUID(prefix);
						return key => Symbol.for(Symbol.keyFor(ns) + '/' + key);
					}
				}
			});
		}

		constructor(...args) {
			const target = new.target;
			if (target === Instance) {
				/* BOOT ENTRY POINT — gated on new.target being Instance ITSELF, never a
				 * subclass. EVERY element in the framework reaches this constructor:
				 * `new Div()`, `new App()`, `class X extends Instance` all land here with
				 * a different new.target. An element must never come back thenable,
				 * because `await new K()` ALREADY means "wait for K's fields to settle"
				 * (§2.2 mandatory field lifecycle) — a different claim entirely, and the
				 * two would collide silently rather than loudly.
				 *
				 *     await new Instance(globalThis)   → the boot handle, resolves to Instance
				 *     await new Div()                  → field settlement, untouched
				 *
				 * IDEMPOTENT: one boot, one promise, however many callers. Two scripts
				 * both writing `await new Instance(globalThis)` is the obvious usage and
				 * must not run shape generation twice.
				 *
				 * Boot is still SYNCHRONOUS (§2.4) — the promise is already settled by the
				 * time it is returned, so awaiting costs one microtask and nothing else.
				 * The handle exists so that when boot becomes gated the await starts
				 * meaning something, instead of silently continuing to mean nothing. */
				if (!Instance.#boot) {
					let p;
					try {
						if (!Instance.#once) Instance.#initialize(args[0]);
						p = Promise.resolve(Instance);
					} catch (e) {
						p = Promise.reject(e);
						p.catch(function () {});   // awaiters still see it; an ignored handle stays quiet
					}
					Instance.#boot = p;
				}
				return Instance.#boot;   // a constructor returning an object overrides `this`
			}
			/* static-is contract (Pass N): identity mirrors the inheritance.
			 * extends Instance → own tag (<scrollbar>, chain …→Meta→HTMLUnknownElement);
			 * extends a tag Meta → web-compat (<div data-is="Scrollbar">);
			 * static is = 'element' | 'web-compat' | 'data' overrides either way. */
			const __is = Instance.#isContract(target);
			if (__is && __is.mode === 'data')
				return new Signal.Store(args.length && args[0] !== null && typeof args[0] === 'object' ? args[0] : {});
			const element = (__is && __is.adopted) || createElement(target.id || 'div', target.ns || 'html');
			setPrototypeOf(element, target.prototype);
			if (__is) {
				if (__is.dataIs) element.setAttribute('data-is', __is.dataIs); // the id mirrors the classname exactly
				if (!__is.adopted && _ADOPT) _ADOPT.appendChild(element);     // fresh instance lands in the app scope
			}
			

			/* [0.89.c] ARGUMENT GRAMMAR AND CONTENT BUILDING LIVE IN THE DSL.
			 * Core used to hardcode `arg[0] === '@'` and hand-roll a DocumentFragment
			 * here — the DSL's own sigil, and its own content rules, embedded in the
			 * one module that otherwise knows nothing about either. It now asks.
			 *
			 * ALWAYS the fragment — there is no textContent fast path. Two reasons, and
			 * the second is a correctness bug rather than a preference:
			 *   1. FOUT. The element is ALREADY CONNECTED by this point (the _ADOPT
			 *      append above puts it in the app scope), so a direct textContent write
			 *      is a live mutation the user can see land separately from everything
			 *      else the constructor does. One appendChild keeps content arrival to a
			 *      single observable step.
			 *   2. textContent REPLACES. `element` may be an ADOPTED node that already
			 *      has children (see __is.adopted above); assigning textContent wipes
			 *      them, while appending a fragment preserves them. Measured: same
			 *      mutation count, opposite result — 1 child and the markup gone, versus
			 *      2 children with it intact. */
			const { route, content: contentItems } = DSL.split(args);
			const frag = DSL.content(contentItems, document);
			if (frag) element.appendChild(frag);

			element[LEAF] = target; // off-element: leaf class via the minted LEAF accessor (loop-backed)
			/* doc:C-ADOPT */
			/* THE ELEMENT IS ITS STORE. Adoption stamps the node brand on the element and
			 * gives it the dictionary; the arena holds it in _handles for the node's
			 * lifetime (RULED: strong). It replaced `STORE.set(element, new Signal.Store())`,
			 * one handle per element in a side table; storeOf(element) is the element now,
			 * and a class is adopted the same way at its first static write (adoptClass). */
			Signal.Store.adopt(element);
			MINTED.set(element, target); // identity: new.target IS the queried class
			/* [0.89.d v2] manifest installer retired: bare keys self-declare as own accessors at first [[Set]] */
			if (element.isConnected) Instance.register(element); // live-DOM registry (Pass Q3): existence begins at insertion — detached mints register at first mount
			
			if (route !== null && doc) {
				DSL.route(DSL.parse(route), element, doc); // place via the DSL, once the element is fully wired
			}

			return element; // constructor returns the element → `this` is the element everywhere up-chain
		}
		appendTo(targetOrSelector) {
			const parent =
				targetOrSelector === 'body'
					? doc.body
					: typeof targetOrSelector === 'string'
						? doc.querySelector(targetOrSelector)
						: targetOrSelector;
			if (parent) Instance.reattach(this, parent, null); // house verb ⇒ SYNCHRONOUS enter: connected and registered before appendTo returns (raw appendChild stays observer-driven, one microtask behind)
			return this;
		}

		// ── #metaclass (verbatim behavior from 0.85.5): raw element + typeof-receiver Meta proxy ──
		static #metaclass(lexeme, namespace) {
			const className = String(lexeme);
			const tagId = lexeme.id;
			const ns = namespace || 'html';
			const nativeProto = getPrototypeOf(createElement(tagId, ns));

			/* ── per-tag prototype (Pass Q6): shared cross-element prototypes — NEVER; the tag is isolate.
			 * Resolved name = 'HTML' + className (baddie suffix stripped) + 'Element'. If the tag's real
			 * native interface already carries exactly that name (div → HTMLDivElement), REUSE it — zero
			 * layers. Otherwise the platform was lazy (section → bare HTMLElement; thead → shared
			 * HTMLTableSectionElement; tr → differently-named HTMLTableRowElement) and we SYNTHESIZE the
			 * interface that should have existed: correctly named, @@toStringTag'd, statics chained,
			 * prototype inheriting the REAL native proto (instanceof stays faithful), exposed on the
			 * realm ifndef-style and recorded for unmint. The Meta then parents to the per-tag proto —
			 * and in engine mode the splice lands on a PER-TAG link, so it can never leak across tags. */
			/* [0.89.2] Record the class→tag fact so the COMPILER can answer "is this field
			 * name intrinsic to this tag?" without instantiating anything. The metaclass is
			 * the only place that knows it; nothing else had to be built. */
			try { this.tagOf.set(className, { tag: tagId, ns, proto: nativeProto, parent: getPrototypeOf(nativeProto) }); } catch (e) {}
			const IFACE_NAME = 'HTML' + className.replace(/Element$/, '') + 'Element';
			let tagProto = nativeProto;
			{
				const nCtor = nativeProto && nativeProto.constructor;
				if (!nCtor || nCtor.name !== IFACE_NAME) {
					const cached = _TAG_IFACES.get(IFACE_NAME);
					if (cached) tagProto = cached.prototype;
					else {
						const IfaceCtor = function () { throw new TypeError('Illegal constructor'); };
						defineProperty(IfaceCtor, 'name', { 
							value: IFACE_NAME, configurable: true
						});
						tagProto = $create(nativeProto);
						defineProperty(tagProto, 'constructor', { 
							value: IfaceCtor, writable: true, configurable: true, enumerable: false 
						});
						defineProperty(tagProto, Symbol.toStringTag, { 
							value: IFACE_NAME, configurable: true
						}); // WebIDL-faithful: [object HTMLSectionElement]
						defineProperty(IfaceCtor, 'prototype', { 
							value: tagProto, writable: false, enumerable: false, configurable: false
						});
						if (typeof nCtor === 'function') setPrototypeOf(IfaceCtor, nCtor); // interface statics chain like the platform's do
						ifndef(globalThis, IFACE_NAME,
							() => { _MINTED_GLOBALS.add(IFACE_NAME); return Reflect.defineProperty(globalThis, IFACE_NAME, { value: IfaceCtor, writable: true, configurable: true, enumerable: false }); });
						_TAG_IFACES.set(IFACE_NAME, IfaceCtor);
					}
				}
			}
			const tagParent = getPrototypeOf(tagProto);

			const BaseCtor = function() {
				return Reflect.construct(Instance, arguments, new.target || Meta);
			};

			/* class metadata; configurable so the Meta proxy may route an instance-level
			set of the same name (element.id = …, element.name = …) to the element
			instead of tripping the proxy's non-configurable [[Set]] invariant */
			defineProperties(BaseCtor, {
				name: { value: className, configurable: true },
				id: { value: tagId, configurable: true, writable: false, enumerable: false }, // was configurable:false — tripped the proxy [[Get]] invariant on every element.id read (mirror of the name fix above)
				ns: { value: ns, configurable: true }
			});

			/* a clean instance interface: the Instance methods layered over the native
				prototype, on a plain object so function junk (name/length) can't shadow
				element properties
			*/
			const iface = $create(tagProto); // the Instance method layer over the PER-TAG link (engine mode retargets to tagParent so trap fall-through never re-enters the Meta)
			_IFACES.push(iface);
			for (const key of Reflect.ownKeys(Instance.prototype))
				if (key !== 'constructor')
					defineProperty(iface, key, $ownDesc(Instance.prototype, key));

			/* the static face: relay every symbol static installed on Instance (the hooks + the well-knowns)
				onto BaseCtor, so static blocks and class-level well-knowns resolve via readStatic. Skip species
				— Instance pins it non-configurable, and element classes keep their inherited species. */
			for (const k of Object.getOwnPropertySymbols(Instance)) {
				if (k !== Symbol.species) {
					defineProperty(BaseCtor, k, $ownDesc(Instance, k)); // @@hasInstance: Metas keep OrdinaryHasInstance so `x instanceof Div` stays tag-specific (Pass Q5)
				}
			}
			/* the STRING protocol (Pass Q8b·search): the five regex well-knowns live on
			 * WellKnownSymbols.prototype (instance face). Relay them onto the class too, so
			 * `query.search(Card)` dispatches to the same body with this===Card — the
			 * `typeof this === 'function'` branch searches Card[ELEMENTS] and returns a
			 * registry index. Both receivers, one implementation. */
			for (const k of [Symbol.search, Symbol.match, Symbol.matchAll, Symbol.replace, Symbol.split]) {
				const d = $ownDesc(WellKnownSymbols.prototype, k);
				if (d) defineProperty(BaseCtor, k, d);
			}
			for (const k of ['flags', 'global']) { // matchAll reads .flags off the class before dispatch
				const d = $ownDesc(WellKnownSymbols.prototype, k);
				if (d) defineProperty(BaseCtor, k, d);
			}

			const readStatic = (prop, receiver) => {
				if (prop === 'this') { // canonical this-chain, static face (Q3 formula + Q6 skip-self: in engine shape the Meta sits behind the per-tag proto and must not answer for itself)
					if (receiver === Instance) return globalThis;
					let pp = receiver.prototype && getPrototypeOf(receiver.prototype);
					let c = pp && (typeof pp === 'function' ? pp : pp.constructor);
					if (c === receiver) { pp = pp && getPrototypeOf(pp); c = pp && (typeof pp === 'function' ? pp : pp.constructor); }
					return c || getPrototypeOf(receiver);
				}
				if (typeof prop === 'string' && prop.length && prop.charCodeAt(0) >= 48 && prop.charCodeAt(0) <= 57 && /^\d+$/.test(prop)) {
					let _r; try { _r = receiver[ELEMENTS]; } catch (e) { _r = null; } // numeric class indexing: Div[0] is the first LIVE div (native array semantics over the registry)
					return Array.isArray(_r) ? _r[+prop] : undefined;
				}
				const desc = $ownDesc(BaseCtor, prop);
				if (desc) return desc.get ? desc.get.call(receiver) : desc.value;
				if (prop === 'teardown') return function (u) { return this[DISPOSE](u); }.bind(receiver); // named aliases over the symbol verbs (Pass Q4)
				if (prop === 'teardownAsync') return function (u) { return this[ASYNC_DISPOSE](u); }.bind(receiver);
				const _cm = COLLECTION_STATIC.get(prop);
				if (_cm) return _cm.bind(receiver);          // collection query over Class[ELEMENTS]
				/* [0.89.3] Instance's OWN statics reach the tag face. The Meta's target is a
				 * synthesized BaseCtor, so a static declared on Instance (pause/resume, and
				 * anything added later) was invisible from Div/TabbyDiv — the static chain
				 * dead-ended at the target. Bind to the receiver so `this` is the class the
				 * caller named, not Instance. */
				const _st = $ownDesc(Instance, prop);
				if (_st) {
					const v = _st.get ? _st.get.call(receiver) : _st.value;
					return typeof v === 'function' ? v.bind(receiver) : v;
				}
				/* [0.89.i] …and finally the PROTOTYPE CHAIN, which this used to drop on the
				 * floor with a bare `return undefined`. Both lookups above are OWN-descriptor
				 * only, so everything a class inherits from Function.prototype and
				 * Object.prototype vanished: `K.hasOwnProperty`, `K.toString`, `K.call` and
				 * `K.propertyIsEnumerable` were all undefined on ANY Instance class, with or
				 * without statics. A native class has them, and code that feature-tests a
				 * constructor reasonably expects them.
				 * Reflect.get walks the chain and binds accessors to the receiver, so an
				 * undeclared static still reads undefined — nothing new is exposed, only what
				 * the platform already puts there. */
				return Reflect.get(BaseCtor, prop, receiver);
			};

			const PRISTINE_PARENT = getPrototypeOf(tagProto);   // captured BEFORE any engine splice
			const Meta = new Proxy(BaseCtor, {
				construct(target, args, newTarget) {
					/* [session — CONSTRUCTION IS OPAQUE, owner ruling]. An object under construction
					 * must not leak subscriptions to whoever happens to be building it: without this
					 * wrap, an effect that does `new Item()` subscribes to every field the child's
					 * constructor reads, and later pokes to the child re-run the parent and build
					 * DUPLICATES (measured). untrack pauses edge recording for the synchronous body
					 * only; ctor door-effects still collect for THEMSELVES (runNode sets its own
					 * context), and — bonus — ctor-minted nodes are no longer adopted under the outer
					 * effect, so its re-runs cannot disposeChildren them. */
					const el = Signal.untrack(() => Reflect.construct(target, args, newTarget));
					try { if (el && typeof el === 'object') registerPristine(el, tagProto, PRISTINE_PARENT); } catch (e) {}
					return el;
				},
				/* [0.89.2] `has` — without this trap the default forwards to the TARGET, a
				 * function, so 'name'/'length'/'prototype' report true for every element
				 * whose chain contains the Meta (all Instance elements today; every element
				 * of a spliced tag under engine mode). `in` is the backbone of feature
				 * detection, so the leak is not cosmetic. The trap gets no receiver, so it
				 * answers for the ELEMENT face — the one that is page-visible — by consulting
				 * the native interface; the store answers for declared fields. */
				has(target, prop) {
					if (typeof prop === 'string' && prop.length > 1 && HANDLE_LANE.test(prop)) return true;
					if (Reflect.has(iface, prop)) return true;
					/* Proxy invariant: a `has` trap may not report false for a NON-CONFIGURABLE
					 * own property of the target. `prototype` on a normal function is exactly
					 * that, so it is the one name that cannot be hidden — harmless, since
					 * nothing feature-detects `prototype` on an element. Everything else
					 * (name/length/arguments/caller) is configurable and now answers false. */
					const d = Reflect.getOwnPropertyDescriptor(target, prop);
					return !!(d && !d.configurable);
				},

				get(target, prop, receiver) {
					/* doc:C-ADOPT */
					/* a store answers REACTIVE_STORE from its own property and never reaches this
					 * trap for it; a receiver that does reach it — on either face — has no store,
					 * and saying so here is what keeps storeOf's own-property test from recursing */
					if (prop === REACTIVE_STORE) return undefined;
					if (typeof receiver === 'function') {
						/* [0.89.8] CLASS-SIDE THENABLE. The virtual `then` was only ever
						 * reachable on the instance face — the static branch returns before
						 * the check below, so `await Klass` never joined the class's own
						 * settlement. Restored here: a class with pending static async
						 * fields is awaitable exactly while it is pending, and thenFor()
						 * deletes the AWAITING entry BEFORE resolving, so the class stops
						 * being thenable the moment it settles. That is what keeps it safe —
						 * a permanently-thenable class would make every `await SomeClass`
						 * and every class returned from an async function behave oddly. */
						if (prop === 'then') return AWAITING.has(receiver) ? thenFor(receiver) : undefined;
						/* the class store answers first, on the same lane as the element face —
						 * which is what makes `unpend` apply here too. ss.get() canonicalises, so
						 * a tier-glyphed static finds its own cell; fall through only on a miss. */
						/* [0.89.i] WALK THE CHAIN FOR THE STORE. `storeOf(receiver)` finds a store
						 * only on the class that declared the static, so a SUBCLASS never saw it:
						 * `A.foo` read 1 while `AB.foo` read undefined, where native gives 1 for both.
						 * Statics are inherited on the platform, and the store is where ours live, so
						 * the lookup has to climb the same chain a native property lookup would. The
						 * FIRST store holding the key wins, which is the shadowing rule too. */
						let _cs = null;
						if (typeof prop === 'string' && !isAcc(prop)) {
							for (let _C = receiver; _C; _C = getPrototypeOf(_C)) {
								const _s = storeOf(_C);
								if (_s && sRead(_s, prop) !== undefined) { _cs = _s; break; }
							}
						}
						if (_cs) {
							/* [0.89.i] TDZ, CLASS SIDE ONLY. A pending static reading `undefined` is
							 * indistinguishable from a settled-to-undefined one and from an absent
							 * key, so `await K` meaning anything was unobservable — the guarantee and
							 * its absence looked identical. Throwing separates them.
							 * Statics settle ONCE, so this is a deterministic ordering bug and never
							 * a race; statics are SHARED, so a half-configured class is systemic; and
							 * templates render INSTANCES, so the element value lane stays renderable
							 * and keeps painting placeholders. A FAN is never seeded, so it holds no
							 * PENDING and cannot trip this — reading one early is its contract. */
							/* the CANONICALISING read, once: `dict.get(prop)` misses a tier-glyphed name,
							 * the same gap that made an own accessor return undefined for every $-tier
							 * static. Call it once — it tracks. */
							const _raw = sRead(_cs, prop);
							if (_raw === PENDING) tdz(prop, receiver);
							const _cv = unpend(_raw);
							if (_cv !== undefined) return _cv;
						}
						return readStatic(prop, receiver); // STATIC: receiver is the class
					}
					
					const ss = storeOf(receiver); // INSTANCE: per-element store
					if (ss) {
						if (isAcc(prop)) return prop === 'ψ' ? sDoor(ss, 'ψ', receiver)
				: sDoor(ss, (prop === 'Φ' || prop === 'ø') ? '$' : prop === 'ΦΦ' ? '$$' : prop);   // doors [split-lane]: $ atomic-union · $$ atomic-consensus · Δ/ΔΔ union sh/deep · Σ/ΣΣ consensus sh/deep · ø/Φ legacy aliases · '_' ergonomic→ø · @ · ψ
						/* [0.89.2] THE HANDLE LANE — '.name' atomic · '_.name' · '$.name' · '$$.name'.
						 * A leading dot cannot collide with any DOM property or JS identifier, ever.
						 * PROPERTY access is a TRACKED retrieval: the key subscribes. */
						if (typeof prop === 'string' && prop.length > 1) {
							const hm = HANDLE_LANE.exec(prop);
							if (hm && prop.slice(hm[0].length).length) {
								const h = doorOf(ss, hm[1])[prop.slice(hm[0].length)];
								if (h) { try { Signal.track(h); } catch (e) {} }
								return h;
							}
						}
						if (typeof prop === 'string' && sHas(ss, prop)) {
							/* [0.89.5] VALUE LANE — COLD at every tier (owner-ruled). A bare name
							 * is just a read: `this.count`, `this.$theme`, `this.$$stats` all
							 * return the value and register nothing. Subscribing is what the
							 * DOOR is for — `this.$.theme` reaches through and takes the edge.
							 * One rule, no tier exceptions. */
							if (isRK(prop)) {
								/* [0.89.c] COLD READ — untracked, but the LIVE value.
								 * This first used peek(), which returns the RAW target rather
								 * than the reactive view. Deep fields then broke silently:
								 * `el.$$stats.hp.now = 9` mutated the bare object, so the write
								 * landed and every read saw it, but the proxy's set trap never
								 * ran and nothing was ever notified. Value correct, graph dead —
								 * the worst shape a bug can take.
								 * Signal.untrack ran the ordinary read with edge registration
								 * suppressed: same object the hot lane returns, no subscription.
								 * [session — OWNER DOCTRINE CHANGE] THE TRACKING CONTEXT. The
								 * untrack wrapper is REMOVED: track() already no-ops outside a
								 * run, so at top level / in third-party code / in console.log
								 * this is still peek-and-set, while INSIDE a formula or effect a
								 * bare read takes the edge. "Bare is cold at every tier" is
								 * overturned deliberately, on failure asymmetry: cold-bare fails
								 * SILENT (a missing edge is a wrong value forever); context-bare
								 * fails LOUD (an extra edge is an extra re-run, values stay
								 * correct). Opt-out inside a run: Signal.untrack(fn) / h.peek(). */
								const __ao = Signal.activeOwner ? Signal.activeOwner() : undefined;
								if (__ao !== undefined && __ao !== ss) { const __p = Signal.pauseTracking(); try { return unpend(sRead(ss, prop), prop, receiver); } finally { Signal.resumeTracking(__p); } } // FOREIGN: peek, closure-free
								return unpend(sRead(ss, prop), prop, receiver);
							}
							const _dr = DERIVED.get(receiver);
							if (_dr && _dr.has(prop)) return unpend(_dr.get(prop).get.call(receiver), prop, receiver);  // bare accessor pair: raw getter, quiet
							const _ref = dictOf(ss).get(prop);
							const _h = _ref != null ? Signal.deref(_ref) : null;
							/* [session — TRACKING CONTEXT, lane 2 of 2] unsigiled bare keys used the peek
							 * shortcut, which suppressed edges even inside a run. get() is the same read on
							 * the same plane — track() no-ops outside a run, so peek-and-set survives at
							 * top level while formulas take their edges. */
							if (_h && typeof _h.get === 'function') { try { const __ao2 = Signal.activeOwner ? Signal.activeOwner() : undefined; return unpend((__ao2 !== undefined && __ao2 !== ss) ? _h.peek() : _h.get()); } catch (e) {} }
							return unpend(sRead(ss, prop), prop, receiver);
						}
					}
					
					if (prop === 'this') return MINTED.get(receiver) ?? receiver.constructor; // canonical this-chain, instance face: this.this → the class it was minted as (Pass Q3)
					if (prop === 'then')
						return AWAITING.has(receiver) ? thenFor(receiver) : undefined; // virtual await-new thenable
					const _v = Reflect.get(iface, prop, receiver); // the native / Instance interface wins
					if (_v !== undefined) return _v;
					let __ln; try { __ln = receiver.localName; } catch (e) { __ln = void 0; } // exotic receivers (Object.create over a Meta, brand-mismatched hosts) must not detonate the internal probe — host accessors brand-check `this` (Pass Q)
					if (prop === __ln && _NAMESPACES.has(prop)) return _nsFacade(receiver); // el.form, el.input, … (Pass I)
					return _v;
				},

				set(target, prop, value, receiver) {

					/* THE CLASS SIDE IS THE SAME SIDE. This read `return Reflect.set(...)` — a
					 * raw write defining a plain own DATA property that thereafter shadowed
					 * every read. Measured: a seeded static handed back the raw Symbol(??)
					 * (no getter to unpend at), and a static was not reactive at all (an
					 * effect re-ran 0 times against the instance side's 1). The trap already
					 * fires for a class — the Meta is in its prototype chain — so all that
					 * was missing is a store to write into: the class itself (C-ADOPT). */
					if (typeof receiver === 'function' && typeof prop === 'string' && !isAcc(prop)
						&& !INTRINSIC_CLASS_KEYS.has(prop) && !storeOf(receiver)) adoptClass(receiver);
					if (typeof receiver === 'function' && !storeOf(receiver))
						return Reflect.set(target, prop, value, receiver);
					const ss = storeOf(receiver);
					if (ss && typeof prop === 'string' && !isAcc(prop)) {
						/* [0.89.2] TOTAL VIRTUALIZATION: the first [[Set]] IS the declaration.
						 * Order: (1) a registered accessor pair routes through its setter — the
						 * SET is the notification point; (2) an INTRINSIC name (pristine per-tag
						 * probe, never the live chain — Function.prototype leaks 'name'/'length'
						 * through the spliced Meta) falls through to the native accessor, exactly
						 * as before; (3) everything else mints or updates a cell. Sigil or no
						 * sigil: every property is reactive; bare is simply the ATOMIC tier. */
						const _dr = DERIVED.get(receiver);
						if (_dr && _dr.has(prop)) {
							const d = _dr.get(prop);
							if (d.node) { d.node.set(value); return true; }        // manual atomic: setter + notify
							if (d.set) { d.set.call(receiver, value); return true; } // sigiled computed with a setter: write-through
							throw new TypeError(`Cannot write derived field "${prop}": it is computed from other state. Give it a setter to make it writable.`);
						}
						/* a HANDLE assigned to a native property is a BINDING */
						if (INTRINSIC(receiver, prop) && value instanceof Signal)   // a minted HANDLE; an adopted host — an element, a class — assigned to a native property is a value
							return bindNative(receiver, prop, value, iface);
						/* [0.89.o] INTERFACE GUARD. A class that implements a typed contract
						 * carries it as a static; every write to a named member is checked here,
						 * ahead of BOTH write paths (glyphed and bare). The settlement sentinels
						 * are exempt — seeding writes PENDING before any value exists. */
						ifaceGuard(receiver, prop, value);
						if (!INTRINSIC(receiver, prop)) {
							/* [0.89.d v2] a TIER-GLYPHED name stays fully VIRTUAL: the store writes it
							 * under its CANONICAL key, so an own accessor reading the literal name
							 * misses forever (measured: every $-tier read came back undefined).
							 * The glyph test, not isAcc, is the virtualization boundary. */
							if (/[$\u03a3\u0394\u03a6\u00f8]/.test(prop)) {
								{ const _dg = dictOf(ss); if (!(_dg && _dg.has(prop)) && !Reflect.isExtensible(receiver)) return false; }
								sWrite(ss, prop, value); return true;
							}
							/* BARE first touch: install the own accessor, then write through it.
							 * Subsequent access never reaches this trap. On a frozen receiver
							 * defineProperty throws — the platform's refusal of a new key. */
							markFreezable(receiver);
							/* doc:C-DESCRIPTOR */
							/* The ROW decides; where it says null, the FACE decides — a class shows its
							 * statics, an element hides its fields. A bare field has no row, so it is
							 * configurable like a native field. */
							const _row = fieldFlags(receiver, prop) || BARE_ROW;
							const _e = _row.e != null ? _row.e : typeof receiver === 'function';
							const _c = _row.c != null ? _row.c : true;
							/* A first touch is a FRESH install. A pliable field may have been deleted
							 * and re-added — a test mocking it — and its old seal must not outlive the
							 * accessor it belonged to. A locked field can never be deleted, so it never
							 * comes back through here. */
							{ const _s = SEALED.get(receiver); if (_s) _s.delete(prop); }
							/* doc:C-CASCADE — a SEED is not a definition: hidden, pliable, no row yet */
							try { if (value === PENDING) seedKey(receiver, prop); else defineProperty(receiver, prop, bareDescriptor(prop, _e, _c, receiver)); }
							catch (_) { return false; }
							return Reflect.set(receiver, prop, value);
						}
					}

					return Reflect.set(iface, prop, value, receiver);
				}
			});
			Meta.prototype = Meta;                 // NON-ENGINE (visible Meta): el → Meta → tagProto → native…
			setPrototypeOf(Meta, tagProto);        // …and the default-trap forwarding (has/gOPD/get-miss) continues down the per-tag chain
			/* ── the engine-mode splice (Pass Q6): same architecture, the Meta changes SLOT.
			 *    ENGINE (hidden Meta): el → tagProto (gp() NATIVE) → Meta → tagParent → …
			 *    apply(on) is toggle-symmetric; powerup/powerdown drive it per pair. */
			/* [0.89.2] THE SPLICE IS INTRINSIC — applied once, here, never reversed.
			 *   el → tagProto (NATIVE, or the synth for tags the platform left shared)
			 *      → Meta → tagParent → …
			 * One arrangement forever. The old design toggled between a visible Meta
			 * (el → Meta → tagProto) and this one, and the reverse branch ORPHANED every
			 * element built while engine was on: powerdown pulled the Meta out of
			 * tagProto's chain, so those elements lost their store and every $field read
			 * undefined. That bug lived entirely in the transition; with no transition it
			 * cannot exist. ⚡ is now purely the CONSTRUCTOR redirect. */
			try { Meta.prototype = tagProto; } catch (e) {}
			setPrototypeOf(Meta, tagParent);
			setPrototypeOf(tagProto, Meta);        // per-TAG — can never leak across tags
			setPrototypeOf(iface, tagParent);      // trap fall-through skips the Meta (no re-entry)
			_ENGINE.pairs.push([tagProto, Meta, null]);
			if (_ENGINE.on) _engineSwapCtor(tagProto, Meta);
			defineProperty(Meta, 'constructor', { value: Meta, configurable: true, writable: true });
			return Meta;
		}

		static #customMetas = new Map(); // classname-tag → minted Meta (element-mode)
		static #spliced = new WeakSet(); // classes already rebased onto a Meta

		/* Resolve the static-is contract for a leaf class. Also performs the ONE-TIME
		 * chain splice for element-mode: the topmost user class sitting directly on
		 * Instance is rebased onto a freshly minted per-classname Meta, so both the
		 * static face (id/ns) and the instance chain flow through the metaclass:
		 *   {{Sub}} → {{Top}} → Meta(<topname>) → native proto (HTMLUnknownElement). */
		static #isContract(NT) {
			if (!NT || NT.prototype === NT) return null; // a Meta constructed directly: legacy path
			const isMeta = (K) => !!K && (K.prototype === K || (typeof K === 'function' && K.prototype && getPrototypeOf(K.prototype) === K)); // both shapes: self-prototype (non-engine) OR the per-tag proto pointing back (engine splice, Pass Q6)
			const ownStatic = (key) => {
				for (let p = NT; p && p !== Instance && !isMeta(p); p = getPrototypeOf(p)) {
					const d = $ownDesc(p, key);
					if (d && typeof d.value === 'string') return d.value;
				}
				return null;
			};
			const mode0 = ownStatic('is');
			const name = NT.name || 'Anonymous';
			if (mode0 === 'data') return { mode: 'data' };

			const metaFor = (tag, display) => {
				let M = Instance.#customMetas.get(tag);
				if (!M) { M = Instance.#metaclass({ id: tag, toString() { return display; } }, ownStatic('namespace') || 'html'); Instance.#customMetas.set(tag, M); }
				return M;
			};
			const rebase = (K, M) => { setPrototypeOf(K, M); setPrototypeOf(K.prototype, M); Instance.#spliced.add(K); };
			// splice: any chain arriving here must flow through a Meta — statics (id/ns)
			// and the instance chain both need it. Explicit 'element' claims its own tag
			// at THIS class; otherwise the topmost class sitting on bare Instance rebases
			// (web-compat → the div Meta; default → a minted Meta for its own name).
			if (mode0 === 'element') {
				if (!Instance.#spliced.has(NT)) { rebase(NT, metaFor(name.toLowerCase(), name)); CUSTOM_TAGS.set(name.toLowerCase(), NT); } // first mint indexes the tag — declarative upgrades need no explicit define()
			} else {
				let top = NT, q;
				while ((q = getPrototypeOf(top)) && q !== Instance && !isMeta(q)) top = q;
				if (q === Instance && !Instance.#spliced.has(top)) {
					rebase(top, mode0 === 'web-compat'
						? metaFor('div', 'Div')
						: metaFor((top.name || name).toLowerCase(), top.name || name));
					if (mode0 !== 'web-compat') CUSTOM_TAGS.set((top.name || name).toLowerCase(), top); // own-tag mode only — <div data-is> carriers are not upgrade targets
				}
			}
			const mode = mode0 || (Instance.#spliced.has(NT) ? 'element' : 'web-compat');
			/* static sigil lift (Pass Q2): `static $label = v` on a leaf class becomes a
			 * CLASS-LEVEL signal — one per defining class, shared by every instance (the
			 * broadcast bus). Reads are tracked (effects subscribe), writes notify. The
			 * accessor is idempotent (data desc → accessor once); frozen classes skip,
			 * same doctrine as the toStringTag brand below. Subclasses inherit the
			 * accessor through the class chain and therefore SHARE the defining class's
			 * signal — that is the point. $-tier only; Δ/ø statics stay literal for now. */
			if (Object.isExtensible(NT)) {
				for (const __k of Object.getOwnPropertyNames(NT)) {
					if (!/^[$ΔΣ]/.test(__k) || __k.length < 2) continue;   // [split-lane] any tier sigil lifts
					const __d = $ownDesc(NT, __k);
					if (!__d || !('value' in __d) || typeof __d.value === 'function' || !__d.configurable) continue;
					/* doc:C-ADOPT — the store is the CLASS, the same one its trap writes reach
					 * (this kept a second Store per class, closed over by these accessors) */
					if (!storeOf(NT)) adoptClass(NT);
					sWrite(NT, __k, __d.value);
					const __key = __k;
					defineProperty(NT, __key, {
						get() { return sRead(NT, __key); },  // tracked — an active Effect subscribes here
						set(v) { sWrite(NT, __key, v); },    // writethrough — triggers subscribers
						configurable: true, enumerable: !!__d.enumerable
					});
				}
			}
			if (!$ownDesc(NT.prototype, Symbol.toStringTag) && Object.isExtensible(NT.prototype))
				defineProperty(NT.prototype, Symbol.toStringTag, { get() { return name; }, configurable: true }); // a user-frozen class prototype simply keeps the default tag — branding must not throw the mint (Pass Q)
			if (mode === 'web-compat')
				return { mode, dataIs: name, adopted: _adoptClaim('[data-is="' + name + '"]') };
			return { mode: 'element', adopted: _adoptClaim(String(NT.id || name).toLowerCase()) };
		}

		// ── #proxify — the lowercase variant (div vs Div); raw elements aren't callable, so no arg-unwrap ──
		static #proxify(Metaclass) {
			return new Proxy(Metaclass, {
				apply(_, __, args) { return new Metaclass(...args) },
				construct(_, args) { return new Metaclass(...args) },
				get(_, prop) { return prop === INSTANCE ? Metaclass : Metaclass[prop] }
			});
		}

		// ── manual generation API: one class (define) / a bucket set (defineAll) ──
		static define(tag, ns = 'html', convention = 'pascalite') {
			/* custom-class overload — define(Klass): index an Instance-extender for
			 * declarative upgrading (boot ring for CORE_TAGS; ⚡⚡ super mode for the
			 * rest). Tag = static id (if declared) else the lowercased class name;
			 * REGISTRY gains the class under its own name so Instance.elements sees
			 * it and a later define('tag') round-trips to the same class. */
			if (typeof tag === 'function' && tag.prototype !== tag) {
				const Klass = tag;
				const custom = String(($ownDesc(Klass, 'id') && Klass.id) || Klass.name).toLowerCase();
				CUSTOM_TAGS.set(custom, Klass);
				REGISTRY[Klass.name] ??= Klass;
				return Klass;
			}
			const lexeme = new Lexeme(tag, convention);
			const className = String(lexeme);
			if (REGISTRY[className]) return REGISTRY[className];
			const ElementClass = Instance.#metaclass(lexeme, ns);
			REGISTRY[className] = ElementClass;
			/* expose globally for `class App extends Div` — skip names colliding with
	critical natives (Image/Option/…); those stay reachable via Instance.elements */
			if (
				!JSDOM.ISBADDIE.test(className) &&
				!(className in global && JSDOM.ISBADDIE.test(className))
			) {
				global[className] = ElementClass;
			}
			return ElementClass;
		}
		static defineAll(nameSets, convention) {
			for (const ns of ['core', 'math', 'svg'])
				for (const tag of nameSets[ns] || [])
					this.define(tag, ns === 'core' ? 'html' : ns, convention);
		}

		// ── #initialize — synchronous, config-driven shape generation (restored from the class era) ──
		// Reads the bootstrapping <script>'s autoclass/typeset (falls back to DEFAULT_SET
		// + pascalite when there's no script, e.g. under Node), then defines each class on
		// CTX with an ifndef collision guard, a lowercase variant, and every typeset alias.
		static #initialize(CTX) {
			if (this.#once) return;
			this.#once = true;

			const CONFIG = new AttributeParser(THIS_SCRIPT, {
				typeset: () => {},
				autoclass: () => {},
				engine: () => {},
				super: () => {},
				mode: { strict: ['flexible', 'strictest'] },
				events: true,
				noglobals: [false, [true, 'init']],
				debug: [false, [true, 'init']]
			}) ?? { engine: null };

			Instance.#debugger = !!CONFIG.debug; // the `debug` script attribute now drives the debug-gated warner
			if (CONFIG.engine) this.powerup();          // <script engine> boots engine mode
			if (CONFIG.super) this.superup();           // <script super> boots ⚡⚡ (implies engine mode)

			const NAMESPACES = CONFIG.autoclass || DEFAULT_SET; // { core:Set, math:Set, svg:Set }
			const typesetList = CONFIG.typeset || [{ key: 'pascalite', value: null }]; // [master, …aliases]; each { key: convention, value: prefix }
			const [MasterConvention, ...ALIASES] = typesetList;
			const { key: convention, value: prefix } = MasterConvention;
			const MODE = (() => {
				switch (this.mode) {
					case 'flexible': return { writable: true, configurable: true, enumerable: false };
					case 'strictest': return { writable: false, configurable: false, enumerable: false };
					default: return { writable: false, configurable: true, enumerable: false };
				}
			})();

			for (const NAMESPACE of Object.getOwnPropertyNames(NAMESPACES)) {
				// core, math, svg
				const ns = NAMESPACE === 'core' ? 'html' : NAMESPACE;
				for (const TAG of NAMESPACES[NAMESPACE]) {

					const LEXEME = new Lexeme(TAG, convention).prefix(prefix).suffixize(JSDOM.ISBADDIE, 'Element');
					const className = String(LEXEME);

					ifndef(CTX, LEXEME,
						() => {
							// collision-safe global definition
							const Metaclass = (REGISTRY[className] ??= Instance.#metaclass(LEXEME, ns));
							Reflect.defineProperty(CTX, LEXEME, Object.assign({ value: Metaclass }, MODE));
							_MINTED_GLOBALS.add(className);

							const lower = LEXEME.toLowerCase();
							ifndef(CTX, lower, () =>
								_MINTED_GLOBALS.add(lower) && Reflect.defineProperty(CTX, lower, {
									get: () => Instance.#proxify(Metaclass),
									configurable: true,
									enumerable: false
								})
							);
							ALIASES.forEach(({ key: conv, value: pref }) => {
								// every extra convention → another global → same Metaclass
								const ALT = LEXEME.alias(conv).prefix(pref).suffixize(JSDOM.ISBADDIE, 'Element');
								ifndef(CTX,ALT, 
									() => { _MINTED_GLOBALS.add(String(ALT)); return Reflect.defineProperty(CTX, ALT, Object.assign({ value: Metaclass }, MODE)); },
									() => this.debug(`@${conv} [${ALT}]: alias overlaps an existing property. Skipping.`)
								);
							});
						},
						() => Instance.#warn(`Class [${className}] could not be defined. Skipping.`)
					);
				}
			}
		}
		/* ══ LIFECYCLE ═════════════════════════════════════════════════════════
		 * Merged in from `class Lifecycle extends Interface`, which sat below and was
		 * grafted on by `new Lifecycle({ target: Instance, 'proto=>proto': true })`.
		 * That splice put these instance members on Instance.prototype at runtime, so
		 * the merge changes WHERE they are written, not where they end up.
		 *
		 * Safe because nothing overlapped: 10 public statics, 16 private statics and 12
		 * instance members against Instance's 25/10/2, with zero name clashes in any of
		 * the four groups — checked on the AST, not by eye. Lifecycle used no super.*,
		 * so `extends Interface` bought it nothing except the splice it no longer needs.
		 * ══════════════════════════════════════════════════════════════════════════ */


	/* ════════════════════════════════════════════════════════════════════════
		* §10 — bootstrap: scan the page, generate elements, compile + run
		* ════════════════════════════════════════════════════════════════════════ */

	/* ════════════════════════════════════════════════════════════════════════
		* §6.5 — lifecycle + lifetime. The imperative methods (detach / reattach /
		*   dispose) are synchronous and deterministic: each performs the DOM operation,
		*   then fires the lifecycle hooks AFTER it with an explicitly-captured ctx
		*   (the element's own parent is gone once it has left), then flags the element
		*   so the observer ignores the record the operation produced. The
		*   MutationObserver is the nondeterministic FALLBACK — it runs the same
		*   transitions only for raw mutations that bypassed the API (adversarial input,
		*   forgetfulness). An element's lifetime is decoupled from its DOM presence:
		*   leaving the DOM detaches (state preserved across any gap); only dispose
		*   tears down, bridging into Chimera's deletion lifecycle. Hooks splice via
		*   the no-op hooks + imperative surface (folded into Lifecycle here); observer, fire logic,
		*   lifetime state and kernel reclaim live on Instance.
		*     ['@insertion'](ctx)  every entry      ['@removal'](ctx)  every exit (never tears down)
		*     ['@mount'](ctx)      first entry only  ['@unmount'](el)   on dispose only — teardown is always explicit
		*     ['@rendered'](el)    post-paint, once  ctx = the parent at the transition (former parent on exit)
		*   el.detach() ≡ el.remove()    leave the DOM, stay alive (the default for any removal)
		*   el.reattach(parent, before?) return to the DOM, mount state intact
		*   el.dispose() ≡ unmount() ≡ remove(true)   the only teardown: @unmount + free the reactive scope
		* ════════════════════════════════════════════════════════════════════════ */

		static #mounted = LC_MOUNTED; // @mount has fired, once-ever
		static #detached = LC_DETACHED; // off-DOM but alive — the default for any removal
		static #handledExit = LC_HANDLED_EXIT; // explicit exit ran — observer skips that removal record
		static #handledEnter = LC_HANDLED_ENTER; // explicit enter ran — observer skips that addition record

		static #observer = null;
		static #raf = globalThis.requestAnimationFrame?.bind(globalThis) ?? (fn => setTimeout(fn, 16));

		// detach: leave the DOM, stay alive. Unlink, then fire @removal after it with the
		// parent captured beforehand, then flag the element so the observer skips the record.
		static detach(el) {
			if (!doc?.contains(el)) return el;
			const parent = el.parentElement; // ctx, captured before the op — gone after
			el.parentNode.removeChild(el);
			Instance.#sweep(el, e =>
				Instance.#onExit(e, e === el ? parent : e.parentElement)
			);
			Instance.#handledExit.add(el);
			return el;
		}

		// visit a node and every managed descendant
		static #sweep(node, visit) {
			if (node[LEAF]) visit(node);
			const walker = doc.createTreeWalker(node, 0x1, {
				acceptNode: el => (el[LEAF] ? 1 : 3)
			}); // SHOW_ELEMENT ; ACCEPT : SKIP
			for (let el = walker.nextNode(); el; el = walker.nextNode()) visit(el);
		}

		/* ── live-DOM registry (Pass Q3): an element EXISTS in Class[ELEMENTS] only while
		 * it is in the document. Detach splices it out (native array semantics — indices
		 * shift); its slot is remembered, and a reattach re-inserts it at the same spot:
		 * [a,(b),c] → detach b → [a,c] → reattach b → [a,(b),c]. Dispose forgets forever.
		 * Because the registry only ever references connected elements, it cannot pin
		 * memory the document isn't already pinning — the leak class is gone by
		 * construction, no WeakRef indirection needed. */
		static #regIdx = new WeakMap(); // el → last index (consumed by the next register)
		static #registryOf(el) {
			let C = MINTED.get(el);
			if (typeof C !== 'function') { try { C = el.constructor; } catch (e) { C = null; } } // fallback: in-place upgrades and adopted natives
			if (typeof C !== 'function') return null;
			let reg; try { reg = C[ELEMENTS]; } catch (e) { reg = null; }
			if (!Array.isArray(reg)) { reg = []; try { C[ELEMENTS] = reg; } catch (e) { return null; } }
			return reg;
		}
		static register(el) {
			const reg = Instance.#registryOf(el);
			if (!reg || reg.indexOf(el) !== -1) return;
			const at = Instance.#regIdx.get(el);
			if (at !== undefined) { Instance.#regIdx.delete(el); reg.splice(Math.min(at, reg.length), 0, el); }
			else reg.push(el);
		}
		static deregister(el, forget) {
			const reg = Instance.#registryOf(el);
			if (reg) {
				const idx = reg.indexOf(el);
				if (idx !== -1) { reg.splice(idx, 1); if (!forget) Instance.#regIdx.set(el, idx); }
			}
			if (forget) Instance.#regIdx.delete(el);
		}

		// exit transition: fire @removal, then mark detached — preserve, never tear down
		static #onExit(el, ctx) {
			this.deregister(el); // out of the document ⇒ out of the registry (index remembered)
			Instance.#fire(el, '@removal', ctx);
			Instance.#detached.add(el);
		}

		// fire one hook (adapted from 0.73.m _fireLC). ctx is explicit because hooks fire
		// AFTER the op; the return is surfaced so the async path can await it.
		static #fire(el, key, ctx) {
			const method = el[key];
			if (typeof method !== 'function' || method === Instance.prototype[key]) return; // an override, not the no-op default
			try {
				return method.call(el, ctx);
			} catch (e) {
				console.warn(`[Instance] ${key}() error:`, e);
			}
		}

		// reattach: return to the DOM, mount state intact
		static reattach(el, parent, before = null) {
			if (!parent) return el;
			parent.insertBefore(el, before);
			Instance.#sweep(el, e => Instance.#onEnter(e, e.parentElement));
			Instance.#handledEnter.add(el);
			return el;
		}

		// enter transition: clear a pending detach, fire @insertion, @mount the first time
		static #onEnter(el, ctx) {
			Instance.#detached.delete(el);
			this.register(el); // back in the document ⇒ back in the registry, at the remembered spot
			Instance.#fire(el, '@insertion', ctx);
			if (Instance.#mounted.has(el)) return;
			Instance.#mounted.add(el);
			Instance.#fire(el, '@mount', ctx);
			Instance.#raf(() => doc.contains(el) && Instance.#fire(el, '@rendered', el)); // post-paint, the one async hook
		}

		/* enter — run the enter transition NOW, in place (no move). The seam for
		 * Instance.upgrade(): a node woken after its connection event has already
		 * passed still needs @insertion/@mount/@rendered. Does NOT flag
		 * #handledEnter — there is no pending observer record to consume, and
		 * poisoning the flag would make the observer skip a FUTURE legit addition. */
		static enter(el) {
			Instance.#sweep(el, e => Instance.#onEnter(e, e.parentElement));
			return el;
		}

		// dispose: the only teardown. Leave the DOM first, then destroy. Thenable
		// returns from @unmount listeners (exit transitions) GATE the reclaim — the
		// deferred-teardown contract. Zero thenables → fully synchronous, returns el;
		// otherwise returns Promise<el> resolving after the hooks settle.
		static dispose(el) {
			/* doc:C-ADOPT */
			/* A CLASS ASKED TO DISPOSE, with no element named, disposes ITSELF. `K.dispose()`
			 * reaches here bound to K (the class face relays Instance's statics to the class
			 * that was asked) and crashed on the missing element. The class face of disposal
			 * is DISPOSE: its live instances, then its own node. Instance itself has
			 * Instance.teardown() for that; `K.dispose(el)` still disposes the element. */
			if (el === undefined && typeof this === 'function' && this !== Instance) return this[DISPOSE]();
			if (doc?.contains(el)) this.detach(el); // @removal + ctx, flags #handledExit
			const pending = [];
			Instance.#sweep(el, e => {
				if (Instance.#mounted.delete(e)) {
					const m = LC_LISTENERS.get(e), ls = m && m.get('@unmount');
					if (ls) for (const fn of [...ls]) {
						try { const r = fn.call(e, e); if (r && typeof r.then === 'function') pending.push(r); }
						catch (err) { console.warn('[Instance] @unmount listener error:', err); }
					}
					/* harmonization (Pass P): the class-defined ['@unmount'] METHOD fires on the
					 * sync path too (it already fired on disposeAsync via #awaitHooks) — once-
					 * guarded by the #mounted.delete above; a thenable return gates the reclaim
					 * exactly like a listener's. */
					const hr = Instance.#fire(e, '@unmount', e);
					if (hr && typeof hr.then === 'function') pending.push(hr);
				}
				this.deregister(e, true); // teardown: no saved slot, no resurrection
				try { e[PROXIES] && e[PROXIES](DISPOSE); } catch (err) {} // workers/sockets/listeners die with their element
				{ const _es = _EVT_SUBS.get(e); if (_es) for (const d of [..._es]) { try { d(); } catch (err) {} } } // event subscriptions drain too (Pass Q8)
				Instance.#detached.delete(e);
			});
			const reclaim = () => { Instance.#sweep(el, e => Instance.#reclaim(e)); return el; };
			return pending.length ? Promise.all(pending).then(reclaim, reclaim) : reclaim();
		}

		// kernel bridge: dispose the element's $-field signals. Chimera's structural
		// invalidation then cascades teardown to dependents and sweeps the slots.
		/* doc:C-ADOPT */
		/* …AND THE ELEMENT'S OWN NODE. The arena holds an adopted element strongly for its
		 * node's lifetime (RULED), so dispose — the one explicit teardown — must end that
		 * lifetime: release() disposes every key (state, computeds, effects) and tags the
		 * element's node, and the recycle clears the lane that held it. Before adoption the
		 * element's separate Store handle was never disposed at all: one slot per element,
		 * held for the life of the arena. A disposed element reads as a plain element.
		 * A CLASS is reclaimed here too, by its own dispose, after its live instances
		 * (RULED, owner, 2026-10-13: dispose on a class disposes it): its statics and its
		 * static effects die with its node, and the arena lets the class go. */
		static #reclaim(el) {
			if (storeOf(el) === el) { try { sRelease(el); } catch (e) {} }
		}

		// async detach: the destructive op WAITS for an async @removal (an exit animation).
		// Order is flipped — fire while still in place, await the promise, THEN unlink.
		static async detachAsync(el) {
			if (!doc?.contains(el)) return el;
			await Instance.#awaitHooks(el, '@removal', e => e.parentElement); // fired while mounted → real parent ctx
			el.parentNode.removeChild(el);
			Instance.#sweep(el, e => Instance.#detached.add(e)); // mark detached, without re-firing @removal
			Instance.#handledExit.add(el);
			return el;
		}

		// fire a hook across the subtree, collect any thenable returns, await them all
		static async #awaitHooks(root, key, ctxOf, mountedOnly = false) {
			const pending = [];
			Instance.#sweep(root, e => {
				if (mountedOnly && !Instance.#mounted.has(e)) return;
				const result = Instance.#fire(e, key, ctxOf(e));
				if (result && typeof result.then === 'function') pending.push(result);
			});
			if (pending.length) await Promise.allSettled(pending); // a rejecting hook must not strand the rest
		}

		// async dispose: await an async @removal (animate out), then await async @unmount, then reclaim
		static async disposeAsync(el) {
			if (el === undefined && typeof this === 'function' && this !== Instance) return this[ASYNC_DISPOSE]();   // a class disposes itself (see dispose)
			if (doc?.contains(el)) await this.detachAsync(el);
			await Instance.#awaitHooks(el, '@unmount', () => el, true);
			Instance.#sweep(el, e => {
				Instance.#mounted.delete(e);
				this.deregister(e, true); // Q3 symmetry: the async path forgets forever too
				try { e[PROXIES] && e[PROXIES](DISPOSE); } catch (err) {}
				{ const _es = _EVT_SUBS.get(e); if (_es) for (const d of [..._es]) { try { d(); } catch (err) {} } }
				Instance.#detached.delete(e);
				Instance.#reclaim(e);
			});
			return el;
		}

		// observer: the nondeterministic FALLBACK, for raw / bypassed mutations only
		static start(root) {
			root ??= doc?.documentElement;
			if (Instance.#observer || !root || typeof MutationObserver === 'undefined') return; // no observer host ⇒ stay inert
			Instance.#observer = new MutationObserver(Instance.#onMutations);
			Instance.#observer.observe(root, { childList: true, subtree: true });
		}

		static #onMutations(records) {
			for (const rec of records) {
				rec.removedNodes.forEach(node =>
					Instance.#dispatch(node, Instance.#handledExit, e =>
						Instance.#onExit(e, e === node ? rec.target : e.parentElement)
					)
				); // rec.target = the former parent
				rec.addedNodes.forEach(node =>
					Instance.#dispatch(node, Instance.#handledEnter, e =>
						Instance.#onEnter(e, e.parentElement)
					)
				);
			}
		}

		static #dispatch(node, handled, visit) {
			if (!node || node.nodeType !== 1) return;
			if (handled.delete(node)) return; // an explicit method already ran this transition — consume the flag, skip
			Instance.#sweep(node, visit); // a raw mutation slipped past the API — run the transition now
		}

		static stop() {
			Instance.#observer?.disconnect();
			Instance.#observer = null;
		}

		['@insertion'](ctx) {}
		['@mount'](ctx) {}
		['@rendered']() {}
		['@removal'](ctx) {}
		['@unmount'](ctx) {}

		detach() { return Instance.detach(this); }
		reattach(parent, before) { return Instance.reattach(this, parent, before); }
		dispose() { return Instance.dispose(this); }
		unmount() { return Instance.dispose(this); }
		detachAsync()  { return Instance.detachAsync(this);  }
		disposeAsync() { return Instance.disposeAsync(this); }
		unmountAsync() { return Instance.disposeAsync(this); }
	}

	/* ════════════════════════════════════════════════════════════════════════
		* §9 — compile + execute .is source
		* ════════════════════════════════════════════════════════════════════════ */
	function compile(source) {
		if (!COMPILER) throw new Error('[Instance] InstanceCompiler is not loaded — cannot compile .is source');

		const { code, diagnostics } = COMPILER.compile(source);
		if (diagnostics)
			for (const d of diagnostics)
				if (d && d.level === 'warn') Instance.debug('[Instance]', d.message);
		return code;
	}
	/* runs compiled JS in global scope; element classes are global, so `extends Div`
		* resolves. Wrapped in an async IIFE so top-level `await new X()` works. */
	function run(source, { compiled = false, async = true } = {}) {
		const js = compiled ? source : compile(source);
		const body = async ? '(async()=>{\n' + js + '\n})()' : js;
		return (0, eval)(body);
	}

	/* the `new Lifecycle({ target: Instance, 'proto=>proto': true })` splice stood
	 * here. Its whole job was to move those members onto Instance.prototype; they
	 * are written there now, so the indirection has nothing left to do. */

	// Explicit resource management, where the runtime supports the protocol:
	//   `using el` / `await using el` — NOT wired: the empty Symbol.dispose /
	//   asyncDispose stubs were pruned in Pass O (nothing consumed them). The
	//   explicit teardown is el.dispose(); point the protocol here if/when
	//   `using` support is wanted.
	if (typeof Symbol.dispose === 'symbol')
		Instance.prototype[Symbol.dispose] = function () {
			return this.dispose();
		};
	if (typeof Symbol.asyncDispose === 'symbol')
		Instance.prototype[Symbol.asyncDispose] = function () {
			return this.disposeAsync();
		};

	void new WellKnownSymbols({ target: Instance, 'static=>static': true, 'proto=>proto': true });

/* ═════════════════════════════════════════════════════════════════════════
 * §7+ FEATURE SURFACES — everything below this line takes ONE of three forms:
 *   class X extends Interface { … }  — a surface; `void new X({ target, … })`
 *                                       is the whole install (no graft loops)
 *   function name(…) { … }           — hoisted machinery (declaration order
 *                                       is irrelevant; nothing runs at load)
 *   void new X({ … }) / assignments   — install declarations & singleton wiring
 * NO top-level `const`/`let` is DECLARED below here: state and data live in
 * the top block; element-keyed weak state is minted once, in §3.
 * ═════════════════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════════════════
 * §10.5 — ported API (0.87.3): collection · events · search · set · chain
 *   Shape from 0.76; guts rewired to the V17 store + 0.87 Instance. Custom-element/shadow tiers dropped.
 * ════════════════════════════════════════════════════════════════════════ */
function _instEffect(element, fn) {
  const store = storeOf(element);
  const node = new Signal.Effect(fn);
  if (store) dictOf(store).set('$$fx:' + (_fxSeq++), node.ref);
  return () => node.dispose && node.dispose();
}

/* ═══ §6a NETWORK UTILITIES — _looksLikeURL / _httpGET. These lived inside the
 * element VOCABULARY, which meant the router had to reach forward into the tag
 * set to fetch a URL — the wrong direction, and half of a dependency cycle.
 * They are generic, so they belong above both. ═══ */

function _looksLikeURL(k) { return /^(?:https?:\/\/|\/\/|\.{0,2}\/)/.test(k); }
// The single network-GET seam — await-import interop upgrades HERE (module URLs →
// dynamic import) without touching get()'s routing. Deferred by design (0.87.h).
function _httpGET(url, opts) {
	const F = typeof fetch === 'function' ? fetch : (typeof globalThis !== 'undefined' ? globalThis.fetch : null);
	if (!F) return Promise.reject(new Error('[Instance] get(url): no fetch in this environment'));
	return Promise.resolve(F(url, opts)).then(r => {
		const ct = (r && r.headers && r.headers.get && r.headers.get('content-type')) || '';
		return ct.includes('json') ? r.json() : r.text();
	});
}

/* ═══ §7 COLLECTION — the registry/query surface ═══
 * ONE body per verb serves BOTH faces — the typeof-this dispatch is IMPLICIT
 * in the state home, object[ELEMENTS]:
 *   this === a class (typeof 'function') → this[ELEMENTS] is the live
 *     instance registry: Div.all(), Widget.where(fn), Panel.count() …
 *   this === a Collection (typeof 'object') → this[ELEMENTS] is the captured
 *     array: Instance.from(nodes).where(fn) …
 * COLLECTION_STATIC (declared at top, assigned below) feeds the Meta
 * readStatic fallback: per-tag Metas relay only SYMBOL statics from Instance,
 * so the string-named verbs reach class receivers through that map instead. */
class Collection {
  constructor(items) {
    this[ELEMENTS] = [...items];
    /* indexable query results (ENSURE_INDEX_UID semantics, Pass Q3): c[n] for ANY n —
     * in-range hits the entry, out-of-range falls back to c[0]. A proxy rather than
     * per-index getters so arbitrary indices resolve without pre-declaration. */
    return new Proxy(this, {
      get(t, p, r) {
        if (typeof p === 'string' && p.length && p.charCodeAt(0) >= 48 && p.charCodeAt(0) <= 57 && /^\d+$/.test(p))
          return t[ELEMENTS][+p] || t[ELEMENTS][0];
        return Reflect.get(t, p, r);
      }
    });
  }
  get length() { return this[ELEMENTS].length; }
  *[Symbol.iterator]() { yield* this[ELEMENTS]; }
  toArray() { return [...this[ELEMENTS]]; }

  /* ── the verbs (dual-face; see the class docblock) ── */
  all()    { return new Collection(this[ELEMENTS] ?? []); } // one query surface: registry reads are Collections — indexable, c[n] || c[0] (Pass Q3)
  first()  { const a = this[ELEMENTS]; return a && a.length ? a[0] : null; }
  last()   { const a = this[ELEMENTS]; return a && a.length ? a[a.length - 1] : null; }
  at(n)    { const a = this[ELEMENTS]; return a ? (a.at(n) ?? null) : null; }
  has(el)  { const a = this[ELEMENTS]; return !!a && a.includes(el); }
  isEmpty(){ const a = this[ELEMENTS]; return !a || a.length === 0; }
  count()  { const a = this[ELEMENTS]; return a ? a.length : 0; }
  each(fn) { (this[ELEMENTS] ?? []).forEach(fn); return this; }
  where(fn){ return new Collection((this[ELEMENTS] ?? []).filter(fn)); }
  pick(fn) { return (this[ELEMENTS] ?? []).map(fn); }
  within(sel) { const c = typeof sel === 'string' ? (doc && doc.querySelector(sel)) : sel; return c ? (this[ELEMENTS] ?? []).filter(el => c.contains(el)) : []; }
  after(el)  { const a = this[ELEMENTS] ?? []; const i = a.indexOf(el); return i === -1 ? [] : a.slice(i + 1); }
  before(el) { const a = this[ELEMENTS] ?? []; const i = a.indexOf(el); return i === -1 ? [] : a.slice(0, i); }
  firstChildren() { return (this[ELEMENTS] ?? []).filter(el => { const p = el.previousElementSibling; return !p || !p[METADATA]; }); }
  lastChildren()  { return (this[ELEMENTS] ?? []).filter(el => { const n = el.nextElementSibling; return !n || !n[METADATA]; }); }
  orphaned()    { return (this[ELEMENTS] ?? []).filter(el => !(doc && doc.contains(el))); }
  byDocument()  { return [...(this[ELEMENTS] ?? [])].sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1); }
}
COLLECTION_STATIC = new Map(
  ['all','first','last','at','has','isEmpty','count','each','where','pick',
   'within','after','before','firstChildren','lastChildren','orphaned','byDocument']
  .map(k => [k, Collection.prototype[k]])); // same function objects → readStatic .bind(receiver) behavior unchanged

function _lcAdd(el, key, fn) {
  let m = LC_LISTENERS.get(el); if (!m) LC_LISTENERS.set(el, m = new Map());
  let s = m.get(key); if (!s) m.set(key, s = new Set());
  s.add(fn);
  const d = Object.getOwnPropertyDescriptor(el, key);
  if (!d || !d.value || !d.value.__lcFan) {
    const fan = function (ctx) { const set = LC_LISTENERS.get(this); const ls = set && set.get(key); if (ls) for (const f of ls) { try { f.call(this, ctx); } catch (e) { console.warn('[Instance] ' + key + ' listener error:', e); } } };
    fan.__lcFan = true;
    defineProperty(el, key, { value: fan, configurable: true, writable: true, enumerable: false });
  }
  return () => s.delete(fn);
}

function _normEvent(name) { return String(name).replace(/_/g, '-').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(); }

// Live same-tag list: parent ? same-localName siblings : [self]. Verbs materialize it
// first — Array's HasProperty checks (map/filter/indexOf…) can't see a prototype proxy's
// virtual indices (has traps get no receiver), so each verb runs on a real snapshot array.
function _liveList(el) {
	const p = el.parentElement; if (!p) return [el];
	const ln = el.localName, out = [];
	for (const ch of p.children) if (ch.localName === ln) out.push(ch);
	return out;
};
function _ITER_SHIM() { return _liveList(this)[Symbol.iterator](); }

/* ── ENGINE MODE (Pass F) — native-behavior augmentation, fully reversible ──
 * powerup(): splices the live-tree proxy between HTMLElement.prototype and
 * Element.prototype AND redirects native prototypes' .constructor to their
 * Instance MetaCtor (recorded for restoration). powerdown() restores both.
 * Nothing native is touched unless engine mode is on. */

function _installTree() {
	if (typeof HTMLElement === 'undefined' || _ENGINE.treeBase) return;
	const hp = HTMLElement.prototype;
	const base = Object.getPrototypeOf(hp);
	_ENGINE.hp = hp; _ENGINE.treeBase = base;
	const carrier = Object.create(base);
	defineProperty(carrier, '__instanceTree', { value: true });
	defineProperty(carrier, Symbol.species, { value: Array, configurable: false });
	const treeProxy = new Proxy(carrier, {
		get(t, prop, receiver) {
			const v = Reflect.get(t, prop, receiver);
			if (v !== undefined) return v;
			let __nt; try { __nt = receiver && receiver.nodeType; } catch (e) { __nt = 0; } // brand-safe: prototype objects / exotic receivers traverse this chain in engine shape (Pass Q6)
			if (__nt !== 1) return v;
			if (prop === Symbol.iterator) return _ITER_SHIM;
			if (typeof prop !== 'string') return v;
			const av = _ARRAY_VERBS.get(prop);
			if (av) return av;
			if (prop === 'length') return _liveList(receiver).length;
			if (/^\d+$/.test(prop)) return _liveList(receiver)[+prop];
			if (prop === receiver.localName && _NAMESPACES.has(prop)) { const nf = _nsFacade(receiver); if (nf !== undefined) return nf; }
			const tag = prop.length > 7 && prop.endsWith('Element') ? prop.slice(0, -7) : prop;
			if (/^[a-z][a-z0-9-]*$/.test(tag)) {
				for (const ch of receiver.children) if (ch.localName === tag) return ch;
			}
			return undefined;
		}
	});
	Object.setPrototypeOf(hp, treeProxy);
}
function _uninstallTree() {
	if (_ENGINE.treeBase && _ENGINE.hp) Object.setPrototypeOf(_ENGINE.hp, _ENGINE.treeBase);
	_ENGINE.treeBase = _ENGINE.hp = null;
}
function _engineSwapCtor(nativeProto, MetaCtor) {
	if (!_ENGINE.ctors.has(nativeProto))
		_ENGINE.ctors.set(nativeProto, Object.getOwnPropertyDescriptor(nativeProto, 'constructor'));
	defineProperty(nativeProto, 'constructor', { value: MetaCtor, configurable: true, enumerable: false, writable: true });
}

/* ── ELEMENT NAMESPACES (Pass I) — 0.73.d port: per-tag reactive facades served
 * at el[localName] (formEl.form, inputEl.input, …) on interface MISS, lazily
 * initialized, cached per element, cleaned on @unmount. This pass: form / input /
 * textarea / select. Mechanical extensions deferred: a, details, dialog, media. */
function _nsCleanup(el, fn) { let s = _NS_CLEAN.get(el); if (!s) _NS_CLEAN.set(el, s = new Set()); s.add(fn); }
// fan bodies resolve listeners via `this` (LC_LISTENERS.get(this)) — a detached call
// silently no-ops. Always invoke with the element as receiver (0.73's _fireLifecycleKey).
function _nsFire(el, key, ctx) { const fan = el[key]; if (typeof fan === 'function') fan.call(el, ctx); } // receiver-bound: fan bodies resolve their listeners via LC_LISTENERS.get(this)
function _nsSig(v) { return new Signal.State(v); }
function _nsRAF(fn) { return typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 0); }
function _nsFacade(el) {
	if (_NS_CACHE.has(el)) return _NS_CACHE.get(el);
	const init = _NAMESPACES.get(el.localName);
	if (!init) return undefined;
	const f = init(el);
	_NS_CACHE.set(el, f);
	_lcAdd(el, '@unmount', () => {
		const set = _NS_CLEAN.get(el);
		if (set) { set.forEach(fn => { try { fn(); } catch (e) {} }); _NS_CLEAN.delete(el); }
		_NS_CACHE.delete(el);
	});
	return f;
}

/* ══ §11a NAMESPACES — EXTENSION SEAM ═════════════════════════════════════════
 * The MECHANISM above is core: _NAMESPACES is the index the get trap consults,
 * and _nsFacade/_nsCleanup/_nsFire/_nsSig/_nsRAF are its generic plumbing. None
 * of it is form-specific — _nsFire is fired by PLATFORM (@async) and by the
 * transition seam (@transition), and _nsFacade is a pure dispatcher.
 *
 * What follows is CONTENT: which namespaces exist and what they do. It defines
 * no elements, so by the rule that decides what may leave core it can register
 * at any point — nothing has to exist when the document is read, and a facade
 * is only ever built on first property access. Absent, _NAMESPACES is simply
 * empty and the get trap's `.has()` guard never fires: no feature detection,
 * no throw, the element just has no `.form` face.
 *
 * Published EAGERLY, unlike §8a's per-call lookup, because the traffic runs the
 * other way: transitions is core CALLING OUT, this is a module PUSHING IN. The
 * module reads this once at load and never again.
 *
 * Through the IVC broker, NOT a Symbol.for('Instance/Namespaces') slot of its own:
 * a per-kit symbol is ONE global, so two Instance builds in a directory silently
 * overwrite each other's kit and the loser fails at a distance. Keyed by version,
 * that collision cannot be written down.
 *     const NS = globalThis[Symbol.for('Instance')]('0.89.d', 'namespaces');
 *     const NS = globalThis[Symbol.for('Instance')]('latest',  'namespaces');
 * ══════════════════════════════════════════════════════════════════════════ */
global[Symbol.for('Instance')].domain('namespaces', { _NAMESPACES, _nsCleanup, _nsFire, _nsSig, _nsRAF });



/* ── TEMPLATE APPS (Pass M) — the scoped container:
 *   <template app='name'><script>…</script><style>…</style><section>…</section></template>
 * → an Instance class (pascalized, registered) whose every instance is a div[app]
 * host with an OPEN SHADOW ROOT: styles shadow-scoped by construction, content
 * cloned per instance, scripts EXTRACTED (never parser-run) and executed scoped —
 * this = host, with ($, app, host, shadow, Instance) in hand; instance-typed
 * scripts route through the Compiler. The template site becomes the first
 * instance; the class is reusable (new Name() anywhere — each with its own
 * shadow + its own reactive store). Klass.shadow.{transitions} is ensured, so
 * '::name' resolution has its home (the shadow transition contract). */
/* ── ⚡⚡ super-mode machinery — the document-wide declarative sweep. Both walk
 * the LIGHT tree only: querySelectorAll never descends into template.content or
 * shadow roots, which is correct — template content is inert by definition and
 * shadow scopes run their own adoption (template apps). Idempotence rides
 * upgrade()'s LEAF guard, so re-sweeps and overlap with the core boot ring are
 * free. */
function _superSweep(root) {
	if (!root || !root.querySelectorAll) return;
	for (const el of root.querySelectorAll('*')) if (CUSTOM_TAGS.has(el.localName)) Instance.upgrade(el);
}
function _superWalk(node) {
	if (!node || node.nodeType !== 1) return;
	if (CUSTOM_TAGS.has(node.localName)) Instance.upgrade(node);
	_superSweep(node);
}

function _adoptClaim(selector) {
	if (_UPGRADE) { const n = _UPGRADE; _UPGRADE = null; CLAIMED.add(n); return n; } // in-place upgrade: the node IS the adoption — no scope, no query
	if (!_ADOPT) return null;
	let nodes; try { nodes = _ADOPT.querySelectorAll(selector); } catch (e) { return null; }
	for (const n of nodes) if (!CLAIMED.has(n)) { CLAIMED.add(n); return n; }
	return null;
}
function _pascal(n) { return String(n).split(/[-_\s]+/).map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(''); }
/* <template app='Name'> — the class-definition context (Pass N model):
 * the template becomes a div[app] host with an OPEN shadow (styles + markup
 * scoped by construction). Its <script>s run ONCE, this = the container, and
 * are expected to DEFINE the class (initialization belongs in the constructor).
 * Scripts compile through the Instance Compiler by default (no type= needed —
 * %Name and the sigils just work; plain JS passes through). Instances minted
 * inside ADOPT matching pre-populated markup in the shadow — the element IS
 * the instance, so adoption is a proto-splice on the existing node; JS
 * structure takes precedence on conflicts; fresh instances append to the
 * scope. The class stays ISOLATED unless `static global = true`; other
 * contexts reach it via Instance.app('Name') — in compiled code, %Name. */
function initTemplateApp(el) {
	if (!el.hasAttribute || !el.hasAttribute('app')) return; // plain <template>s untouched
	if (el._instanceAppInit) return; el._instanceAppInit = true;
	const name = el.getAttribute('app');
	if (!name) return;
	if (!globalThis.Div) { // classes not yet registered — retry after boot settles
		el._instanceAppInit = false;
		Promise.resolve(globalThis.InstanceReady).then(() => initTemplateApp(el));
		return;
	}
	const host = doc.createElement('div');
	host.setAttribute('app', name);
	const shadow = host.attachShadow({ mode: 'open' });
	const frag = doc.importNode(el.content, true);
	const scripts = [...frag.querySelectorAll('script')];
	scripts.forEach(sc => sc.remove()); // never parser-run
	shadow.appendChild(frag);
	el.replaceWith(host);
	const ident = /^[A-Za-z_$][\w$]*$/.test(name) ? name : _pascal(name);
	const prevAdopt = _ADOPT; _ADOPT = shadow;
	let Klass;
	for (const sc of scripts) {
		let code = sc.textContent || '';
		/* [0.89.o] THE APP IS ITS OWN SOURCE FILE. `//# sourceURL` names the compiled
		 * text after the app, so a stack frame reads `Scrollbar.js:1` in devtools and
		 * in `error.stack` instead of `<anonymous>`. And the error is NOT swallowed:
		 * it used to become a console.warn, which hid a SyntaxError behind a log line.
		 * A refusal in an app script is a refusal — let it flow. */
		if (Instance.Compiler) code = Instance.Compiler.compile(code).code;
		const fn = new Function('app', 'host', 'shadow', 'Instance',
			'"use strict";\n' + code +
			'\n;return (typeof ' + ident + " !== 'undefined') ? " + ident + ' : undefined;' +
			'\n//# sourceURL=' + ident + '.js');
		const K = fn.call(host, host, host, shadow, Instance);
		if (typeof K === 'function') Klass = K;
	}
	_ADOPT = prevAdopt;
	if (Klass) {
		APPS.set(name, Klass); // %Name / Instance.app(name) — the isolation bridge
		if (Klass.global === true) {
			if (!(name in globalThis)) globalThis[name] = Klass;
			else console.warn('[Instance] app class name taken — registry-only: ' + name);
		}
	}
}


/* ─── the boot ring — wake the parsed document's built-in vocabulary. Runs
 * UNCONDITIONALLY (pages using <router>/<intl> today need no flag); ⚡⚡ super
 * mode extends the identical machinery to user classes via its own sweep +
 * observer. Routers upgrade first (they configure the engine and register
 * outlets), then outlets, then the rest; template apps stay bespoke — a class
 * definition context is not an element upgrade (Pass P decision). Removals are
 * deliberately NOT handled here: raw removal is detach (a paused <sync> is a
 * live <sync>), and dispose() — the only real teardown — already fires
 * ['@unmount'] through Instance. The three hardcoded cleanup calls this
 * replaces both leaked (dispose never ran them) and over-killed (raw removal
 * destroyed permanently). */
function _bootWalk(node) {
	if (!node || node.nodeType !== 1) return;
	if (node.localName === 'template') { initTemplateApp(node); return; } // [app] guard lives in the init; plain templates untouched; content is inert — never descend
	if (CORE_TAGS.has(node.localName)) Instance.upgrade(node);
	node.childNodes.forEach(_bootWalk);
}
function _elementBoot() {
	try { document.head && document.head.appendChild(Object.assign(document.createElement('style'), { textContent: 'intl{display:inline}' })); } catch (e) {}
	document.querySelectorAll('router').forEach(el => Instance.upgrade(el));
	document.querySelectorAll('outlet').forEach(el => Instance.upgrade(el));
	for (const tag of CORE_TAGS) if (tag !== 'router' && tag !== 'outlet') document.querySelectorAll(tag).forEach(el => Instance.upgrade(el));
	document.querySelectorAll('template[app]').forEach(initTemplateApp);
	const root = document.body || document.documentElement;
	if (!root || root._instanceElementObs) return;
	root._instanceElementObs = true;
	new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(_bootWalk))).observe(root, { childList: true, subtree: true });
}
if (typeof document !== 'undefined') {
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _elementBoot, { once: true });
	else _elementBoot();
}


function _evStore(el) { let s = _EV.get(el); if (!s) _EV.set(el, s = []); return s; }

function _isThenable(v) { return v != null && typeof v.then === 'function'; }
// Run handler, then afterFn (finally-style): afterFn ALWAYS runs and receives (returnValue, {e, time, count,
// error}); the handler's error and afterFn's own error each surface via _surface (handler first), so neither
// clobbers the other. Sync handler -> afterFn fires immediately; thenable handler -> after it settles. Never throws.
function _withAfter(target, e, delegateTarget, handler, afterFn, ctr) {
  const time = Date.now();                 // ms since epoch (for POSIX seconds: Math.floor(Date.now() / 1000))
  const count = ++ctr.n;                   // per-listener fire counter, 1-based
  let value, errH;
  try { value = handler.call(target, e, delegateTarget); }
  catch (err) { errH = err; }
  const after = (val, error) => {
    let errA, ret;
    try { ret = afterFn.call(target, val, { e, time, count, error }); }
    catch (err) { errA = err; }
    if (error) _surface(error);            // handler error — primary, surfaced first
    if (errA) _surface(errA);              // afterFn's own error — separate, never eats the handler's
    if (_isThenable(ret)) ret.then(undefined, _surface); // afterFn async rejection, same channel
  };
  if (_isThenable(value)) value.then(v => after(v, undefined), err => after(undefined, err));
  else after(errH ? undefined : value, errH);
}

/* ══ §8a TRANSITIONS — EXTENSION SEAM ═════════════════════════════════════════
 * The WAAPI machinery moved to modules/i_transitions-1.0.js. It defines no elements,
 * so by the rule that decides what may leave core, it can register at any point:
 * nothing has to exist when the document is read. Core keeps only this seam.
 *
 * The lookup is LATE and per-call, never cached, because the extension may be
 * loaded after core — that is the whole point of the synchronous boot. Absent,
 * `transition()` resolves immediately instead of throwing: an element that cannot
 * animate should still settle its promise, or every caller has to feature-detect.
 * ══════════════════════════════════════════════════════════════════════════ */
const _TRANSITIONS = Symbol.for('Instance.Transitions');
/* Broker first, symbol second. The lookup stays LATE and per-call — the extension
 * may register after core, which is the whole point of the synchronous boot — and
 * still degrades to null when absent, so transition() resolves instead of throwing. */
const _tr = () => {
	const B = global[Symbol.for('Instance')];
	return (typeof B === 'function' && B.provides && B.provides('transitions')) || global[_TRANSITIONS] || null;
};

/* ═══ §8 EVENTS — the element event surface ═══
 * The on/off/once tiers (native · '#'/'##' hot-swap · '::' shadow fan · '@'
 * lifecycle fans · ':name' reflection sugar), the meta channels
 * (:addition/:removal), the universal verbs (get/has/remove/batch/subscribe/
 * notify/inspect), bind/callbind, and the transition surface (machinery in
 * §11). Overloads normalize their arguments on the first lines of each body
 * — typeOrConds may be an event name, a '$key' map, or a conditions object;
 * selOrFn is a delegation selector or the handler itself.
 *
 * STATE: _EV (tier bookkeeping) · _SUBS (observers) · LC_LISTENERS (fan
 * bodies) · ACTIVE_TR (transition dedupe) — every one minted in the §3
 * Symbols block (the single weak-state mint) and aliased at the file top.
 *
 * INSTALL: the `void new Events(…)` declaration below — Interface splices
 * this prototype onto Instance.prototype with descriptors mirrored 1:1
 * (class methods are non-enumerable/writable/configurable, exactly what the
 * old graft loop wrote), and every per-tag iface relays from there. */
class Events extends Interface {

  trigger(event, detail = null, options = {}) {
    const type = _normEvent(event);
    const native = typeof window !== 'undefined' && ('on' + type) in window;
    const evt = native
      ? new Event(type, { bubbles: true, cancelable: true, ...options })
      : new CustomEvent(type, { bubbles: true, composed: true, cancelable: false, detail: detail ?? {}, ...options });
    this.dispatchEvent(evt);
    return this;
  }
  emit(...a) { return this.trigger(...a); }
  /* notify — the universal-verb face: fan out to subscribe()d observers; the
   * (type, listener[, depth]) shape ALSO feeds the Pass-D meta channels. */
  notify(...args) {
    const subs = _SUBS.get(this);
    if (subs) for (const cb of [...subs]) { try { cb.apply(this, args); } catch (e) { console.warn('[Instance] notify subscriber error:', e); } }
    if (typeof args[0] === 'string' && typeof args[1] === 'function')
      this.emit(':'.repeat(typeof args[2] === 'number' ? args[2] : 1) + 'addition', { type: args[0], listener: args[1] });
    return this;
  }
  subscribe(a, b, c) { // Pass Q8b overload: subscribe(ParentClass, '$field' | getter, cb) — '@change' semantics with the class explicit
    if (typeof a === 'function' && typeof c === 'function'
        && (typeof b === 'function' || (typeof b === 'string' && (b[0] === '$' || b[0] === 'Δ')))) {
      const read = typeof b === 'function' ? b : () => a[b];
      let first = true;
      return _instEffect(this, () => { const v = read.call(this); if (first) { first = false; return; } c.call(this, v, this); });
    }
    const cb = a;
    if (typeof cb !== 'function') return this; let set = _SUBS.get(this); if (!set) _SUBS.set(this, set = new Set()); set.add(cb); return () => set.delete(cb); }
  unsubscribe(cb) { const set = _SUBS.get(this); if (set) { if (cb) set.delete(cb); else set.clear(); } return this; }
  _wireStandardInterceptors() {
    if (this.__stdWired) return this;
    try { defineProperty(this, '__stdWired', { value: true, configurable: true }); } catch (e) { this.__stdWired = true; }
    const add = this.addEventListener.bind(this), rem = this.removeEventListener.bind(this);
    defineProperty(this, 'addEventListener', { configurable: true, writable: true,
      value: (t, l, o) => { add(t, l, o); if (!_inOn) this.emit(':addition', { type: t, listener: l, options: o }); } });
    defineProperty(this, 'removeEventListener', { configurable: true, writable: true,
      value: (t, l, o) => { rem(t, l, o); this.emit(':removal', { type: t, listener: l, options: o }); } });
    return this;
  }
  effect(fn) { _instEffect(this, fn); return this; }

  /* ── 0.73.w ports (Pass C): once · bind · callbind ── */

  once(typeOrConds, selOrFn, fnArg) {
    let sel = null, cb = selOrFn;
    if (typeof selOrFn === 'string') { sel = selOrFn; cb = fnArg; }
    if (typeof cb !== 'function') return this;
    if (typeOrConds !== null && typeof typeOrConds === 'object') {          // reactive-condition tier
      let done = false, disp;
      disp = this.on(typeOrConds, (...args) => {
        if (done) return; done = true;
        try { return cb.apply(this, args); }
        finally { if (typeof disp === 'function') disp(); }
      });
      return disp;
    }
    const el = this, t = String(typeOrConds);
    if (t[0] !== '@' && !sel) return this.on(t, cb, { once: true });   // native once
    // lifecycle / delegated: done-flag wrapper (per-callback lifecycle off is a known
    // gap; the wrapper stays registered inert after firing — single-fire guaranteed)
    let done = false;
    const wrapper = function (...a) {
      if (done) return; done = true;
      const r = cb.apply(this, a);
      if (t[0] !== '@') el.off(t, wrapper);
      return r;
    };
    wrapper._original = cb;
    return sel ? this.on(t, sel, wrapper) : this.on(t, wrapper);
  }

  /* bind — 0.73's three-overload declarative binding layer on the unified write path:
   *   bind('click', '$count', fn)  → on event, r = fn($, this, e); r !== undefined → set(key, r)
   *   bind('$count', fn)           → sugar for the object form
   *   bind({ key: fn, … })         → one live shallow effect keeping keys in sync (rides ψ) */
  bind(first, second, third) {
    if (typeof first === 'string' && typeof second === 'string' && typeof third === 'function') {
      return this.on(first, (e) => {
        const r = third.call(this, this.$, this, e);
        if (r !== undefined) this.set(second, r);
      });
    }
    if (typeof first === 'string' && typeof second === 'function')
      return this.bind({ [first]: second });
    if (first !== null && typeof first === 'object') {
      const entries = Object.entries(first);
      this.ψ(() => {
        for (const [k, fn] of entries) {
          const r = fn.call(this, this.$, this);
          if (r !== undefined) this.set(k, r);
        }
      });
    }
    return this;
  }

  /* callbind — the frozen destructure-safe scoped API (0.73's crown jewel):
   * mutators return el (chain), readers return values. Parked pending the
   * kernel-verbs pass: notify/watch/computed/signal/readonly/resource/inherit/next. */
  callbind() {
    const el = this;
    const chain = (name) => (...a) => (el[name](...a), el);
    const pass  = (name) => (...a) => el[name](...a);
    return Object.freeze({
      el,
      $: el.$, $$: el.$$, '@': el['@'], ø: el.ø, ψ: el.ψ,
      set: chain('set'), add: chain('add'), emit: chain('emit'), trigger: chain('trigger'),
      on: chain('on'), off: chain('off'), once: chain('once'), bind: chain('bind'),
      find: pass('find'), findAll: pass('findAll'),
      peek: (k) => el.$(k),
      effect: (fn, key, opts) => (el.ψ(fn, key, opts), el),
      batch: (fn) => Signal.batch(fn),
      untrack: (fn) => Signal.untrack(fn),
      signal: (v) => el.signal(v),
      computed: (fn) => el.computed(fn),
      watch: (src, fn) => el.watch(src, fn),
      readonly: (sig) => el.readonly(sig),
      resource: (fn) => el.resource(fn),
      inherit: (k, src) => (el.inherit(k, src), el),
      clone: (deep) => el.clone(deep),
      remove: (t) => (el.remove(t), el),
      get: (k, o) => el.get(k, o),
      has: (t) => el.has(t),
      inspect: () => el.inspect(),
      subscribe: (cb) => el.subscribe(cb),
      unsubscribe: (cb) => (el.unsubscribe(cb), el),
      notify: (...a) => (el.notify(...a), el),
      post: (u, b, o) => (el.post(u, b, o), el),
    });
  }

  /* ── unified verbs (Pass G) — same API at every level, scoped to `this` ── */

  /* get — parser-routed: sigil → reactive read · URL-ish → HTTP GET (promise) ·
   * '.cls' → classList test · property · attribute. */
  get(key, opts) {
    if (key == null) return undefined;
    const k = String(key);
    if (_looksLikeURL(k)) return _httpGET(k, opts);
    if (/^[$Δ@ø]/.test(k)) return this[k];
    if (k[0] === '.') return this.classList.contains(k.slice(1));
    if (k in this) return this[k];
    return (this.hasAttribute && this.hasAttribute(k)) ? this.getAttribute(k) : undefined;
  }

  /* has — Node → contains · sigil → store · '.cls' · property/attribute. */
  has(target) {
    if (target instanceof Node) return this.contains(target);
    const k = String(target);
    if (/^[$Δ@ø]/.test(k)) { const ss = this[REACTIVE_STORE]; return !!(ss && sHas(ss, k)); }
    if (k[0] === '.') return this.classList.contains(k.slice(1));
    return (k in this) || (this.hasAttribute ? this.hasAttribute(k) : false);
  }

  /* remove — () → detach self · Node → removeChild · '@evt' → off (set/add symmetry) ·
   * sigil → store delete · '.cls' · attribute. */
  remove(target) {
    /* bare + boolean honor the LIFECYCLE contract (this method shadows the old
     * Instance.remove(hard), which the splice order buried — Pass P unified
     * them): remove() = detach ('@removal' fires SYNCHRONOUSLY, element stays
     * alive), remove(true) = dispose (the only real teardown). Everything else
     * is the ported sigil dispatch. */
    if (target === undefined) return Instance.detach(this);
    if (target === true) return Instance.dispose(this);
    if (target instanceof Node) { if (target.parentNode === this) this.removeChild(target); return this; }
    const k = String(target);
    if (k[0] === '@' || (k[0] === ':' && k[1] === ':')) { this.off(k); return this; }
    if (/^[$Δø]/.test(k)) { const ss = this[REACTIVE_STORE]; if (ss) sRemove(ss, k); return this; }
    if (k[0] === '.') { this.classList.remove(k.slice(1)); return this; }
    this.removeAttribute(k); return this;
  }

  /* batch — (fn) kernel batch passthrough · ({obj}) one-flush routed writes via set(). */
  batch(a) {
    if (typeof a === 'function') return Signal.batch(a);
    if (a !== null && typeof a === 'object') { Signal.batch(() => { for (const k of Object.keys(a)) this.set(k, a[k]); }); return this; }
    return this;
  }
  untrack(fn) { return Signal.untrack(fn); }

  inspect() {
    const ss = this[REACTIVE_STORE]; const store = {};
    if (ss) for (const k of dictOf(ss).keys()) if (!String(k).endsWith('$$effect'))
      store[k] = Signal.untrack(() => this[k]);
    return { tag: this.localName, id: this.id || null, classes: [...this.classList],
      attributes: this.attributes ? this.attributes.length : 0, children: this.children.length, store };
  }

  /* post — STUB (0.87.h): routing per spec — HTTP POST unless { message: true }
   * (postMessage interop); both land with the network pass. */
  post(url, body, opts) {
    if (opts && opts.message) { console.warn('[Instance] post(): message-channel interop is stubbed — queued for the network pass'); return this; }
    console.warn('[Instance] post(): HTTP POST is stubbed — queued for the network pass');
    return this;
  }

  /* ── transitions (Pass L) ── */
  /* ── transitions surface — resolution + WAAPI/fallback machinery lives in §11 below ── */
  transition(nameOrConfig) {
    const el = this;
    const TR = _tr();
    if (!TR) return Promise.resolve(el);          // extension absent: settle, do not throw
    const config = TR.resolve(el, nameOrConfig);
    if (!config) return Promise.resolve(el);
    const target = config.el || el;
    const name = config._name || (typeof nameOrConfig === 'string' ? nameOrConfig : 'inline');
    const scope = config._scope || 'local';
    const fullKey = (scope === 'shadow' ? '::' : '') + name;
    let active = ACTIVE_TR.get(el);
    if (!active) ACTIVE_TR.set(el, active = new Set());
    if (active.has(fullKey)) return Promise.resolve(el);
    active.add(fullKey);
    _nsFire(el, '@transition', { name: fullKey, phase: 'start', duration: config.duration, scope });
    return TR.run(target, config).then(() => {
      active.delete(fullKey);
      _nsFire(el, '@transition', { name: fullKey, phase: 'end', duration: config.duration, scope });
      return el;
    });
  }
  /* '::transition' — shadow-channel receiver: { detail: { to } } → run it. */
  ['::transition'](context) {
    const to = context && context.detail && context.detail.to;
    return to ? this.transition(to) : Promise.resolve(this);
  }

  /* ── kernel verbs (Pass E) — the callbind parked list, on Signal.State/Computed ── */

  signal(v)      { return new Signal.State(v); }
  computed(fn)   { return new Signal.Computed(fn); }

  readonly(sig) {
    return Object.freeze({
      get: () => sig.get(), peek: () => sig.peek(),
      [Symbol.toPrimitive]() { return sig.get(); },
      toString() { const v = sig.get(); return v == null ? '' : String(v); }
    });
  }

  /* watch — 0.73 semantics: prime old value untracked; on change, fn(newValue, prev, $)
   * runs untracked; a plain-object return bulk-applies to the store (rides ψ). */
  watch(source, fn) {
    const $ = this.$;
    const getter = typeof source === 'function' ? () => source($) : () => source.get();
    let oldValue = Signal.untrack(getter);
    const node = new Signal.Effect(() => {
      const newValue = getter();
      if (newValue !== oldValue) {
        const prev = oldValue; oldValue = newValue;
        let result; Signal.untrack(() => { result = fn.call(this, newValue, prev, $); });
        if (result !== null && typeof result === 'object' && !Array.isArray(result)) this.ψ(result);
      }
    });
    return () => { try { node.dispose && node.dispose(); } catch (e) {} };
  }

  /* resource — 0.73 semantics: tracked async effect; deps read inside asyncFn drive refetch. */
  resource(asyncFn) {
    const data = new Signal.State(undefined), loading = new Signal.State(false), error = new Signal.State(null);
    this.effect(async () => {
      loading.set(true); error.set(null);
      try { data.set(await asyncFn.call(this, this.$)); }
      catch (e) { error.set(e); }
      finally { loading.set(false); }
    });
    return Object.freeze({ data, loading, error });
  }

  /* inherit — share a cell between owners: the store dict holds node refs, so aliasing
   * a key to another owner's node makes reads AND writes flow through one shared cell. */
  inherit(key, source) {
    const k = /^[$ΔΣ@ø]/.test(key) ? key : 'Δ' + key;   // [split-lane] bare shorthand defaults to SHALLOW (Δ); '$' now spells atomic
    const m = k.match(/^([$ΔΣ@ø]{1,3})(.*)$/); const sigil = m[1], bare = m[2];
    let node = null;
    if (source && typeof source.get === 'function' && typeof source.ptr === 'number') node = source;   // a Signal handle
    else if (source) {
      const tier = sigil === '@' ? source['@'] : sigil === 'ø' ? source.ø : sigil.length === 2 ? source.$$ : source.$;
      if (typeof tier === 'function') node = tier[bare];                                    // triad handle (mints on miss)
    }
    if (!node) throw new Error('[Instance] inherit() — unrecognised source');
    const store = storeOf(this);
    if (store) dictOf(store).set(k, node.ref);   // (a `_proxies` sweep sat here; no store has carried that table since V17)
    return this;
  }

  clone(deep = true) { return this.cloneNode(deep); }

  /* route — register this element as an outlet; resolves the current location
   * immediately unless { immediate: false }. */
  route(routeMap, options) {
    _router()._register(this, routeMap, options);
    if (!options || options.immediate !== false) {
      const loc = _RT.config.history === 'hash'
        ? ((typeof location !== 'undefined' && location.hash && location.hash.slice(1)) || '/')
        : (typeof location !== 'undefined' ? location.pathname + location.search + location.hash : '/');
      _router().navigate(loc, true);
    }
    return this;
  }

  on(typeOrConds, selOrFn, fnArg, a3, a4) {
    // ── DOM-event HANDLE tier (Pass Q8b) — FIRST: handles are objects and must be
    //    claimed before the condition-object tier can swallow them. ──
    if (typeOrConds && (typeof typeOrConds === 'object' || typeof typeOrConds === 'function') && typeOrConds[EVT_HANDLE] && typeof selOrFn === 'function') {
      const d = _hSubscribe(typeOrConds[EVT_HANDLE], this, selOrFn);
      if (this.nodeType === 1) { let set = _EVT_SUBS.get(this); if (!set) _EVT_SUBS.set(this, set = new Set()); set.add(d); }
      return d;
    }
    if (typeOrConds !== null && typeof typeOrConds === 'object' && !(typeOrConds instanceof Node) && !typeOrConds[EVT_HANDLE]) {
      const cb = selOrFn; if (typeof cb !== 'function') return this;
      const conds = Object.entries(typeOrConds).map(([k, want]) => [/^[$ΔΣ@]/.test(k) ? k : 'Δ' + k, want]);
      return _instEffect(this, () => { let all = true; for (const [k, want] of conds) if (this[k] !== want) all = false; if (all) cb.call(this, this); });
    }
    const t0 = String(typeOrConds).trim();
    // ── meta tiers (Pass D): ':name' observes standard listener additions, ':::name' observes @/:: ones ──
    if (/^(:{3}|:)(?!:)/.test(t0) && !/^:{1,3}(addition|removal)$/.test(t0)) {
      const cb = typeof selOrFn === 'function' ? selOrFn : fnArg;
      if (typeof cb !== 'function') return this;
      const name = t0.replace(/^:+/, '');
      const depth = t0.length - name.length;                     // 1 (standard) | 3 (meta-shadow)
      if (depth === 1) this._wireStandardInterceptors();
      const nn = depth === 1 ? _normEvent(name) : name;
      return this.on(':'.repeat(depth) + 'addition', (e) => {
        const d = e.detail || {};
        if (depth === 3 ? (d.type === nn || d.type === '@' + nn || d.type === '::' + nn) : d.type === nn)
          cb.call(this, d.listener, nn, e);
      });
    }
    // ── DOM-event class tier (Pass Q8): on(MouseDown, fn) — one shared pump per
    //    (element, type) feeding a kernel pulse; disposer returned; drains at dispose. ──
    if (typeof typeOrConds === 'function' && typeof typeOrConds[EVT_TYPE] === 'string' && typeof selOrFn === 'function')
      return _evtSubscribe(this, typeOrConds[EVT_TYPE], selOrFn);
    // ── '@change' subscription tier (Pass Q2): on('@change', src, cb) — src is a class-static
    //    sigil name ('$mark', resolved on this.constructor so the accessor read is TRACKED) or a
    //    getter fn. Rides _instEffect: the first (arming) run is swallowed — '@change' means
    //    change — and the effect ref lives in the element's store, so dispose() drains it. ──
    if (t0 === '@change' && typeof fnArg === 'function'
      && (typeof selOrFn === 'function' || (typeof selOrFn === 'string' && (selOrFn[0] === '$' || selOrFn[0] === 'Δ')))) {
      const read = typeof selOrFn === 'function' ? selOrFn : () => this.constructor[selOrFn];
      let first = true;
      return _instEffect(this, () => { const v = read.call(this); if (first) { first = false; return; } fnArg.call(this, v, this); });
    }
    // ── lifecycle '@' and shadow '::' tiers: keyed fans via _lcAdd, identity-aware, meta-announced ──
    if (t0[0] === '@' || (t0[0] === ':' && t0[1] === ':' && t0[2] !== ':')) {
      const cb = typeof selOrFn === 'function' ? selOrFn : fnArg;
      if (typeof cb !== 'function') return this;
      let key = t0, id = null, scoped = false;
      const hh = key.indexOf('##');
      if (hh !== -1) { id = key.slice(hh + 2); key = key.slice(0, hh); scoped = true; }
      else { const h = key.indexOf('#'); if (h !== -1) { id = key.slice(h + 1); key = key.slice(0, h); } }
      if (id) this.off(scoped ? key + '##' + id : '#' + id);     // identity hot-swap (0.73 semantics)
      const dispose = _lcAdd(this, key, cb);
      _evStore(this).push({ type: key, wrapped: cb, id, scoped, dispose });
      this.emit(':::addition', { type: key, listener: cb });
      return dispose;
    }
    let type = t0, selector = null, cb, rest;
    if (typeof selOrFn === 'string') { selector = selOrFn; cb = fnArg; rest = [a3, a4]; }
    else { cb = selOrFn; rest = [fnArg, a3]; }
    if (typeof cb !== 'function') return this;
    // remaining slots disambiguate by type: an object is options, a function is afterFn (order-independent)
    let options = null, afterFn = null;
    for (const r of rest) {
      if (typeof r === 'function') { if (!afterFn) afterFn = r; }
      else if (r && typeof r === 'object') { if (!options) options = r; }
    }
    let id = null, scoped = false;
    const hh = type.indexOf('##');
    if (hh !== -1) { id = type.slice(hh + 2); type = type.slice(0, hh); scoped = true; }
    else { const h = type.indexOf('#'); if (h !== -1) { id = type.slice(h + 1); type = type.slice(0, h); } }
    type = _normEvent(type);
    if (id) this.off(scoped ? type + '##' + id : '#' + id);      // identity hot-swap (0.73 semantics)
    const self = this;
    const ctr = { n: 0 };
    const wrapped = afterFn
      ? (selector
          ? (e) => { const tgt = e.target && e.target.closest(selector); if (tgt && self.contains(tgt)) _withAfter(tgt, e, tgt, cb, afterFn, ctr); }
          : (e) => _withAfter(self, e, undefined, cb, afterFn, ctr))
      : (selector
          ? (e) => { const tgt = e.target && e.target.closest(selector); if (tgt && self.contains(tgt)) cb.call(tgt, e, tgt); }
          : (e) => cb.call(self, e));
    const nativeOpts = {};
    if (options && typeof options === 'object') for (const f of ['capture', 'once', 'passive', 'signal']) if (f in options) nativeOpts[f] = options[f];
    _inOn = true;
    this.addEventListener(type, wrapped, nativeOpts);
    _inOn = false;
    _evStore(this).push({ type, wrapped, id, scoped, selector });
    this.emit(':addition', { type, listener: wrapped });
    return this;
  }

  off(target, cbArg) {
    const store = _EV.get(this);
    if (typeof target === 'string' && (target[0] === '@' || (target[0] === ':' && target[1] === ':' && target[2] !== ':'))) {
      const m = LC_LISTENERS.get(this); const setr = m && m.get(target);
      if (setr) {
        if (typeof cbArg === 'function') {
          for (const f of setr) if (f === cbArg || f._original === cbArg) { setr.delete(f); this.emit(':::removal', { type: target, listener: f }); break; }
        } else { setr.clear(); this.emit(':::removal', { type: target, listener: null }); }
      }
      if (store) for (let i = store.length; i--; ) if (store[i].type === target && (!cbArg || store[i].wrapped === cbArg || store[i].wrapped._original === cbArg)) store.splice(i, 1);
      return this;
    }
    if (!store) return this;
    if (typeof target === 'string' && target.includes('##')) {
      const j = target.indexOf('##'); const t = target.slice(0, j), id = target.slice(j + 2);
      for (let i = store.length; i--; ) { const e = store[i]; if (e.scoped && e.id === id && e.type === t) { e.dispose ? e.dispose() : this.removeEventListener(e.type, e.wrapped); store.splice(i, 1); } }
      return this;
    }
    if (typeof target === 'string' && target[0] === '#') {
      const id = target.slice(1);
      for (let i = store.length; i--; ) { const e = store[i]; if (e.id === id && !e.scoped) { e.dispose ? e.dispose() : this.removeEventListener(e.type, e.wrapped); store.splice(i, 1); } }
      return this;
    }
    const type = target ? _normEvent(target) : null;
    for (let i = store.length; i--; ) { const e = store[i]; if (!type || e.type === type) { e.dispose ? e.dispose() : this.removeEventListener(e.type, e.wrapped); store.splice(i, 1); } }
    return this;
  }
}
void new Events({ target: Instance, 'proto=>proto': true }); // one declaration — the splice IS the install



/* ═══ §9 CHAIN — the writethrough / template-tag surface ═══
 * set(…) in all its overloads (key/value · object · template-tag), the
 * reactive tagged-template path (_tag: object interpolations mint $keys and
 * ride one effect), and the chainable await face. Same install pattern as
 * Events; state rides the §3-minted stores. */
class Chain extends Interface {

  _isTag(args) { return Array.isArray(args[0]) && args[0].raw !== undefined; }
  _tag(strings, values, callback) {
    const reactive = values.some(v => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Node));
    if (!reactive) { callback(strings.reduce((acc, s, i) => acc + s + (values[i] ?? ''), '')); return this; }
    this.effect(() => {
      const out = strings.reduce((acc, s, i) => {
        const v = values[i];
        if (v == null) return acc + s;
        if (v && typeof v.get === 'function') return acc + s + String(v);
        if (typeof v === 'object' && !Array.isArray(v) && !(v instanceof Node)) {
          const parts = Object.entries(v).map(([key, def]) => { const sk = /^[$ΔΣ]/.test(key) ? key : 'Δ' + key; if (!(this[REACTIVE_STORE] && this[REACTIVE_STORE].has(sk))) this[sk] = def; return String(this[sk]); });
          return acc + s + parts.join('');
        }
        return acc + s + String(v);
      }, '');
      callback(out);
    });
    return this;
  }
  set(...args) {
    if (this._isTag(args)) { const [strings, ...values] = args; return this._tag(strings, values, v => { this.textContent = v; }); }
    const [key, value] = args;
    if (key && typeof key === 'object') { for (const [k, v] of Object.entries(key)) this.set(k, v); return this; }
    const k = String(key);
    if (args.length === 1 && k[0] !== '.' && k[0] !== '$' && k[0] !== '@') { this.textContent = k; return this; }
    if (k[0] === '.') { this.classList.toggle(k.slice(1), value === undefined ? true : !!value); return this; }
    if (k[0] === '$') { this[k] = value; return this; }
    if (k[0] === 'ø' || k[0] === 'Δ') { this[k] = value; return this; }
    if (k[0] === '@') { this.on(k, value); return this; }
    if (k in this) { this[k] = value; return this; }
    this.setAttribute(k, value === true ? '' : String(value ?? ''));
    return this;
  }
  add(...args) {
    if (this._isTag(args)) { const [strings, ...values] = args; const t = doc.createTextNode(''); this.appendChild(t); return this._tag(strings, values, v => { t.data = v; }); }
    const [thing, fn] = args;
    if (thing instanceof Node) { this.appendChild(thing); return this; }
    if (typeof thing === 'function') { const r = thing(); if (r instanceof Node) this.appendChild(r); return this; }
    if (typeof thing === 'string') {
      const t = thing.trim();
      if (typeof fn === 'function' && t[0] === '@') { this.on(t, fn); return this; }
      if (t[0] === '.') { this.classList.add(t.slice(1)); return this; }
      this.appendChild(doc.createTextNode(thing)); return this;
    }
    return this;
  }
  find(selector)    { return new Collection(this.querySelectorAll(String(selector))); }
  findAll(selector) { return this.find(selector); }
  sleep(ms, callback) {
    const el = this;
    const work = new Promise(resolve => setTimeout(async () => { try { if (callback) await callback(el); } finally { resolve(); } }, ms));
    return _seq(el, work);
  }
  init(...behaviors) {
    const el = this;
    const runOne = (b) => { if (typeof b === 'function') return b.call(el, el); if (b && typeof b === 'object') for (const [event, handler] of Object.entries(b)) el.on(event, handler); };
    for (let i = 0; i < behaviors.length; i++) {
      const r = runOne(behaviors[i]);
      if (r && typeof r.then === 'function') {
        const work = (async () => { await r; for (let j = i + 1; j < behaviors.length; j++) { const n = runOne(behaviors[j]); if (n && typeof n.then === 'function') await n; } })();
        return _seq(el, work);
      }
    }
    return this;
  }
  async(...behaviors) {
    const el = this;
    const ps = behaviors.map(b => { if (typeof b === 'function') { const r = b.call(el, el); return r && typeof r.then === 'function' ? r : Promise.resolve(r); } return (b && typeof b.then === 'function') ? b : Promise.resolve(b); });
    const work = Promise.all(ps).then(() => {});
    return _seq(el, work);
  }
}
void new Chain({ target: Instance, 'proto=>proto': true });



defineProperty(Instance, 'makeChainable', {
  value(promise) {
    return new Proxy(promise, {
      get(target, prop) {
        if (prop in target) { const v = target[prop]; return typeof v === 'function' ? v.bind(target) : v; }
        return (...args) => Instance.makeChainable(target.then(r => {
          if (typeof r[prop] !== 'function') throw new TypeError("Method '" + String(prop) + "' does not exist on the resolved element.");
          return r[prop](...args);
        }));
      }
    });
  }, configurable: true
});
defineProperty(Instance, 'from', { value(items) { return new Collection(items); }, configurable: true });
defineProperty(Instance, 'Collection', { value: Collection, configurable: true });

if (doc) {
  const $sel  = (sel) => typeof sel === 'string' ? doc.querySelector(sel) : sel;
  const $$sel = (sel) => new Collection(typeof sel === 'string' ? doc.querySelectorAll(sel) : sel);
  if (!('$' in global))  defineProperty(global, '$',  { value: $sel,  configurable: true, writable: true });
  if (!('$$' in global)) defineProperty(global, '$$', { value: $$sel, configurable: true, writable: true });
}


	new Instance(global); // §6 #initialize: generate the configured shape synchronously at load (Div/Span/…)
	if (doc) Instance.start(); // begin observing once the core elements exist


	function isInstanceScript(script) {
		/* `bypass` means nothing in Instance compiles it. The capture honours it, and
		 * so must this scan, which runs at DOMContentLoaded — after hydration has put
		 * a bypassed block back with its Instance type still on. */
		if (script.hasAttribute('bypass') || script.hasAttribute('data-bypass')) return false;
		const type = (script.getAttribute('type') || '').toLowerCase();
		return INSTANCE_TYPES.has(type) || /\.is(\?|$)/.test(script.getAttribute('src') || '');
	}

	async function fetchText(url) {
		const response = await fetch(url);
		if (!response.ok) throw new Error('fetch ' + url + ' → ' + response.status);
		return response.text();
	}

		// scan the page for <script type=text/instance>, compile + run each
	async function bootstrap() {
		if (!doc) return;
		for (const script of [...doc.scripts].filter(isInstanceScript)) await bootScript(script);
	}

	/* [0.89.j] ARTIFACT REPAIR, pinned by the EVENTS case "await fixed, once-latch
	 * fixed". Three faults, measured killing EVERY page script:
	 *   1. the source resolver was an un-awaited async IIFE, so `source` was a
	 *      Promise and `.trim` threw before anything ran;
	 *   2. `bootScript.once` was a GLOBAL latch — one attempt, page-wide, ever;
	 *   3. with the latch gone the engine would also run HARNESS-owned blocks
	 *      (module=), which are the suite's to execute, not the page's.
	 * The latch becomes per-script (a WeakSet, so re-entrant bootstrap() calls
	 * stay idempotent), and `sandbox` picks run()'s async-IIFE lane exactly as
	 * documented — declarations stay inside; without it the block runs on the
	 * global lane so a page-declared class is usable by the next script. */
	const BOOTED_SCRIPTS = new WeakSet();
	async function bootScript(script) {
		if (BOOTED_SCRIPTS.has(script)) return; BOOTED_SCRIPTS.add(script);
		if (script.hasAttribute('module')) return; // harness-owned block — not the page's
		// element generation is centralized in §6 #initialize (once, at load); scripts only compile + run
		try {
			const source = await (async (s) => {
				if (s === 'data:text/javascript,' || !s) return script.textContent;
				return await fetchText(s);
			})(script.src);
			if (source && source.trim()) run(source, { async: script.hasAttribute('sandbox') });
		} catch (error) {
			(console.error || console.log)('[Instance] script failed:', (error && error.message) || error);
		}
	}
	if (doc) {
		/* [0.89.c] 'interactive' MUST defer too. A <script defer> runs AFTER parsing,
		 * when readyState is already 'interactive' — DOMContentLoaded has NOT fired
		 * yet. The old check tested only 'loading', so a deferred core scanned the
		 * page immediately and every module loaded after it registered too late:
		 * its elements were already in the DOM and never upgraded, silently. The
		 * state that means "DOMContentLoaded is past" is 'complete', not 'interactive'. */
		if (doc.readyState === 'loading' || doc.readyState === 'interactive') {
			doc.addEventListener('DOMContentLoaded', bootstrap, { once: true });
		}
		else bootstrap();
	}

	/* ════════════════════════════════════════════════════════════════════════
	* §10b — the SUPERSET RUNTIME: what compiled output calls
	* ════════════════════════════════════════════════════════════════════════ */
	/* doc:C-RUNTIME */
	/* One namespace, off the element model. Nothing here is a static of Instance,
	 * so no element class inherits it and `Div.describe` does not exist; nothing
	 * here needs the compiler, so compiled output runs against core alone. Each
	 * helper takes its host as the first argument where it needs one — the same
	 * body serves both faces. The compiler, when loaded, is this class with
	 * `compile` on it (it extends this one), so `Superset` is one name. */
	class Superset {
		/* doc:C-DESCRIPTOR */
		/* Describe a face's fields in ONE call, on the object that carries them:
		 * `{ kind: [names] }`, a kind being a DESCRIPTORS keyword, optionally with
		 * participles (`'untracked let'`). The compiler no longer emits it: a row
		 * rides its descriptor word (C-DEFINE), `ø.let(this, ['a'])` where nothing
		 * is written. It stays the general form, and the one that takes a raw
		 * `{ e, c, w }` row. */
		static describe(host, rows) {
			for (const k in rows) describeHost(host, rows[k], rowOf(k));
			return host;
		}
		/* doc:C-METHODDESC */
		/* A METHOD is already on the prototype when the class body ends, so its slot
		 * is described again: `let` is the default, `const` seals, `enum` seals and
		 * shows. An accessor keeps get/set; a method keeps its value. A method's face
		 * is hidden unless the row says otherwise, as native methods are. */
		static redescribe(target, rows) {
			for (const k in rows) {
				const row = rowOf(k);
				for (const n of rows[k]) {
					const d = Object.getOwnPropertyDescriptor(target, n);
					if (!d || !d.configurable) continue;
					const next = { enumerable: row.e != null ? row.e : false, configurable: row.c != null ? row.c : true };
					if ('value' in d) { next.value = d.value; next.writable = row.w != null ? row.w : true; }
					else { next.get = d.get; next.set = d.set; }
					try { Object.defineProperty(target, n, next); } catch (e) {}
				}
			}
			return target;
		}
		/* doc:C-DEFINE */
		/* DESCRIBE AND WRITE, one call: `define(host, kind, name, value)`. The row
		 * lands first, then the value, as given: a promise is stored raw, as `=`
		 * stores it; an awaited value arrives settled, because the `yield` sits
		 * inside the call. NO value is a blank declaration (C-BLANK): it writes
		 * BLANK, where an explicit `undefined` spends the write. The emit calls it
		 * by its descriptor word — `ø.let(this, 'n', v)`, below the class — and
		 * by name only for a row that carries a participle. NAMES AS A LIST
		 * describe and write nothing — `ø.let(this, ['a', 'b'])` — for a field whose
		 * value arrives by its own path (a fan's landing, a batch, a pattern, a
		 * tee): its row is in place before it, as C-CASCADE wants. */
		static define(host, kind, name, v) {
			if (Array.isArray(name)) { describeHost(host, name, rowOf(kind)); return host; }
			describeHost(host, [name], rowOf(kind));
			host[name] = arguments.length > 3 ? v : BLANK;
			return v;
		}
		/* doc:C-SEED */
		/* THE SEED, one call per face: each name past the split becomes a TDZ
		 * binding (C-CASCADE) through the same [[Set]] a field write takes. */
		static pending(host, ...names) {
			for (const n of names) host[n] = PENDING;
			return host;
		}
		/* the registrar a compiled class calls at declaration time */
		static implement(C, I) { IFACES.set(C, ifaceSnapshot(I)); return C; }
		/* PACKAGE MIXIN. A package PROVIDES: its methods are copied onto the host's
		 * prototype, walking its own `is` chain so a base package's members come too.
		 * The host's own declarations SHADOW a package's. */
		static mixin(C, P) {
			const chain = [];
			for (let p = P; p && p !== Function.prototype && p.prototype; p = Object.getPrototypeOf(p)) chain.unshift(p);
			for (const link of chain)
				for (const k of Reflect.ownKeys(link.prototype)) {
					if (k === 'constructor' || Object.prototype.hasOwnProperty.call(C.prototype, k)) continue;
					Object.defineProperty(C.prototype, k, Object.getOwnPropertyDescriptor(link.prototype, k));
				}
			return C;
		}
		/* doc:C-SETLANE */
		static lane(host, name, policy, rest) { return laneRun(host, name, policy, rest); }
		/* doc:C-MEMO */
		/* MEMO(R)IZE. Out-of-order results are cached; assignment follows source
		 * order. When a result lands in its turn it is assigned at once, and any
		 * results already cached behind it drain in the SAME SYNCHRONOUS PASS. Not a
		 * promise chain: every result is captured the instant it arrives; only the
		 * WRITE holds for its turn. One cursor per lane, not per host, so a detached
		 * `memo async` cannot hold up a `memo batch` write. */
		static memo(host, lane, p, ok, bad) {
			let lanes = MEMO.get(host);
			if (!lanes) MEMO.set(host, lanes = new Map());
			let q = lanes.get(lane);
			if (!q) lanes.set(lane, q = { next: 0, count: 0, slots: [] });
			const i = q.count++;
			const land = (write) => {
				q.slots[i] = write;
				while (q.slots[q.next]) { const w = q.slots[q.next]; q.slots[q.next] = null; q.next++; w(); }
			};
			Promise.resolve(p).then(v => land(() => ok(v)), e => land(() => bad(e)));
			return p;
		}
		/* doc:C-RUNTIME */
		/* A FAN IS ONE CALL: `ø.fan(this, 'x', p)` lands the value on the host when it
		 * resolves, POISONS the field when it rejects (author-first: the write is the
		 * handler, as `=` on a rejected await would be), and registers the write in
		 * flight for `await this`. The emit used to spell the three itself —
		 * `ø.inflight(this, Promise.resolve(p).then(_ => { this.x = _; }, _ => { this.x =
		 * Symbol.for('!!'); }))` — and so spelt the sentinel; now it spells none (RULED
		 * 2026-10-12). `mode` is the lane's second word: 'indexed' routes the write
		 * through the memo cursor of the async lane, so it lands in source order among
		 * the indexed fans; 'delay' is the waterfall, and `p` is then a THUNK, since
		 * that is the one lane that must not evaluate its expression where it stands.
		 * A destructuring fan passes every bound name and a landing function — the
		 * pattern assignment — in place of the write; each name is poisoned on rejection. */
		static fan(host, name, p, mode, land) {
			if (typeof mode === 'function') { land = mode; mode = undefined; }
			const names = Array.isArray(name) ? name : [name];
			const ok = land || (v => { host[name] = v; }), bad = () => { for (const n of names) host[n] = POISONED; };
			const pr = mode === 'indexed' ? Superset.memo(host, 'async', p, ok, bad)
			         : mode === 'delay'   ? Superset.waterfall(host, 'async layer', p, ok, bad)
			         : Promise.resolve(p).then(ok, bad);
			return Superset.inflight(host, pr);
		}
		/* doc:C-AWAITTHIS */
		/* Every FAN registers the promise of its write as it starts and leaves the
		 * set when it settles; `await this` waits for whatever is in the set at that
		 * moment — the fans declared above it. allSettled: one failed fan cannot hold
		 * construction. */
		static inflight(host, p) {
			if (!p || typeof p.then !== 'function') return p;
			let set = INFLIGHT.get(host);
			if (!set) INFLIGHT.set(host, set = new Set());
			set.add(p);
			const done = () => set.delete(p);
			p.then(done, done);
			return p;
		}
		static landed(host) {
			const set = INFLIGHT.get(host);
			return Promise.allSettled(set ? [...set] : []).then(() => undefined);
		}
		/* doc:C-WATERFALL */
		/* A THUNK arrives, not a promise: the work begins only once the previous
		 * `async setup` on this lane has resolved. */
		static waterfall(host, lane, thunk, ok, bad) {
			let lanes = WFALL.get(host);
			if (!lanes) WFALL.set(host, lanes = new Map());
			const prev = lanes.get(lane) || Promise.resolve();
			const next = prev.then(() => thunk()).then(ok, bad);
			lanes.set(lane, next.then(() => {}, () => {}));
			return next;
		}
		/* doc:C-BATCH */
		/* ONE CALL PER RUN, at its barrier: `yield ø.batch(this, ['a', øbatch_a], ['b',
		 * øbatch_b, 'try indexed'])`. Each member is its field, its handle (the start
		 * was emitted where the member stands) and its words. A member lands
		 * first-come-first-served as it resolves — an `indexed` one through the memo
		 * cursor of the batch lane, in source order among the indexed — and a `try`
		 * member lands `undefined` on rejection; the barrier returned rejects the
		 * moment a member without `try` does, and the yield in the hook waits on it.
		 * Before, each member was its own call under a string id and a second call
		 * (`batchWait`) closed the run, with a table on the side to join the two. */
		static batch(host, ...members) {
			return Promise.all(members.map(([name, p, words = '']) => {
				const soft = /\btry\b/.test(words), indexed = /\bindexed\b/.test(words);
				const pr = Promise.resolve(p);
				const ok = v => { host[name] = v; }, bad = soft ? () => { host[name] = undefined; } : () => {};
				if (indexed) Superset.memo(host, 'batch', pr, ok, bad); else pr.then(ok, bad);
				return pr.then(v => v, e => { if (!soft) throw e; });
			}));
		}
		/* doc:C-DRAINS */
		/* THE DRAIN is a generator the hook delegates to: `this.rows = yield* ø.drain(src)`.
		 * Each step of the source is yielded to the driver exactly as the inline loop
		 * yielded it, so the settlement protocol — one suspension per item, the
		 * author's catch first on a rejection — is unchanged; what the emit loses is
		 * a loop and five registers. `into` receives the items: an array by push, an
		 * object by [key, value] pairs; the tiered form passes the field itself, so
		 * every push lands on the reactive array; a function is called with each item
		 * (`yield* stream()` tees them: `yield* ø.drain(src, _ => ø.emit(this, _))`). */
		static *drain(src, into = []) {
			const it = src[Symbol.asyncIterator] ? src[Symbol.asyncIterator]() : src[Symbol.iterator]();
			const take = typeof into === 'function' ? into : Array.isArray(into) ? v => { into.push(v); } : v => { into[v[0]] = v[1]; };
			let r;
			while (!(r = yield it.next()).done) take(r.value);
			return into;
		}
		/* doc:C-SOFTMETHOD */
		/* Softness for a `try` METHOD. A sync throw is caught; a returned promise gets
		 * the recovery attached, because `try { return p }` in an async function does
		 * not catch p's rejection. */
		static soft(fn) {
			try {
				const r = fn();
				return (r && typeof r.then === 'function') ? r.then(v => v, () => undefined) : r;
			} catch (e) { return undefined; }
		}
		/* reads inside fn register no edges — the kernel's T axis, by name */
		static untrack(fn) { return (Signal && typeof Signal.untrack === 'function') ? Signal.untrack(fn) : fn(); }
		/* doc:C-TLY */
		/* A TEE: the value passes through to the host's settlement stream. */
		static emit(host, v) {
			const q = emitQueue(host);
			if (q.waiters.length) q.waiters.shift()({ value: v, done: false });
			else q.buf.push(v);
			return v;
		}
		/* PRIVATE CELLS — reactive #fields. The compiler emits an accessor pair per
		 * private field; values live in per-host symbol-keyed cells. The KEY is a
		 * closure-held Symbol minted as a `static #` on the class: unforgeable, and
		 * outside the string keyspace. Not store-scanned: a failed settlement leaves
		 * a private pending (reads undefined), silent locally, loud globally. The TIER
		 * rides as the third argument, since symbol keys carry no sigil. */
		static cell(host, key, tier) {
			if (typeof key !== 'symbol') return undefined;
			let m = PRIVATE_CELLS.get(host);
			if (!m) PRIVATE_CELLS.set(host, m = new Map());
			let h = m.get(key);
			if (!h) {
				const T = { '$': ['atomic', 'union'], '$$': ['atomic', 'consensus'],
					'Δ': ['shallow', 'union'], 'ΔΔ': ['deep', 'union'],
					'Σ': ['shallow', 'consensus'], 'ΣΣ': ['deep', 'consensus'] }[tier];
				try { h = T ? new Signal({ value: undefined, options: { capture: T[0], affect: T[1] } }) : new Signal(undefined); }
				catch (e) { h = new Signal(undefined); }
				m.set(key, h);
			}
			return h;
		}
		/* doc:C-DELETE */
		/* `delete obj.key` and `delete obj[expr]` are rewritten to this, and
		 * `Reflect.deleteProperty(o, k)` to reflectDelete: native semantics — same
		 * result, same TypeErrors, the key converted once — then a removed reactive
		 * field's subscribers are told. `optional` is an optional last link
		 * (`obj?.key`): a nullish object short-circuits to true, and the key arrives
		 * as a thunk so it is not evaluated, as native does not. A static still in
		 * its TDZ cannot be deleted, as it cannot be read (C-CASCADE). */
		static delete(o, k, strict, optional) {
			if (optional) { if (o == null) return true; k = k(); }
			if (o == null) throw new TypeError('Cannot convert undefined or null to object');
			const obj = Object(o), key = toPropertyKey(k);
			if (typeof obj === 'function' && isSeeded(obj, key)) tdz(key, obj);
			if (!Reflect.deleteProperty(obj, key)) {
				if (strict) throw new TypeError("Cannot delete property '" + String(key) + "' of " + Object.prototype.toString.call(obj));
				return false;
			}
			forgetField(obj, key);
			return true;
		}
		static reflectDelete(o, k) {
			if (o === null || (typeof o !== 'object' && typeof o !== 'function')) throw new TypeError('Reflect.deleteProperty called on non-object');
			const key = toPropertyKey(k);
			if (typeof o === 'function' && isSeeded(o, key)) tdz(key, o);
			const ok = Reflect.deleteProperty(o, key);
			if (ok) forgetField(o, key);
			return ok;
		}
	}
	/* doc:C-DEFINE */
	/* ONE METHOD PER DESCRIPTOR WORD, made from the table so a new row gets its
	 * word for free: `ø.const(this, 'x', v)` is `define` with the kind filled in. */
	for (const kind of Object.keys(DESCRIPTORS))
		Object.defineProperty(Superset, kind, { configurable: true, writable: true, value: {
			[kind](host, name, v) { return arguments.length > 2 ? Superset.define(host, kind, name, v) : Superset.define(host, kind, name); }
		}[kind] });
	/* a kind is a DESCRIPTORS word, optionally with participles; a raw `{ e, c, w }`
	 * row arrives as its JSON, since it stands where an object key must. One
	 * frozen row per kind: elements hold it by reference. */
	const ROWS = new Map();
	function rowOf(kind) {
		if (typeof kind !== 'string') return kind;
		let row = ROWS.get(kind);
		if (row) return row;
		if (kind[0] === '{') row = JSON.parse(kind);
		else {
			const words = kind.split(' ').filter(Boolean);
			const base = words.find(w => DESCRIPTORS[w]);
			if (!base && !words.every(w => w === 'untracked')) throw new TypeError('Superset.describe: unknown descriptor ' + kind);
			row = Object.assign({}, base ? DESCRIPTORS[base] : BARE_ROW);
			for (const w of words) if (w === 'untracked') row.t = 0;
		}
		ROWS.set(kind, Object.freeze(row));
		return ROWS.get(kind);
	}
	/* The global the emit names. Load order is free: the compiler's class takes
	 * the name when it loads, and whichever half arrives second puts this one
	 * behind it, so `Superset.soft` and `Superset.compile` resolve on one object. */
	{
		const d = Object.getOwnPropertyDescriptor(global, 'Superset'), prior = d && d.value;
		if (typeof prior === 'function' && typeof prior.compile === 'function') Object.setPrototypeOf(prior, Superset);
		else Object.defineProperty(global, 'Superset', { value: Superset, writable: true, configurable: true, enumerable: false });
	}
	/* doc:C-RUNTIME */
	/* `ø` IS THE SHORTHAND the emit writes (the compiler's RUNTIME.ref). It reads
	 * through to the global `Superset`, so it is the same object whichever half
	 * loaded first. A page binding of its own named `ø` would shadow it. */
	if (!Object.getOwnPropertyDescriptor(global, 'ø'))
		Object.defineProperty(global, 'ø', { get: () => global.Superset, configurable: true, enumerable: false });

	/* ════════════════════════════════════════════════════════════════════════
	* §11 — public surface
	* ════════════════════════════════════════════════════════════════════════ */
	defineProperties(Instance, {
		version: { value: '0.89.g', enumerable: true },
		elements: { value: REGISTRY, enumerable: false },
		/* [0.89.d] LATE-BOUND. COMPILER is destructured from `build` as a const at
		 * module scope, so a compiler that registers after the boot gate could never
		 * be seen — and with COMPILER outside the CORE group it is optional, i.e.
		 * exactly the thing that may arrive late. Falling through to the broker makes
		 * script order stop mattering for it, the same trade §8a already makes. */
		Compiler: { get() {
			if (COMPILER) return COMPILER;
			if (_lateCompiler !== undefined) return _lateCompiler;
			const B = global[Symbol.for('Instance')];
			let v = (typeof B === 'function' && B.provides) ? B.provides('compiler') : undefined;
			if (v == null) v = global[Symbol.for('Instance.Compiler')];
			/* EXTMAP hands a FACTORY to resolver(), which calls it with GLOBAL. Arriving
			 * late means skipping that step, so do it here or the caller gets the factory
			 * and `Instance.Compiler.compile` is not a function. Memoised: one call. */
			if (typeof v === 'function' && typeof v.compile !== 'function') { try { v = v(global); } catch (e) { v = undefined; } }
			return (_lateCompiler = v);
		} },
		/* [0.89.j] the compiler's own name for itself — `new Instance.Superset(10.0)` */
		Superset: { get() { return Instance.Compiler; } },
		/* doc:C-DESCRIPTOR */
		DESCRIPTORS: { value: DESCRIPTORS },
		Chimera: { get() { return CHIMERA } },
		layer: { value: layer },
		Interface: { value: Interface },
		Lifecycle: { value: Instance },   // merged: the lifecycle IS Instance now
		DSL: { value: DSL },
		JSDOM: { value: JSDOM },
		Lexeme: { value: Lexeme },
		PENDING: { value: PENDING, enumerable: true },
		POISONED: { value: POISONED, enumerable: true },
		BLANK: { value: BLANK, enumerable: true },
		compile: { value: compile },
		run: { value: run },
		UUID: {
			value: key => {
				if (typeof key !== 'string' || !key) throw new Error('Instance.UUID expects a non-empty key');
				return Symbol.for(key);
			}
		}
	});

/* ── the PLATFORM kit ─────────────────────────────────────────────────────────
 * Everything §10 reads from core, handed out through the same channel §11a uses.
 *
 * PUBLISHED HERE, at the end of core's body, and the position is not taste: the kit
 * names `Events`, which is declared in §8 — publishing it up beside the namespaces
 * kit threw `Cannot access 'Events' before initialization`. A kit is a snapshot of
 * bindings, so it can only be taken once they all exist.
 *
 * Published unconditionally. In the monolith nothing reads it — §10 has all of this
 * in lexical scope already — and an unread domain costs one object. Publishing it
 * only for the split would hand §10 its dependencies by two different routes, which
 * is the two-code-paths arrangement the prologue hoist just removed. */
global[Symbol.for('Instance')].domain('platformkit', {
	CORE_TAGS, MINTED, Signal, _I18N, _RT, _httpGET, _looksLikeURL, _nsFire,
	createElement, Instance   // no Events: the analyser counted the word from a COMMENT in §10
});

/* The EVENTS kit stood here and is gone with the extraction. §8 EVENTS is back in
 * core, where it has to be: `class Events extends Interface`, and an Interface
 * SPLICES onto Instance.prototype. The metaclass COPIES that prototype onto each
 * tag's own iface at mint time, so a splice arriving after #initialize lands
 * somewhere nothing reads. Measured: modular had Instance.prototype.on present and
 * el.on missing — the whole event surface, absent, with a green board. */

	return Instance;
},
{
	/* EXTMAP */

	/* Registry SYMBOLS for what actually ships; null for reserved slots the
	 * resolver skips silently. A symbol is looked up at BOOT, after every script
	 * has run — so EXTMAP order is not load order, and a <script src> module and
	 * an inline definition register through the same channel. STORE is gone:
	 * CHIMERA already provides Signal.Store, so the slot could only duplicate it. */
	/* true = resolve by KEY NAME through the lookup chain (IVC provider channel,
	   then Symbol.for('Instance.Key'), then Symbol.for('Key')). A symbol still
	   names one global slot directly; null is skipped.

	   CORE groups the extensions that must be present BEFORE core boots, and it
	   IS the requirement set — nothing else lists them. Membership is not taste:
	   BIOS6 destructures Chimera and DSL one level deeper (`const { Signal, … } =
	   CHIMERA`), so absent they throw at module scope. COMPILER stops one level
	   up and is merely undefined — measured: core boots, classes construct,
	   signals work, only `.is` compilation is gone. Hence optional, and hence
	   the late-bound Compiler getter, since optional means it may arrive late. */
	['CORE']: {
		'Chimera':   true,                              // the signal kernel
		'DSL':       true                               // placement + argument grammar
	},
	['COMPILER']:    true,                              // the .is transpiler — optional
	['PLATFORM']:    null,                              // platform-gap elements (router and forms excluded)
	['ROUTER']:      null,                              // client-side routing
	['FORMS']:       null,                              // form state
	['TRANSITIONS']: null,                              // resolved by the LATE-BOUND seam in §8a, not
	['I18N']:        null,                              // internationalization
	['DEVTOOLS']:    null,                              // developer tools overlay


}));

// The loader is async (for-await over EXTMAP) → the module resolves to a Promise.
// Node: const Instance = await require('./Instance-0_86_d.js');
// if (typeof module === 'object' && typeof module.exports === 'object') module.exports = __instanceBoot;

/* [0.89.c] BOOT IS SYNCHRONOUS. __INSTANCE__ is the Instance itself, not a promise:
   the whole pipeline lost its awaits when EXTMAP stopped resolving module URLs. That
   is the point — a module loaded AFTER core can now write `class Router extends
   Instance` in plain script scope, with no factory-and-context indirection.
   InstanceReady is kept, already-resolved, because it is the documented entry point
   and every consumer awaits it. */
/* core already installs globalThis.Instance (non-writable) during boot. */
/* [0.89.d] Waits on the BROKER, not on __INSTANCE__ — which is null at this point
   whenever the CORE group has not arrived yet. `await new Instance(globalThis)` is
   the entry point now; InstanceReady is kept as a resolved alias so the six existing
   consumers keep working while they migrate. */
globalThis.InstanceReady = globalThis[Symbol.for('Instance')].ready().then(function (Instance) {
	/* [0.89.d] new Instance(globalThis) now returns the BOOT HANDLE. InstanceReady
	   CHAINS it rather than firing and forgetting, so the two entry points cannot
	   disagree about when boot finished — and a boot that throws now reaches an
	   awaiter of either one instead of only the console. */
	if (typeof document === 'undefined') return Instance;
	return new Instance(globalThis).then(function () { return Instance; },
		function (e) { console.error('[Instance bundle] boot failed:', e); return Instance; });
});


})();
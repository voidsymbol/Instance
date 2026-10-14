(function () {
'use strict';
const CHIMERA_API = (function init(factory) {

	const u = typeof void function($0, $1, $2) {
		var upsert = (proto, name) => {
			if (!Object.prototype.hasOwnProperty.call(proto, name)) {
				Object.defineProperty(proto, name, {
					value: {
						[$1](key, dv) { return this.has(key) ? this.get(key) : (this.set(key, dv), dv); },
						[$2](key, fn) {
							if (this.has(key)) return this.get(key);
							if (typeof fn !== $0) throw new TypeError(`${$2} requires a ${$0}`);
							const computed = fn(key, this);
							return this.set(key, computed), computed;
						}
					}[name], writable: true, configurable: true, enumerable: false
				});
			}
		};
		for (const proto of [WeakMap.prototype, Map.prototype]) { upsert(proto, $1); upsert(proto, $2); }
	}('function', 'getOrInsert', 'getOrInsertComputed');

	const VERSION = '18.3.y';
	const THIS = 
	  typeof globalThis !== u ? globalThis : 
		typeof window !== u ? window : 
		  typeof self !== u ? self :
			typeof global !== u ? global : 
			  this ?? Function('return this')();

	const INIT = factory(THIS, VERSION);
	
    if (typeof define === 'function' && define.amd) define( [], () => INIT ); // AMD
    if (typeof module === 'object' && typeof module?.exports === 'object') module.exports = INIT; // CommonJS
	
	return INIT; // Browser global

})(function(global, version) { 

/*
	Tony Stark, built this in a CAVE!!! With a box of SCRAPS!!
*/

'use strict';

const CURSOR_NODE_BUMP      = 0; // Simple bump allocator (64-bit)
const CURSOR_EDGE_BUMP      = 1; // Simple bump allocator (64-bit)
const CURSOR_LIVE_NODES     = 2; // Atomic counter (64-bit)
const CURSOR_FREE_NODE_HEAD = 3; // Tagged Pointer for ABA-safe CAS (64-bit)
const CURSOR_FREE_EDGE_HEAD = 4; // Tagged Pointer for ABA-safe CAS (64-bit)
const CURSOR_GLOBAL_UUID    = 5; // Global epoch generator (64-bit)

const ψ = (Ctor, ...sizes) => sizes.map(size => new Ctor(size)); // hydrator
const encode = (r, e, a, c, t) => (81*r + 27*e + 9*a + 3*c + t); // trit encoder
/** */
const EDGE_STRIDE_SHIFT = 2, SAB_HEADER_SIZE = 65536;
const THREAD_CTX_OFFSET_BYTES = 256, THREAD_CTX_STRIDE = 16, MAX_THREADS = 16;
const THREAD_ACTIVE_PTR = 0, THREAD_TRACE_EPOCH = 1, THREAD_OBSERVED_EPOCH = 2;
const MTC_NODE_BUMP = 0, MTC_EDGE_BUMP = 1, MTC_FREE_NODE_HEAD = 2, MTC_FREE_EDGE_HEAD = 3;
const MTC_TRACE_EPOCH64 = 8; // [18.3.h] shared 64-bit run-epoch (cursors64): MT mirror of sync's _traceEpoch — bumped once per node run, stamps dep edges, never wraps
const MTC_GLOBAL_UUID = 4, MTC_HLC = 5, MTC_GLOBAL_EPOCH = 6, MTC_WORK_AVAILABLE = 7;
const MTC_WORK_HEAD = 8, MTC_WORK_HEAD_MAIN_ONLY = 10;
const MTC_ARENA_NODES = 12, MTC_ARENA_EDGES = 13, MTC_ARENA_WORKERS = 14; // header-authoritative geometry + topology (18.3.g) — APPEND-only slots
const MARK_BIT = 0x80000000_00000000n, MASK_INDEX = 0xFFFFFFFFn;
const { load: LOAD, store: STORE, compareExchange: CAS, add: ADD, sub: SUB, or: OR, and: AND, exchange: EXCHANGE, notify: NOTIFY, wait: WAIT } = Atomics;
const packPtr = (idx, tag) => (BigInt(tag) << 32n) | (BigInt(idx) & MASK_INDEX);
const unpackIndex = (p) => Number(p & MASK_INDEX);
const unpackTag = (p) => Number((p >> 32n) & 0x7FFFFFFFn); // mark-aware: strips MARK_BIT
const isMarked = (p) => (p & MARK_BIT) !== 0n;
const getMarked = (p) => p | MARK_BIT;
const getUnmarked = (p) => p & ~MARK_BIT;

const CHIMERA  = Symbol.for('Chimera');
/* [0.89.d] a dead `const PENDING = Symbol.for('Instance.??')` sat here for two */
const POISONED = Symbol.for('Instance.!!');

const REACTIVE_STORE = Symbol('/Store');
const LAYER  		 = Symbol('/Layer');
const DEEP_PROXIES	 = Symbol('/Deep Proxies'); // proxies
const QUORUM  		 = Symbol('/Quorum');
const CASCADE  	 	 = Symbol('/Cascade');
const DICTIONARY	 = Symbol('/Dictionary');
function computeMemo(self, bag, args) {
	const sig    = bag.sigOf(args);
	const leaf   = trieDescend(bag.trieRoot, sig);
	const cached = leaf.node;

	if (cached && _nodeGen[cached[PTR]] === cached[GEN]) {
		if (_trits[cached[PTR]] !== 0) return get(cached[PTR]);
		dropFromQueue(bag.leafQueue, cached[PTR]);
	}

	if (sig.length === 0) {   // the empty signature IS the head (C-ONENODE): arm it and run it as a leaf is run
		if (GraphNode.dead(self)) return undefined;
		const ptr = armHead(self, bag, leaf, bag.leafTrit);
		runNode(ptr);
		return get(ptr);
	}

	const leafPtr = allocNode();
	_trits[leafPtr] = bag.leafTrit;
	if (bag.quorum) _gateA[leafPtr] = 1;   // [RULED] explicit consensus: the leaf holds until every dep has moved
	adopt(stateOf(self).engine[PTR], leafPtr);
	const leafRef = refOf(leafPtr);

	if (_memoGC) {
		for (const a of args)
			if (isKeyable(a) && !(a instanceof Signal))
				_memoGC.register(a, leafRef);
	}

	bag.leafQueue.push(ø({ [PTR]: leafPtr, trieNode: leaf })); // queue entries symbol-keyed — dropFromQueue reads e[PTR]
	bag.liveCount++;

	if (bag.leafQueue.length > bag.maxSize) {
		/* [RULED — Immune-Active LRU] a leaf with consumers, or a live PUSH leaf
		 * (an effect is running work), is IMMUNE and rotates back; only inert,
		 * unsubscribed pull memos age out. Immunity outranks the cap. */
		let scan = bag.leafQueue.length;
		while (bag.leafQueue.length > bag.maxSize && scan-- > 0) {
			const old = bag.leafQueue.shift();
			if (!old) break;
			const _p = old[PTR];
			const live = _trits[_p] !== 0 && old.trieNode?.node?.[PTR] === _p;
			if (live && (_sigHead[_p] !== 0 || e_axis(_trits[_p]) === 1)) { bag.leafQueue.push(old); continue; }
			if (live) { triePrune(old.trieNode); tagForDisposal(_p); bag.liveCount--; }
			else if (old.trieNode?.node?.[PTR] === _p) triePrune(old.trieNode);
		}
	}

	/* [RULED — arity shift] the engine injects the LENS as arg0; the caller's
	 * arguments are the signature. Bare heads lens their own handle; door- and
	 * owner-scoped bodies already ride arg0 by construction (see installRecipe). */
	_values[leafPtr] = () => bag.factory.call(self, self, ...args);
	leaf.node = Signal(leafPtr);
	runNode(leafPtr);
	return get(leafPtr);
}

/* doc:C-ONENODE */
/* THE HEAD IS THE EMPTY SIGNATURE. A factory's `[]` variant is installed on the head
 * node itself: the body sits in the head's value lane and the trie's root names it,
 * so `comp()`, `eff()` and `s()` read the head, and a Computed or an Effect is ONE
 * arena slot (it was two: an inert head and a leaf). The head is never in the LRU
 * queue — a store cannot evict itself — and deleting the signature retypes it
 * instead of killing it: the store, with its other variants, lives on. */
function armHead(self, bag, leaf, trit) {
	const ptr = GraphNode.ptrOf(self);
	_trits[ptr] = trit;
	if (bag.quorum) _gateA[ptr] = 1;   // [RULED] explicit consensus: the head holds until every dep has moved
	_values[ptr] = () => bag.factory.call(self, self);
	_ctx[ptr] = undefined;
	leaf.node = self;
	bag.liveCount++;
	return ptr;
}
/* the head sheds its body (delete of the empty signature, clear): back to the plain
 * state node it was born as. What the body owned goes with it, and its consumers
 * learn, as they would of a leaf's death. */
function retypeInert(ptr) {
	const prev = _ctx[ptr];
	cleanupDeps(ptr);
	if (_nodeTree[(ptr*3 + TREE_CHILD)] !== 0) disposeChildren(ptr);
	_gateA[ptr] = 0;
	_predicates[ptr] = undefined;
	_ctx[ptr] = undefined;
	_values[ptr] = undefined;
	_parkedTrit[ptr] = 0;
	_trits[ptr] = TRIT_STATE;
	if (prev !== undefined) trigger(ptr);
}

// Throw families — one shape each, so the message lives in exactly one place.
const noStore   = n => { throw new TypeError(`Signal.Store does not support ${n}()`); };
const storeOnly = n => { throw new TypeError(`${n}() is a Signal.Store method`); };
// ── INVARIANT (Liveness) ──────────────────────────────────────────────────────
// #zombie is STORED, not derived. Therefore: EVERY path that kills a node MUST
// mark its handle via _handles[ptr]?.[MARK]?.() before the slot can be observed.
// Today that is exactly two sites: tagForDisposal() (logical death) and freeNode()
// (physical death). Add a third death path without marking and liveness goes stale
// silently — §10 of the suite exists to catch that.
const MARK      = Symbol('/markZombie'); // arena → handle liveness write-back (symbol: Reachability Invariant)
const ENGINE    = Symbol('/store.engine'); // Reachability: engine is control state read across module scope
const PROXY_REF = Symbol('/traps.proxy');
const CALL           = Symbol('/Callable');
const GEN_CTX 		 = Symbol('/Chimera FN');
const AWAITING		 = Symbol('/Awaiting');

// ── SIGIL_REF — the sigil table IS data. Canonical runs carry {A, C} pole names
// (A = family, C = depth — SAME poles in every row); aliases are strings pointing
// at their canonical run. Every consumer (parse, canonKey, canonOf, the scanners'
// regexes, the triads' canonical namespace) derives from this table and nothing else.
//
// [RULED — split-lane] The grid is 3×2 and DOUBLING STRENGTHENS WITHIN A LANE.
// Unicode lanes: the CHARACTER picks the family (Δ union, Σ consensus) and
// doubling picks the depth (single shallow, double deep). The $ lane is ATOMIC
// (depth 0): with no depth left to vary, doubling spends on the family instead —
// $ union, $$ consensus. One rule, three lanes, no footnote; the family axis is
// observable at depth 0 (measured: torn-state under a multi-key union write).
// ø and Φ are LEGACY aliases of '$' — the old atomic type sat OUTSIDE the family
// checks, so its legacy behavior was self-contradictory (recipes fired union,
// writes batched consensus). The alias follows the dominant pinned lane: the
// RECIPE lane (suite: "Φ-door default is UNION"). Legacy multi-key writes
// through ø/Φ become union — the one divergence, accepted at retirement.
const SIGIL_REF = {
    'Δ':  { A: 'union',     C: 'shallow' },
    'ΔΔ': { A: 'union',     C: 'deep'    },
    'Σ':  { A: 'consensus', C: 'shallow' },
    'ΣΣ': { A: 'consensus', C: 'deep'    },
    'Φ':  { A: 'union',     C: 'atomic'  },   // canonical
    'ΦΦ': { A: 'consensus', C: 'atomic'  },   // canonical
    '$': 'Φ', '$$': 'ΦΦ', 'ø': 'Φ',      // aliases
};
// Derived ONCE from the table: spelling → {type, depth} (aliases resolved, doubles map
// to Infinity, triples fall back to their double — '$$$'/'ΔΔΔ' stay obsolete-but-alive),
// discipline → canonical spelling (first canonical entry wins), the scanner char set,
// and the caller-sigil strip the doors use. Nothing below reads SIGIL_REF directly.
const RUN_META = {}, CANON_SPELLING = {};
for (const run of Object.keys(SIGIL_REF)) {
    const def = SIGIL_REF[run];
    const d = typeof def === 'string' ? SIGIL_REF[def] : def;
    const depth = d.C === 'deep' ? Infinity : d.C === 'shallow' ? 1 : 0;
    const type  = d.A;   // [split-lane] the family SURVIVES depth 0 — $ vs $$ is observable (measured)
    RUN_META[run] = Object.freeze({ type, depth });
    if (typeof def !== 'string' && CANON_SPELLING[type + ':' + depth] === undefined)
        CANON_SPELLING[type + ':' + depth] = run;
}
const SIGIL_CHARS = new Set(Object.keys(SIGIL_REF).map(k => k[0]));
const SIGIL_STRIP_RE = new RegExp('^[' + [...SIGIL_CHARS].map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + ']+');
const TRIADS = new WeakMap();

const PREFIX_RE = buildRegex('prefix', SIGIL_CHARS);
const SUFFIX_RE = buildRegex('suffix', SIGIL_CHARS);

function buildRegex(type, chars, maxLen = 3) {
	// Escape each character for use inside a regex character class
	const escaped = [...chars].map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
	const classPattern = `[${escaped}]{1,${maxLen}}`;
	const p = type === 'prefix' ? `^(${classPattern})(.*)$` : `^(.*?)(${classPattern})$`;
	return new RegExp(p);
}

function ø(o) { return { __proto__: null, ...o } }

function isFrozen(ptr) { return (r_axis(_trits[ptr]) === 0) && (_trits[ptr] !== 0); } // don't mistake void nodes for frozen 
/* the store state behind a handle or host, for code outside the class body */
function stateOf(h) { return GraphNode.stateOf(h); }

function startsWith(r, s) { const m = r.exec(s); return m ? { sigil: m[1], name: m[2] } : null; }
function endsWith(r, s) { const m = r.exec(s); return m ? { sigil: m[2], name: m[1] } : null; }
function isKeyable(v) { return v !== null && (typeof v === 'object' || typeof v === 'function'); }
/* [§2a — EXOTICS ARE OPAQUE, at every tier, in every wrapper]. Platform objects with */
const EXOTIC_TAGS = new Set(['[object Map]', '[object Set]', '[object WeakMap]', '[object WeakSet]',
	'[object Date]', '[object RegExp]', '[object Promise]', '[object DataView]',
	'[object ArrayBuffer]', '[object SharedArrayBuffer]', '[object Error]']);
const _ots = Object.prototype.toString;
function isExoticOpaque(o) {
	const p = Object.getPrototypeOf(o);
	if (p === Object.prototype || p === Array.prototype || p === null) return false; // plain records: the fast lane
	if (typeof o.nodeType === 'number' && typeof o.nodeName === 'string') return true; // DOM, realm-proof
	if (ArrayBuffer.isView(o)) return true;
	return EXOTIC_TAGS.has(_ots.call(o));
}
/* [0.89.j] the VALUE predicate: a class instance is opaque as DATA — skinning
 * one breaks its own private fields (#x through a proxy throws, measured). The
 * skin exists for SUB-KEY granularity; data is plain objects and arrays. The
 * ENGINE'S own objects (handles, stores) are class instances too, so this rule
 * must never guard reactive() targets wholesale — values only. */
function isOpaqueValue(o) {
	if (isExoticOpaque(o)) return true;
	const pr = Object.getPrototypeOf(o);
	return pr !== Object.prototype && pr !== null && !Array.isArray(o);
}

/* doc:C-ADOPT */
/* A door is a Proxy, and a Proxy is callable only over a callable target. A
 * minted handle is one, and is its own doors' target. An adopted host is not used
 * even when it is callable: an element is not, and a CLASS carries non-configurable
 * own properties (`prototype`) that the Proxy invariants would make every door
 * report. So an adopted host's doors stand on a SURROGATE function and the traps
 * answer from ctx.store, never from the target. The surrogate holds nothing: writes
 * mirrored onto a target are junk on a handle too, and a door's own keys are the
 * dictionary's. "Minted" is the PROTOTYPE's answer (instanceof Signal), never
 * typeof's: a class is a function and is not a handle. */
const newMap = () => new Map();
function doorTarget(instance) {
    return instance instanceof Signal ? instance : function door() {};
}
function triad(instance, prefix, isUnion, owner) {
    prefix = canonSigil(prefix); // one canonical namespace — $/Σ tiers share ONE cache entry

    const cache = TRIADS.getOrInsertComputed(instance, newMap);   // computed: a hit must not allocate (it did, on every door access)
    const key = `${prefix}|${isUnion}|${owner == null ? '' : owner}`;

    return cache.getOrInsertComputed(key, () => {
        GraphNode.ensureState(instance);   // a door on a cell: its first key lives here (C-ONENODE)
        return reactive(doorTarget(instance), {
            isRoot: true,
            store: instance,
            prefix,
            meta: sigilMeta(prefix),
            owner,
            isUnion
        });
    });
}

/** */
function parse(key) {
    if (typeof key !== 'string') return null;
    const prefix = startsWith(PREFIX_RE, key);
    const suffix = endsWith(SUFFIX_RE, key);
    if (prefix && !prefix.name) return null;
    if (suffix && !suffix.name) return null;
    if (prefix && suffix) throw new TypeError(`Double-sided sigils are banned: key "${key}" carries both a prefix and a suffix run.`);
    if (!prefix && !suffix) return null;
    const { sigil, name } = prefix || suffix;
    const mode = prefix ? 'prefix' : 'suffix';
    if (new Set(sigil).size > 1)
        throw new TypeError(`Key "${key}" has mixed sigils. All consecutive sigils must be identical.`);
    const meta = sigilMeta(sigil);
    if (!meta) return null;
    const sig = canonOf(meta);
    return { key, mode, name, depth: meta.depth, type: meta.type,
             canonKey: mode === 'prefix' ? sig + name : name + sig };
}

function canonKey(key) { const m = parse(key); return m ? m.canonKey : key; }

function canonSigil(p) { const m = sigilMeta(p); return m ? canonOf(m) : p; }

// Scoped-namespace conflict rule: at ONE level, the same bare name may not carry
function assertDisciplines(obj) {
    const seen = new Map();
    for (const k of Object.keys(obj)) {
        const m = parse(k);
        const bare = m ? m.name : k;
        const mode = m ? m.mode : 'prefix';
        const disc = m ? `${m.type}:${m.depth}` : 'inherit';
        const g = bare + '\u0000' + mode;
        const prev = seen.get(g);
        if (prev && prev.disc !== disc)
            throw new TypeError(`Conflicting disciplines for "${bare}": "${prev.k}" vs "${k}" at the same level.`);
        seen.set(g, { k, disc });
    }
}

/** */
function sigilMeta(sigil) {
    if (typeof sigil !== 'string' || sigil.length === 0) return null;
    if (new Set(sigil).size > 1) throw new TypeError(`Mixed sigils: "${sigil}"`);
    // THE table lookup — runs longer than the table knows collapse toward their double,
    return RUN_META[sigil] ?? RUN_META[sigil.slice(0, 2)] ?? RUN_META[sigil[0]] ?? null;
}
const canonOf = ({ type, depth }) =>
    CANON_SPELLING[type + ':' + depth]
    ?? (depth === 0 ? (type === 'consensus' ? '$$' : '$')
        : type === 'union' ? (depth === Infinity ? 'ΔΔ' : 'Δ')
                           : (depth === Infinity ? 'ΣΣ' : 'Σ')); // legacy fallback: defensive only

const TEXT_SYNC = `%c[Chimera V${version}] Trit Arena Active (Sync).`;

const EXPORT_SYMBOLS = true;
const PTR = Symbol('ptr'), GEN = Symbol('gen'); // [18.3.o] identity moved off the public name
// surface ([PTR]/[GEN] retired): reachable only by holding the symbol — deliberate, greppable, unshadowable by name.
const SYMBOLS = { DICTIONARY, REACTIVE_STORE, LAYER, DEEP_PROXIES, QUORUM, CASCADE, CALL, PTR, GEN }; // for exporting

const ROOT_MOUNT = 121;
const Z = 128, U = 'undefined'; // Zero point.

const [R, E, A, C, T] = [3 ** 4, 3 ** 3, 3 ** 2, 3 ** 1, 3 ** 0];
const [L1, L2, L3, L4, L5] = [1 << 16, 1 << 17, 1 << 18, 1 << 19, 1 << 20];

// ── Sentinels. Each of them are polar opposites. (Deferred)
const [X127, X126, X125, X124, X123, X122] = [+127, +126, +125, +124, +123, +122];
const [M128, M127, M126, M125, M124, M123, M122] = [-128, -127, -126, -125, -124, -123, -122];

const [EDGE_STRIDE, EDGE_SHIFT] = [4, 2]; // idx >> 2 → edge index          
const [EDGE_TARGET, EDGE_NEXT, EDGE_PREV_SUB, EDGE_PAIR] = [0, 1, 2, 3];

// ── Dependency links and LUTs
const [TREE_PARENT, TREE_CHILD, TREE_SIB] = [0, 1, 2];
const [LUT_R, LUT_E, LUT_A, LUT_C, LUT_T] = ψ(Int8Array, 256, 256, 256, 256, 256);

void ((rnd) => {
	for (let i = ROOT_MOUNT; i >= -ROOT_MOUNT; i--) {
		const r = rnd(i / R);
		const e = rnd((i - R*r) / E);
		const a = rnd((i - R*r - E*e) / A);
		const c = rnd((i - R*r - E*e - A*a) / C);
		const t = i - R*r - E*e - A*a - C*c;
		LUT_R[i + Z] = r; LUT_E[i + Z] = e; LUT_A[i + Z] = a; LUT_C[i + Z] = c; LUT_T[i + Z] = t;
	}
})(Math.round);

const ZEROES = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

const EDGE_DIRTY_FLAG  = 0x80000000;   // bit 31 – set when the edge is dirty of lane 0;
const EDGE_TARGET_MASK = 0x7FFFFFFF;   // bits 30:0 – extracts the real node index
const ID_MULTIPLIER_BIGINT = BigInt(0x200000); // multiplier flag
/* THE REF: a slot and its 64-bit generation packed into one BigInt — the arena's
 * identity VALUE. A dictionary entry holds a ref and so pins nothing: the slot
 * can be freed and reused forever, and a stale ref fails the generation compare
 * in deref and reads as absent. The multiplier gives the slot 21 bits, which is
 * why init refuses a larger arena. Arithmetic, not shifts: measured faster in V8. */
function refOf(ptr) { return _nodeGen[ptr] * ID_MULTIPLIER_BIGINT + BigInt(ptr); }
/* (ptr, gen) names the LIVE occupant of the slot: same generation, non-void trit. */
function isLive(ptr, gen) { return _nodeGen[ptr] === gen && _trits[ptr] !== 0; }
/* a RUNNABLE holds a body in its value lane: a formula or effect (E ≠ 0), or one
 * parked with a ticket. A value lane that happens to hold a function is DATA. */
function isRunnable(ptr) { return typeof _values[ptr] === 'function' && (e_axis(_trits[ptr]) !== 0 || _parkedTrit[ptr] !== 0); }

const ZERO_POINT = 128;
class CachedThrow { constructor(e) { this.e = e; } }
const CORRUPTION = -128;

const FRESH_MIN  = +41, STALE_MAX = -41;
const EAGER_HI   = -41, EAGER_LO = -67;
const ZOMBIE_HI  = -68, ZOMBIE_LO = -94;

// Inert trit for Store / user subclass "identity" nodes.
const TRIT_STORE 	= encode(+1,  0,  0,  0,  0);
const TRIT_STATE    = encode(+1,  0,  0,  0, -1); // the default
const TRIT_COMPUTED = encode(-1, -1, +1, -0, -1);
const TRIT_EFFECT   = encode(-1,  1, -1, -0, -1); // A=-1 CONSENSUS — OWNER-CANONICAL, restored (18.3.i) and gated in the docsuite.

const LOCK_DELTA   = R;
const DIRTY_DELTA  = R*2;
const SETTLE_DELTA = E*2;

const SIZES = { L1, L2, L3, L4, L5 };
/** */
const resolveSize = (x) => (typeof x === 'number' && x > 0 ? (x | 0) : (SIZES[x] ?? SIZES.L2));

// Descriptor form (single-arg object): maps 1:1 onto the five balanced-ternary
const POLE = {
	R: { FRESH: 1, STASIS: 0, FROZEN: 0, STALE: -1 }, // "it's RAW!!!" — STASIS (né FROZEN, alias kept): frozen band ∪ mid-run lock share the digit (§30)	// R = Return
	E: { PUSH: 1, DETACHED: 0, PULL: -1 },						// E — Eval
	A: { UNION: 1, PHANTOM: 0, CONSENSUS: -1, ANY: 1, AS: 0, ALL: -1 },	// A — Affect (ANY/AS/ALL — owner naming, this session)
	C: { DEEP: 1, ATOMIC: 0, SHALLOW: -1 },						// C — Capture
	T: { VOLATILE: 1, UNTRACKED: 0, SEMANTIC: -1 },				// T — Tracking
};														// V - void: (0,0,0,0,0)

const _DESC_KEYS = new Set(['scope', 'key', 'value', 'get', 'set', 'options']);

// ✨ Reserved keys that bypass the prefix lookup
/* [18.4.3] the '@' EFFECT LANE is retired: it was never in SIGIL_REF, so
 * `triad(this, '@', …)` had no lane configuration to read. The field sigil
 * `@cfg` is a COMPILER spelling of `sync` and is untouched — different thing,
 * same glyph. */
const DOOR_KEYS = new Set(['Σ', 'ΣΣ', 'Φ', 'ΦΦ', '$', '$$', 'ø', 'Δ', 'ΔΔ', 'ψ']);
const RESERVED = new Set(['Σ', 'ΣΣ', '$', '$$', 'Φ', 'ø', 'Δ', 'ΔΔ',
                          'ψ', 'get', 'set', 'delete', 'clear']);   // [RULED] `size` retired — has() is the count; `size` is a data key

const _accessorSet = new Map();   // ptr -> custom setter fn (writable-accessor descriptors); cleared on freeNode

/* kernel weak registry — single mint for the kernel's module tables (core has WEAK). */
const KWEAK = { mint(name, kind) { return (KWEAK[name] = kind === 'set' ? new WeakSet() : new WeakMap()); } };

// Memoization (APM) — with maxSize and FIFO eviction
const _deepCache = KWEAK.mint('deepCache', 'map');
const _proxySet  = KWEAK.mint('proxySet', 'set');
/* [0.89.j] NESTED identity — one proxy per (store, raw target): without this,
 * every traversal minted fresh (v.a !== v.a), so ===, WeakMap/Set keying, and
 * memo checks were permanently unstable one level down. Aliasing caveat: a raw
 * object reachable at two paths in ONE store shares the first mint's ctx. */
const _storeNested = KWEAK.mint('storeNested', 'map');   // store → WeakMap(target → proxy)
const _nodeHome = new Map();   // ptr → { store, key }: lets a key HANDLE read what the value lane serves

/* doc:C-OWNERELEMENT */
let _ownElements = false;   // RULED open, leaning false: an adopted host is not the running effect's child
const _componentState = new WeakMap();   // component handle → { dict, proxies, quorums, cascade, engine }
const _memoGC = (typeof FinalizationRegistry === 'function')
	? new FinalizationRegistry((ref) => { const h = Signal.deref(ref); if (h) { h.dispose() } }) 
	: null;

let MAX_NODES, MAX_EDGES, EDGE_MAX_STRIDE;

let _cursors, _edgePtr, _nodePtr, _globalUUID;
let _isFlushing, _isPaused, _isBooted;
let
	_trits, _freeMemoryAxis, _runCount, _depsCount, _layer, _durable,
	_readyCount, _edgeEpoch, _nodeTree, _nodeGen, _gateA, _owner, _predicates,
	_sigHead, _headDep, _pendingQueue, _zombieQueue,
	_worklist, _edges, _values, _ctx, _detachDirty, _handles, _parkedTrit,  // [typed] arrays

	_traceEpoch, _activePtr,  // numerics (zeroed at init)
	_pendingHead, _pendingTail, _batchDepth, _zombieTail,
	_rootPtr, _liveNodes, _freeNodeHead, _freeEdgeHead;

// ── Arena buffer ─────────────────────────────────────────────────
let _sharedBuffer = null;      // SharedArrayBuffer | ArrayBuffer
let _arenaOffset  = 0;         // byte offset for next allocation
let _isShared     = false;     // true when SAB is active

function isDescriptor(a) {
	if (a === null || typeof a !== 'object' || Array.isArray(a)) return false;
	const ks = Object.keys(a);
	return ks.length > 0 && ks.every(k => _DESC_KEYS.has(k));
};

function r_axis(v, R) { return typeof R === U ? LUT_R[v+Z] : encode(R, LUT_E[v+Z], LUT_A[v+Z], LUT_C[v+Z], LUT_T[v+Z]) }
function e_axis(v, E) { return typeof E === U ? LUT_E[v+Z] : encode(LUT_R[v+Z], E, LUT_A[v+Z], LUT_C[v+Z], LUT_T[v+Z]) }
function a_axis(v, A) { return typeof A === U ? LUT_A[v+Z] : encode(LUT_R[v+Z], LUT_E[v+Z], A, LUT_C[v+Z], LUT_T[v+Z]) }
function c_axis(v, C) { return typeof C === U ? LUT_C[v+Z] : encode(LUT_R[v+Z], LUT_E[v+Z], LUT_A[v+Z], C, LUT_T[v+Z]) }
function t_axis(v, T) { return typeof T === U ? LUT_T[v+Z] : encode(LUT_R[v+Z], LUT_E[v+Z], LUT_A[v+Z], LUT_C[v+Z], T) }

const isClass = (x) => typeof x === 'function' && /^class[\s+{]/.test(Function.prototype.toString.call(x));
const isScope = (x) => x === null || isClass(x) || (typeof x === 'object' && x !== null && x[REACTIVE_STORE]);

const { is, is: $is, create: $create } = Object;

/** */
let allocNode = function() {
	if (!_isBooted) init(L2);
	return (allocNode = jsAllocNode)();      // bootstrap & run
};

function init(size = L2) {
	/* RULED: the arena is capped at 2^21 slots per shard. The ref packs the slot
	 * into 21 bits; a larger arena would mint nodes whose own refs do not deref. */
	if (!(size > 0) || size > Number(ID_MULTIPLIER_BIGINT)) throw new RangeError(`[Chimera ${version}] arena size ${size} exceeds the ref layout (max ${Number(ID_MULTIPLIER_BIGINT)} slots per shard)`);

	const N = (MAX_NODES = size);
	const E = (MAX_EDGES = size * 4);

	EDGE_MAX_STRIDE = E * EDGE_STRIDE;

	[ _trits, _freeMemoryAxis ] = ψ(Int8Array, N, N);
	[ _runCount, _depsCount, _readyCount ] = ψ(Uint16Array, N, N, N);
	[ _nodeTree ] = ψ(Uint32Array, N * 3); // _edgeEpoch: one element per edge.

	[ _sigHead, _headDep, _edges, _zombieQueue ] = ψ(Int32Array, N, N, EDGE_MAX_STRIDE, N + E); // _edges: EDGE_STRIDE lanes per edge
	[ _nodeGen, _edgeEpoch ] = ψ(BigUint64Array, N, E + 1);
	[ _values, _ctx, _pendingQueue, _worklist ] = ψ(Array, N, N, 0, 0);

	_layer = new Uint8Array(MAX_NODES);
	_durable = new Uint8Array(MAX_NODES);
	_detachDirty = new Uint8Array(MAX_NODES);   // ← NEW
	_gateA = new Uint8Array(MAX_NODES);         // [session ②] explicit-ALL gate bit for runnables
	_owner = new Array(MAX_NODES);              // [session] ownership plane — ptr → owning store handle (same shape as _values/_ctx; realloc voids it with the arena)
	_predicates = new Array(MAX_NODES);         // [§21] the membrane plane — ptr → gate stack (undefined = no membrane, one array load to know)
	_handles = new Array(MAX_NODES); // canonical handle lane — strong refs, node-lifetime, cleared on free (SoA: no WeakRef/Map)
	_parkedTrit = new Int8Array(MAX_NODES); // resurrection tickets: full pre-park trit; 0 = no ticket (a live trit is never 0)
	_edgePtr = EDGE_STRIDE;
	_nodePtr = 1;
	_globalUUID = 0n; // BigInt
	_traceEpoch = 0n; // BigInt

	[
	  _activePtr, _pendingHead, _pendingTail, _batchDepth, _zombieTail, 
	  _rootPtr, _liveNodes, _freeNodeHead, _freeEdgeHead, _isFlushing, _isPaused
	] = ZEROES;

	_values.fill(void 0); 
	_ctx.fill(null); // preallocate memory

    _isBooted = true;
}

// ── Abstract: bottom of the construction chain. Not decoration — THE handle factory.
// Private fields install only while their declaring class's constructor RUNS; the
// return-override below is what makes the minted handle become `this` up the chain.
/* doc:C-ADOPT */
/* ADOPTION. The return override is what makes a handle: whatever this constructor
 * returns becomes `this` up the chain, and GraphNode's private fields land on it.
 * Given a HOST — an element or a class — it returns the host itself, untouched: no
 * prototype change (a div stays a div), no callable wrapper, no own property but
 * the private fields (and the REACTIVE_STORE brand). The host then carries the node
 * brand (#ptr, #gen, #dead, #store) exactly as a minted handle does, so every
 * brand-based method works on it through .call, and the arena holds it in _handles
 * for the node's lifetime (RULED: strong — an element is never collected because
 * it left the document; dispose() is the teardown, as for every handle). A host
 * cannot inherit this prototype, so the arena reads a handle's brand through the
 * statics ptrOf, genOf and mark, never through [PTR], [GEN] or [MARK]. */
class Abstract extends null {
	constructor(host) {
		if (new.target === Abstract) throw new TypeError('[Chimera] Abstract is abstract — construct through Signal');
		if (host !== undefined) return host;
		const handle = function ƒ(...args) {
			return handle[CALL](...args);
		};
		Object.setPrototypeOf(handle, new.target.prototype);
		return handle;
	}
}

class GraphNode extends Abstract {
	// ── identity: private + tamper-proof; public reads via shared prototype getters (fast path) ──
	#ptr; #gen; #dead = false; // identity slack slots — symbol own-props retired 18.2.d (see constructor JSDoc)
	/** */
	get #zombie() { return this.#dead === true || _trits[this.#ptr] === 0; } // === true, NOT bare truthiness: a typed compare against the true-oddball; bare || emits a generic ToBoolean and leaves the getter return non-provably-boolean at its 8 inline call sites. Measured, owner-found. Applies to every hot predicate in this kernel. // [18.3.j] HOT liveness: bool + Int8 load.
	// SOUND WITHOUT the BigInt gen-derive: _handles is a STRONG-ref lane ("no WeakRef/Map", cleared on free) and
	set #zombie(v) { if (v === true) { this.#dead = true; this.#gen = -1n; } } // latch + poison
	[MARK]() { this.#zombie = true; } // the arena's only way in (via the _handles lane) — poisons gen
	#store = null; // stage 2 (the bag): ALL store state in one lazily-allocated record —
	               // plain nodes carry ONLY this null slot (measured: 272 → 200 B/node)

	/** */
	constructor(ptr, gen, host) {
		super(host);
		this.#ptr = ptr;
		this.#gen = gen;
	}
	/* the brand, read and written from outside the prototype (an adopted host has none) */
	static ptrOf(h) { return h.#ptr; }
	static genOf(h) { return h.#gen; }
	/* the cheap latch (bool + Int8 load), spelled out: measured in Chromium, reaching the
	 * #zombie accessor through a static costs 28 ns where the two field reads cost 3 */
	static dead(h) { return h.#dead === true || _trits[h.#ptr] === 0; }
	/* the store state of a handle or host: the bag for a Store, the side record for a
	 * component (a reactive class instance keeps #store null — it is a cell with keys) */
	/* spelled with a local: measured in Chromium, `h.#store !== null ? h.#store : …` with the
	 * WeakMap in the alternative costs 15 ns per call, the local form 4.5, the bare read 1.8 */
	static stateOf(h) { const b = h.#store; return b !== null ? b : _componentState.get(h); }
	/* doc:C-ONENODE */
	/* EVERY NODE CAN CARRY KEYS. A cell's bag is made the first time a key is asked of
	 * it, so a plain node costs one null slot until then and a Store is simply a node
	 * born with its bag. One literal, one shape (the factory shape is its sibling). */
	static ensureState(h) {
		const b = h.#store;
		if (b !== null) return b;
		const side = _componentState.get(h);
		if (side !== undefined) return side;
		if (Object.isExtensible(h) && !(REACTIVE_STORE in h))   // the store brand: a node with keys is a scope (find, the doors' #api)
			Object.defineProperty(h, REACTIVE_STORE, { value: h, configurable: !(h instanceof Signal) });
		return (h.#store = { dict: new Map(), proxies: new Map(), quorums: new Map(), cascade: undefined, engine: root(),
		                     effectiveDepth: 0, union: false, isEffect: false, factory: null,
		                     trieRoot: null, leafQueue: null, maxSize: 0, sigOf: null, liveCount: 0, leafTrit: 0 });
	}
	static mark(h) { h.#zombie = true; }
	static rebind(h, ptr, gen) { h.#ptr = ptr; h.#gen = gen; h.#dead = false; }
	get [PTR]() { return this.#ptr; } // identity read — symbol-keyed (18.3.o); the [PTR] name surface is gone
	get [GEN]() { return this.#gen; } // generation read — symbol-keyed (18.3.o)
	/** */
	static isZombie(h) { return !((typeof h === 'function' || (typeof h === 'object' && h !== null)) && #gen in h) || h.#dead || _trits[h.#ptr] === 0 || _nodeGen[h.#ptr] !== h.#gen; } // cold path keeps the FULL derived check
	static isSignal(o) { return (typeof o === 'function' || (typeof o === 'object' && o !== null)) && #gen in o; } // #gen presence IS the brand (18.2.e): only signals carry the slot — minted handles and adopted hosts; `in` never throws, false for foreign objects.

	static {
		// EARLY WIRING — must precede the nested class fields below, because
		Signal.prototype = GraphNode.prototype; // the splice is dead
		Object.defineProperty(GraphNode.prototype, 'constructor',
			{ value: Signal, writable: true, configurable: true });
	}

	static #ref = null;

	static State = class State extends Signal {};
	/* */
	static Store = class Store extends Signal {
		/* doc:C-ADOPT */
		/* THE STORE'S STATE LIVES IN THE BAG. The dictionary, the deep-proxy cache, the
		 * quorum table, the cascade flag and the engine used to be four symbol-keyed own
		 * properties on the handle. On an adopted host they would be own properties on
		 * the element — and measured, nine extra own keys tipped the element into V8's
		 * slow-property mode, making every field read slower, the opposite of the point.
		 * In the bag they are private state behind one slot, reached through stateOf(). */
		constructor(data, options = {}, host) {
			super(host);
			// Taxonomy: Store ⊂ Component. The BAG is the store brand — #store is non-null iff this is
			/* the STORE BRAND, also what core's storeOf tests (an own-property identity read):
			 * fixed on a handle; on an adopted host it is configurable, so release() can take
			 * it away and a disposed element reads as a plain element with no further test */
			Object.defineProperty(this, REACTIVE_STORE, { value: this, configurable: host !== undefined });

			// ── disentangle the polymorphic first argument ──────────────────────────
			// (handles are FUNCTIONS, so the engine branch only ever sees plain objects)
			const obj      = data !== null && typeof data === 'object';
			const isEngine = obj && typeof data[PTR] === 'number' && typeof data.get === 'function';
			const factory  = typeof data === 'function' ? data
			               : typeof options.factory === 'function' ? options.factory : null;
			const seed     = obj && !isEngine && !Array.isArray(data) ? data : null;

			// ── derive EVERY bag value first, then build the record in ONE literal:
			//    V8 gets the final shape in one shot (no field-by-field transitions) ──
			const effectiveDepth = options.depth ?? (options.deep ? Infinity : 0);
			const union    = !!options.union;
			const quorum   = options.union === false;   // [RULED] EXPLICIT consensus on a factory head: every leaf arms the quorum gate
			const isEffect = !!options.effect;
			const cAxis    = effectiveDepth > 1 ? 1 : effectiveDepth === 1 ? -1 : 0;

			const engine = isEngine ? data : root(), cascade = options.cascade;
			_storeFamily.set(this, union ? 1 : -1); // make the family readable by the bell
			_storeDepth.set(this, effectiveDepth);  // and the depth readable by the read gate
			this.#store   = factory
				? { dict: new Map(), proxies: new Map(), quorums: new Map(), cascade, engine,
				    effectiveDepth, union, isEffect, factory,
				    trieRoot : trieNode(),
				    leafQueue: [],
				    maxSize  : options.maxSize ?? 10000,
				    sigOf    : typeof options.key === 'function'
				                 ? args => [options.key.apply(null, args)]
				                 : args => args,
				    liveCount: 0,
				    quorum,   // explicit consensus → each leaf arms _gateA
				    leafTrit : encode(-1, 1, union ? 1 : -1, cAxis, -1) } // [session] every leaf mints STALE+PUSH; the arming run + trit switch assign the ROLE (isEffect is a hint now, not a dispatcher)
				: { dict: new Map(), proxies: new Map(), quorums: new Map(), cascade, engine,
				    effectiveDepth, union, isEffect: false, factory: null,
				    trieRoot: null, leafQueue: null, maxSize: 0, sigOf: null, liveCount: 0, leafTrit: 0 };

			if (seed) { assertDisciplines(seed); for (const k of Object.keys(seed)) storeWrite(this, k, seed[k]); }
		}
	}

	/* [RULED — one machine] Computed and Effect ARE factory heads: the same trie,
	 * dedup, Immune-Active eviction, and delete() as Signal.Store(fn). The brand
	 * adds exactly one sentence each — Computed: lazy, no eager call. Effect:
	 * live, arms the empty-signature variant at construction. Calling with
	 * arguments mints a VARIANT (arity shift: the engine injects the LENS as
	 * arg0; the caller's arguments are the signature). The old call-with-value
	 * write-lobotomy is unrepresentable on this path. */
	static Computed = class Computed extends GraphNode.Store {
		constructor(fn, opts) {
			if (typeof fn !== 'function') throw new TypeError('Computed expects a function');
			super(fn, opts);
			/* lazy, and ONE node from birth: the body sits on the head as a stale PULL
			 * formula, so the first read computes it — comp(), or the head met as a
			 * dictionary member (core files a sigiled getter's Computed under its key) */
			const bag = this.#store;
			armHead(this, bag, trieDescend(bag.trieRoot, NO_OPERANDS), e_axis(bag.leafTrit, -1));
		}
	};
	static Effect = class Effect extends GraphNode.Store {
		constructor(fn, opts) {
			if (typeof fn !== 'function') throw new TypeError('Effect expects a function');
			super(fn, { ...(opts || {}), effect: true });
			this();   // live: the empty-signature variant arms now
		}
	};

	static deref(ref) {
		if (typeof ref !== 'bigint') return;
		const ptr = Number(ref % ID_MULTIPLIER_BIGINT);
		const gen = ref / ID_MULTIPLIER_BIGINT;
		if (ptr <= 0 || ptr >= MAX_NODES || _nodeGen[ptr] !== gen || _trits[ptr] === 0) return;   // isLive, inline: this is the read path
		return Signal(ptr);
	}

	static init(size = 'L2') {
		void init(resolveSize(size));
		const rootPtr = allocNode();
		_trits[rootPtr] = ROOT_MOUNT;
		return (GraphNode.#ref = Signal(rootPtr));
	}

	static root() { return root(); }

	static get() { return GraphNode.#ref ?? new Substrate('L2'); }

	static teardown() { // clear memory
		init(L1);
		GraphNode.#ref = null;
		return true;
	}

	static wipe() { sweep(); }
	
	static batch(fn) { _batchDepth++; try { return fn(); } finally { if (--_batchDepth === 0) flushQueue(); } }
	static untrack(fn) { const prev = _activePtr; _activePtr = 0; try { return fn(); } finally { _activePtr = prev; } }

	static subscribe(c, s) { // consumer, source
		return subscribe(typeof c === 'number' ? c : c && GraphNode.ptrOf(c), typeof s === 'number' ? s : s && GraphNode.ptrOf(s));
	}
	static unsubscribe(c, s) { // consumer, source
		return unsubscribe(typeof c === 'number' ? c : c && GraphNode.ptrOf(c), typeof s === 'number' ? s : s && GraphNode.ptrOf(s));
	}

	static find(scope, key, query = 'value') {
		if (scope == null || typeof key !== 'string') return;
		const store = scope[REACTIVE_STORE];
		if (!store) return;
		const cleanKey = key.endsWith('()') ? key.slice(0, -2) : key;
		const ref = stateOf(store).dict.get(cleanKey);
		if (query === 'id') return ref != null ? Number(ref / ID_MULTIPLIER_BIGINT) : undefined;
		if (query === 'node' || key.endsWith('()')) return ref != null ? Signal.deref(ref) : undefined;
		return storeRead(store, cleanKey); // (was store.read — retired 18.3.n)
	}

	/* ── THE STORE SURFACE AS VERBS OF THE HOST ───────────────────────────────────
	 * Each takes the store first and does what the method of the same meaning does
	 * on a dictionary store: read(h, k) is h.get(k), write(h, k, v) is h.set(k, v),
	 * has(h, k) is h.has(k), remove(h, k) is h.delete(k), dictOf(h) is h.dict,
	 * door(h, name, owner) is the door getter of that name (ψ takes its owner).
	 * They are what core calls, so that a host which cannot inherit this prototype
	 * — an ELEMENT carrying the node brand — serves as its own store. */
	/* doc:C-ADOPT */
	/* adopt(host, data, options): the host becomes its own store node. Construction
	 * is the Store constructor with the host as its third argument; then the three
	 * symbols the arena reads from a handle are defined on the host, since it does
	 * not inherit them. [PTR] and [GEN] read the brand so a rebind shows through. */
	static adopt(host, data, options) {
		if (host === null || (typeof host !== 'object' && typeof host !== 'function')) throw new TypeError('[Chimera] adopt: the host must be an object');
		if (#gen in host) throw new TypeError('[Chimera] adopt: the host already carries a node');
		/* checked FIRST: the brand is a property, and a refusal after construction would
		 * leave the private fields on the host and a node in the arena with no owner */
		if (!Object.isExtensible(host)) throw new TypeError('[Chimera] adopt: the host is not extensible');
		const h = new Signal.Store(data, options, host);
		if (h !== host) throw new TypeError('[Chimera] adopt: construction did not return the host');
		return host;   // nothing else is put on the host: the arena reads its brand through ptrOf/genOf/mark
	}
	/* release(h): the host's node dies — its keys first, then the node itself, so the
	 * arena's strong lane lets the host go. For a handle this is h.dispose(). */
	static release(h) {
		GraphNode.prototype.dispose.call(h);
		if (!(h instanceof Signal)) { try { delete h[REACTIVE_STORE]; } catch (e) {} }   // the store brand goes with the store; a handle's is fixed
	}
	static get ownElements() { return _ownElements; }
	static set ownElements(v) { _ownElements = v === true; }
	static dictOf(h) { const b = h.#store; return b !== null ? b.dict : _componentState.get(h).dict; }
	static rawOf(h) { return _values[h.#ptr]; }
	/* read and write grow a cell's bag on its first key (C-ONENODE); the test is the one
	 * null slot, so an element or a Store — born with its bag — pays nothing for it */
	static read(h, key) {
		if (h.#dead === true || _trits[h.#ptr] === 0) return undefined;
		if (h.#store === null) GraphNode.ensureState(h);
		return storeRead(h, key);
	}
	static write(h, key, val) {
		if (h.#dead === true || _trits[h.#ptr] === 0) return h;
		if (h.#store === null) GraphNode.ensureState(h);
		storeWrite(h, key, val);
		return h;
	}
	static has(h, key) {
		if (h.#dead === true || _trits[h.#ptr] === 0) return false;
		const b = h.#store, st = b !== null ? b : _componentState.get(h);
		if (st === undefined) return false;   // no key was ever asked of it
		const r = st.dict.get(canonKey(key));
		return r != null && !!Signal.deref(r);
	}
	static remove(h, key) {
		if (h.#dead === true || _trits[h.#ptr] === 0) return false;
		if (h.#store === null && _componentState.get(h) === undefined) return false;
		return storeDelete(h, key);
	}
	/* ONE table for the doors. [split-lane] isUnion follows the TABLE's A pole, ending
	 * the $/Δ contradiction (the old $ door passed false — consensus behavior under
	 * union metadata, measured). ø and Φ are legacy → '$' and keep their flag; ΦΦ is
	 * the $$ door; ψ is INTERNAL owner-scoping over the Δ namespace, UNION affect:
	 * scope and member effects fire on any dep. '@' is retired and names nothing. */
	static door(h, name, owner) {
		switch (name) {
			case '$':  return triad(h, '$',  true,  null);   // atomic-union
			case '$$': return triad(h, '$$', false, null);   // atomic-consensus
			case 'Δ':  return triad(h, 'Δ',  true,  null);
			case 'ΔΔ': return triad(h, 'ΔΔ', true,  null);
			case 'ø':  return triad(h, 'ø',  false, null);   // legacy → '$'
			case 'Σ':  return triad(h, 'Σ',  false, null);
			case 'ΣΣ': return triad(h, 'ΣΣ', false, null);
			case 'Φ':  return triad(h, 'Φ',  false, null);   // legacy → '$'
			case 'ΦΦ': return triad(h, '$$', false, null);
			case 'ψ':  return triad(h, 'Δ',  true,  owner === undefined ? h : owner);
		}
		return undefined;
	}

	static subtle = {
		Watcher: class Watcher {
			constructor(notifyFn) {
				if (typeof notifyFn !== 'function') throw new TypeError('Watcher expects a callback');
				this._notify = notifyFn;
				this._node = _wire(encode(-1, -1, -1, 0, -1), () => this._notify(), 0);
			}
			watch(...signals) {
				const prev = _activePtr; _activePtr = this._node[PTR];
				for (const sig of signals) if (GraphNode.isSignal(sig)) track(GraphNode.ptrOf(sig));
				_activePtr = prev;
				const v = _trits[this._node[PTR]];
				if (e_axis(v) === -1) _trits[this._node[PTR]] = v + SETTLE_DELTA;
			}
			unwatch() { cleanupDeps(this._node[PTR]); }
		}
	};

	get ref()  { return this.#gen * ID_MULTIPLIER_BIGINT + BigInt(this.#ptr); }
	
	// ═══════════════════════════════════════════════════════════
    //  Triad accessors ($$$ and ΔΔΔ are obsolete)
    // ═══════════════════════════════════════════════════════════
	/* the getters read the one table in GraphNode.door (its comment has the lanes) */
	get $()    { return GraphNode.door(this, '$');  }
	get $$()   { return GraphNode.door(this, '$$'); }
	get Δ()    { return GraphNode.door(this, 'Δ');  }
	get ΔΔ()   { return GraphNode.door(this, 'ΔΔ'); }
	get ø()    { return GraphNode.door(this, 'ø');  }
	get Σ()    { return GraphNode.door(this, 'Σ');  }
	get ΣΣ()   { return GraphNode.door(this, 'ΣΣ'); }
	get Φ()    { return GraphNode.door(this, 'Φ');  }
	get ψ()    { return GraphNode.door(this, 'ψ', this); }
	ψFor(owner){ return GraphNode.door(this, 'ψ', owner); }

	/* doc:C-OPERAND */
	/* THE CALL. A factory answers by signature: the arguments name a memo leaf.
	 * Every other node is the same shape whether or not it carries keys — a
	 * store's keys are reached through .get/.set and the doors, never through
	 * the call (RULED: default write): `()` reads the value lane; a function
	 * installs a formula; on a field holding a formula, values are the formula's
	 * OPERANDS; otherwise a value is written. */
	[CALL](...args) {
		if (this.#store !== null && this.#store.factory !== null) return this.#zombie ? undefined : this.#computeMemo(args);   // memo mode — the callable IS the factory
		if (args.length === 0) {
			/* [0.89.j] a KEY handle's read serves what the VALUE LANE serves — the same
			 * skinned object, the same identity (H() === store.get(key)); .raw() remains
			 * the deliberate escape. Ends the silent-nested-write hazard: writes through
			 * a handle-read value now notify like any value-lane write. */
			const home = this.#zombie ? void 0 : _nodeHome.get(this.#ptr);
			if (home !== void 0) return GraphNode.read(home.store, home.key);   // through the verb: the home may be an adopted host
			return get(this.#ptr); // plain nodes: tracked raw read
		}
		if (typeof args[0] === 'function' && !(args[0] instanceof Signal))
			return installRecipe(this.#ptr, args[0], args[1]);
		/* an accessor-backed node routes its write through its setter, as set() does;
		 * it is a runnable too (its getter is the body), so this test comes first */
		const acc = _accessorSet.size !== 0 ? _accessorSet.get(this.#ptr) : undefined;
		if (acc !== undefined) { acc.call(this, args[0]); if (t_axis(_trits[this.#ptr]) !== 0) trigger(this.#ptr); return this; }
		if (isRunnable(this.#ptr)) {
			if (bindOperands(this.#ptr, args)) return this;   // a field formula: feed it
			return installConstant(this.#ptr, args[0]);        // a bare runnable (new Signal(fn)): formula → constant, as before
		}
		set(this.#ptr, args[0]);                      // write & notify (direct: [CALL] fidelity — accessors go through .set())
		return this;
	}

	// 'default' → peek(): console/equality coercion must NOT subscribe.
	[Symbol.toPrimitive](hint) {
		const v = (hint === 'default') ? this.peek() : this.get();
		if (hint === 'number') return typeof v === 'number' ? v : (Number(v) || 0);
		if (hint === 'string') return v != null ? String(v) : '';
		return v ?? null;
	}

	// ── handle API ──
	/* doc:C-ONENODE */
	/* ONE SURFACE. A node has a value lane and, on demand, keys. The bare verbs are
	 * the lane's: get() reads it, set(v) is the loud write, delete() disposes the
	 * node, clear() empties it. A key names a field: get(k), set(k, v), delete(k),
	 * has(k) — the first key grows the bag, so a cell and a Store are one shape.
	 * A factory head keeps its own meaning for every verb: its arguments are a
	 * signature, never a key, and values are computed. */
	get(...args) {
		if (this.#zombie) return void 0;
		const st = this.#store;
		if (st !== null && st.factory !== null) return this.#computeMemo(args);
		if (args.length === 0) return get(this.#ptr);                 // the value lane: tracked read
		if (st === null) GraphNode.ensureState(this);                 // the first key grows the bag
		return storeRead(this, args[0]);                              // one identity per key, at the read gate
	}
	peek() { return this.#zombie ? void(0) : get(this.#ptr, false); }
	set(...args) {
		if (this.#zombie) return this;
		const st = this.#store;
		if (st !== null && st.factory !== null) throw new Error(
			'[Chimera] Store(factory): set() unavailable — values are computed; use get(...args)');
		if (args.length === 0) return this;
		if (args.length === 1) {                      // the value lane: .set(v) is the loud write
			const p = this.#ptr;
			const s = _accessorSet.size !== 0 ? _accessorSet.get(p) : undefined;
			if (s !== undefined) {
				s.call(this, args[0]);
				if (t_axis(_trits[p]) !== 0) trigger(p);
			} else if (isRunnable(p) && !isFrozen(p)) installConstant(p, args[0]); // a value over a formula: the formula goes, edges and all
			else set(p, args[0]);
			return this;
		}
		if (st === null) GraphNode.ensureState(this);   // the first key grows the bag
		if (args[2] === true) {                        // silent: write the leaf, skip propagation
			const ref = GraphNode.stateOf(this).dict.get(canonKey(args[0]));
			if (ref != null) {
				const node = Signal.deref(ref);
				if (node && !isFrozen(node[PTR])) silentSet(node[PTR], args[1]);
			}
			return this;
		}
		storeWrite(this, args[0], args[1]);
		return this;
	}
	delete(...args) {
		if (this.#zombie) return false;
		const bag = this.#store;
		if (bag !== null && bag.factory !== null) {   // a variant, by its signature
			const leaf = triePeek(bag.trieRoot, bag.sigOf(args));
			if (!leaf?.node) return false;
			const { [PTR]: ptr, [GEN]: gen } = leaf.node; // bundle is symbol-keyed (18.3.o)
			triePrune(leaf);
			bag.liveCount--;
			if (ptr === this.#ptr) { retypeInert(ptr); return true; }   // the empty signature: the head sheds its body, the store lives on
			dropFromQueue(bag.leafQueue, ptr);
			if (isLive(ptr, gen)) tagForDisposal(ptr);
			return true;
		}
		/* [0.89.d ruling] CELL FACE: delete IS dispose — remove the node. The handle
		 * stays, inert. With a key it removes that field and leaves the node. */
		if (args.length === 0) { this.dispose(); return true; }
		const st = bag !== null ? bag : _componentState.get(this);
		return st === undefined ? false : storeDelete(this, args[0]);
	}

	clear() {
		if (this.#zombie) return this;
		const st = this.#store;
		if (st !== null) {
			if (st.factory !== null) { clearLeaves(st); if (isRunnable(this.#ptr)) retypeInert(this.#ptr); return this; }   // a factory's lane is its variants; the head's body is one of them
			clearKeys(st);
		}
		/* [0.89.d ruling] clear is the VALUE verb — the lane reads undefined, the node
		 * and its identity stay. A formula goes with its edges, as a value over it would. */
		const p = this.#ptr;
		if (isRunnable(p) && !isFrozen(p)) installConstant(p, undefined); else set(p, undefined);
		return this;
	}

	/* [RULED — reserved keys, step one] `size` is retired from the API: it is a
	 * common DATA key ({ size: 'XL' }) and the getter shadowed it. has() with NO
	 * argument is the count now; has(key) / has(...signature) stays boolean. */
	has(...args) {
		if (this.#zombie) return args.length === 0 ? 0 : false;
		const b = this.#store, st = b !== null ? b : _componentState.get(this);
		if (st === undefined) return args.length === 0 ? 0 : false;   // no key was ever asked of it
		if (args.length === 0) {
			if (st.factory !== null) return st.liveCount;
			let n = 0;
			for (const ref of st.dict.values()) {
				const node = Signal.deref(ref);
				if (node && _trits[node[PTR]] > 40) n++;
			}
			return n;
		}
		if (st.factory !== null) return liveLeaf(triePeek(st.trieRoot, st.sigOf(args)));
		const r = st.dict.get(canonKey(args[0]));
		return r != null && !!Signal.deref(r);
	}

	//═══════════════════════════════════════════════════════════
	//  Lifecycle & Signal method overrides
	//═══════════════════════════════════════════════════════════

	update(key, fn) {
		if (this.#zombie) throw new TypeError('Store has been disposed');
		if (typeof key === 'function' && fn === undefined) {   // the lane: update(fn) reads it untracked and writes through set(v)
			GraphNode.prototype.set.call(this, key(get(this.#ptr, false)));
			return true;
		}
		if (this.#store === null) GraphNode.ensureState(this);
		if (typeof fn !== 'function') { GraphNode.write(this, key, fn); return true; }
		GraphNode.write(this, key, fn(storeRead(this, key)));
		return true;
	}

	// the memo engine lives at module scope — see computeMemo() above the class
	#computeMemo(args) { return computeMemo(this, this.#store, args); }

	poke(v)    { const st = this.#store; if (st !== null && st.factory !== null) noStore('poke'); if (!this.#zombie) rawset(this.#ptr, v); return this; }
	// (duplicate thin detach removed — unified into the single signed detach below)

	detach() {
		if (this.#zombie) throw new TypeError('Disposed');
		if (isFrozen(this.#ptr)) throw new TypeError('Frozen signal cannot detach');
		detach(this.#ptr); // arena signed park — writes the resurrection ticket into _parkedTrit
		return this;
	}

    // (duplicate thin attach removed — unified into the single signed attach below)

	attach(sign) {
		if (this.#zombie) throw new TypeError('Disposed');
		const s = sign === undefined ? undefined : (sign === -1 || sign === false) ? -1 : 1;
		attach(this.#ptr, s); // arena: the ticket is the license; bare attach() restores the ticketed sign
		return this;
	}
	freeze() {
		if (this.#zombie) return this;   // guard first: one check, and the return stays chainable
		const st = this.#store;
		if (st !== null) {
			// 1. Deep‑freeze every reactive key in the store
			for (const ref of st.dict.values()) {
				const node = Signal.deref(ref);
				if (node && !isFrozen(node[PTR])) freeze(node[PTR], true);       // deep freeze the entire subtree
			}
			// 2. a factory head is the mount of its variants, not a value: it stays open
			if (st.factory !== null) return this;
		}
		// 3. the value lane freezes with the keys (C-ONENODE): one node, one freeze
		freeze(this.#ptr);
		return this;
	}
	thaw() {
		if (this.#zombie) return this;   // guard first: one check, and the return stays chainable
		// 1. the value lane first (a no-op unless it is frozen)
		thaw(this.#ptr);
		// 2. then every reactive key that is currently frozen
		const st = this.#store;
		if (st !== null) {
			for (const ref of st.dict.values()) {
				const node = Signal.deref(ref);
				if (node && isFrozen(node[PTR])) thaw(node[PTR]);
			}
		}
		return this;
	}
	keep()     { if (!this.#zombie) adopt(root()[PTR], this.#ptr); return this; }
	dispose()  { if (this.#zombie) return; const st = this.#store; if (st !== null) { if (st.factory !== null) clearLeaves(st); else clearKeys(st); } tagForDisposal(this.#ptr); } // return undefined — keys and variants go first; the lane goes with the node
	reattach() { return this.attach(); }

	subscribe(source) {
		if (!GraphNode.isSignal(source))
			throw new TypeError('Expected a Signal');
		if (this.#zombie || isZombie(source))
			throw new TypeError('Cannot subscribe to/from a disposed signal');

		const consumerPtr = this.#ptr;
		const sourcePtr   = GraphNode.ptrOf(source);

		// Enforce T‑axis: an UNTRACKED consumer must not subscribe,
		if (t_axis(_trits[consumerPtr]) === 0)
			throw new TypeError('An untracked signal cannot subscribe');
		if (t_axis(_trits[sourcePtr]) === 0)
			throw new TypeError('Cannot subscribe to an untracked signal');

		return subscribe(consumerPtr, sourcePtr);
	}

	unsubscribe(source) {
		if (!GraphNode.isSignal(source))
			throw new TypeError('Expected a Signal');
		if (this.#zombie || isZombie(source))
			return false;

		return unsubscribe(this.#ptr, GraphNode.ptrOf(source));
	}

	// ═══════════════════════════════════════════════════════════════
	//  Signal.prototype.clone()
	// ═══════════════════════════════════════════════════════════════
	clone() {
		if (this.#zombie) throw new TypeError('Cannot clone a disposed Signal');

		return Signal.untrack(() => {
			// ── Store path ──────────────────────────────────────
			if (this.#store !== null) {
				const newStore = new Signal.Store();
				for (const key of this.#store.dict.keys()) {
					const ref = this.#store.dict.get(key);
					const node = Signal.deref(ref);
					if (node) {
						// Read the **raw** value, never a deep proxy
						const rawValue = get(node[PTR], false);
						// storeWrite re‑parses the sigil and creates a fresh tree
						storeWrite(newStore, key, rawValue);
					}
				}
				return newStore;
			}

			// ── Plain signal path (State / Computed / Effect) ──
			// Snapshots the current value as a fresh state signal.
			// Even a frozen original produces a live, mutable copy.
			const currentValue = get(this.#ptr, false);
			return new Signal.State(currentValue);
		});
	}

	/* ══ [§21] the membrane verbs ══
	 * compose()           → the manifest: [[name, args] | ['(anonymous)']]
	 * compose(fn)         → attach an anonymous gate → disposer
	 * compose(name, ...a) → attach a REGISTERED gate (Signal.compose) — instantiation
	 *                       memoized: same (name, args) app-wide shares ONE gate closure
	 * compose(null)       → clear the stack; state republishes raw, recipes re-land next read
	 * raw()               → the _values plane: the writer's truth (a recipe's raw is its fn) */
	raw() { return _values[this.#ptr]; }
	compose(...args) {
		const ptr = this.#ptr;
		if (this.#zombie || _trits[ptr] === 0) return undefined;
		const isState = !isRunnable(ptr);
		if (args.length === 0) {
			const s = _predicates[ptr];
			return s === undefined ? [] : s.map(e => e.name !== undefined ? [e.name, e.args] : ['(anonymous)']);
		}
		if (args[0] === null) {
			if (_predicates[ptr] === undefined) return this;
			_predicates[ptr] = undefined;
			if (isState) {
				const prev = _ctx[ptr]; _ctx[ptr] = undefined; cleanupDeps(ptr);
				if (!is(prev, _values[ptr]) && t_axis(_trits[ptr]) !== 0) trigger(ptr);
			} else { _trits[ptr] = r_axis(_trits[ptr], -1); trigger(ptr); }
			return this;
		}
		let entry;
		if (typeof args[0] === 'function') entry = ø({ fn: args[0] });
		else {
			const name = String(args[0]);
			const reg = _composers.get(name);
			if (!reg) throw new TypeError('[Chimera] compose: no composer named "' + name + '" — Signal.compose(name, factory) first');
			const gArgs = args.slice(1);
			entry = ø({ name, args: gArgs, fn: reg(...gArgs) });
		}
		if (typeof entry.fn !== 'function') throw new TypeError('[Chimera] compose: the factory must return a gate function');
		const stack = _predicates[ptr] ?? (_predicates[ptr] = []);
		stack.push(entry);
		if (isState) {
			// state → PULL: a gate-dep change must be able to STALE this cell (E=0 targets only collect detachDirty)
			if (e_axis(_trits[ptr]) === 0 && _parkedTrit[ptr] === 0) _trits[ptr] = e_axis(_trits[ptr], -1);
			cleanupDeps(ptr);
			const prev = _ctx[ptr];
			const out = runMembrane(ptr, _values[ptr]);   // attaching re-lands immediately
			if (out !== VETO) { _ctx[ptr] = out; if (!is(prev, out) && t_axis(_trits[ptr]) !== 0) trigger(ptr); }
		} else { _trits[ptr] = r_axis(_trits[ptr], -1); trigger(ptr); }  // recipe: next read lands gated
		let dead = false;
		const self = this;
		return function off() {
			if (dead) return; dead = true;
			const s = _predicates[ptr]; if (!s) return;
			const i = s.indexOf(entry); if (i >= 0) s.splice(i, 1);
			if (s.length === 0) _predicates[ptr] = undefined;
			if (!isRunnable(ptr)) {
				cleanupDeps(ptr);
				const prev = _ctx[ptr];
				const out = runMembrane(ptr, _values[ptr]); // stack-less → raw passthrough
				const pub = out === VETO ? prev : out;
				_ctx[ptr] = _predicates[ptr] === undefined ? undefined : pub;
				if (!is(prev, pub) && t_axis(_trits[ptr]) !== 0) trigger(ptr);
			} else { _trits[ptr] = r_axis(_trits[ptr], -1); trigger(ptr); }
		};
	}
	untrack(fn) { 
		const prev = _activePtr; 
		_activePtr = 0; 
		try { return fn() } finally { _activePtr = prev }
	}

	map(fn) { return _wire(TRIT_COMPUTED, (() => this.#zombie ? null : fn(this.get())), 0); }

	filter(pred) {
		let last = this.peek();
		return _wire(
			TRIT_COMPUTED, (() => { // dead-source doctrine (18.2.f): filter is PARTIAL — death clears the hold to its natural empty, undefined
				if (this.#zombie) return (last = undefined);
				const v = this.get(); if (pred(v)) last = v; return last; }), 0
		);
	}
	combine(o, fn) { 
		return _wire(
			TRIT_COMPUTED, (() => { // dead-source doctrine (18.2.f): ANY dead input -> undefined (multi-input cannot compute)
				const oSig = o && typeof o.get === 'function';
				if (this.#zombie || (oSig && GraphNode.isZombie(o))) return undefined;
				return fn(this.get(), oSig ? o.get() : o); }), 0
		);
	}
	effect(fn) { 
		if (this.#zombie) return; 
		const c = _wire(TRIT_EFFECT, fn, -1); 
		adopt(this.#ptr, c[PTR]); 
		return c;
	}

	static {
		// LATE WIRING — statics inherit through the function façade; chain flattened to a
		Object.setPrototypeOf(Signal, GraphNode);
		Object.setPrototypeOf(GraphNode.prototype, null);
	}
}

// 
class Substrate extends Signal {

	constructor(config = {}) {
        if (typeof config === 'string') config = { size: config };
        const size = config.size ?? 'L2';

        if (config.multithreaded || config.wasm || config.__wasmMemory)
            throw new Error('Chimera 18.3.q: multithreaded/wasm arenas are STRIPPED in this kernel-work build — use shipped Chimera-18_3_p.js');

        // -- BRANCH A: Native JS Arena (Sync, Fallback) --
        const root = Signal.init(size);
        splice(root, Substrate.prototype, ['constructor']);
        console.log(TEXT_SYNC, 'color: #f59e0b;');
        return root;
    }

    static wipe() { sweep() }

	get activeNodes() { return _liveNodes; }
	get loadFactor() { return _liveNodes / (MAX_NODES || 1); }
	get density() { return _nodePtr / (MAX_NODES || 1); }

	pause() { _isPaused = 1; }
	resume() { _isPaused = 0; flushQueue(); }
	signal(key, value, opts = {}) {
		let depth = 0, raw = value;
		if (raw !== null && typeof raw === 'object' && raw[LAYER] !== void 0) { depth = raw[LAYER]; raw = raw.value; }
		else if (typeof opts.layer === 'number') depth = opts.layer;
		else if (opts.deep) depth = Infinity;
		let trit = opts._trit ?? encode(1, 1, 1, -1, -1);
		if (depth > 0) trit = a_axis(trit, depth === 1 ? -1 : 1);
		return _wire(trit, raw, opts.free | 0);
	}
}

function jsAllocNode() {
    for (var ptr;;) {
        if (_freeNodeHead !== 0) { ptr = _freeNodeHead; _freeNodeHead = _headDep[ptr]; break; } // 1. Pop from free‑list (fast path)
        if (_nodePtr < MAX_NODES) { ptr = _nodePtr++; break; } // 2. Bump allocator
        if (_zombieTail > 0) {// 3. Bump pointer exhausted – try to reclaim pending zombies
            recycle(); continue; // synchronous drain of the tagged queue; retry free-list or bump
        }
        throw new Error(`[Chimera ${version}] arena OOM: MAX_NODES exhausted`); // 4. Truly out of memory
    }
	// zero out
    _nodeGen[ptr] = ++_globalUUID;
    _headDep[ptr] = _sigHead[ptr] = 0;
    _nodeTree[(ptr*3) + TREE_PARENT] = 0;
	_nodeTree[(ptr*3) + TREE_CHILD] = 0;
	_nodeTree[(ptr*3) + TREE_SIB] = 0;
	_layer[ptr] = 0;
    _values[ptr] = undefined;
    _ctx[ptr] = null;
    _runCount[ptr] = _depsCount[ptr] = _readyCount[ptr] = 0;
    _freeMemoryAxis[ptr] = 0;
    _liveNodes++;
    return ptr;
}

function allocEdge() {
    for (var idx;;) {
        if (_freeEdgeHead !== 0) { // (1)
            idx = _freeEdgeHead;
            _freeEdgeHead = _edges[(idx + EDGE_NEXT)];
            break;
        }
        if ((_edgePtr + EDGE_STRIDE) < EDGE_MAX_STRIDE) { // (2)
            idx = _edgePtr;
            _edgePtr += EDGE_STRIDE;
            break;
        }
        if (_zombieTail > 0) { recycle(); continue; } // (3)
        throw new Error(`[Chimera ${version}] arena OOM: MAX_EDGES: ${MAX_EDGES} exhausted`); // (4)
    }

    _edges[(idx + EDGE_TARGET)]   = 0; // (5)
    _edges[(idx + EDGE_NEXT)]     = 0;
    _edges[(idx + EDGE_PREV_SUB)] = 0;
    _edges[(idx + EDGE_PAIR)]     = 0;
    _edgeEpoch[(idx >> EDGE_SHIFT)] = 0n;
    return idx;
}

// freeNode(ptr) — unchanged
function freeNode(ptr) {
	_trits[ptr] = 0;
	{ const h = _handles[ptr]; if (h !== undefined) GraphNode.mark(h); } // liveness write-back — see INVARIANT (Liveness) in the header
	_handles[ptr] = undefined; // release canonical handle (node-lifetime)
	_parkedTrit[ptr] = 0; // void any resurrection ticket
	_layer[ptr] = 0;
	_durable[ptr] = 0;
	_gateA[ptr] = 0;
	_owner[ptr] = undefined;
	_predicates[ptr] = undefined;
	_values[ptr] = undefined;
	_ctx[ptr] = null;
	if (_accessorSet.size !== 0) _accessorSet.delete(ptr);
	/* a key handle's home is slot-keyed; a stale entry let a recycled slot read the
	 * dead field's store (measured: wrong value, and the deleted key vivified back). */
	if (_nodeHome.size !== 0) _nodeHome.delete(ptr);
	if (_recipes.size !== 0) _recipes.delete(ptr);
	_headDep[ptr] = _freeNodeHead;
	_freeNodeHead = ptr;
	_liveNodes--;
}

// freeEdge(idx) — unchanged (NEXT is still lane 1)
function freeEdge(idx) {
	_edges[idx + EDGE_NEXT] = _freeEdgeHead;
	_freeEdgeHead = idx;
}

function layer(depth, value) { return { [LAYER]: depth, value }; }

function subscribe(consumer, source) {
	for (
		let dep = _headDep[consumer]; dep !== 0; dep = _edges[(dep + EDGE_NEXT)]
	) {
		if (_edges[(dep + EDGE_TARGET)] === source) {
			_edgeEpoch[(dep >> EDGE_SHIFT)] = _traceEpoch;
			return false; // edge already present — idempotent
		}
	}
	const subIdx = allocEdge();
	try { var depIdx = allocEdge(); } catch (e) { freeEdge(subIdx); throw e; }
	try {
		_edges[(subIdx + EDGE_TARGET)] = consumer;
		_edges[(depIdx + EDGE_TARGET)] = source;
		_edges[(subIdx + EDGE_PAIR)] = depIdx;
		_edges[(depIdx + EDGE_PAIR)] = subIdx;
		_edgeEpoch[(subIdx >> EDGE_SHIFT)] = _traceEpoch;
		_edgeEpoch[(depIdx >> EDGE_SHIFT)] = _traceEpoch;

		const sHead = _sigHead[source];
		_edges[(subIdx + EDGE_NEXT)] = sHead;
		_edges[(subIdx + EDGE_PREV_SUB)] = 0;
		if (sHead !== 0) _edges[(sHead + EDGE_PREV_SUB)] = subIdx;
		_sigHead[source] = subIdx;
		_edges[(depIdx + EDGE_NEXT)] = _headDep[consumer];
		_headDep[consumer] = depIdx;
		if (_trits[source] !== 0) _depsCount[consumer]++;
	} catch (e) {
		freeEdge(subIdx); 
		freeEdge(depIdx);
		throw e; // rollback
	}
	return true; // a new edge was created
}

function walkSubscribers(p, fn) {
    const tp = _nodeTree[(p * 3) + TREE_PARENT];
    for (let sub = _sigHead[p]; sub !== 0;) {
        const raw      = _edges[sub + EDGE_TARGET];
        const consumer = raw & EDGE_TARGET_MASK;
        const next     = _edges[sub + EDGE_NEXT];
        if (consumer !== 0 && consumer !== tp && _trits[consumer] !== 0 && !isFrozen(consumer))
            fn(consumer, raw, sub);
        sub = next;
    }
}

// dirtyConsumer: apply DIRTY_DELTA and queue if the E-axis says Push.
function dirtyConsumer(consumer, cv) {
	const nv = cv - DIRTY_DELTA;
	_trits[consumer] = nv;
	if (e_axis(nv) === 1) { 
		_pendingQueue[_pendingTail++] = consumer; 
		return true;
	} 
	return false;
}

// unlinkSub: pure doubly-linked removal from a signal's subscriber list.
function unlinkSub(subIdx, source) {
	const p = _edges[(subIdx + EDGE_PREV_SUB)];
	const n = _edges[(subIdx + EDGE_NEXT)];
	if (p === 0) _sigHead[source] = n; else _edges[(p + EDGE_NEXT)] = n;
	if (n !== 0) _edges[(n + EDGE_PREV_SUB)] = p;
}

// unsubscribe(consumer, source) — unchanged except masks not needed
function unsubscribe(consumer, source) {
	let prev = 0;
	for (
		let dep = _headDep[consumer]; dep !== 0; prev = dep, dep = _edges[(dep + EDGE_NEXT)]
	) {
		if (_edges[(dep + EDGE_TARGET)] !== source) continue;
		if (prev === 0) _headDep[consumer] = _edges[(dep + EDGE_NEXT)];
		else _edges[(prev + EDGE_NEXT)] = _edges[(dep + EDGE_NEXT)];
		const sub = _edges[(dep + EDGE_PAIR)];
		unlinkSub(sub, source);
		freeEdge(sub);
		freeEdge(dep);
		if (_depsCount[consumer] > 0 && _trits[source] !== 0) _depsCount[consumer]--;
		return true;                              // an edge was removed
	}
	return false;                                 // no such edge
}

// adopt, unlinkSibling — unchanged
function adopt(parent, child) {
	if (parent === 0 || child === 0 || parent === child) return;
	unlinkSibling(child);
	_nodeTree[(child*3) + TREE_PARENT] = parent;
	_nodeTree[(child*3) + TREE_SIB]    = _nodeTree[(parent*3) + TREE_CHILD];
	_nodeTree[(parent*3) + TREE_CHILD] = child;
}

/** */

function unlinkSibling(child) {
	const parent = _nodeTree[(child*3) + TREE_PARENT];
	if (parent === 0) return;
	let prev = 0;
	let cur = _nodeTree[(parent*3) + TREE_CHILD];
	while (cur !== 0 && cur !== child) { 
		prev = cur; 
		cur = _nodeTree[(cur*3) + TREE_SIB];
	}
	if (cur === child) {
		if (prev === 0) _nodeTree[(parent*3) + TREE_CHILD] = _nodeTree[(child*3) + TREE_SIB];
		else _nodeTree[(prev*3) + TREE_SIB] = _nodeTree[(child*3) + TREE_SIB];
	}
	_nodeTree[(child*3) + TREE_PARENT] = 0;
	_nodeTree[(child*3) + TREE_SIB] = 0;
}

/** */
function trigger(sigPtr) {
	const _sv = _trits[sigPtr];
	if (_sv < -121 || _sv > 121) return; // sentinel band (Persephone reserve): inert to propagation — LUTs unfilled there

	const sig = _trits[sigPtr];
	if (sig >= -40 && sig <= 40) return; 

	let queued = false;
	let wi = 0;
	const work = [sigPtr];

	while (wi < work.length) {
		const source = work[wi++];
		for (let e = _sigHead[source]; e !== 0;) {

			const nx     = _edges[e + EDGE_NEXT];
			const packed = _edges[e + EDGE_TARGET];     // bit 31 = DIRTY marker
			const target = packed & EDGE_TARGET_MASK;   // real node index
			const v 	 = _trits[target];

			if (v !== 0 && e_axis(v) === 0 && r_axis(v) !== 0) {
				_detachDirty[target] = 1;
				e = nx;
				continue;
			}
			if (v > 40) {
				if (a_axis(v) === -1 && ((typeof _values[target] !== 'function' && _predicates[target] === undefined) || _gateA[target] === 1)) { // [18.3.i] CONSENSUS QUORUM — the GATE is the request: aggregators arm it at install, effects arm it when consensus is asked for EXPLICITLY ($$/Σ doors, {union:false}, affect:'consensus'); the A-axis default alone never gates
					if (packed >= 0) { 				    // It's not DIRTY
						_edges[e + EDGE_TARGET] = packed | EDGE_DIRTY_FLAG;

						if (++_readyCount[target] >= _depsCount[target]) {
							queued = dirtyConsumer(target, v) || queued;
							if (_sigHead[target] !== 0) work.push(target);
						}
					}
				} else { // UNION (doc: A +1/0 — ANY dep fires; plain effects + computeds live here)
					if (v > 40) { // fresh band only: stale is already pending, mid-band (running) settles on unlock — prevents Int8 wrap
						if (e_axis(v) === 1) queued = dirtyConsumer(target, v) || queued; // effects: queue -> tail flush (batch()-aware)
						else _trits[target] = v - DIRTY_DELTA;                            // computeds: mark stale, recompute on pull
					}
					if (_sigHead[target] !== 0) work.push(target);
				}
			}
			e = nx;
		}
	}
	if (queued && _batchDepth === 0 && !_isFlushing) flushQueue();
}

function flushQueue() {
	if (_isFlushing || _isPaused) return;
	_isFlushing = 1;
	try {
		while (_pendingHead < _pendingTail) {
			const ptr = _pendingQueue[_pendingHead++];
			if (_trits[ptr] === 0) continue;
			if (_freeMemoryAxis[ptr] > 0) next(ptr);
			else runNode(ptr);
		}
	} finally {
		_isFlushing = 0;
		_pendingHead = _pendingTail = 0;
		_pendingQueue.length = 0;
		_runCount.fill(0);
	}
}

function runNode(ptr) {

	const v = _trits[ptr];
	if (v === 0) return;
	if (v < EAGER_LO || v > EAGER_HI) return;
	if (++_runCount[ptr] > 100) {
		const _panic = new Error(`[Chimera ${version}] Topology Panic: at ${ptr}`);
		_ctx[ptr] = new CachedThrow(_panic); // deterministic: the panic is replayable state, not a parked trit
		throw _panic;
	}

	_trits[ptr] = (v + LOCK_DELTA);
	const prevActive = _activePtr;
	cleanupDeps(ptr);
	_activePtr = ptr;
	_traceEpoch++;

	if (_nodeTree[(ptr*3) + TREE_CHILD] !== 0) disposeChildren(ptr);
	try {
		const fn = _ctx[ptr]?.[GEN_CTX] || _values[ptr];
		const res = typeof fn === 'function' ? fn() : void 0;
		if (typeof res?.next === 'function') { 
			res[GEN_CTX] = fn; 
			_ctx[ptr] = res; 
			_freeMemoryAxis[ptr] = 1;
		} else if (res !== undefined && e_axis(v) === 1) {
			const prev = _ctx[ptr];
			const cAx = c_axis(_trits[ptr]);       // [18.3.v] capture grain applies on the PUSH side too
			const out = cAx !== 0 ? resultProxy(res, cAx === 1 ? Infinity : 1, ptr) : res;
			_ctx[ptr] = out;                       // result cache (fn stays in _values)
			_trits[ptr] = e_axis(_trits[ptr], -1);
			settle(ptr, prev, out);                // consumers learn the new value
		}
		_trits[ptr] += LOCK_DELTA;
	} catch (e) {
		console.error(`[Chimera ${version}] runNode error:`, e); // effects have no reader: log AND cache
		const _pv = _ctx[ptr];
		_ctx[ptr] = new CachedThrow(e);
		_trits[ptr] += LOCK_DELTA;                               // unlock via the same transition
		settle(ptr, _pv, _ctx[ptr]);                             // consumers of value-effects learn of the failure
	} finally { 
		_activePtr = prevActive;
	}
	if (typeof _ctx[ptr]?.next === 'function') next(ptr);
}

function detach(ptr) {
	const v = _trits[ptr];
	const e = e_axis(v);
	if (v === 0 || e === 0) return;             // void / already parked — protects the ticket
	if (v >= -40 && v <= 40) return;            // frozen band cannot park (proto throws before us; internal callers skip)
	_parkedTrit[ptr] = v;                       // resurrection ticket — the full pre-park trit (R/A/C/T + sign of E)
	_detachDirty[ptr] = 0;                      // dirt accumulates only DURING the park
	_trits[ptr] = r_axis(v - e * E, 1);         // E := 0 (both signs), R normalized Fresh → parked domain stays out of zombie/eager bands
	invalidateConsumers(ptr);                   // leave subscribers' quorum while parked
}

function attach(ptr, sign) {
	const v = _trits[ptr];
	if (e_axis(v) !== 0) return;                           // only resurrect a parked (Detached) node
	const ticket = _parkedTrit[ptr];
	if (ticket === 0) return;                              // the ticket is the license — protects State/Store from phantom attach
	const s = (sign === 1 || sign === -1) ? sign : e_axis(ticket);
	if (s === 0) return;                                   // foreign/corrupt ticket — refuse, keep for inspection
	_parkedTrit[ptr] = 0;                                  // consume
	const dirty = _detachDirty[ptr] === 1;
	_detachDirty[ptr] = 0;
	revalidateConsumers(ptr);                              // rejoin subscribers' quorum
	const t = t_axis(v);
	const run = t === 1 || (t === -1 && dirty);            // VOLATILE always; SEMANTIC only if dirtied while parked; UNTRACKED never
	if (run) {
		_trits[ptr] = r_axis(v + s * E, -1);               // restore sign, force Stale so the engine accepts the run
		s === 1 ? runNode(ptr) : recompute(ptr);           // the run IS the re-subscription
	} else {
		_trits[ptr] = r_axis(v + s * E, 1);                // restore sign, Fresh: cache valid, edges still armed for future triggers
	}
}

function recompute(ptr) {

	const v = _trits[ptr];
	if (v >= -40) return;
	_trits[ptr] = (v + LOCK_DELTA);
	const fn = _values[ptr];

	if (typeof fn !== 'function') {
		if (_predicates[ptr] !== undefined) { // [§21] predicated STATE gone stale = a gate dep moved → RE-PUBLISH over the kept raw
			cleanupDeps(ptr);
			const prev = _ctx[ptr];
			const out = runMembrane(ptr, fn); // fn === the RAW value here
			if (out !== VETO) _ctx[ptr] = out;
			_trits[ptr] += LOCK_DELTA;
			if (out !== VETO && !is(prev, out)) settle(ptr, prev, out);
			return;
		}
		_readyCount[ptr] = 0;
		let d = _headDep[ptr];
		while (d !== 0) {
			const sub = _edges[(d + EDGE_PAIR)];
			if (sub !== 0) {
				_edges[(sub + EDGE_TARGET)] &= EDGE_TARGET_MASK;   // clear DIRTY
			}
			recompute(_edges[(d + EDGE_TARGET)]);
			d = _edges[(d + EDGE_NEXT)];
		}
		_trits[ptr] += LOCK_DELTA;
		return;
	}

	const prevActive = _activePtr;
	cleanupDeps(ptr);
	_activePtr = ptr;
	_traceEpoch++;
	if (_nodeTree[(ptr*3 + TREE_CHILD)] !== 0) disposeChildren(ptr);
	try {
		let res = fn();
		let landed = true;
		if (_predicates[ptr] !== undefined) { // [§21] recompute results pass the membrane; VETO keeps the previous published
			const gated = runMembrane(ptr, res);
			if (gated === VETO) landed = false; else res = gated;
		}
		if (landed) {
			const cAx = c_axis(_trits[ptr] - LOCK_DELTA);
			_ctx[ptr] = cAx !== 0 ? resultProxy(res, cAx === 1 ? Infinity : 1, ptr) : res;
		}
	}
	catch (e) { _ctx[ptr] = new CachedThrow(e); } // TC39: silent cache; the READER gets the throw
	_trits[ptr] += LOCK_DELTA;                    // same clean transition, success or failure
	_activePtr = prevActive;
}

// disposeChildren(ptr): owned children die with the owner — tag each for disposal (iterative via the queue).
function disposeChildren(ptr) {
	let child = _nodeTree[(ptr*3 + TREE_CHILD)];
	while (child !== 0) {
		const nx = _nodeTree[(child*3 + TREE_SIB)];
		_nodeTree[(child*3 + TREE_PARENT)] = 0; 
		_nodeTree[(child*3 + TREE_SIB)] = 0;
		tagForDisposal(child);
		child = nx;
	}
	_nodeTree[(ptr*3 + TREE_CHILD)] = 0;
}

// hasExternalReader(p): true if any subscriber of p is NOT its structural tree‑parent (something external reads it).
function hasExternalReader(p) {
	const tp = _nodeTree[(p*3 + TREE_PARENT)];
	for (
		let sub = _sigHead[p]; sub !== 0; sub = _edges[(sub + EDGE_NEXT)]
	) {
		if ((_edges[(sub + EDGE_TARGET)] & EDGE_TARGET_MASK) !== tp) return true;
	}
	return false;
}

// next(ptr): generator / async‑iterator resumption (fma=+1 sources). Advance one step, store the yielded
function next(ptr) {
    if (_trits[ptr] === 0) return;
    let iter = _ctx[ptr];
    if (!iter || typeof iter.next !== 'function' || iter[AWAITING]) {
        const fn = iter?.[GEN_CTX] || _values[ptr];
        if (typeof fn !== 'function') return;
        iter = fn();
        if (!iter || typeof iter.next !== 'function') return;
        iter[GEN_CTX] = fn;
        _ctx[ptr] = iter;
    }
    
    const savedGen = _nodeGen[ptr];
    const prevActive = _activePtr;

    cleanupDeps(ptr);
    _activePtr = ptr;
    _traceEpoch++;
	
    /* [0.89.d] ONE STEP FUNCTION for all three continuation sites. The original had the */
    const step = (result) => {
        if (result.done) {
            _values[ptr] = result.value;
            _ctx[ptr] = { [GEN_CTX]: iter[GEN_CTX] };
            if (_trits[ptr] !== 0) _trits[ptr] = r_axis(_trits[ptr], 1);
            trigger(ptr);
            return;
        }
        const y = result.value;
        if (typeof y?.then === 'function') {
            iter[AWAITING] = true;
            y.then(onValue, onError);
        } else {
            _values[ptr] = y;
            if (_trits[ptr] !== 0) _trits[ptr] = r_axis(_trits[ptr], 1);
            trigger(ptr);
        }
    };
    const onValue = (v) => {
        if (_nodeGen[ptr] !== savedGen || _ctx[ptr] !== iter) return;
        iter[AWAITING] = false;
        _values[ptr] = v;
        if (_trits[ptr] !== 0) _trits[ptr] = r_axis(_trits[ptr], 1);
        trigger(ptr);
        _pendingQueue[_pendingTail++] = ptr;
        flushQueue();
    };
    const onError = (e) => {
        if (_nodeGen[ptr] !== savedGen || _ctx[ptr] !== iter) return;
        iter[AWAITING] = false;
        let rr;
        try { rr = iter.throw(e); }                     /* author-first */
        catch (fatal) {
            _values[ptr] = new CachedThrow(fatal);
            if (_trits[ptr] !== 0) _trits[ptr] = r_axis(_trits[ptr], 1);
            trigger(ptr);
            return;
        }
        step(rr);                                       /* recovery rejoins the ONE path */
    };
    try {
        const result = iter.next(_values[ptr]);
        _activePtr = prevActive;
        step(result);
    } catch (e) {
        console.error(`[Chimera ${version}] next error:`, e); // generators are effect-like: log AND cache
        _values[ptr] = new CachedThrow(e);                    // generator value plane is _values
        if (_trits[ptr] !== 0) _trits[ptr] = r_axis(_trits[ptr], 1);
        trigger(ptr);                                         // consumers learn of the failure
    } finally {
        if (_activePtr === ptr) {
			_activePtr = prevActive;
		}
    }
}

function logicalSweep(ptr) {

    const frontier = []; // still a plain JS array; short‑lived and small

    // dispose owned children, detach from parent
    if (_nodeTree[(ptr*3 + TREE_CHILD)] !== 0) disposeChildren(ptr);
    unlinkSibling(ptr);

    // clean up the node’s own dependency edges (this unlinks and collects sub/dep edges)
    cleanupDeps(ptr, 1);

    // walk the subscriber list of the dead node to adjust consumers
    let subIdx = _sigHead[ptr];
    while (subIdx !== 0) {
        const depIdx   = _edges[(subIdx + EDGE_PAIR)];
        const rawSub   = _edges[(subIdx + EDGE_TARGET)];
        const nextSub  = _edges[(subIdx + EDGE_NEXT)];
        const consumer = (rawSub & EDGE_TARGET_MASK);
        const cv       = consumer !== 0 ? _trits[consumer] : 0;

        if (cv !== 0) {
            if (rawSub < 0 && _readyCount[consumer] > 0) _readyCount[consumer]--;
            if (_depsCount[consumer] > 0) _depsCount[consumer]--;
            if (cv > 40) {
                const eAxis = e_axis(cv);
                if (eAxis === 1) {
                    if (_depsCount[consumer] === 0) detach(consumer); // signed park — writes the resurrection ticket
                } 
				else if (eAxis === -1 && _freeMemoryAxis[ptr] <= 0) {
                    frontier.push(consumer);
                }
            }
        }

        // Remove the paired dep edge from the consumer’s dependency list
        if (depIdx !== 0) {
            let prev = 0;
			let cur = _headDep[consumer];
            while (cur !== 0 && cur !== depIdx) { 
				prev = cur; 
				cur = _edges[(cur + EDGE_NEXT)];
			}
            if (cur === depIdx) {
                if (prev === 0) _headDep[consumer] = _edges[(depIdx + EDGE_NEXT)];
                else	_edges[(prev + EDGE_NEXT)] = _edges[(depIdx + EDGE_NEXT)];
            }
            _edges[(depIdx + EDGE_TARGET)] &= EDGE_TARGET_MASK; // clear DIRTY
            _zombieQueue[_zombieTail++] = ~depIdx;				// tag dep edge for deferred physical recycling
        }

        _zombieQueue[_zombieTail++] = ~subIdx; // tag subscriber edge for deferred physical recycling
        subIdx = nextSub;
    }

    // clear the dead node’s subscriber list
    _sigHead[ptr] = 0;
    _nodeTree[((ptr*3) + TREE_PARENT)] = 0;
    _nodeTree[((ptr*3) + TREE_CHILD)]  = 0;
    _nodeTree[((ptr*3) + TREE_SIB)]    = 0;

    // tag the node itself for deferred recycling
    _zombieQueue[_zombieTail++] = ptr;

    // process the frontier synchronously
    for (let i = 0; i < frontier.length;) {
        const consumer = frontier[i++];
        const ev0 = _trits[consumer];
        if (ev0 > 40 && e_axis(ev0) === -1) {
            _trits[consumer] = (ev0 - DIRTY_DELTA);
        }
    }
}

let _recycleScheduled = false;
function scheduleRecycling() {
    if (_recycleScheduled) return; _recycleScheduled = true;
    queueMicrotask(() => { 
		_recycleScheduled = false; 
		recycle();
	});
}

function recycle() {
    for (let i = 0; i < _zombieTail;) {
        const val = _zombieQueue[i++];
        if (val >= 0) {
            // it’s a node – physically free it through the single free contract.
            freeNode(val);
        } else {
            // it’s an edge – invert back to get the real index
            const idx = ~val;
            freeEdge(idx);
            _edgeEpoch[(idx >> EDGE_SHIFT)] = 0n;
        }
    }
    _zombieTail = 0;   // reset for next batch
}

// Old `sweep()` becomes a stub that flushes any pending physical work.
function sweep() {
    if (_zombieTail > 0) recycle();
}

function cleanupDeps(ptr, reap) {

	_depsCount[ptr] = _readyCount[ptr] = 0;
	let depIdx = _headDep[ptr];

	while (depIdx !== 0) {
		const subIdx = _edges[(depIdx + EDGE_PAIR)];
		const signal = _edges[(depIdx + EDGE_TARGET)];
		const nx     = _edges[(depIdx + EDGE_NEXT)];

		if (subIdx !== 0) {
			unlinkSub(subIdx, signal);
			freeEdge(subIdx);
			_edgeEpoch[(subIdx >> EDGE_SHIFT)] = 0n;
		}

		_edges[(depIdx + EDGE_TARGET)] &= EDGE_TARGET_MASK;   // clear DIRTY on dep edge (safety)
		freeEdge(depIdx);
		_edgeEpoch[(depIdx >> EDGE_SHIFT)] = 0n;

		if (reap && 
			signal !== 0 && 
			signal !== ptr &&
			_durable[signal] === 0 &&                 // [18.3.s] written data outlives its readers
			_nodeTree[(signal*3 + TREE_PARENT)] !== 0 &&
			_nodeTree[(signal*3 + TREE_CHILD)]  === 0 &&
			_parkedTrit[signal] === 0 &&              // ticketed park = "I'll be back": patrol may not reap (demolition still does)
			!hasExternalReader(signal)
		) {
			tagForDisposal(signal);
		}

		depIdx = nx;
	}
	_headDep[ptr] = 0;
}

// ── Store helpers (updated with disposed‑consumer guard) ──
function invalidateConsumers(p) {
	walkSubscribers(p, (consumer, raw, sub) => {
		if (raw < 0) {
			_edges[(sub + EDGE_TARGET)] &= EDGE_TARGET_MASK;
			if (_readyCount[consumer] > 0) _readyCount[consumer]--;
		}
		if (_depsCount[consumer] > 0) _depsCount[consumer]--;
	});
}

function revalidateConsumers(p) {
	walkSubscribers(p, (consumer) => {
		if (_trits[consumer] > -40) _depsCount[consumer]++;
	});
}

function fireAndWithdraw(p) {
	
	if (_trits[p] >= -40 && _trits[p] <= 40 && _trits[p] !== 0) return;
	let queued = false;
	walkSubscribers(p, (consumer, raw, sub) => {
		const cv = _trits[consumer];
		if (cv <= -40) return;
		if (
			cv > 40 && 
			e_axis(cv) === -1 && 
			typeof _values[consumer] === 'function'
		) {
			if (_depsCount[consumer] > 0) _depsCount[consumer]--;
			_trits[consumer] = cv - DIRTY_DELTA;      // mark-only: computed goes stale, never queued
			return;
		}
		if ((raw & EDGE_DIRTY_FLAG) === 0) { 
			_edges[(sub + EDGE_TARGET)] |= EDGE_DIRTY_FLAG; 
			_readyCount[consumer]++;
		}
		if (_depsCount[consumer] > 0) _depsCount[consumer]--;
		if (cv > 40 && (a_axis(cv) === 1 || _readyCount[consumer] >= _depsCount[consumer])) {
			queued = dirtyConsumer(consumer, cv) || queued;
		}
	});
	if (queued && _batchDepth === 0 && !_isFlushing) flushQueue();
}

/** */
function get(ptr, mark = true) {
    const v = _trits[ptr];
    if (v === 0) return;                              // void
    if (v < -40) recompute(ptr);                      // stale → recompute
    else if (t_axis(v) === 1 && e_axis(v) === -1 && v > 40 && typeof _values[ptr] === 'function') {
        _trits[ptr] = r_axis(v, -1);                  // FRESH → STALE, same node
        recompute(ptr);
    }
    const locus = _values[ptr];
    const value = (typeof locus === 'function' && (e_axis(v) !== 0 || _parkedTrit[ptr] !== 0)) ? _ctx[ptr]
                : (_predicates[ptr] !== undefined && typeof locus !== 'function') ? _ctx[ptr] // [§21] predicated state serves PUBLISHED; .raw() serves the truth
                : locus;
    if (value instanceof CachedThrow) {                // TC39: reads of a failed node THROW, at the reader
        if (mark !== false && !(v >= -40 && v <= 40)) track(ptr); // still subscribe: recovery must propagate
        throw value.e;
    } // computed / effect → cached result | locus;
    if (v >= -40 && v <= 40) return value; // frozen: return snapshot, no tracking
    if (mark !== false) track(ptr); 				// tracks if the trit allows it.
    return value;
}

function track(ptr) {
    const a = _activePtr;
    if (a === 0 || a === ptr) return;
    if (t_axis(_trits[a]) === 0) return;          // reader is UNTRACKED – don't subscribe
    if (t_axis(_trits[ptr]) === 0) return;        // source is UNTRACKED – don't subscribe
    subscribe(a, ptr);
}

function set(ptr, val, cascade = true) {
    const v = _trits[ptr];
    if (v === 0) return;                                          // void
    if (v >= -40 && v <= 40) throw new TypeError('❄️ Cannot write to frozen Signal');
    if (e_axis(v) === 0 && _parkedTrit[ptr] !== 0) {   // PARKED (ticketed) → silent; naked E=0 (State/Store) falls through and triggers
    	if (typeof _values[ptr] === 'function') _ctx[ptr] = val;  // parked computed/effect: update the cache, never clobber the factory
    	else _values[ptr] = val;
        return;
    }
    if (_predicates[ptr] !== undefined && typeof _values[ptr] !== 'function') return predicatedWrite(ptr, val); // [§21] the membrane
    const changed = !is(_values[ptr], val);		// alive, non‑detached
    _values[ptr] = val;
    const t = t_axis(v);
    if (t === 1 || (t === -1 && changed)) trigger(ptr);  // VOLATILE always, SEMANTIC on change
}

function freeze(ptr, deep = true) {
    const v = _trits[ptr];
    if (v >= -40 && v <= 40) return;           // already frozen/disposed
    _trits[ptr] = r_axis(v, 0);                // set R=0
    if (deep) {								   // recursively freeze all children
        let child = _nodeTree[(ptr * 3) + TREE_CHILD];
        while (child !== 0) {
            freeze(child, true);
            child = _nodeTree[(child * 3) + TREE_SIB];
        }
    }
}

// thaw(ptr): R 0 -> -1 (Stale) then recompute — the re‑sync handshake. A frozen node has lost its old
function thaw(ptr) {
	const v = _trits[ptr];
	if (v > 40 || v < -40 || v === 0) return; // only a frozen (R=0, non‑disposed) node
	_trits[ptr] = r_axis(v, -1);
	recompute(ptr);
}

function tagForDisposal(ptr) {
    if (_trits[ptr] === 0) return;
    _trits[ptr] = 0;
    { const h = _handles[ptr]; if (h !== undefined) GraphNode.mark(h); } // dead NOW, not at recycle — closes the tag→freeNode window
    logicalSweep(ptr);
    scheduleRecycling();
}

function rawset(ptr, val) {
    const v = _trits[ptr];
    if (v === 0) return;
    if (v >= -40 && v <= 40) throw new TypeError('❄️ Cannot write to frozen Signal');
    _values[ptr] = val;
    if (t_axis(v) !== 0) trigger(ptr);                       // rawset ignores change detection, but still respects UNTRACKED
}

function silentSet(ptr, val) { // guard 
	if (_trits[ptr] === 0) return;
	_values[ptr] = val;
}

const _composers = new Map();  // name → factory Store
const VETO = Symbol('veto');
function runMembrane(ptr, incoming) {
	const stack = _predicates[ptr];
	if (stack === undefined) return incoming;
	const owner = _owner[ptr];
	const lens  = owner ? GraphNode.door(owner, '\u03A6') : undefined;
	const self  = _ctx[ptr];
	const prevA = _activePtr;
	_activePtr = ptr; _traceEpoch++;
	try {
		let cur = incoming;
		for (let i = 0; i < stack.length; i++) {
			cur = stack[i].fn.call(lens, lens, self, cur);
			if (cur === undefined) return VETO;
		}
		return cur;
	} finally { _activePtr = prevA; }
}
function predicatedWrite(ptr, val) {
	cleanupDeps(ptr);                                   // per-landing recollection: branchy gates stay honest
	const out = runMembrane(ptr, val);
	if (out === VETO) return;                           // the landing never happened
	const prevPub = _ctx[ptr];
	_values[ptr] = val;                                 // RAW lands
	_ctx[ptr] = out;                                    // PUBLISHED lands
	const t = t_axis(_trits[ptr]);
	if (t === 1 || (t === -1 && !is(prevPub, out))) trigger(ptr);
}
function activeOwner() { return _activePtr !== 0 ? _owner[_activePtr] : undefined; }
Signal.activeOwner = activeOwner; // [session] THE OWNERSHIP CONTEXT — which object the running node belongs to
Signal.pauseTracking  = function ()  { const p = _activePtr; _activePtr = 0; return p; }; // [session — GC audit]
Signal.resumeTracking = function (p) { _activePtr = p; }; // paired form: lets callers peek WITHOUT allocating a closure per read
Signal.compose = function (name, factory) { // [§21] register a named composer — the registry IS a factory Store (memoized instantiation)
	if (typeof factory !== 'function') throw new TypeError('[Chimera] Signal.compose(name, factory)');
	_composers.set(String(name), new Signal.Store(factory, { depth: 0 }));
	return Signal;
};
/* doc:C-OPERAND */
/* THE RECIPE RECORD. A field formula is the body as written, its lens, and its
 * OPERANDS — the arguments the door call feeds it: `s.Φ.total(99)` binds 99, and
 * the main lane reads formula(lens, 99) from then on. The value lane holds a
 * wrapper closed over all three, so a recompute costs no lookup; the record is
 * what the door call and a replacement read. Operands SURVIVE a replacement: the
 * operand is the field's input, the formula is how it is processed, and a new
 * formula answering with the old input avoids a transient run on nothing. A
 * freeze (a value written by assignment, .set or a keyed write) clears them with
 * the formula, as does death. A formula that declares nothing beyond the lens
 * ignores what is bound: ruled acceptable, the freeze having its own spelling. */
const _recipes = new Map();   // ptr → { fn, lens, ops }
const NO_OPERANDS = Object.freeze([]);
function wrapRecipe(ptr, rec) {
	const { fn, lens, ops } = rec;
	return ops.length === 0 ? () => fn.call(lens ?? _handles[ptr], lens)
	                        : () => fn.call(lens ?? _handles[ptr], lens, ...ops);
}
function sameOperands(a, b) {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (!is(a[i], b[i])) return false;
	return true;
}
/* bind the door call's arguments to the field's formula; false when the node
 * holds no recipe (a bare effect, an accessor pair, a memo leaf) */
function bindOperands(ptr, args) {
	const rec = _recipes.get(ptr);
	if (rec === undefined) return false;
	if (isFrozen(ptr)) throw new TypeError('[Chimera] a frozen cell cannot take an operand \u2744');
	if (sameOperands(rec.ops, args)) return true;                           // the same input: nothing moved
	rec.ops = args.length === 0 ? NO_OPERANDS : args.slice();
	_values[ptr] = wrapRecipe(ptr, rec);
	_trits[ptr] = r_axis(_trits[ptr], -1);                                  // stale: the next read applies the new input
	if (e_axis(_trits[ptr]) === 1) runNode(ptr); else trigger(ptr);         // an effect re-runs now; a formula's consumers learn
	return true;
}
function installRecipe(ptr, fn, opts) {
	const cur = _trits[ptr];
	if (cur === 0) return undefined;
	if (isFrozen(ptr)) throw new TypeError('[Chimera] a frozen cell cannot take a formula \u2744');
	cleanupDeps(ptr); // the OLD recipe's edges die with it — replacement must not leave stale drivers
	const owner = _owner[ptr];
	const lens  = owner ? GraphNode.door(owner, '\u03A6') : undefined;   // the table, not the owner's prototype: an adopted host has none
	const oA = opts && opts.affect  != null ? POLE.A[String(opts.affect).toUpperCase()]  : undefined;
	const oC = opts && opts.capture != null ? POLE.C[String(opts.capture).toUpperCase()] : undefined;
	let A = oA !== undefined ? oA : a_axis(cur);
	if (A === 0) A = 1;                                  // forced ANY (owner ruling)
	const C = oC !== undefined ? oC : c_axis(cur);
	const E = opts && opts.effect === 'push' ? 1 : -1;   // lazy-on-target default
	_gateA[ptr] = A === -1 ? 1 : 0;
	const prev = _recipes.get(ptr);
	const rec = { fn, lens, ops: prev !== undefined ? prev.ops : NO_OPERANDS };   // operands outlive the formula
	_recipes.set(ptr, rec);
	_values[ptr] = wrapRecipe(ptr, rec);
	_ctx[ptr] = undefined;
	_trits[ptr] = encode(-1, E, A, C, -1);               // stale: first read (or the eager arming run) computes
	if (E === 1) runNode(ptr);                           // eager: the arming run collects deps
	else trigger(ptr);                                   // lazy: consumers learn; they recompute on read
	return _handles[ptr];
}
/* RETYPE: a runnable becomes a VALUE node. Its edges, gate, membrane and cache go
 * with the formula; the A/C/T axes stay. Every write of a value over a formula —
 * the call, .set, a keyed write, a door assignment — comes through here, so none
 * of them can leave the old formula's edges live (measured before: a watcher of
 * the overwritten key re-ran on every change to the old dependency). */
function retypeConstant(ptr) {
	const cur = _trits[ptr];
	if (_recipes.size !== 0) _recipes.delete(ptr);   // the operands go with the formula
	cleanupDeps(ptr);
	_gateA[ptr] = 0;
	_predicates[ptr] = undefined; // [§21] freezing means 'done deciding' — the membrane clears with the formula
	_ctx[ptr] = undefined;
	_trits[ptr] = encode(1, 0, a_axis(cur), c_axis(cur), t_axis(cur) || -1);
}
function installConstant(ptr, v) {
	if (_trits[ptr] === 0) return undefined;
	if (isFrozen(ptr)) throw new TypeError('[Chimera] frozen \u2744');
	const prev = _ctx[ptr];
	retypeConstant(ptr);
	_values[ptr] = v;
	if (!Object.is(prev, v)) trigger(ptr);               // formula → constant is a CHANGE
	return _handles[ptr];
}

function root() {
	if (_rootPtr === 0) { _rootPtr = allocNode(); _trits[_rootPtr] = ROOT_MOUNT; }
	return Signal(_rootPtr);
}

function splice(to, from, skip) {
	for (const key of Reflect.ownKeys(from)) {
		if (!skip.includes(key)) {
			Object.defineProperty(to, key, Object.getOwnPropertyDescriptor(from, key));
		}
	} return to;
}

function isZombie(handle) { return GraphNode.isZombie(handle); }

/** */
function _wire(trit, val, free) {
	const ptr = allocNode();
	_trits[ptr] = trit;
	_values[ptr] = val;
	if (free) _freeMemoryAxis[ptr] = free;
	if (_activePtr !== 0) adopt(_activePtr, ptr);
	if (trit >= EAGER_LO && trit <= EAGER_HI) runNode(ptr);
	return Signal(ptr);
}

function settle(ptr, prev, next, manual) {
	if (next === undefined) {
		if (!manual) invalidateConsumers(ptr);
		else if (prev !== undefined) fireAndWithdraw(ptr);
	} else trigger(ptr); // next is defined: both modes trigger
}

/** */
function reconcileSubtree(store, name, prevValue, nextValue) {

    const previousIsObject = isKeyable(prevValue);
    const nextIsObject     = isKeyable(nextValue);

    if (!previousIsObject && !nextIsObject) return; // Nothing to reconcile if both sides are primitives (or null).

    const storeDict = stateOf(store).dict;
    const propertyKeys = new Set();

    // Collect every property key from both the old and new objects.
    if (previousIsObject) {
        for (const key in prevValue) propertyKeys.add(key);
        if (Array.isArray(prevValue)) propertyKeys.add('length');
    }
    if (nextIsObject) {
        for (const key in nextValue) propertyKeys.add(key);
        if (Array.isArray(nextValue)) propertyKeys.add('length');
    }

    for (const key of propertyKeys) {
        const dottedChildKey = name + '.' + canonKey(key); // nested sigils canonize too
        const childRef = storeDict.get(dottedChildKey);

        // No reactive node exists for this key – nothing to synchronise.
        if (childRef == null) continue;

        const childNode = Signal.deref(childRef);
        if (!childNode) continue;

        const childPtr       = childNode[PTR];
        const nextChildValue = nextIsObject ? nextValue[key] : void(0);
        const previousChildValue = _values[childPtr];

        // Value unchanged – skip.
        if (is(previousChildValue, nextChildValue)) continue;

        // Apply the new value and invalidate any cached deep proxy.
        _values[childPtr] = nextChildValue;
        stateOf(store).proxies.delete(dottedChildKey);

        // Recurse into nested objects so their own reactive children are
        reconcileSubtree(
            store,
            dottedChildKey,
            previousIsObject ? prevValue[key] : void(0),
            nextChildValue
        );

        // If the new value is undefined, the property was deleted.
        if (
            nextChildValue === undefined &&
            _nodeTree[(childPtr*3 + TREE_CHILD)] === 0 &&
            !hasExternalReader(childPtr)
        ) {
            purgeQuorumChild(store, dottedChildKey);
            storeDict.delete(dottedChildKey);
            tagForDisposal(childPtr);
        } else {
            settle(childPtr, previousChildValue, nextChildValue);
        }
    }
}

function mintField(val) {
	const prev = _activePtr; 
	_activePtr = 0;
	try { return _wire(TRIT_STATE, val, 0); } finally { _activePtr = prev; }
}

// =================================================================

class ProxyTraps {
    // Reachability Invariant (strict): ctx data lives in #privates — the handler can
    #isRoot; #store; #handle; #key; #meta; #prefix; #owner; #ownerPtr; #declared; #isUnion; #layer; #layerDepth;
    constructor(ctx) {
        this.#isRoot     = ctx.isRoot ?? false;
        this.#store      = ctx.store;
        this.#handle     = ctx.store instanceof Signal;   // a MINTED handle; an adopted host (element, class) is not, callable or not
        this.#key        = ctx.key;
        this.#meta       = ctx.meta;
        this.#prefix     = ctx.prefix;
        this.#owner      = ctx.owner;
        this.#ownerPtr   = ctx.ownerPtr;
        this.#declared   = ctx.declared;
        this.#isUnion    = ctx.isUnion ?? false;
        this.#layer      = ctx._layer;
        this.#layerDepth = ctx._layerDepth ?? 0;
    }

    get #frozen() {
        const ptr = this.#ownerPtr;
        return _trits[ptr] >= -40 && _trits[ptr] <= 40 && _trits[ptr] !== 0;
    }

    #storedKey(k) {
        k = String(k).replace(SIGIL_STRIP_RE, '');
        const p = this.#prefix || '';
        /* [split-lane] the ATOMIC lane (depth 0) IS the bare namespace: the door adds
         * affect, never a key prefix — that is the loud-write/silent-read doctrine.
         * Decided by the TABLE (depth), not by glyph identity: the old `p === 'Φ'`
         * check went stale the moment triad canonicalized aliases before this point. */
        const sp = (this.#meta && this.#meta.depth === 0) ? '' : p;
        const cand = sp + k;
        const dict = stateOf(this.#store).dict;
        if (dict.has(cand)) return cand;
        if (k.indexOf('.') > 0) {
            // Branch keys live at the ROOT-CANONICAL spelling ('ΣΣstats.hp' under a
            const cut = k.indexOf('.');
            const rootCand = sp + k.slice(0, cut);
            if (dict.has(rootCand)) {
                const branch = rootCand + k.slice(cut);
                if (dict.has(branch)) return branch;
            }
            if (dict.has(k)) return k;
        }
        return cand;                                     // the mint target for a new key
    }

    #getChildNode(name, val, meta, t, ownerPtr) {
        const dict = stateOf(this.#store).dict;
        const storedRef = dict.get(name);
        let node = storedRef != null ? Signal.deref(storedRef) : null;
        if (node) return node;

        // Back‑reference resolution (same as _field)
        let back = null;
        if (isKeyable(val) && val === t) back = ownerPtr;
        else if (isKeyable(val)) {
            let anc = this.#key || name.slice(0, name.lastIndexOf('.'));
            while (anc) {
                const anRef = dict.get(anc);
                const an = anRef != null ? Signal.deref(anRef) : null;
                if (an && _values[an[PTR]] === val) { back = an[PTR]; break; }
                anc = anc.slice(0, anc.lastIndexOf('.'));
            }
        }
        if (back !== null) {
            dict.set(name, refOf(back));
            return Signal(back);
        }

        // Create a fresh signal
        const fresh = mintField(val);
        const childMeta = parse(name);
        if (childMeta && childMeta.depth === Infinity) {
            _trits[fresh[PTR]] = a_axis(_trits[fresh[PTR]], childMeta.type === 'union' ? 1 : -1);
        }
        dict.set(name, refOf(fresh[PTR]));
        adopt(ownerPtr, fresh[PTR]);
        return fresh;
    }

    #applyDepthOverride(nodePtr) {
        if (this.#layer && this.#layerDepth != null) {
            this.#layer[nodePtr] = this.#layerDepth !== Infinity ? this.#layerDepth : 0;
        }
    }

    // ── Reactivity methods (replacing old helpers) ────────────────
    #handleReactivity(t, k, name, meta) {
        // Called only when proxy is NOT frozen
        const n = this.#getChildNode(name, t[k], meta, t, this.#ownerPtr);
        const val = get(n[PTR], true);

        if (meta.depth > 1 && isKeyable(val) && !isOpaqueValue(val)) { // [§2a] exotic AND class-instance children come back RAW
            return reactive(val, {
                isRoot: false,
                nested: true,   // [0.89.j] identity-cached per (store, target)
                store: this.#store,
                key: name,
                meta: { ...meta, depth: meta.depth === Infinity ? Infinity : meta.depth - 1 },
                ownerPtr: n[PTR],
                _layer: this.#layer,
            });
        }
        return val;
    }

    #mutateField(t, k, name, v, meta, mirror = true) {
        // Frozen? Then mutation is forbidden
        if (this.#frozen) {
            throw new TypeError(`❄️ Cannot assign to frozen property "${name}".`);
        }

        const dict = stateOf(this.#store).dict;
        let node = Signal.deref(dict.get(name));

        let layerDepth = null; // Layer unwrapping (storeWrite behaviour)
        if (isKeyable(v) && typeof v[LAYER] === 'number') {
            layerDepth = v[LAYER];
            v = v.value;
        }

        const cBand = layerDepth != null
            ? (layerDepth >= 3 || layerDepth === Infinity ? 1 : layerDepth === 1 ? -1 : 0)
            : null;

        if (node) {
            const setter = _accessorSet.get(node[PTR]);
            if (setter) return setter.call(node, v), node;

            if (cBand != null) {
                _trits[node[PTR]] = c_axis(_trits[node[PTR]], cBand);
                this.#applyDepthOverride(node[PTR]);
            }

            /* a value over a formula: the formula goes first (edges, gate, membrane, cache) */
            if (isRunnable(node[PTR])) retypeConstant(node[PTR]);
            const oldV = _values[node[PTR]];
            if (is(oldV, v)) { stateOf(this.#store).proxies.delete(name); return; }

            _values[node[PTR]] = v;
            if (mirror) Reflect.set(t, k, v);   // update the underlying object *after* arena
            settle(node[PTR], oldV, v, true);
            reconcileSubtree(this.#store, name, oldV, v);
            stateOf(this.#store).proxies.delete(name);

            if (stateOf(this.#store).cascade !== false) cascadeUp(this.#store, name);
            return;
        }

        // Fresh node
        node = mintField(v);
        const freshMeta = parse(name);
        if (freshMeta) {
            if (cBand != null) {
                _trits[node[PTR]] = c_axis(_trits[node[PTR]], cBand);
                this.#applyDepthOverride(node[PTR]);
            }
            if (freshMeta.depth === Infinity) {
                _trits[node[PTR]] = a_axis(_trits[node[PTR]], freshMeta.type === 'union' ? 1 : -1);
            }
        }
        dict.set(name, refOf(node[PTR]));
        adopt(this.#ownerPtr, node[PTR]);
        if (mirror) Reflect.set(t, k, v);

        if (stateOf(this.#store).cascade !== false) cascadeUp(this.#store, name); // [18.3.m] same rule, fresh path
    }

    // ── Traps ─────────────────────────────────────────────────────
    #bound;
    /* the store's API through the door: a handle answers from its own chain (a
     * component may override a method); an adopted host answers from the Store
     * prototype, bound to the host, since the host has no such chain */
    #api(t, k, r) {
        const s = this.#store;
        if (this.#isRoot && s != null && (s === t || !this.#handle) && k !== 'constructor' && k in GraphNode.prototype) {
            const v = this.#handle ? Reflect.get(s, k, s) : (typeof k === 'string' && DOOR_KEYS.has(k) ? GraphNode.door(s, k) : Reflect.get(GraphNode.prototype, k, s));
            if (typeof v !== 'function') return v;
            if (typeof k === 'string' && DOOR_KEYS.has(k)) return v; // doors: proxies, never bind
            const b = (this.#bound ??= new Map());
            let f = b.get(v);
            if (!f) { f = v.bind(s); b.set(v, f); }
            return f;
        }
        return Reflect.get(t, k, r);
    }
    /* the store's own call through the door (`s.Φ(5)` with no string/function/object form) */
    #call(args) {
        const s = this.#store;
        return this.#handle ? s[CALL](...args) : GraphNode.prototype[CALL].call(s, ...args);
    }

    get(t, k, r) {
        if (k === 'then') return Reflect.get(t, k, r);
        if (typeof k === 'symbol') return this.#api(t, k, r);

        // Frozen → raw, untracked read
        if (this.#frozen) return this.#api(t, k, r);

        if (this.#isRoot) {
            // (REACTIVE_STORE is a symbol — handled two lines up by #api, which resolves the
            if (this.#declared?.has(k)) return Reflect.get(t, k, r);

            // Triad accessor: prefix + key → store key lookup
            if (this.#prefix) {
                if (RESERVED.has(k)) return this.#api(t, k, r);

                const sk = this.#storedKey(k);
                const ref = stateOf(this.#store).dict.get(sk);
                let node = ref != null ? Signal.deref(ref) : null;
                if (!node && k.indexOf('.') > 0) {
                    const cut = k.indexOf('.');
                    const rootSk = this.#storedKey(k.slice(0, cut));
                    if (stateOf(this.#store).dict.has(rootSk)) {
                        const branchSk = rootSk + k.slice(cut);   // ROOT-CANONICAL spelling
                        if (!stateOf(this.#store).dict.has(branchSk)) {
                            // vivify by WALKING THE DEEP VIEW — the only lane that mints
                            let view = GraphNode.read(this.#store, rootSk);
                            for (const seg of k.slice(cut + 1).split('.')) {
                                if (view == null) break;
                                view = view[seg];
                            }
                        }
                        const r2 = stateOf(this.#store).dict.get(branchSk);
                        node = r2 != null ? Signal.deref(r2) : null;
                    }
                }
                if (!node) node = storeWrite(this.#store, sk, undefined); // subscribe-before-set
                if (node) { try { track(node[PTR]); } catch (e) {} }
                return node; // callable signal handle
            }

            // Normal reactive key with inline sigil (e.g., $count)
            const meta = parse(k);
            if (!meta) return this.#api(t, k, r);
            return this.#handleReactivity(t, k, k, meta);
        }

        // Non‑root: key is a dotted path; delegate to parent handler
        const meta = this.#meta;
        return this.#handleReactivity(t, k, `${this.#key}.${canonKey(k)}`, meta);
    }

    set(t, k, v, r) {
        if (typeof k === 'symbol') return Reflect.set(t, k, v, r);

        if (this.#frozen) {
            throw new TypeError(`❄️ Cannot assign to frozen property "${k}".`);
        }

        /* DOOR ASSIGNMENT — `s.Φ.x = v`, `el.Σ.x = v`. The door's lane names the key,
         * and the assignment is the loud write .set(v) makes: a value lands, a formula
         * is retyped. It used to fall through to Reflect.set with the proxy as receiver,
         * which defined a frozen own property on the handle and broke every later read
         * of the door (measured). The target is never mirrored on this path. */
        if (this.#isRoot && this.#prefix != null && typeof k === 'string' && !RESERVED.has(k) && !parse(k)) {
            const sk = this.#storedKey(k);
            Signal.batch(() => this.#mutateField(t, k, sk, v, this.#meta, false));
            return true;
        }

        if (this.#isRoot) {
            const meta = parse(k);
            if (meta) {
                /* [0.89.j] ONE logical write = ONE wave: the field write and its
                 * upward cascade fuse into a single flush, so a consumer reading
                 * both the leaf and its path fires once, at every family. */
                Signal.batch(() => this.#mutateField(t, k, k, v, meta));
                return true;
            }
            return Reflect.set(t, k, v, r);
        }
        Signal.batch(() => this.#mutateField(t, k, `${this.#key}.${canonKey(k)}`, v, this.#meta));
        return true;
    }

    has(t, k) {
        // Frozen or not, has doesn't mutate or track – safe to use as‑is
        return (this.#isRoot && stateOf(this.#store).dict.has(k)) || Reflect.has(t, k) || (this.#isRoot && this.#store !== t && k in GraphNode.prototype);
    }

    ownKeys(t) {
        // Same as before; frozen doesn't change own keys
        return this.#isRoot
            ? [...new Set([...Reflect.ownKeys(t), ...stateOf(this.#store).dict.keys()])]
            : Reflect.ownKeys(t);
    }

    getOwnPropertyDescriptor(t, k) {
        // Unchanged – still shows dictionary entries as configurable/writable
        if (this.#isRoot && !this.#declared?.has(k) && stateOf(this.#store).dict.has(k)) {
            return { enumerable: true, configurable: true, writable: true };
        }
        return Reflect.getOwnPropertyDescriptor(t, k);
    }

    deleteProperty(t, k) {
        if (typeof k === 'symbol') return Reflect.deleteProperty(t, k);

        if (this.#frozen) {
            throw new TypeError(`❄️ Cannot delete frozen property "${k}".`);
        }

        if (this.#isRoot && this.#prefix != null && this.#store && typeof k === 'string') {
            const sk = this.#storedKey(k);
            if (stateOf(this.#store).dict.has(sk)) return GraphNode.remove(this.#store, sk);
            return true;
        }

        const meta = this.#isRoot ? parse(k) : this.#meta;
        const name = this.#isRoot ? k : `${this.#key}.${canonKey(k)}`;

        const oldV = t[k];
        const ok = Reflect.deleteProperty(t, k);
        if (ok && meta && this.#store && !(k in t)) {
            const ref = stateOf(this.#store).dict.get(name);
            const n = ref != null ? Signal.deref(ref) : null;
            if (n) {
                if (this.#isRoot && !this.#declared?.has(k)) {
                    const axis = e_axis(_trits[n[PTR]]);
                    axis >= 0 ? n.detach() : n.dispose();
                } else {
                    _values[n[PTR]] = undefined;
                    settle(n[PTR], oldV, undefined, true);
                    purgeQuorumChild(this.#store, name);
                    if (meta.depth > 1 && (stateOf(this.#store).cascade ?? meta.type !== 'union')) {
                        cascadeUp(this.#store, name);
                    }
                }
            }
        }
        return ok;
    }

    defineProperty(t, k, desc) {
        if (this.#frozen) {
            throw new TypeError(`❄️ Cannot define property "${k}" on a frozen signal.`);
        }

        const ok = Reflect.defineProperty(t, k, desc);
        if (ok && typeof k !== 'symbol' && 'value' in desc) {
            this.set(t, k, desc.value, t);
        }
        return ok;
    }

    construct(t, args, nt) {
        if (this.#isRoot && this.#prefix != null && this.#store) {
            const p = this.#prefix, sp = (this.#meta && this.#meta.depth === 0) ? '' : p;   // [split-lane] depth decides the bare lane (see #storedKey)
            const dict = stateOf(this.#store).dict;
            const out = {};
            for (const key of dict.keys()) {
                if (key.indexOf('.') !== -1) continue;
                const m = parse(key);
                if (sp === '') { if (m !== null) continue; }
                else { if (!m || m.mode !== 'prefix' || canonOf(m) !== sp) continue; }
                const ref = dict.get(key);
                const n = ref != null ? Signal.deref(ref) : null;
                if (!n) continue;
                out[sp === '' ? key : m.name] = get(n[PTR], false);
            }
            return out;
        }
        return Reflect.construct(t, args, nt);
    }

    // ψ — the chainable seeding functor (0.87.a):
    apply(t, thisArg, args) {
        const [arg1, arg2, arg3] = args;   // arg3 === false → force the LOUD write

        if (args.length === 0) return this.#isRoot ? (this.#owner ?? this.#store ?? t) : Reflect.apply(t, thisArg, args);

        if (this.#isRoot && this.#store) {
            const prefix = this.#prefix || '';
            const meta = this.#meta || parse(prefix || '$') || sigilMeta(prefix || '$');

            if (typeof arg1 === 'string') {
                const sk = this.#storedKey(arg1);        // [18.3.v] tier spelling, not blind concat
                if (arg2 === undefined) {
                    const ref = stateOf(this.#store).dict.get(sk);   // the store, never the target: a door over an adopted host stands on a surrogate
                    return ref != null ? Signal.deref(ref) : undefined;
                }
                if (arg3 !== false) {
                    let ref = stateOf(this.#store).dict.get(sk);
                    if (ref == null) { this.#mutateField(t, sk, sk, arg2, meta); return this[PROXY_REF]; }
                    const node = Signal.deref(ref);
                    if (node && !isFrozen(node[PTR])) { silentSet(node[PTR], arg2); return this[PROXY_REF]; }
                }
                // mutateField will throw if frozen – no extra check needed here
                this.#mutateField(t, sk, sk, arg2, meta);
                return this[PROXY_REF];
            }

            if (typeof arg1 === 'function') {
                const capture = meta.depth > 1 ? 'deep' : meta.depth === 1 ? 'shallow' : 'atomic';
                /* [RULED] the mint's affect follows the TABLE (meta.type), not the triad's
                 * write-lane flag: legacy ø/Φ alias to the union `$`, so effects minted
                 * through them fire on any dep; $$/Σ/ΣΣ ask for consensus explicitly and
                 * arm the quorum gate. (#isUnion still governs multi-key WRITE batching.) */
                const affect = meta.type === 'union' ? 'union' : 'consensus';
                const door = this[PROXY_REF];
                const owner = this.#owner ?? undefined;
                const home = this.#store;
                const mint = () => new Signal({
                    /* SELF-STAMP: a push node runs AT MINT, before any post-mint bookkeeping */
                    value: function () { _owner[_activePtr] = home; return arg1.call(owner ?? this, door); },
                    options: { capture, affect, effect: arg2 ? 'pull' : 'push' }
                });
                const ambient = activeOwner();
                return (ambient !== undefined && ambient !== home) ? Signal.untrack(mint) : mint();
            }

            if (isKeyable(arg1) && !Array.isArray(arg1)) {
                const put = () => {
                    for (const k of Object.keys(arg1)) {
                        const cleanKey = this.#storedKey(k.replace(SIGIL_STRIP_RE, ''));   // [18.3.v]
                        this.#mutateField(t, cleanKey, cleanKey, arg1[k], meta);
                    }
                };
                this.#isUnion ? put() : Signal.batch(put);
                return this[PROXY_REF];
            }
        }

        if (this.#isRoot && this.#store) return this.#call(args);
        return t[CALL] ? t[CALL](...args) : Reflect.apply(t, thisArg, args);
    }
}

// ── Consolidated handle factory (unchanged) ──────────────────────
function createCallableHandle(ctor, ptrVal = 0, genVal = 0n, host) {
	return Reflect.construct(GraphNode, [ptrVal, genVal, host], ctor);
}

const _RESULT_PROXIES = new WeakMap();   // inner -> proxy, per depth band (identity-stable reads)
function resultProxy(value, depth, ownerPtr) {
	if (!isKeyable(value) || depth <= 0 || isOpaqueValue(value)) return value; // [§2a]
	let band = _RESULT_PROXIES.get(value);
	if (band && band.ptr === ownerPtr && band.depth === depth) return band.proxy;
	const proxy = new Proxy(value, {
		get(t, k, r) {
			const v = Reflect.get(t, k, r);
			return (depth > 1 && typeof k === 'string' && isKeyable(v) && !isOpaqueValue(v)) // [§2a]
				? resultProxy(v, depth - 1, ownerPtr) : v;
		},
		set(t, k, v) {
			const ok = Reflect.set(t, k, v);
			if (ok && typeof k === 'string' && _trits[ownerPtr] !== 0) trigger(ownerPtr);
			return ok;
		},
		deleteProperty(t, k) {
			const ok = Reflect.deleteProperty(t, k);
			if (ok && typeof k === 'string' && _trits[ownerPtr] !== 0) trigger(ownerPtr);
			return ok;
		}
	});
	_RESULT_PROXIES.set(value, { ptr: ownerPtr, depth, proxy });
	return proxy;
}

// ── reactive – the single entry point ─────────────────
function reactive(target, ctx) {
    if (isKeyable(target) && (isExoticOpaque(target)
        || (!ctx.isRoot && ctx.store && isOpaqueValue(target)))) return target; // [§2a] exotics never wrap; class instances stay raw as store VALUES (engine targets — handles, stores, roots — are exempt)
    if (!ctx.isRoot) {
        if (_proxySet.has(target)) return target;
        if (!ctx.store) {
            if (_deepCache.has(target)) return _deepCache.get(target);
        } else if (ctx.nested) {
            const m = _storeNested.get(ctx.store);
            const hit = m && m.get(target);
            if (hit) return hit;
        }
    }

    const traps = new ProxyTraps(ctx);
    const proxy = new Proxy(target, traps);
    traps[PROXY_REF] = proxy;

    if (!ctx.isRoot) {
        if (!ctx.store) {
            _deepCache.set(target, proxy);
            _proxySet.add(proxy);
        } else if (ctx.nested) {
            let m = _storeNested.get(ctx.store);
            if (!m) _storeNested.set(ctx.store, m = new WeakMap());
            m.set(target, proxy);
            _proxySet.add(proxy);
        }
    }
    return proxy;
}

function storeWrite(store, key, val) {
	return storeWriteSync(store, key, val);
}
function storeWriteSync(store, key, val) {
    const st = stateOf(store);   // the bag, read once
    key = canonKey(key);
    let depthOverride = null;
    if (isKeyable(val) && typeof val[LAYER] === 'number') {
        depthOverride = val[LAYER];
        val = val.value;
    }

    let node = Signal.deref(st.dict.get(key));

    // Compute cBand once
    const cBand = depthOverride !== null
		? (depthOverride > 1 ? 1 : depthOverride === 1 ? -1 : 0) : null;

    if (node) {
		const nv = _trits[node[PTR]];
        if (nv >= -40 && nv <= 40) { // frozen
            throw new TypeError(`❄️ Frozen key cannot be set: "${key}".`);
        }

        const setter = _accessorSet.get(node[PTR]);
        if (setter) return setter.call(node, val), node;

        if (cBand !== null) {
            _trits[node[PTR]] = c_axis(_trits[node[PTR]], cBand);
            _layer[node[PTR]] = (depthOverride !== Infinity) ? depthOverride : 0;
        }
        /* a VALUE written over a FORMULA replaces it: retype first, so the landing
         * below is an ordinary value write and the old edges are already gone */
        if (isRunnable(node[PTR])) retypeConstant(node[PTR]);   // the body stays in the lane as `oldV`, so the landing below always notifies

        if (_predicates[node[PTR]] !== undefined && typeof _values[node[PTR]] !== 'function') {
            predicatedWrite(node[PTR], val); // [§21] the membrane; VETO = the landing never happened (no settle, no cascade)
            return node;
        }
        const oldV = _values[node[PTR]];
        if (is(oldV, val)) { st.proxies.delete(key); return node; }

        _values[node[PTR]] = val;
        settle(node[PTR], oldV, val, true);
        reconcileSubtree(store, key, oldV, val);
        st.proxies.delete(key);
        if (typeof key === 'string' && key.indexOf('.') > 0) writeThrough(store, key, val);
        if (st.cascade !== false && !_inCascade && typeof key === 'string' && key.indexOf('.') > 0) cascadeUp(store, key);
        return node;
    }

    if (val === undefined && typeof key === 'string' && key.indexOf('.') > 0) val = resolveSlice(store, key);
    node = mintField(val);
	const meta = parse(key);
    if (meta) {
        if (cBand !== null) {
            _trits[node[PTR]] = c_axis(_trits[node[PTR]], cBand);
            _layer[node[PTR]] = (depthOverride !== Infinity) ? depthOverride : 0;
        }
        if (cBand === null && meta.depth > 0) {
            _trits[node[PTR]] = c_axis(_trits[node[PTR]], meta.depth === Infinity ? 1 : -1);
        }
        if (meta.depth >= 1 && meta.type !== 'atomic') {
            _trits[node[PTR]] = a_axis(_trits[node[PTR]], meta.type === 'union' ? 1 : -1);
        }
    }
    _owner[node[PTR]] = store; // [session ②] recipes minted on this cell find their lens here
    adopt(root()[PTR], node[PTR]);
    if (val !== undefined) _durable[node[PTR]] = 1;   // [18.3.s] born from a WRITE, not a read-vivify
    st.dict.set(key, node.ref);
    _nodeHome.set(node[PTR], { store, key });
    st.proxies.delete(key);
    if (st.cascade !== false && !_inCascade && val !== undefined && typeof key === 'string' && key.indexOf('.') > 0) { writeThrough(store, key, val); cascadeUp(store, key); }
    return node;
}

function storeRead(store, key) {
	return storeReadSync(store, key);
}
/* remove a key: its node withdraws from its consumers and is tagged for disposal */
function storeDelete(store, key) {
	key = canonKey(key);
	const ref = stateOf(store).dict.get(key);
	if (ref == null) return false;
	const node = Signal.deref(ref);
	purgeQuorumChild(store, key);
	stateOf(store).dict.delete(key);
	stateOf(store).proxies.delete(key);
	if (node) {
		const ptr = node[PTR], prev = _values[ptr];
		_values[ptr] = undefined;
		if (prev !== undefined) fireAndWithdraw(ptr);
		tagForDisposal(ptr);
	}
	return true;
}
/* the sweeps clear() and dispose() share: every key's node is tagged and the bag's
 * tables emptied; a factory's variants are tagged and its trie remade */
function clearKeys(st) {
	for (const ref of st.dict.values()) {
		const node = Signal.deref(ref);
		if (node) tagForDisposal(node[PTR]);
	}
	st.dict.clear();
	st.proxies.clear();
	st.quorums.clear();
}
function clearLeaves(st) {
	for (const e of st.leafQueue) if (_trits[e[PTR]] !== 0) tagForDisposal(e[PTR]);
	st.trieRoot  = trieNode();
	st.leafQueue = [];
	st.liveCount = 0;
}
function storeReadSync(store, key) {
    const st = stateOf(store);   // the bag, read once
    key = canonKey(key);
    const node = Signal.deref(st.dict.get(key)) ?? storeWrite(store, key, undefined);

    if (isFrozen(node[PTR])) return get(node[PTR], false); // Frozen: plain, untracked read – no subscription
    
    const obj  = _values[node[PTR]];

    if (obj === null || typeof obj !== 'object') return get(node[PTR]);

    const meta0 = parse(key);
    const stamped = _layer[node[PTR]] || 0;
    const optDepth = _storeDepth.get(store) || 0;
    if ((!meta0 || meta0.depth === 0) && stamped <= 0 && optDepth <= 0)   // [split-lane] depth is the atomic test; type carries the FAMILY
        return track(node[PTR]), obj;
    const meta = meta0 || { prefix: '', depth: 0,
        type: _storeFamily.get(store) === 1 ? 'union' : 'consensus' };
	meta.depth = stamped || meta.depth || optDepth; // layer override, then sigil, then options

    const proxyMeta = {  // nested-proxy ctx: meta must stay NESTED — ProxyTraps reads this.#meta
        meta, store, ownerPtr: node[PTR], key   // (was `...meta`, which flattened it to undefined)
    };

    const px = st.proxies.getOrInsertComputed(key, () => reactive(obj, {
        isRoot: false,
        ...proxyMeta,
        _layer                    // pass the global array for nested overrides
    }));

    if (meta.depth > 1) track(node[PTR]);
    return px;
}

function Signal(a, b, c, d) {
    if (new.target === Signal && arguments.length === 0) return new Signal.Store();
    const _initNode = (value, opts) => {
        let trit, free;
        if (opts._trit !== undefined) {
            trit = opts._trit;
            free = opts.free ?? 0;
        } else {
            const isFn     = typeof value === 'function';
            const isGen    = isFn && /GeneratorFunction/.test(value.constructor?.name || '');
            const isEffect = isFn && !opts.computed && !opts.defer;

            const xR = isFn ? -1 : 1;
            const xE = isEffect ? 1 : isFn ? -1 : 0;
            const xA = opts.union ? 1 : opts.interrupt ? 1 : isFn ? (isEffect ? -1 : 1) : 0;
            const xC = opts.deep ? 1 : opts.shallow ? -1 : 0;
            const xT = opts.volatile ? 1 : opts.untracked ? 0 : -1;
            trit = encode(xR, xE, xA, xC, xT);
            free = opts.free ?? (isGen ? 1 : isEffect ? -1 : 0);
        }
        // const node = resolveNode(root()[PTR], null, value, null, root()[PTR], null, null, null, { _trit: trit, free });
		const node = _wire(trit, value, free);
        if (opts._setter) _accessorSet.set(node[PTR], opts._setter);
        return { [PTR]: node[PTR], [GEN]: node[GEN], ref: node.ref }; // [18.3.o] bundle keys follow the symbols — its readers (liveLeaf et al.) already do
    };

    const newt = new.target;

    // ── Handle path (no `new`) ──────────────────────
    if (newt === void 0) {
        const hit = (a > 0 && a < MAX_NODES) ? _handles[a] : void 0;
        if (hit !== void 0 && GraphNode.genOf(hit) === _nodeGen[a]) return hit;  // canonical: one handle per live node — the brand read works on a handle and on an adopted host alike
        const fresh = createCallableHandle(Signal, a, _nodeGen[a]);
        if (a > 0 && a < MAX_NODES) _handles[a] = fresh;
        return fresh;
    }

    // ── Signal.Store: allocate an identity node ─────
    if (newt === Signal.Store || (newt && newt !== Signal && newt.prototype instanceof Signal.Store)) {
        /* `super(host)` from Store carries the host to adopt; a plain `new Store()` carries nothing */
        const host = (a !== null && (typeof a === 'object' || typeof a === 'function')) ? a : undefined;
        const ptr = allocNode();
        /* doc:C-ONENODE */
        /* the head is a STATE node from birth, not an inert mount: it is the store's own
         * value lane — `s()` reads it, `s.set(v)` and `s.Φ(v)` write it, and an effect
         * that read it wakes on the write. (TRIT_STORE, the untracked spelling, cannot
         * mark a head: encode(1,0,0,0,0) is also an untracked State cell. The component
         * mint below still uses it.) */
        _trits[ptr] = TRIT_STATE;
        /* doc:C-OWNERELEMENT */
        /* a store allocates OUTSIDE the ownership tree. For an ELEMENT the question is
         * already decided by CONSTRUCTION IS OPAQUE (core's Meta construct trap runs every
         * construction under untrack, so no node is active when an element is minted):
         * switch or no switch, an element can never become the running effect's child.
         * The switch governs direct adoption inside a run (Signal.Store.adopt called from
         * an effect body); it is off, and the ruling stays open. */
        if (_ownElements && host !== undefined && _activePtr !== 0) adopt(_activePtr, ptr);
        const storeHandle = createCallableHandle(newt, ptr, _nodeGen[ptr], host);
        _handles[ptr] = storeHandle;  // canonical (overwrites any transient _wire mint)
        return storeHandle;
    }

    // ── Core signal constructors (State, Computed, Effect, base Signal) ──
    if (newt === Signal || newt === Signal.State) {
        let scope = null, key = null, value = void 0, opts = {};

        switch (arguments.length) {
            case 0: throw new TypeError('Signal requires an argument');
            case 1: {
                if (isDescriptor(a)) {
                    const o = a.options || {};
                    const hasGet = 'get' in a;
                    const hasSet = 'set' in a;
                    if ('value' in a && (hasGet || hasSet)) {
                        throw new TypeError('Invalid Signal descriptor: value and accessor cannot coexist');
                    }
                    const dv = hasGet ? a.get : a.value;
                    const fn = typeof dv === 'function';
                    
                    scope = a.scope ?? null;
                    key   = typeof a.key === 'string' ? a.key : null;
                    value = dv;
                    opts  = {
                        _trit:  o.trit ?? encode(
                            POLE.R[o.return?.toUpperCase()] ?? (fn ? -1 : 1),
                            POLE.E[o.effect?.toUpperCase()] ?? (fn ? (hasGet ? -1 : 1) : 0),
                            POLE.A[o.affect?.toUpperCase()] ?? (fn ? (POLE.E[o.effect?.toUpperCase()] === 1 ? -1 : POLE.E[o.effect?.toUpperCase()] === -1 ? 1 : 0) : 0),
                            POLE.C[o.capture?.toUpperCase()] ?? 0,
                            POLE.T[o.threshold?.toUpperCase()] ?? (hasGet ? 1 : -1)
                        ),
                        free:   o.free ?? ((POLE.E[o.effect?.toUpperCase()] ?? (fn ? (hasGet ? -1 : 1) : 0)) === 1 ? -1 : 0),
                        _setter: hasSet ? a.set : void(0),
                        _gate:  POLE.A[o.affect?.toUpperCase()] === -1 && (POLE.E[o.effect?.toUpperCase()] ?? (fn ? (hasGet ? -1 : 1) : 0)) === 1,   // [RULED] EXPLICIT consensus on a push body → quorum gate
                    };
                } else { value = a; }
                break;
            }
            case 2: {
                if (isScope(a)) { scope = a; value = b; }
                else            { value = a; opts  = b || {}; }
                break;
            }
            case 3: {
                if (isScope(a)) { scope = a; value = b; key = (typeof c === 'string') ? c : null; if (typeof c !== 'string') opts = c || {}; }
                else            { value = a; key = (typeof b === 'string') ? b : null; opts = c || {}; }
                break;
            }
            default: {
                scope = a; value = b; key = c; opts = d || {};
                break;
            }
        }

        switch (newt) {
            case Signal.State:    opts._trit ??= TRIT_STATE;    opts.free ??= 0; break;
        }

        const { [PTR]: ptr, [GEN]: gen, ref } = _initNode(value, opts); // bundle is symbol-keyed (18.3.o)
            if (opts._gate === true) _gateA[ptr] = 1;   // [RULED] explicit consensus on a push body: quorum
        if (scope && scope[REACTIVE_STORE] && typeof key === 'string') {
            stateOf(scope[REACTIVE_STORE]).dict.set(key, ref);
            _nodeHome.set(ptr, { store: scope[REACTIVE_STORE], key });
        }
        const handle = createCallableHandle(newt, ptr, gen);
        _handles[ptr] = handle;  // canonical — overwrites the transient base-proto handle from _wire
        return handle;
    }
    {   // ── User subclass (reactive classes) ────────────
        const ptr = allocNode();
        _trits[ptr] = TRIT_STORE;
        const handle = createCallableHandle((newt || Signal), ptr, _nodeGen[ptr]);
        _handles[ptr] = handle;  // canonical for kernel derefs; NOTE: userland receives the reactive() proxy (identity across that boundary = open item)

        /* the component's store state, in the side record: #mutateField touches the
         * proxies on sigil writes — components crashed without them on every 18.x */
        _componentState.set(handle, { dict: new Map(), proxies: new Map(), quorums: new Map(), cascade: undefined, engine: root() });
        handle[REACTIVE_STORE] = handle; // component brand — #store stays null: components are NOT stores

        const declaredMembers = new Set();
        const pendingEffects  = [];
        scanClass(handle, handle, pendingEffects, declaredMembers);
        registerActiveEffects(handle, handle, pendingEffects);

		return reactive(handle, {
		    isRoot: true,
			store: handle,
			ownerPtr: ptr,
			declared: declaredMembers,
			 _layer: _layer,   // pass the global array
		});
    }
}

function memberTrit(R, E, union, deep) { return encode(R, E, union ? 1 : -1, deep ? 1 : -1, -1); }

function scanClass(instance, store, activeEffects, members) {
    const enginePtr = stateOf(store).engine[PTR];
    const seen = new Set(['constructor']);
    let proto = Object.getPrototypeOf(instance);

    while (proto && proto !== Signal.prototype && proto !== Object.prototype && proto !== Function.prototype) {
        for (const key of Object.getOwnPropertyNames(proto)) {
            if (seen.has(key)) continue;
            seen.add(key);

            const meta = parse(key);
            if (!meta) continue;

            const desc = Object.getOwnPropertyDescriptor(proto, key);
            if (!desc) continue;
            const isGetter = typeof desc.get === 'function';
            const isMethod = typeof desc.value === 'function';
            if (!isGetter && !isMethod) continue;

            if (meta.mode === 'suffix') {
                activeEffects.push({
                    key, name: meta.name, method: desc.value || desc.get,
                    deep: meta.depth > 1, union: meta.type === 'union'
                });
            } else {
                const trit = memberTrit(1, -1, meta.type === 'union', meta.depth > 1);
                const ptr = allocNode();
                _trits[ptr] = trit;

                if (isGetter) {
                    _values[ptr] = desc.get;
                    _ctx[ptr] = undefined;
                    adopt(enginePtr, ptr);
                    Object.defineProperty(instance, key, {
                        configurable: true, enumerable: true,
                        get: () => {
							const val = get(ptr);
							return meta.depth > 0
								? reactive(val, {
									isRoot: false,
									store: store,
									key: meta.key,
									meta: meta,
									ownerPtr: ptr,
									_layer: _layer,
								})
								: val;
						}
                    });
                } else {
                    adopt(enginePtr, ptr);
                    Object.defineProperty(instance, key, {
                        configurable: true, enumerable: true, writable: true,
                        value: new Signal.Store(desc.value, { union: meta.type === 'union', deep: meta.depth === Infinity })
                    });
                }
                members.add(key);
                stateOf(store).dict.set(key, refOf(ptr));
                _nodeHome.set(ptr, { store, key });
            }
        }
        proto = Object.getPrototypeOf(proto);
    }
}

Signal.prototype['$#£@'] = null; // syntax highlighting

let _inCascade = false; // the bell may materialize parent records; those mints must not re-ring
const _storeDepth = new WeakMap();  // store handle -> options-configured depth. Depth used to be
// believed ONLY when written in the key's name ($$tree); options.depth configured the memo path
const _storeFamily = new WeakMap(); // store handle -> +1 union / -1 consensus (options-configured
// family was invisible to the bell: it lived only in the private bag, so option-union stores

// resolveSlice — walk from the nearest ancestor RECORD down the remaining dotted path,
function resolveSlice(store, key) {
	if (typeof key !== 'string') return undefined;
	let cut = key.lastIndexOf('.');
	while (cut > 0) {
		const anc = key.slice(0, cut);
		const aNode = Signal.deref(stateOf(store).dict.get(anc));
		const aObj = aNode ? _values[aNode[PTR]] : null;
		if (aObj !== null && typeof aObj === 'object') {
			let v = aObj;
			for (const seg of key.slice(cut + 1).split('.')) {
				if (v === null || typeof v !== 'object') return undefined;
				v = v[seg];
			}
			return v;
		}
		cut = anc.lastIndexOf('.');
	}
	return undefined;
}

// writeThrough — a leaf written BY NAME must also land inside its parent's stored object,
function writeThrough(store, key, val) {
	if (typeof key !== 'string') return;
	const cut = key.lastIndexOf('.');
	if (cut < 1) return;
	const pNode = Signal.deref(stateOf(store).dict.get(key.slice(0, cut)));
	let pObj = pNode ? _values[pNode[PTR]] : null;
	if (pObj === null || typeof pObj !== 'object') {
		pObj = resolveSlice(store, key.slice(0, cut));
		if (pObj === null || typeof pObj !== 'object') return;
	}
	pObj[key.slice(cut + 1)] = val;
}

// cascadeUp — hierarchical consensus/union barrier for deep fields.
function cascadeUp(store, childName) {
	let name = childName;
	_batchDepth++;
	try {
	for (;;) {
		const cut = name.lastIndexOf('.');
		if (cut < 1) return;                              // reached the field root — done
		const parentName = name.slice(0, cut);
		const childKey   = name.slice(cut + 1);
		const pRef  = stateOf(store).dict.get(parentName);
		let pNode = pRef != null ? Signal.deref(pRef) : null;
		if (!pNode) {
			const slice = resolveSlice(store, parentName);
			if (slice === null || typeof slice !== 'object') return;
			_inCascade = true;
			try { pNode = storeWrite(store, parentName, slice); } finally { _inCascade = false; }
		}
		let pObj = _values[pNode[PTR]];
		if (pObj === null || typeof pObj !== 'object') {
			pObj = resolveSlice(store, parentName);
			if (pObj === null || typeof pObj !== 'object') return;
			_values[pNode[PTR]] = pObj; // silent repair: the record was never truly valued
		}
		let fired;
		const pA = a_axis(_trits[pNode[PTR]]);
		const fam = pA !== 0 ? pA : (_storeFamily.get(store) ?? -1); // sigil on the parent wins; else the store's family
		if (fam === 1) {                               // UNION — any child fires the parent
			fired = true;
		} else {                                          // CONSENSUS — quorum barrier
			let q = stateOf(store).quorums.get(parentName);
			if (!q) { q = new Set(); stateOf(store).quorums.set(parentName, q); }
			q.add(childKey);
			if (q.size >= Object.keys(pObj).filter(kk => kk[0] !== '@').length) { q.clear(); fired = true; }
			else fired = false;
		}
		if (!fired) return;
		trigger(pNode[PTR]);                               // fire this parent's subscribers
		name = parentName;                                // and propagate upward
	}
	} finally { if (--_batchDepth === 0) flushQueue(); }
}

function registerActiveEffects(proxy, store, effects) {
	for (const { key, method, deep, union } of effects) {
		const c = new Signal(method.bind(proxy), { _trit: memberTrit(-1, 1, union, deep) });
		adopt(stateOf(store).engine[PTR], c[PTR]);
		stateOf(store).dict.set(key, c.ref);
		_nodeHome.set(c[PTR], { store, key });
	}
}

function trieNode(parent = null, key = null, bucket = null) { 
    return ø({ 
		children: null, weak: null, node: null, val: undefined,
		parent, key, bucket, 
		refs: 0
	}); 
}

function trieDescend(root, args) { return trieWalk(root, args, true); }
function triePeek(root, args) { return trieWalk(root, args, false); }

/** */
function trieWalk(root, args, mutating = false) {
    let i = 0, cur = root;
    do {
        if (mutating) cur.refs++; // add one more leaf, inclusive
        if (i === args.length) break;
        const arg = args[i++];
        const isSig = arg instanceof Signal;
        const weak  = !isSig && isKeyable(arg);
        const key   = isSig ? arg.ref : arg;
        const bucket = weak
            ? (mutating ? (cur.weak ??= new WeakMap()) : cur.weak)
            : (mutating ? (cur.children ??= new Map()) : cur.children);
		// Non‑mutating: bail out if bucket is missing or key not present
        if (!mutating && !bucket?.has(key)) return null;
		// Mutating: create and retrieve missing node if needed, otherwise just retrive it.
        cur = mutating
            ? bucket.getOrInsertComputed(key, () => trieNode(cur, key, bucket))
            : bucket.get(key);
    } while (true);
    return cur;
}

// Detach a leaf from the trie: clear payload, walk up decrementing refs, prune dead branches.
function triePrune(leaf) {
    leaf.node = null; 
    leaf.val = undefined;
    let curr = leaf;
    do {
        curr.refs--;
        if (curr.refs === 0 && curr.parent) {
            curr.bucket.delete(curr.key);
            if (curr.bucket instanceof Map && curr.bucket.size === 0) curr.parent.children = null;
        }
        curr = curr.parent;
    } while (curr);
}

/** */
function purgeQuorumChild(store, dottedKey) {
    // keys may be non-string (numbers, Symbols) — quorum nesting is a string-path feature;
    if (typeof dottedKey !== 'string') return;
    const dot = dottedKey.lastIndexOf('.');
    if (dot <= 0) return;                      // root field – no parent
    const parentName = dottedKey.slice(0, dot);
    const childKey = dottedKey.slice(dot + 1);
    const q = stateOf(store).quorums.get(parentName);
    if (q) q.delete(childKey);
}

// ── per-signature management API (0.87.8) — the unified-Store contract ──
function liveLeaf(leaf) {
    return !!(
        leaf?.node && 
        _nodeGen[leaf.node[PTR]] === leaf.node[GEN] && 
        _trits[leaf.node[PTR]] > 40
    );
}

function dropFromQueue(queue, ptr) {
	const i = queue.findIndex(e => e[PTR] === ptr);
	if (i >= 0) queue.splice(i, 1);
}

// Reactive class scanner (unchanged except uses get() for computed members)

/* ═════════ MULTITHREADED ARENA — Kraken (merged from Chimera-MT-18) ═════════ */
Signal.MT = {
	active: false,
	_mintA: () => LUT_A[TRIT_EFFECT + Z],   // effect-mint A axis (owner-canonical -1)
	_mintC: () => LUT_A[TRIT_COMPUTED + Z], // computed-mint A axis (+1)
	_peekTrit: p => _trits[p],              // sentinel-band probes (§23) — pure sync reads
	_pokeTrit: (p, v) => { _trits[p] = v; },
};
Signal.silentSet = (h, v) => silentSet(GraphNode.ptrOf(h), v); // [18.3.r] the quiet write, exported — the doors' $(key, v) form
Signal.track = (h) => { if (h != null) track(GraphNode.ptrOf(h)); return h; }; // [18.3.t] SUBSCRIBE WITHOUT READING —
/* UNTRACKED, by handle: the node's T axis goes to 0, so reads of it register no
 * edge and writes to it trigger nothing — the `untracked` field keyword. */
Signal.untracked = (h) => { if (h != null) { const p = GraphNode.ptrOf(h); _trits[p] = t_axis(_trits[p], 0); } return h; };
void {
};
const API = { 
	Signal, Substrate, SYMBOLS: EXPORT_SYMBOLS ? SYMBOLS : {}
};

try {
	return Object.defineProperty(globalThis, CHIMERA, {
		value: () => API,
		writable: false, enumerable: false, configurable: true
	})[CHIMERA]();
} catch (e) {
	return API;
}

});

{
	const { Signal: __S, SYMBOLS: __SY } = CHIMERA_API;
	const { DICTIONARY: __DICT, PTR: __PTR, GEN: __GEN } = __SY;
	const __SP = __S.Store.prototype;

	if (!Object.getOwnPropertyDescriptor(__SP, 'dict'))
		Object.defineProperty(__SP, 'dict', { get() { return __S.dictOf(this); }, configurable: true });

	/* Sigil canon for direct-dict consumers: V18 stores '$'→'Σ', '$$'→'ΣΣ', atomic bare. */
	const __canon = k => typeof k === 'string'
		? k.replace(/^\$\$/, 'ΣΣ').replace(/^\$/, 'Σ').replace(/^[øΦ]/, '')
		: k;

	if (!__SP.write) __SP.write = function (k, v) { this.set(k, v); return true; };
	if (!__SP.read) __SP.read = function (k) {
		const ref = __S.dictOf(this).get(__canon(k)) ?? __S.dictOf(this).get(k);
		const h = ref != null ? __S.deref(ref) : null;
		if (h) {
			if (h instanceof Error || h instanceof __S) { /* handle */ }
			try { __S.track(h); } catch (e) {}
			if (h && typeof h.get === 'function' && (__S.dictOf(this).get(__canon(k)) === ref)) {
				const v = this.get(k);
				if (v !== undefined) return v;
				try { return h.get(); } catch (e) { throw e; }
			}
		}
		return this.get(k);
	};

	{
		const __probe = new __S.Store(); __probe.set('x', 1);
		const __h = __S.deref(__S.dictOf(__probe).get('x'));
		const __proto = __h ? Object.getPrototypeOf(__h) : null;
		if (__proto && !Object.getOwnPropertyDescriptor(__proto, 'ptr')) {
			Object.defineProperty(__proto, 'ptr', { get() { return this[__PTR]; }, configurable: true });
		}
		__probe.dispose();
	}

	(typeof globalThis !== 'undefined' ? globalThis : global).Chimera = CHIMERA_API;
	/* [0.89.c] registry-symbol channel: EXTMAP names the SYMBOL, not the binding, */
	CHIMERA_API.REACTIVE_STORE = __SY.REACTIVE_STORE;
	CHIMERA_API.CHIMERA_LAYER = __SY.LAYER;
	CHIMERA_API.layer = (depth, value) => ({ [__SY.LAYER]: depth, value });

	const __IVC = globalThis[Symbol.for('Instance')];
	if (typeof __IVC === 'function' && typeof __IVC.provide === 'function')
		__IVC.provide({ module: 'chimera', value: CHIMERA_API, from: '0.89.c', to: '0.89.z' });
	else
		globalThis[Symbol.for('Instance.Chimera')] = CHIMERA_API;
	/* NEVER THROWS. Chimera is a genuinely self-contained program — a signal kernel */
	if (typeof module === 'object' && typeof module.exports === 'object') module.exports = CHIMERA_API;
}

})();
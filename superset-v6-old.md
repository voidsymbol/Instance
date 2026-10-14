# Superset V6

Five parts.

**Part 0 is the SYNTAX GUIDE** — every form that compiles, and the ones that are
refused, with the refusal marked. Read it to learn what you can write.

**Part 1 is the OUTPUT** — the same forms with the JavaScript they compile to,
side by side. Every block is real compiler output. Read it to learn what your
code actually does at runtime, and what the emit costs.

**Part 2 is the TRAP CATALOGUE.** JavaScript has places where the obvious
implementation is wrong, and a `.is` compiler meets most of them. Each entry
names the surprise, gives the input that exposes it, and says where the
compiler handles it. Every one was *measured*, not remembered. Read it before
touching the lexer or the parser, and add to it whenever something bites.

**Part 3 is the RULINGS** — design decisions that are not traps: containment,
the inheritance matrix, conservation. Kept because nothing else records why
they are the shape they are. Its first, **C-CASCADE (3.0)**, is the law the
whole architecture rests on: read it before anything that touches settlement.

**Part 4 is PROPOSED** — designs held, open or declined. None of it is the
language: it may contradict itself, and nothing in it is implemented. It comes
last so that nothing in it is read as a ruling.

Anchors (`[[C-`…`]]`, `[[T-`…`]]`) pair with `doc:` pointers in the source.
Nothing checks the pairing at the moment, and no check could show that this
prose is *true*; only `verify:` blocks are immune to rot.

---

## The vocabulary

Three groups. Every modifier belongs to exactly one, except `yield`, which is
its own case and has a section below.

### Descriptors — how does the slot behave?

One word, and one per field.

| | E | C | W | |
| --- | --- | --- | --- | --- |
| *bare* | ✓ | ✓ | ✓ | a native field |
| `ply` | ✗ | ✓ | ✓ | internal mockable state |
| `let` | ✗ | ✗ | ✓ | internal strict state |
| `pin` | ✓ | ✗ | ✓ | public strict state (was `var`, which still compiles while it retires) |
| `get` | ✗ | ✓ | ✗ | internal mockable constant |
| `const` | ✗ | ✗ | ✗ | internal strict constant — ONE value for the hierarchy |
| `set` | ✗ | ✗ | ✗ | the same cell, one value PER CLASS: a subclass may declare its own (C-SHADOW) |
| `azo` | ✓ | ✓ | ✗ | public mockable constant |
| `enum` | ✓ | ✗ | ✗ | public strict constant |

E is enumerable — it shows in `Object.keys`, spread and JSON. C is
configurable, which makes a field PLIABLE: a test can delete or redefine it to
mock it. A LOCKED field refuses both. W is whether a write lands. A bare field
is a native field — enumerable, configurable, writable — on both faces, exactly
as `x = 1` is in JavaScript.

Accessors take no descriptor. A method takes one, and it describes the method's
slot: `static const connect()` cannot be replaced, `enum ping()` is visible to
enumeration.

### Temporal modifiers — when does the value arrive, and who waits?

One lane per field, spelled with one word or two. **None of these emit.**

| lane | waits? | physics |
| --- | --- | --- |
| `setup` | yes | halts here until it resolves |
| `setup async` | yes | a contiguous same-face run fires together; writes land FCFS; one barrier at the run's end |
| `defer` | yes | starts where it stands, assigns at the local tail in source order, once every other field of its level is defined (fans started, not landed) |
| `defer async` | yes | starts where it stands, waits at the tail, assigns as each lands |
| `async` | no | detached; the field updates whenever it lands |
| `async setup` | no | detached, but each STARTS only after the previous one in its lane resolves |
| `delay` | yes | assigns at `new.target`'s tail — the bottom of the whole chain. NOT YET BUILT |

`yield` is also a lane — see below.

**A LANE THAT WAITS REQUIRES THE STAR.** `class*` on the class face,
`constructor*` on the instance face. The star answers *does this class block*
by looking, and it installs the iteration protocol.

The lane slot is CONTIGUOUS: a descriptor may sit before it or after it, never
between the halves of a two-word lane. `defer const batch x` is refused.
Descriptor against lane is a tie — both orders compile to the same bytes and
neither is canonical.

### Structural modifiers — `try` and `memo`

Neither is a lane. Neither changes when a value arrives.

`try` decides what happens on failure. On a FIELD it wraps one evaluation and
the field lands `undefined`. On a METHOD it wraps the body, and every call is
soft for the life of the function. On a detached lane it is a no-op, because a
detached field is already soft.

`memo` decides the ORDER of writes: assignment follows source order even when
values resolve out of order, per lane. An early result is cached and written in
its turn, and the cache drains in one synchronous pass. It never moves when work
starts. It is a no-op where the lane is already strict, so `memo defer` is
`defer`.

### The binding — `=` or `as`

Not a modifier: the operator between the name and the value.

    let token  = auth();      // the promise auth() returns
    let token as auth();      // what that promise produces — construction waits

`=` binds a field to its expression's value as written, exactly as in
JavaScript. `as` binds it to what the expression PRODUCES. It is the `= await`
pair in one word, and it implies the blocking lane when no other lane is
named — so `let token as auth()` is `setup let token = await auth()`.

## `yield` — the one word in both groups

`yield` is a temporal modifier and a structural one at once, which is why it sits
outside the tables above.

**As a lane, `yield == setup`.** Both block; the field halts where it stands
until the value resolves. `yield setup` is therefore `yield` — `setup` adds
blocking to a lane that already blocks, so it is a no-op there, accepted the way
`memo defer` is accepted.

**As a structural modifier, `yield` EMITS.** It is the only thing in the language
that does. The value passes through to the field and into the settlement stream
at the same time, and `el[METADATA]` logs explicit yields and nothing else. That
is the entire difference from `setup`, and it is why the relation is `==` rather
than `===`.

    setup const schema = await net.get('/schema');   // blocks, silently
    yield const schema = await net.get('/schema');   // blocks, and streams the value
    yield 'connecting';                              // emits, binds nothing

`yield` blocks, so it takes the star like any other waiting lane. It is refused
on accessors: a getter runs on demand, long after settlement, so there is no
stream left to emit into.

## Reserved words

Words the superset takes in a class body. None may be used as a field name where
it would sit in the column.

**Live** — `let`, `const`, `enum`, `yield`, `setup`, `setup async`, `defer`, `async`,
`try`, `memo`, `static`, `get`, `set`, `mixed`, `iterable`, `untracked`, `using`.

**Reserved, not yet built** — `delay` (the leaf tail, one word for what was
spelled `defer join`), `watch`, `latch`, `join`. Each is refused BY NAME
rather than read as a field name, so a declaration using one fails at the
declaration instead of quietly minting a property.

**Retiring** — `layer`, `vsync`, `bsync`. All three still compile and all three
mean `setup`.

**Alias** — `synch`, which means `sync` and nothing else. It carries no
information the canonical spelling does not; it exists because it amuses its
author, and it is never written in this document or the suite. `setup` is accepted on a field and at the class head, where `setup class*` is
`class*`.

### `enum` — two meanings, one word

As a DESCRIPTOR it is the visible constant: enumerable, sealed, and the setter
throws — the LOCKED public constant. `azo` is the pliable one, `pin` the
writable public field, and a bare field is public just as it is in JavaScript.

At TOP LEVEL the same word declares an enum TYPE. Where the left says `enum` and
the right is ENUM-SHAPED — `{ A, B }`, shorthand properties, no colon — it is
both at once, and the compiler writes `new Enum(RHS)` so that `x instanceof Enum`
answers. That syntax space is free: the literal is valid JavaScript but reads
bindings a class body does not have, so it could only ever have thrown.

The type half is NOT yet built. The descriptor half ships alone; `enum X = { A, B }`
is accepted today as a descriptor field holding an ordinary object literal.

`enum` is a future reserved word in ECMAScript, so it can never collide with a
user's identifier.

### `package` and `using package`

`package Name { … }` declares a named unit; `using package Name;` consumes one.
Inside a package body, `public` marks the exported face and precedes `static`,
as visibility does in Java and TypeScript. `public` is refused in a plain class.

# Part 0 — Syntax guide

Every form below compiles today. This is the reference; the rulings that follow
say why each is shaped as it is.

## 0.1 At a glance

One class, both faces. Every line here compiles.

```js
export default mixed class* Engine extends Instance {

    // ================================================================
    // STATIC LANES — the class face. Settles once, before any instance.
    // ================================================================

    static try async const superset = await new Toolchain({ version: '2026-09-07' });

    static const VERSION = 3;                            // no await, no lane
    static setup const schema = await net.get('/schema');// halts the class face
    static let   token  as auth();                   // halts too — `as` unwraps, no lane word
    static async const region = await geo.detect();      // nobody waits
    static defer const cluster = await dns.resolve();    // starts here, joins at the tail

    static try setup const policy = await net.get('/policy');   // soft: undefined on failure
    static try async let  worker = await pool.best();           // soft, reassignable

    static get health() { return net.ping(this.worker); }       // on demand, every access
    static async get peers() { return await net.discover(); }   // accessors have no lane

    // ================================================================
    // INSTANCE LANES — per element. Settles during construction.
    // ================================================================

    id      = crypto.randomUUID();                       // plain
    token   = await auth();                              // setup, implicit
    ?ping   = await beacon();                            // fan — nobody waits
    &db     = await open();                              // acquire — joins at the tail

    setup  const baseline = await disk.snapshot();        // sealed once it settles
    async let  pending   = await disk.journal();         // reassignable later
    try setup const config = await disk.config();         // soft AND sealed

    yield 'connecting';                                  // emits into the stream
    try yield const handshake = await net.hello(); // soft, emitted, sealed

    { users, metrics } = await dash();                   // destructured onto the instance
    rows[]*            = await stream();                 // drained
    cached             = try await down() ?? 'FALLBACK'; // soft, with a tail

    await warm();                                        // a gate — binds nothing
    defer await prefetch();

    mixed constructor*(){ yield super(); }
}
```

`static try async const x = await y()` reads left to right as one sentence:
**on the class face, tolerating failure, without anyone waiting, bind once and
seal it, to the settled result of y.** Five orthogonal decisions, five words,
each meaning exactly one thing, in a fixed order:

```
    FACE   ACTION       STATE
    static try yield    async const socket = await wss.connect();
    static     yield    async const stream = await api.stream();
    static try          setup const schema = await api.get();
    static              setup get   profile() { … }
    static                    const version = '1.0.0';

[static] [try] [memo] [lane] [ply|let|pin|get|set|const|azo|enum] name
  │     │         │       │      │      │
  │     │         │       │      │      └─ how is it stored, or accessed?
  │     │         │       │      └─ who waits for it?
  │     │         │       └─ assign in SOURCE order, or in arrival order?
  │     │         └─ which face — the class, or the element?
  │     └─ does it also emit to the stream?
  └─ does failure throw, or yield undefined?

lane ::= yield | setup | async | batch | defer   — simple
       | defer async | defer join           — compound, one slot, one unit
       | defer async | async setup           — compound, one slot, one unit
       | (omitted)                          — the blocking lane, under `'use implicit'` or after `as`

binding ::= '=' expr                       — the value as written
          | 'as' expr                      — what it produces: unwrapped, and blocking

  yield is not usable with accessors: one runs on demand, long after
  settlement, so there is no stream left to emit into.
```

Any subset, in that order, is a legal field. Two slots compose rather than
merely coexisting: a COMPOUND LANE is two words filling the single lane slot,
and `memo` modifies the lane it precedes rather than standing alone. Both are
ruled on in Part 3. `static` and `try` commute — the emit is byte-identical
either way — but the written order above is the canonical one.

## 0.2 Fields

```js
mixed class* Tab extends Div {
    n = 1;                                  // plain — no suspension
    cfg         = await load();             // spine: the face waits (setup is implicit)
    setup   cfg2 = await load();             // the same, said twice
    async  log  = await send();             // fan: nobody waits
    ?log        = await send();             // fan, shorthand
    &db         = await open();             // acquire: starts here, joins at the tail
    @cfg        = await load();             // spine, shorthand
    static setup cfg = await load();         // the class face
    setup Δcount = await n();                // a tiered name
    setup total  = (await a()) + (await b()); // composite RHS — one suspension
}
```

### 0.2.1 `as` — bind to what it produces

```js
mixed class* Tab extends Div {
    let   token  as auth();                   // blocks; the value, writable
    const schema as net.get('/schema');       // blocks; the value, sealed
    enum  region as geo.detect();             // blocks; the value, visible
    const task   =  fetchTask();              // the promise itself — `=` is raw

    { users, metrics } as dash();             // destructure what dash() produces
    rows[]*            as stream();           // drain what stream() produces
    try let profile    as api.profile();      // soft
    static let config  as load();             // the class face

    mixed constructor*(){ yield super(); }
}
```

`as` binds a field to what its right-hand side produces. It is `= await` in one
word, and it implies the blocking lane, so a suspending field no longer has to
name one: `let token as auth()` compiles to exactly what
`setup let token = await auth()` does. Patterns, comprehensions and static
patterns bind the same way.

`=` never unwraps on its own, and that is the escape hatch. To hold a promise
rather than its value, bind with `=` — nothing has to be spelled to opt out,
because unwrapping was never the default.

The choice is made by the token, not by what a function happens to return, so
a helper changing from setup to async cannot silently change what a class waits
on. Only the outermost value unwraps: `x as a() + b()` adds two promises, and
combining them still needs an `await` on each operand. Beside another lane,
`as` is a no-op — every lane already unwraps. Ruled at `C-AS`.

## 0.3 The three faces

A class has two faces of its own and inherits a third. `static` chooses between
the first two; `super()` is the link to the third.

    mixed class* Engine extends Instance {
        static const schema = await net.get('/schema');   // the CLASS face
               const config = await disk.config();        // the INSTANCE face
        mixed constructor*(){ yield super(); }            // the SUPER link
    }

**The class face settles once**, before any element exists. **The instance face
settles per element**, during construction. **The super link** decides how this
class's settlement joins its parent's.

### 0.3.1 The faces do not cross

Nothing past a blocking field is defined until that field settles, top-down, on
both faces — but the two faces run that law separately. A blocking static does
not defer instance fields, and a blocking field does not defer statics.

    class C extends Div { static setup cfg = await p(); n = 1; }
        n is immediate — the blocker is on the other face

### 0.3.2 The super link — three joins, one word each

    setup constructor(){ await super(); }    // JOIN — wait for the parent
    mixed constructor(){ yield super(); }    // AGGREGATE — fold into the parent
    async constructor(){ void  super(); }    // NO JOIN — start it, drop the result

`void` is the JavaScript operator doing its ordinary work: the parent still runs,
only its result is discarded. Nothing is skipped and nothing is stranded.

`await super()` is not an exception to the settlement law, it IS the law: `this`
is in TDZ until `super()` returns, so an awaited super is a blocking field
sitting above every instance field. That is why every field of a `setup class`
settles together — the synthesized constructor blocks above all of them. A
`mixed` link aggregates instead of blocking, so its fields split at the first
blocker of their own.

### 0.3.3 What each parent will accept

Two rules, and the table falls out of them. A child may not DROP a join its
parent mandates; a child may not AWAIT a join its parent refuses.

| | parent `setup` | parent `mixed` | parent `async` |
| --- | --- | --- | --- |
| `await super()` | ok | ok | refused — nothing to await |
| `yield super()` | ok | ok | refused — nothing to aggregate |
| `void super()` | refused | refused | ok — nothing to strand |
| bare `super()` | refused | refused | ok |

Only a declared `setup` parent mandates a join, so `mixed` accepts every link.
A declared `async class` does not waive conservation: waiving it would make the
parent's settled half permanently unobservable through the child.

Ruled at 3.10 and 3.14.

## 0.4 `'use implicit'` — the lane you do not write

    mixed class* Tab extends Div {
        'use implicit';
        const   db    = await open();      // blocking. the lane is assumed
        async const j = await journal();   // a departure still says so
    }

First member of the class body, nothing before it. With the directive, a
suspending field that names no lane gets the BLOCKING one, so `const db =
await open()` is exactly `setup const db = await open()` — it blocks, and it does
NOT emit. Reaching the stream is always written out. Without it the same
line is refused, naming the lane as the fix.

It exists because the blocking lane is the common case, and a word written on
almost every line stops being read. Every DEPARTURE — `async`, `defer`,
`setup async`, `defer async` — is still written out, so the lanes left on the page
are exactly the ones that mean *nobody waits* or *joins at the tail*.

The directive is per class body and does not inherit; a subclass says it again
or does without. It is stripped from the emit, since a verbatim
`'use implicit';` would define a property of that name. Ruled at 2.4.22.

`as` reaches the same place without a directive. `const x as f()` is legal in
any class, because the unwrap is said at the binding rather than inferred from
the right-hand side.

## 0.5 `try` — two placements

`try` is both a DECLARATION modifier (left of the name, softening the whole
initialiser) and a UNARY OPERATOR (right of the `=`, binding like `void` and
`typeof`). Where the initialiser IS one operand they emit identical code.

```js
try x = risky();                         // LHS — soft, no suspension
try x = await load();                    // LHS — soft, suspends
try x = await a() + await b();           // LHS covers the whole initialiser
try ?x = await send();                   // lanes compose
static try x = await load();             // face, then hazard, then the slot

x = try parse(raw);                      // RHS — the operand is parse(raw)
x = try await load();                    // the operand is `await load()`
x = try await load() ?? CACHED;          // the tail is OUTSIDE, by precedence
x = try (a() + b());                     // parens widen the operand

try x = { await a() + await b() };       // braces = a BLOCK BODY
try x = { s(); return v(); } catch (e) { … };   // a clause needs braces
x = try await { … } finally { … };
x = await { … };                         // ✖ await never introduces a block
x = try await load() catch { … };        // ✖ a clause needs a block
```

`try` binds like `void` and `typeof`, and additionally takes a block.

```js
x = try parse(raw);                      // soft, no suspension
x = try await load();                    // soft, suspends — the operand is `await load()`
x = try await api.load(id);              // member/call chain is part of the operand
x = try await load() ?? CACHED;          // the tail is OUTSIDE, by precedence
x = try (a() + b());                     // parens widen the operand
x = try { … };                           // a block operand
x = try await { … } catch (e) { … };     // clauses attach to the BLOCK
x = try await { … } finally { … };
x = await { … };                         // ✖ await never introduces a block
x = try await load() catch { … };        // ✖ a clause needs a block
```

Braceless is the terse form: the await operand, soft, and nothing after it.
One word toggles hard to soft, with no change of punctuation.

```js
setup x = await load();                  // hard — a rejection rejects the element
setup x = try await load();              // soft — undefined on failure
setup x = try await api.load(id).length; // the operand carries its member/call chain
setup x = try await (a ? b() : c());     // a parenthesised group is one operand

setup x = try await load() ?? 'CACHED';  // ✖ a tail needs a block
setup x = try await load() catch { 1 };  // ✖ a clause needs a block
```

Braceless has no delimiter, so a tail would sit INSIDE the try —
`try await boom() ?? 9` gave `undefined`, because the throw took the `??` with
it, while the braced form gave `9`. One rule covers clauses and tails alike:
**anything after the expression needs a block to attach to.**

## 0.6 Braced blocks — `try await { … }`

```js
setup x = try await { load() };                          // soft: undefined if it throws
setup x = try await { const a = await f(); return a+1; }; // multi-statement, explicit return
setup x = try await { load() } ?? 'CACHED';              // any operator composes after it
setup x = try await { load() } || 'was falsy';
setup x = try await { list() }?.length;
setup x = try await { probe() } ? 'live' : 'degraded';
setup x = try await { n() } + 1;
setup x = try await { load() } catch (e) { return CACHED; };
setup x = try await { load() } catch (e) { CACHED };     // single expression is the value
setup x = try await { load() } catch { CACHED };         // 0-arg catch
setup x = try await { load() } catch (e) { throw e; };   // rethrow → stays HARD
setup x = try await { load() } finally { release(); };   // finally alone keeps the soft default
setup x = try await { load() } catch { C } finally { done(); };
setup x = await ({ a: 1 });                          // an object needs parens, as in arrow bodies
setup x = await { load() };                          // ✖ `await` never introduces a blockness punctuation
```

## 0.7 Accessors — `[try] [lane] get / set`

A getter and a setter are not fields. They run on demand, long after settlement,
so the field column does not apply: there is no `yield` slot (no stream to emit
into) and no lane on a GETTER (nothing to schedule — a getter runs on the
caller's stack and cannot pause it).

```js
async get peers() { return await net.discover(); }   // returns a promise; the caller awaits
try async get health() { return await ping(); }      // soft: undefined on failure
static async get region() { return await geo(); }    // the class face
untracked get raw() { return this.#slot; }           // reads inside register no dependency

setup  set save(v)  { this.local = v; await disk.put(v); }   // FIFO — every write, in order
defer set query(v) { this.local = v; await api.search(v); } // queue-latest — newest wins
async set log(v)   { this.last = v; await beacon(v); }      // fan — all at once
try defer set draft(v) { this.local = v; await save(v); }   // soft remainder

setup get x() { … }                                   // ✖ a getter cannot be scheduled
yield set x(v) { … }                                 // ✖ settlement is over; no stream
```

Inside any member body, a local binding can hold the lock:

```js
async m() {
    let x = engine.search;         // 0ms — whatever the getter returned
    let setup y = engine.search;    // halts this frame; y is the resolved value
    let async y = e;               // ✖ that is just  let y = e
    let defer y = e;               // ✖ a local binding has no settlement tail
}
```

**A setter's body splits at the first top-level `await`.** Everything before it
is the synchronous prefix and runs on every assignment, immediately — that is
your optimistic update. Everything after enters the lane. A getter has no lane
because it cannot suspend its caller; the caller awaits the promise instead.

## 0.8 Destructuring fields

```js
{ users, metrics } = await fetchDashboard();     // binds both onto the instance
[head, tail]       = await pair();               // array pattern
{ total: count }   = await stats();              // alias binds `count`, not `total`
{ a = 1 }          = await maybe();              // a default
try { a, b }       = await mayFail();            // soft: every name lands undefined

{ a: { b } }       = await f();                  // nests — the inner name is rewritten
?{ a, b }          = await f();                  // a fan: destructures inside its .then
&{ a, b }          = await f();                  // an acquire: destructures at the join
yield { a, b }     = await f();                  // emits the payload, then binds
static { a, b }    = await f();                  // a field — `static { … }` alone is a block
```

The pattern is a POST-TRANSFORM over whatever the row emitted, keyed off the
assignment boundary, so every lane keeps its own shape.

## 0.9 Cached fields — `let`, `const` and `enum`

```js
static try async const schema = await network.fetch('/api/schema');
static try async let  worker = await cluster.findBestNode();

try setup  const baseline = await disk.readSnapshot('latest');
try       const snapshot as disk.readSnapshot('latest');   // the same field, no lane word
try async let  pending   = await disk.readJournal('pending');

const limit = 50;                                // no await, no lane needed

let const x = 1;                                 // ✖ one or the other

static try { risky(); }                          // a soft static block
static try { risky(); } catch (e) { log(e); }    // the author's catch is kept
```

The column is `static · try · yield · memo · lane · [ply|let|pin|get|set|const|azo|enum] · name`. A
cached field that SUSPENDS must say so — name its lane, or bind with `as`.
`const x = await f()` is refused, because it differs from `const x = f()` by
one word that is easy to miss; `const x as f()` says the same thing with a
word that is not. `const` seals on its settling write and is structurally immutable — a
later assignment throws `TypeError: Assignment to constant field`, `delete`
fails, and the accessor cannot be replaced. `let` emits as a bare field and is
there for symmetry. `enum` is the third descriptor: visible to enumeration and
refusing the write.

## 0.10 Comprehensions

```js
setup rows[]* = await stream();      // drain into an array
setup map{}*  = await pairs();       // drain into an object
items[]*     = source();                // spread, no suspension
```

## 0.11 Await gates — bind nothing

Three independent modifier slots, in this order: `static` picks the face, `try`
softens, `defer` moves the join to the tail. All eight combinations are legal.

```js
await gate();                        // suspends here, binds nothing
defer await gate();                  // starts NOW, joins at the tail
try await gate();                    // soft — a failure does not reject the element
try defer await gate();              // soft AND deferred
static await gate();                 // the class face
static defer await gate();
static try await gate();
static try defer await gate();

await x = gate();                    // ✖ a gate binds nothing — to bind, write `x as gate()`
setup await gate();                   // ✖ a gate admits `defer`, not a lane word
```

`try defer await` softens the JOIN, not the start — the work beginning cannot be
the thing that fails. The soft forms are honoured on BOTH faces (T-SOFTFACE).

### 0.11.1 `await this` — a sequence point

```js
async let peers   as discover();          // a fan — nothing waits for it
async let pending as journal();
await this;                               // every fan above has landed
const plan as build(this.peers, this.pending);
```

A gate waits for its own expression. `await this` waits for every FAN declared
above it — `async` fields, waterfalls, `memo async`, async drains — so a field
below can depend on background work above. It is legal on both faces
(`static await this`) and soft with `try`. A rejected fan has already written
its sentinel, so it cannot hold construction.

`defer await this` is refused: `defer` starts a gate before anything below it,
which here means before any fan exists, so it would wait on nothing.

A fan that never settles — a subscription, an endless stream — holds
construction at the next `await this`. Place it where the wait belongs.

## 0.12 The chain

```js
setup  class  R extends Div { setup  constructor(){ await super(); } }   // join
mixed class* S extends Div { mixed constructor(){ yield super(); } }   // aggregate
async class* T extends Div { async constructor(){ void  super(); } }   // no join
mixed class* U extends Div { constructor(id){ super(); } }             // inherits the class grain
globalThis.V = await setup class* extends Div { static setup cfg = await load(); };
```

## 0.13 Structure

```js
class* Tab extends Div { }        // iterable faces, both
class* extends Div { }          // anonymous
constructor*(){ }               // iterable instance face
untracked probe(){ }            // reads live, registers no edges
untracked let cache = {};       // a cell nobody can subscribe to (C-UNTRACKED)
Δcount$                         // ✖ double-sided sigils are banned
```

## 0.14 Template apps

```html
<template app="Scrollbar">
    <style>:host { display:block; }</style>       <!-- shadow DOM -->
    <main><div><span>hi</span></div></main>       <!-- structure -->
    <script>                                      <!-- inert: never parser-run -->
        mixed main class Scrollbar extends Instance { … }
        export default mixed class Scrollbar extends Instance { … }   // same thing
    </script>
</template>
```

The script needs no `type="text/instance"` — the app strips scripts from the
imported fragment before appending, so the parser never runs them. It compiles
the text, names it after the app, and evaluates it with `app`, `host`, `shadow`
and `Instance` in scope.

**The app IS its own source file.** `//# sourceURL=Scrollbar.js` names the
compiled text, so a stack frame reads `Scrollbar.js:1` rather than
`<anonymous>`. Errors are not swallowed: a refusal in an app script flows
natively, so a SyntaxError arrives as one rather than as a log line.

**`extends Instance` already synthesizes the element** — no
`customElements.define`, no hyphen requirement. `metaFor(tag, display)` mints a
per-name Meta, `rebase` splices it into both chains, and `CUSTOM_TAGS` registers
the lower-cased tag. `new Scrollbar()` gives `<scrollbar></scrollbar>`
with `tagName` `SCROLLBAR`. (`document.createElement('scrollbar')` is still an
`HTMLUnknownElement`, so the `<main>` swap must CONSTRUCT the class rather than
rename the tag.)

### 0.14.1 The main class [[C-MAINCLASS]]

Two spellings, both marking the class that owns the app's `<main>` element:

    mixed main class Scrollbar extends Instance { … }
    export default mixed class Scrollbar extends Instance { … }

`main` is a structural modifier, collected in the same backward walk as
`iterable` and `untracked`. `export default` is STRIPPED from the emit, because
an app script is not a module and would be a SyntaxError as written.

[OPEN] the `<main>` hot-swap itself, and what precedence the class's structure
takes over markup inside `<main>`.

## 0.15 Top-level yield — the settlement stream

```js
mixed class* Conn extends Div {
    yield 'connecting';                 // emit, bind nothing
    yield db = await open();            // emit AND bind — a tee
    try yield user = await auth();      // soft: on failure, nothing is emitted
    static try yield defer x = await f();
    x = yield await f();                // the same as `yield x = await f()`
    yield* stream();                    // delegate a setup iterable into the stream
    yield* await asyncStream();         // await the source, then delegate
    mixed constructor*(){ yield super(); }
}

for await (const step of new Conn()) { … }

yield 1;                                // ✖ without `class*`: a value to nobody
```

The modifier column is `try · yield · static · lane · name`. Emissions arrive in
source order and buffer until drained, so iterating late loses nothing; the
stream ends when settlement does.

## 0.16 Emitted names

Intermediate bindings are minted from a table, never spelled inline:

```
ødefer_db   øbatch_x   øvalue_x   øarray_rows   øiterator_rows    the word, and the name it stands for
ødefer0     ølabel1    øerror0                                    a gate, a goto level, a catch: a number
øiterator_rows_2                                                  a second of one word for one name counts up
```

The settlement generator carries the class name, so a stack frame reads
`at øUserProfile` rather than `at <anonymous>`; an unnamed class gets
`øanonymous_1`, `øanonymous_2` per file, and the static face is `ø<Name>_Static`.
The name is in the source, so it survives minification.

## 0.17 Doors

A door reads a field as a HANDLE rather than a value. There are three
disciplines, each with a shallow and a deep form.

```js
el.Φ.count()      el.ΦΦ.count()          // atomic  — union, consensus
el.Δ.count()      el.ΔΔ.count()          // proxy   — shallow, deep
el.Σ.count()      el.ΣΣ.count()          // signal  — shallow, deep
el.ψ                                      // the per-receiver door
```

`Φ` and `ΦΦ` are canonical. `$`, `$$` and `ø` are aliases and resolve to the
SAME door object, so `el.Φ === el.$`.

Through a door, a field has three spellings, and they never depend on what the
field holds at the moment (C-OPERAND):

```js
el.Φ.total = 7;                 // ASSIGN — store 7; over a formula, the formula goes
el.Φ.total((Φ, unit) => …);     // CALL WITH A FUNCTION — install a formula
el.Φ.total(99);                 // CALL WITH A VALUE — feed the formula its operand;
                                //   on a plain field, write 99
el.Φ.total();                   // read
```


## 0.18 Structured goto

```js
*drive(events) {                       // goto yield needs a generator
    let i = 0;
    start: {
        if (done) goto finish;
        goto continue;                 // next sibling
    }
    retry: {
        outer: { inner: { goto super; } goto return; }   // restart the parent
        goto break;                    // leave this level
        goto break super;              // leave the parent
        goto start;                    // a named block
        goto continue start;           // the block after `start`
        goto yield;                    // suspend, resume here
        goto yield continue;           // suspend, resume at the next block
    }
    finish: { goto return; }           // leave every level (`goto void` is an alias)
    return i;
}
```

`goto` alone is `goto this` — restart this block. Every block ends in a
terminator; there is no implicit fall-through. `goto continue` is the form for
`goto continue`.

## 0.19 Declaration relations — `is` and `implements`

`is` is the CONTRACT relation and belongs to interfaces alone. `extends` is real
prototype inheritance, and belongs to classes and packages — both emit real
classes. `implements` is conformance, and works on either.

```js
interface IBase  { id = Number; }
interface ICart is IBase { qty = Number; }          // inheritance
package  BaseLog { log(m){ … } }
package  FileLog extends BaseLog { log(m){ super.log(m); } }
package  Money implements IFormat { format(v){ … } }
class    Cart extends Div implements ICart { … }    // extends a CLASS, implements a CONTRACT

interface IBad extends IBase { }                    // ✖ an interface uses `is`
package  PBad  is BaseLog { }                       // ✖ a package uses `extends`
```

## 0.20 Packages — `using package`

A class **is** something, an interface **requires** something, a package
**provides** something. A package is never instantiated: its methods are copied
onto the host, and its fields and constructor run against the host's receiver.

```js
package Resizable {
    width  = 300;                                    // fields, with defaults
    height = 200;
    resize(w, h) { this.width = w; this.height = h; }
    get area()   { return this.width * this.height; }
}

package Sized extends Resizable {                    // a real prototype chain
    constructor(w, h) { this.width = w; this.height = h; }   // optional
}

package Fetcher {
    data = null;
    async constructor(u) { this.data = await remote(u); }
}

package Money implements IFormat {                   // contracts, as on an interface
    format(v) { return '$' + v.toFixed(2); }
}
```

**The manifest** — a package's public static face, and the npm story:

```js
package AcmeUI {
    public static get manifest() {
        return { manifest: 1, name: '@acme/ui', version: '2.0.0',
                 exports: { '.': './index.js' } };
    }
}
```

`public` is erased and the getter is emitted verbatim, so `AcmeUI.manifest` is a
real property — readable with no runtime, inherited, overridable with
`super.manifest`. The body must RETURN AN OBJECT LITERAL, because package.json is
JSON and npm reads it to learn how to LOAD the module. `manifest: N` desugars to
`manifest_version`, defaults to 1, and is consumed rather than emitted. The class
name is a JS binding; the registry name lives in `name`, and they need not meet.
`compile()` always exposes `result.packages`; `{ manifest: path }` writes it, in
Node, idempotently.

**Four using-forms** — two independent axes, as on a field:

```js
mixed class Panel extends Div {
    using package Resizable;                    // immediate, hard
    using package Sized(1920, 1080);            // with arguments
    try using package Analytics('UA-123');      // immediate, soft
    await using package Fetcher('/api');        // suspends, hard
    try await using package Optional('/x');     // suspends, soft

    label = 'panel';                            // host fields come after
    mixed constructor(){ yield super(); }
}

using Logger;                                   // ✖ `using` must name a package
```

Packages are declared at the **top** of the class body and run immediately after
`super()`, before any field, top to bottom. Host declarations shadow a
package's. A setup package runs inline; an async one starts there and is joined
after the partition, because the pre-partition region cannot suspend.

## 0.21 Interfaces

```js
interface IERC { }                       // an empty abstract base -> class IERC { }

interface IBase {
    id  = Number;
    static ver = Number;
}

interface ICart is IBase {
    qty   = Number;
    tag   = [String, Number];            // a union — either token satisfies
    label = String;
    anything;                            // presence only, no type
    setup cfg = Object;                   // a grain requirement
    subtotal(): Number;                  // a method, with a return type
}

mixed class* Cart extends Div implements ICart, IOther {
    id = 0; qty = 0; tag = 'x'; label = 'L'; anything = null;
    static ver = 1;
    setup cfg = await load();
    subtotal(){ return this.qty; }
    mixed constructor(){ yield super(); }
}
```

Type tokens: `Number String Boolean Symbol BigInt Function Object Array Date
Map Set Promise RegExp`, or another interface name.

---

# Part 1 — Output

How each form compiles. Every block below is real compiler output, not a
sketch: the left is what you write, the right is what runs.

## 1.1 Fields — the lanes

**a plain field**

```js
class Tab extends Div { n = 1; }
```

```js
class Tab extends Div {
    constructor(...args) {
        super(...args);
        this[Symbol.new](function* øTab() {
            this.n = 1;
        });
    }
}
```

**setup (implicit)**

```js
mixed class Tab extends Div { n = await load(); mixed constructor(){ yield super(); } }
```

```js
class Tab extends Div { // @mixed
    constructor() { // @mixed
        super(); // @yield
        this[Symbol.new](function* øTab() {
            ø.pending(this, 'n'); // @seed
            yield (yield);                    // @partition
            this.n = yield load();
        });
    }
}
```

**fan**

```js
mixed class Tab extends Div { ?n = await send(); mixed constructor(){ yield super(); } }
```

```js
class Tab extends Div { // @mixed
    constructor() { // @mixed
        super(); // @yield
        this[Symbol.new](function* øTab() {
            ø.fan(this, 'n', send());
            yield (yield);                    // @partition
        });
    }
}
```

**acquire**

```js
mixed class Tab extends Div { &n = await open(); mixed constructor(){ yield super(); } }
```

```js
class Tab extends Div { // @mixed
    constructor() { // @mixed
        super(); // @yield
        this[Symbol.new](function* øTab() {
            const ødefer_n = open(); // @defer-start
            ø.pending(this, 'n'); // @seed
            yield (yield);                    // @partition
            this.n = yield ødefer_n;
        });
    }
}
```

## 1.2 `try` — both placements

**RHS operator**

```js
mixed class Tab extends Div { n = try await load(); mixed constructor(){ yield super(); } }
```

```js
class Tab extends Div { // @mixed
    constructor() { // @mixed
        super(); // @yield
        this[Symbol.new](function* øTab() {
            ø.pending(this, 'n'); // @seed
            yield (yield);                    // @partition
            let øvalue_n;
            try { ølabel_n: { øvalue_n = yield load(); } } catch (e) { øvalue_n = undefined; }
            this.n = øvalue_n;
        });
    }
}
```

**RHS, no suspension**

```js
class Tab extends Div { n = try parse(raw); }
```

```js
class Tab extends Div {
    constructor(...args) {
        super(...args);
        this[Symbol.new](function* øTab() {
            let øvalue_n;
            try { ølabel_n: { øvalue_n = parse(raw); } } catch (e) { øvalue_n = undefined; }
            this.n = øvalue_n;
        });
    }
}
```

**RHS, with a tail**

```js
mixed class Tab extends Div { n = try await load() ?? C; mixed constructor(){ yield super(); } }
```

```js
class Tab extends Div { // @mixed
    constructor() { // @mixed
        super(); // @yield
        this[Symbol.new](function* øTab() {
            ø.pending(this, 'n'); // @seed
            yield (yield);                    // @partition
            let øvalue_n;
            try { ølabel_n: { øvalue_n = yield load(); } } catch (e) { øvalue_n = undefined; }
            this.n = øvalue_n ?? C;
        });
    }
}
```

**LHS modifier**

```js
mixed class Tab extends Div { try n = await load(); mixed constructor(){ yield super(); } }
```

```js
class Tab extends Div { // @mixed
    constructor() { // @mixed
        super(); // @yield
        this[Symbol.new](function* øTab() {
            ø.pending(this, 'n'); // @seed
            yield (yield);                    // @partition
            let øvalue_n;
            try { ølabel_n: { øvalue_n = yield load(); } } catch (e) { øvalue_n = undefined; }
            this.n = øvalue_n;
        });
    }
}
```

**a block operand**

```js
mixed class Tab extends Div { n = try await { load() } catch { C }; mixed constructor(){ yield super(); } }
```

```js
class Tab extends Div { // @mixed
    constructor() { // @mixed
        super(); // @yield
        this[Symbol.new](function* øTab() {
            ø.pending(this, 'n'); // @seed
            yield (yield);                    // @partition
            let øvalue_n;
            try { ølabel_n: {øvalue_n = yield load()} } catch (e) {øvalue_n = C}
            this.n = øvalue_n;
        });
    }
}
```

## 1.3 Gates — bind nothing

**a gate**

```js
mixed class Tab extends Div { a = await one(); await warm(); mixed constructor(){ yield super(); } }
```

```js
class Tab extends Div { // @mixed
    constructor() { // @mixed
        super(); // @yield
        this[Symbol.new](function* øTab() {
            ø.pending(this, 'a'); // @seed
            yield (yield);                    // @partition
            this.a = yield one();
            yield warm();
        });
    }
}
```

**deferred**

```js
mixed class Tab extends Div { a = await one(); defer await warm(); mixed constructor(){ yield super(); } }
```

```js
class Tab extends Div { // @mixed
    constructor() { // @mixed
        super(); // @yield
        this[Symbol.new](function* øTab() {
            ø.pending(this, 'a'); // @seed
            yield (yield);                    // @partition
            this.a = yield one();
            yield warm();                     // its start and its join are one line (C-REGISTER)
        });
    }
}
```

**soft**

```js
mixed class Tab extends Div { a = await one(); try await warm(); mixed constructor(){ yield super(); } }
```

```js
class Tab extends Div { // @mixed
    constructor() { // @mixed
        super(); // @yield
        this[Symbol.new](function* øTab() {
            ø.pending(this, 'a'); // @seed
            yield (yield);                    // @partition
            this.a = yield one();
            try { yield warm(); } catch (e) {}
        });
    }
}
```

## 1.4 Comprehensions

**drain an iterator**

```js
mixed class Tab extends Div { rows[]* = await stream(); mixed constructor(){ yield super(); } }
```

```js
class Tab extends Div { // @mixed
    constructor() { // @mixed
        super(); // @yield
        this[Symbol.new](function* øTab() {
            ø.pending(this, 'rows'); // @seed
            yield (yield);                    // @partition
            this.rows = yield* ø.drain((yield stream()));
        });
    }
}
```

**drain into an object**

```js
mixed class Tab extends Div { map{}* = await pairs(); mixed constructor(){ yield super(); } }
```

```js
class Tab extends Div { // @mixed
    constructor() { // @mixed
        super(); // @yield
        this[Symbol.new](function* øTab() {
            ø.pending(this, 'map'); // @seed
            yield (yield);                    // @partition
            this.map = yield* ø.drain((yield pairs()), {});
        });
    }
}
```

## 1.5 Structured goto

**a label machine**

```js
class Tab extends Div { *drive(){ let i = 0; start: { if (i > 2) goto done; i++; goto start; } done: { goto return; } return i; } }
```

```js
class Tab extends Div {
    *drive(){ let i = 0;
let ølabel1 = "start";
ølabel0: while (true) { switch (ølabel1) {
case "start": { if (i > 2) { ølabel1 = "done"; continue ølabel0; }; i++; { ølabel1 = "start"; continue ølabel0; }; }
case "done": { { break ølabel0; }; }
} }
 return i; }
}
```

## 1.6 Interfaces

**a contract**

```js
interface IBase { id = Number; }
interface ICart is IBase { qty = Number; }
```

```js
class IBase {
    id = Number;
}
class ICart extends IBase {
    qty = Number;
}
```

**a class implementing**

```js
interface ICart { qty = Number; }
mixed class Cart extends Div implements ICart { qty = 1; mixed constructor(){ yield super(); } }
```

```js
class ICart {
    qty = Number;
}
class Cart extends Div { // @mixed
    constructor() { // @mixed
        super(); // @yield
        this[Symbol.new](function* øCart() {
            this.qty = 1;
            yield (yield);                    // @partition
        });
    }
    static {
        this[Symbol.new](function* øCart_Static() {
            ø.implement(this, ICart);
        });
    }
}
```

## 1.7 Packages

**a package**

```js
package Sized { width = 300; constructor(w){ this.width = w; } resize(w){ this.width = w; } }
```

```js
class Sized {
    resize(w){ this.width = w; }
    static [Symbol.for('Instance.package')] = function (w) {
        this.width =  300;
        this.width = w;
    };
}
```

**using it**

```js
package P { a = 1; }
mixed class Tab extends Div { using package P; b = 2; mixed constructor(){ yield super(); } }
```

```js
class P {
    static [Symbol.for('Instance.package')] = function () {
        this.a =  1;
    };
}
class Tab extends Div { // @mixed
    constructor() { // @mixed
        super(); // @yield
        this[Symbol.new](function* øTab() {
            P[Symbol.for('Instance.package')].call(this);
            this.b = 2;
            yield (yield);                    // @partition
        });
    }
    static {
        this[Symbol.new](function* øTab_Static() {
            ø.mixin(this, P);
        });
    }
}
```

**the manifest**

```js
package AcmeUI { public static get manifest() { return { manifest: 1, name: '@acme/ui', version: '2.0.0' }; } }
```

```js
class AcmeUI {
    static get manifest() { return { manifest: 1, name: '@acme/ui', version: '2.0.0' }; }
    static [Symbol.for('Instance.package')] = function () {
    };
}
```

# Part 2 — Traps

## 2.1 Lexing

### 2.1.1 `/` is division after a value [[T-DIVISION]]

    x++ / 2        ← DIVISION. A postfix update completes a value.
    x = /2/g       ← regex

Two independently written scanners both opened a regex at `x++ /` and swallowed
to the next slash; the fix had to be written twice, which is why there is one
shared scanner now. `regexAllowed(prevValue, prevWord, prevPunct)` reduces to
`!prevValue` in every branch; the longer form is kept because it says why.

### 2.1.2 The escape branch must be tested first [[T-ESCAPE]]

    /[\]/]/g       ← the escaped ] stays INSIDE the class; the / is literal
    /\[a/          ← the escaped [ opens NO class

In `delimited`, the backslash branch precedes the closer and the class
branches. Reorder it and both of these break while ordinary regexes keep
working — which is why it is pinned rather than trusted.

### 2.1.3 `?.` before a digit is not optional chaining [[T-OPTCHAIN]]

    x?.5:y         ← conditional, then the number .5   → `x ? .5 : y`
    o?.p           ← optional chain                    → `o ?. p`

The punctuator walk carves this case out explicitly. Longest-match alone gets
it wrong.

### 2.1.4 Integer-like object keys iterate ASCENDING [[T-WIDTH]]

`PUNCT_BY_WIDTH` is keyed `{4:…, 3:…, 2:…}`, but `Object.keys` returns
`['2','3','4']` — the exact opposite of what longest-match needs. Written
naively, `a>>>=b` lexes as `>>` then `>=`. `PUNCT_WIDTHS` sorts descending once
at module scope for this reason alone.

### 2.1.5 Templates nest arbitrarily [[T-TEMPLATE]]

    `a${ `b${ c }` }`

A template holds interpolations hold templates. `skip` recurses into itself
rather than bouncing between two mutually recursive functions, because that is
what the grammar actually is.

### 2.1.6 Comments must be stripped before any text predicate [[T-COMMENT]]

    x = /* await */ 1;     ← must NOT be read as a suspending field

Downstream checks are text-level: `suspends()` tests `/\bawait\b/` on an
initialiser, the elision test is `/\bextends\b/`. Markers are `\uE000<id>\uE001`
— Private Use Area, neither identifier nor punctuator — so a marker is skipped
atomically, and one surviving to output is a loud failure (`assertClean`).

### 2.1.7 Member-granular recovery [[C-RECOVER]]

Under `{ recover: true }` a member-level refusal is COLLECTED rather than
thrown, and the walk continues — so one bad field costs one diagnostic instead
of the whole class, and later passes still run. Measured on a class with three
distinct faults: 1 diagnostic by default, 3 under recovery, file still emitted.

**A refused member is CUT, wherever it was refused** (RULED 2026-10-13). The
collected refusals above are the soft ones: checks that can name a fault and
still emit the member. Every other refusal cost more than its member. One raised
while the WALK was still reading the class escaped recovery altogether, and the
whole file became one comment; one thrown by a check cost the whole class, which
in a one-class file is the same thing. Now it is one rule:

- a refusal inside a member cuts that member. The walk resumes where the member
  ends — its `;`, or the line where ASI ends it, the walk's own boundaries — and
  a refusal from the checks or the emit compiles the class again without it;
- the class compiles, and each cut member is a diagnostic and a line above the
  class, at its indentation:

      /* SyntaxError @line 44: `delay` is reserved for a future lane and is not built yet. */
      class Engine extends Instance { // @mixed

- a refusal in a CONSTRUCTOR, in the head, or with no position is the class's,
  and the class gives way to its notes (T-DIAGPOS). A constructor is not cut:
  the grain and the handshake may stand on it, and the class without it would be
  refused for things the author did not write;
- only a refusal outside every class costs the file.

The grains stay as the source wrote them, so no class — the cut one, or a
subclass reading it — is judged against what recovery left. Without `recover`
nothing changes: the first refusal throws. The editor compiles in recover mode,
both for its checks and for **Show Compiled Output**, so every refusal is its
own squiggle and the output always opens.

**This is the shape labels exist for.** Both walls are NESTED loops: on a
violation the next thing to examine is the next OUTER member, and a bare
`continue` would advance the inner one. `continue member;` and `continue param;`
say which loop. A try/catch could do the same, but only by making every check a
throw site; the label keeps a diagnostic a VALUE and the control flow visible.

error recovery did not exist yet. Recovery is what creates the outer-exit shape.

### 2.1.8 A refusal is a result, not only an exception [[T-DIAGPOS]]

Every diagnostic carries the offset it was raised at, so it can name a LINE.
The default is still a throw, with ` (line N)` appended to the message. Under
`{ recover: true }` the compiler instead emits

    /* SyntaxError @line 3: Instance: class Bad — … */

in place of a class whose refusal is the class's own, and KEEPS COMPILING, so
one bad class does not cost the rest of the file; a refusal inside a member costs
only that member, noted the same way above its class (C-RECOVER). That is what a toolchain wants, and it is what lets a suite
case whose source is *meant* to be refused show its refusal as output rather
than as a caught exception.

## 2.2 Identifiers

### 2.2.1 Unicode-aware lexing [[T-IDENT]]

    async get Ωmega() { return await p(); }

An identifier is not ASCII. Every regex that matches one uses `\p{ID_Start}` and
`\p{ID_Continue}`, never `[A-Za-z0-9_$]` or `\w` — an ASCII class silently skips
a name like `Ωmega` and the member falls through to a branch that does not
apply the rewrite.

Two ASCII classes are correct and deliberate: regex flags (the spec's flag set
is ASCII) and the numeric-literal run (number literals admit no Unicode ID
characters).

### 2.2.2 `$` is legal in identifiers and is a regex metacharacter [[T-METACHAR]]

Any dynamic `RegExp` built from a user name must escape it — `escRe` is the one
escaper, used by both walls. Today `$` is the only metacharacter that survives
`sigilBare`; the helper exists so that stays true when name shapes change.

## 2.3 Parsing

### 2.3.1 A default parameter's brace is not the method body [[T-PARAMBRACE]]

    m(a = {x:1}) { return a; }

Scanning for the first `{` finds the object literal, matches it, and cuts the
method in half — the emit was `m(a = {x:1}` and the member after it was eaten.
The body brace is the first `{` at DEPTH 0. Same for `[1]` defaults and nested
`{x:{y:1}}`.

### 2.3.2 Scanning FOR an opening bracket needs the target tested first [[T-OPENTARGET]]

In `topLevel`, the depth-increment branch runs on `(`, `[`, `{`. If the target
test comes after it, `topLevel(…, '{')` can never match — the increment
swallows it. Target first, then depth. (For `;` the order is irrelevant, which
is why it went unnoticed until `methodEnd` needed a brace.)

### 2.3.3 Parameter and super-argument lists nest [[T-NESTPAREN]]

    constructor(a = f(g(1)), b) { super(f(g(a)), h(1)); }

`indexOf(')')` is wrong in both positions. `closeParen` walks balanced; it was
written twice inside `ctorParts` before being extracted.

## 2.4 Class semantics

### 2.4.1 A field initialiser cannot see constructor parameters [[T-FIELDPARAM]]

In plain JS this is a ReferenceError. Our shared generator holds the fields AND
the constructor body, so the binding really *is* in scope — the emit runs and
LOOKS right. That is exactly why it must be a compile error rather than a
runtime surprise. Literals are stripped before scanning, property positions are
excluded, and boundaries are `\p{ID_Continue}`-aware so `Ωmega` matches while
`ΩmegaX` does not. Pattern-bound parameters carry no simple name — documented
gap.

### 2.4.2 Settlement order is not source order [[T-ORDER]]

Acquires collect at the TAIL, so a plain field written after a `defer` one
still settles before it, and a fan written after it has STARTED before the
defer joins: the join waits for every other member of its face to be defined,
never for a fan to land. The order is computed once (`settleOrder`) and read by
both the emit and the sibling wall, so the check cannot disagree with the
emit. A suspending computed key is a blocker in its place (T-DYNKEY). A fan is
never a violation — settling out of sequence is its contract.

**An acquire STARTS where it stands** (RULED 2026-10-12). Only its join moves.
Its start is a plain binding, so a `defer` above every blocker of its face
still starts in the synchronous prefix, before the seed, and overlaps with
everything below it; one below a blocker starts once that blocker has landed,
and may therefore read it. The author chooses the overlap by position — the
way `<script defer>` is fetched where its tag stands and runs after the
document, in order. Before this ruling every start was hoisted to the top of
the hook: a defer written below `setup abc = await …` ran its expression before
`abc`'s, silently out of source order, and could read no sibling at all (the
wall refused the read with a hint that was already satisfied). `defer async`
follows the same rule, which `setup async` always had.

The sibling wall reads an acquire's expression at its start: every member above
it that is not itself an acquire has landed by then, and an acquire above it
has not (it joins at the tail), so reading one is refused with the hint to make
it `sync`. A read of a sibling declared BELOW is left to the runtime, as for
every field: the class face throws its TDZ `ReferenceError`, the instance face
reads `undefined` (C-CASCADE).

### 2.4.3 `static async x = …` is a SyntaxError in the output [[T-STATICASYNC]]

v8 fell through to a `keep` row and emitted exactly that. The field table's
last row therefore matches everything: no fall-through, ever.


### 2.4.4 The lexical lock: `let setup` / `const setup` [[C-LOCALLANE]]

Inside a member body, a lane on a LOCAL binding halts that frame:

    async m() {
        let x = engine.search;             // 0ms — x is whatever the getter returned
        let setup y = engine.search;        // halts THIS frame; y is the resolved value
        const setup z = await load();       // works with an explicit await too
    }

`let setup x = e` emits `let x = await e`. The enclosing member must already be
able to suspend — the compiler does not silently make it async, because that
changes what every caller receives.

**Only `setup` generalises out of settlement**, the same finding as the field
sigils. `let async x = e` would mean “do not await”, which is `let x = e`, an
alias for nothing. `let defer x = e` means “start now, join at the tail”, and a
local binding has no tail. Both are refused, naming the reason, rather than
given a second meaning that holds only locally.

`let setup = 1` is still an ordinary binding named `setup` — the lane form needs a
name after it.

### 2.4.5 Mutation lanes on a setter [[C-SETLANE]]

An `async set` is a CONCURRENCY CONTROLLER. A 0ms assignment feeding a boundary
that takes real time must have a collision policy; standard JavaScript picks one
(fire-all) and gives you no way to name it. The lane names it:

    setup  set x(v)   FIFO. Every write runs, in order. Nothing is lost.
    defer set x(v)   Queue-latest. Intermediates are dropped, the newest runs next.
    async set x(v)   Fan. Every write fires at once, order unmanaged.

These are the four flattening strategies of a reactive stream, minus one. In
RxJS terms: `concatMap`, a trailing-latest queue, and `mergeMap`. `exhaustMap`
— drop the NEW write — is deliberately absent: a dropped assignment leaves the
local value and the remote value silently different, with nothing at the call
site to indicate it. Throttle an event, never a memory boundary.

**The synchronous prefix is not scheduled.** The body splits at the first
top-level `await`, exactly where a class body splits at its partition:

    defer set query(val) {
        this.localQuery = val;          // PREFIX — runs on every assignment, now
        await api.search(val);          // REMAINDER — entered into the lane
    }

Only the remainder enters the lane. That is what makes an optimistic update land
immediately under EVERY policy. Scheduling the whole body instead would setup
the local write for every assignment after the first, by exactly the latency the
optimism existed to hide — measured: three rapid clicks showed `+1`, not `+3`.

`try` wraps the remainder, so a failed background write does not surface as an
unhandled rejection.

### 2.4.6 Cached fields: `let`, `const` and `enum` [[C-CACHED]]

    static try async const schema = await network.fetch('/api/schema');
    static try async let  worker = await cluster.findBestNode();

A fourth axis on the column, nearest the name where JS already puts these words:
`static · try · yield · memo · lane · [ply|let|pin|get|set|const|azo|enum] · name`. The others ask
whether it fails soft, whether it also streams, and when it settles; this asks
whether it can be written again — and, with `enum`, whether it can be seen.

**`const` seals on its settling write, and is STRUCTURALLY immutable.** The seal
is a BIT the setter consults, never a descriptor change: the accessor is defined
`configurable: false` with both lanes and stays that way forever, so a const
field is never briefly reconfigurable, `delete` fails, and the accessor cannot
be replaced by `defineProperty`. Runtime enforcement is not a toy — if it says
const, it means const. (The shared bare descriptor is cached BY NAME across
every class, so a sealed one is not cached: a const `schema` in one class must
not make an ordinary `schema` immutable in another.) A later write throws `TypeError: Assignment to constant field`,
echoing JavaScript's own wording. A settlement sentinel never seals — the seed
writes PENDING through the same setter, so sealing on the first write would seal
the sentinel and reject the real value.

Registration lands on the prototype, one set per class, and the lookup climbs,
so a subclass inherits its parent's const fields. The seal itself is one line,
placed so that moving it behind a success test would make `const`
seal-on-success-only without any structural change.

**A cached field that SUSPENDS must name its lane.** `const x = await f()` is
refused; write `setup const x = await f()`. The two forms it sits between differ
by one word — `const x = f()` does not halt settlement, `const x = await f()`
halts it entirely — and with `const` already occupying the column, an elided
lane is too easy to miss. This is the first step of the C-SYNCDEFAULT
deprecation; the lane is expected to become mandatory everywhere.

`let` is accepted and emits identically to a bare field. It is there for
symmetry with `const`, and reads as an author saying “this one is meant to
change.”

### 2.4.7 Intermediate names [[C-REGISTER]]

Every synthetic binding the emit introduces is minted from one table, never
spelled inline. The shape is `ø` · the WORD for what the register is · `_` ·
the author's name for what it stands for (RULED 2026-10-12; the old form, a
sequence number and one letter — `ødefer_db` — read as gibberish):

    øtmp0            transient   freed after the next statement; never crosses a yield
    øvalue_x         value       pinned across a suspension for a waiting parent
    øarray_rows      array       an aggregated structure — a drain accumulator
    ølabel0          label       a synthetic block label for goto / break routing
    østatic_x        static      minted inside the static face, so the two never mix
    øerror0          error       a catch binding
    øiterator_rows   iterator    a loop cursor or iterator-protocol handle
    ødefer0          gate        a deferred gate: `defer await warm()`
    ødefer_db        join        an acquire's handle — its start, and its join
    øbatch_x         batch       a `setup async` member's handle

**A register that stands for something the author wrote carries that name**, so
the emit is traceable back to the source, and a lane's handle carries the lane's
word:

    rows[]* = await s();     ->  const øarray_rows = []; const øvalue_rows = (yield s());
    x = try await f();       ->  var øvalue_x = yield f();   inside its try (C-VAR)
    &db = await open();      ->  const ødefer_db = open();
    await using package P;   ->  const øvalue_P = P[…].call(this);

    defer await warm();      ->  const ødefer0 = warm();   no name to carry: a number
    a: { goto b; }           ->  ølabel0: while (true)      a LEVEL, not an author name

Seven of the nine mint sites have a source name in scope; the two that do not —
a gate binds nothing, and a goto state register is one per level — take a
number, counted per word. So does a second register of one word for one name,
since two bindings cannot share a spelling: a drain's cursor is
`øiterator_rows` and its result `øiterator_rows_2`. A field name is already a
valid identifier, so appending it is always legal; sigils and the tier prefix
are stripped first.

`ø` is a legal identifier, label and catch binding, and no author writes it, so
a collision is not a practical concern — which the old `__name` prefix could not
promise. `regFor(key, kind)` mints a register that must be spelled the same in
two places, such as a gate's start and its join, so emit order cannot matter.
The sequence resets once per COMPILE, not per class: `gotoWrap` mints during
`buildIR`, before any class is emitted, so a per-class reset would make the
numbers depend on leftover state.

**A register used once, on the next line, is not minted** (RULED 2026-10-13).
A start whose only use is the statement right after it is that value, in place:

    const ødefer0 = warm(); // @defer-start      ->      yield warm();
    yield ødefer0;

A register exists to carry a value ACROSS something: a `defer` starts where it
stands and joins at its level's tail. So anything between the start and its use
keeps it, a row line included, since folding the start past a line would move
it. A soft join keeps it too (its `try` would then also catch the start's own
throw), and so does a line that gathers several registers: a barrier over a run
of two or more names each member's. A run of one is its barrier, in place —
`yield ø.batch(this, ['x', f()])`.

### 2.4.8 The settlement generator carries the class name [[C-TRACENAME]]

    class UserProfile { constructor(){ this[Symbol.new](function* øUserProfile(){ … }); } }

A throw during settlement names the class in the stack instead of reading
`at <anonymous>` — measured: `at øUserProfile (…)` against a bare
`at [eval]:5:28`. An unnamed class gets a per-file sequence, `øanonymous_1`,
`øanonymous_2`, so a frame in a production log is a string you can search the
bundle for. The two faces are distinct: the static generator is
`øUserProfile_Static`.

The name survives minification, because it is part of the emitted source rather
than a sourcemap. A named function EXPRESSION binds its own name inside itself
as a const, so nothing leaks out of the generator.

### 2.4.9 The hook, by subtraction [[C-HOOK]]

The settlement hook lost an argument at a time:

    1.  this[Symbol.for('Instance')](Tab, function(){ … }, async function(){ … }, ['$a','$b']);
    2.  this[Symbol.for('Instance')](Tab, function(){ … }, async function(){ … });
    3.  this[Symbol.new](Tab, function*(){ … });
    4.  this[Symbol.new](function*(){ … });

The seed list went first: the generator already names every field it settles.
Then the two-function split, once one generator could carry both phases with a
partition between them. Then the class argument, which `this.constructor` and
the grain tag already answer. What remains is a hook and a generator.

### 2.4.10 Top-level yield: settlement is a stream [[C-TLY]]

`yield` in a class body emits a value to anyone iterating the element. The
class must say it iterates.

```js
mixed class* Conn extends Div {
    yield 'connecting';
    yield db = await open();          // a TEE: emitted AND bound
    yield 'authenticating';
    user = await auth();
    yield 'ready';
    mixed constructor*(){ yield super(); }
}

for await (const step of new Conn()) console.log(step);
// connecting, DB, authenticating, ready
```

**Emitting requires the star, on whichever init emits.** A class-level `yield`
needs `class*`; a `yield` in the constructor body needs `constructor*`. Both
refuse by naming the fix. `yield super()` is the settlement handshake rather
than an emission and is exempt, as is a `yield` inside a nested generator, which
belongs to that scope.

    mixed class* Tab { yield 1; mixed constructor*(){ yield super(); } }   ✓
    mixed class  Tab { yield 1; … }                                        ✖ write `class* Tab`
    mixed class* Tab { mixed constructor(){ yield super(); yield 1; } }    ✖ write `constructor*()`

**The modifier column is `try · yield · static · lane · name`** — `try` decides
whether there is anything, `yield` where it goes, the lane when. Lane closest to
the name, as the sigils already are.

    yield x = await f();              emit and bind
    try yield x = await f();          soft: on failure nothing is emitted
    static try yield defer x = …      all four slots
    x = yield await f();              the same, one operand — they converge

**Emission is a call, not a generator yield.** It must not suspend, and the
settle pump's protocol is untouched. Values buffer until a consumer drains
them, so iterating late loses nothing; the stream ends when settlement does,
including on rejection.

**`Symbol.asyncIterator` is canonical.** Whether another emission is coming
depends on whether the next field suspends, which is not known until it does —
exactly the question the async protocol exists to answer. The setup face walks
settled entries instead. `for await` falls back to `Symbol.iterator`, so a
consumer writes one form either way.

    yield 1;                          ✖  without `class*`: a value to nobody

### 2.4.11 Packages [[C-PACKAGE]]

A class IS something, an interface REQUIRES something, a package PROVIDES
something. A package is never instantiated: its METHODS are copied onto the host
at declaration time, and its FIELDS and CONSTRUCTOR are an initialiser run
against the host's receiver.

    package Resizable { width = 300; height = 200; resize(w,h){ … } }
    package Sized extends Resizable { constructor(w,h){ this.width = w; this.height = h; } }

    mixed class Panel extends Div {
        using package Sized(1920, 1080);
        label = 'panel';
    }

**Ordering, ruled.** Packages must be declared at the top of a class body. They
run immediately after super and BEFORE any field, top to bottom — the first
statements inside the hook, which is also where writes go through [[Set]], so a
package field extends reactive, guarded and tier-aware exactly as a declared one.
Host declarations SHADOW a package's: the host is the more specific one, and a
package gaining a member must not break a host that already had it.

**THE USING TABLE.** Two independent axes, as on a field:

    using package X            immediate, hard
    try using package X        immediate, soft
    await using package X      suspends,  hard
    try await using package X  suspends,  soft

**The pre-partition region CANNOT SUSPEND** — `it.next()` runs the setup prefix
synchronously and the FIRST yield there IS the partition. So a sync package runs
inline, while an async one is STARTED in the prefix and JOINED after the
partition; its installer is an async function returning a thenable, exactly as
an element is thenable during settlement. That is the acquire shape, reused.

```js
package AcmeUI {
    public static get manifest() {            // the npm manifest — see C-MANIFEST
        return { manifest: 1, name: '@acme/ui', version: '2.0.0' };
    }
    theme = 'dark';
    toggle(){ … }
}
```

`extends` for inheritance — a package emits a real class, so the prototype
relation is real. `implements` for contracts, as on an interface. `is` belongs
to interfaces alone.

### 2.4.12 The manifest [[C-MANIFEST]]

A package's public static face, and a REAL property:

    package AcmeUI {
        public static get manifest() {
            return { manifest: 1, name: '@acme/ui', version: '2.0.0' };
        }
    }

      ->  class AcmeUI {
              static get manifest() { return { manifest: 1, name: '@acme/ui', … }; }
          }

`public` is erased and the getter is emitted VERBATIM, so it is readable with no
runtime, inherited by a subclass, and overridable with `super.manifest`. A
compiler-stashed value would need a symbol, the runtime loaded, or a sibling
file.

**The body must RETURN AN OBJECT LITERAL.** Not a style rule: package.json is
JSON, which has no computation — and npm reads package.json to learn HOW to load
the module (`type`, `main`, `exports`), so the file cannot be produced by running
the module. A computed body would work at runtime and silently fail the build.
A spread, a call, a reference or a function value is refused, naming the token —
`JSON.stringify` would have DROPPED it silently instead.

**`manifest: N` desugars to `manifest_version`** and defaults to 1, as Chrome's
did, so every manifest written today survives a v2. It is CONSUMED, never
emitted: it tells the compiler how to read the rest, so it cannot also be part of
the rest — npm never sees a key it does not know.

**Names do not have to meet.** `AcmeUI` is a JS binding, used by
`using package AcmeUI` and `import`; `'@acme/ui'` is a registry string in the
`name` field. npm allows `@ / - .` and JavaScript allows none of them in a
binding, so a class name can never carry a scoped package name — and does not
need to, exactly as `import _ from 'lodash'` binds `_`.

**Extraction is pure; the write is opt-in.** `compile()` always exposes
`result.packages`, a Map of name → manifest. `{ manifest: path }` writes it, in
Node, IDEMPOTENTLY BY CONTENT — 200 compiles are one write and a watcher does not
loop. The path comes from the caller because `compile()` receives a string and
cannot know which directory a source belongs to. Outside Node the flag warns
rather than failing.

[TABLED] `public static version = '2.0.0'` as a shorthand for individual npm
fields, pending the full semantics of `public`.

### 2.4.13 Nested classes compile [[C-NESTED]]

A class declared inside a method body is compiled exactly as a top-level one:
the member's text is run through `compile()` before it is copied out, so the
inner class gets its own seed, partition and settlement, and an ungrained inner
class with a suspending field is refused by name rather than leaking `await`
into a non-async scope.

    class Tab extends Div {
        m() { mixed class Inner extends Div { y = await g(); … } return Inner; }
    }

### 2.4.14 interface + implements [[C-IFACE]]

Inheritance is spelled `is`, as in Solidity — `interface IBLT is IFoo`.
The same word tests conformance at runtime (`u is IFoo`, sketched), because it
asserts the same thing in both positions: at a declaration, that this contract
carries another's members; at an expression, that this value satisfies one.
`extends` is refused on an interface, with the fix named.

Note `is` is NOT a reserved word in JavaScript — the reserved-but-unused set is
seven (`enum implements interface package private protected public`), and
claiming `is` costs identifier space exactly as `goto` and `jump` do.

An interface COMPILES TO A CLASS with **pure class semantics** — fields for
fields, statics for statics — so the compiled form looks like the thing it
describes. The `implements` clause IS erased from the class head, since it is
not JavaScript and JS has single inheritance.

    interface IBase  { id = Number; static ver = Number; }
    interface ICart is IBase { qty = Number; tag = [String, Number]; anything; }

      ->  class IBase  { id = Number; static ver = Number; }
          class ICart extends IBase { qty = Number; tag = [String, Number]; anything; }

The source and the emit are the SAME SHAPE — `interface` swaps one keyword and
adds a contract. `=` is the canonical annotation, because it is what a class
field looks like; `:` is accepted as an alias.

**Both faces inherit natively, and they cannot shadow each other.** The INSTANCE
face merges through construction — one `new` yields the child's fields and every
inherited one in a single object. The STATIC face merges through the class
chain, no construction at all. A struct-style static would carry one
instead; it SHADOWED on inheritance, so a subclass interface silently lost its
parent's members at runtime. Class semantics cannot, because each face uses its
own native chain.

Nothing here is sigil-gated: bare keys work throughout, and a tier glyph is
matched exactly when present.

**Runtime enforcement.** A typed implementer registers at declaration time —
`ø.implement(this, ICart)` in the static hook, passing the interface CLASS, not
a transcription. `Superset.implement` snapshots both faces once into a WeakMap
keyed by the CONSTRUCTOR; a miss walks the prototype chain once and memoises the
answer, including `null` for "no interface here".

The guard picks a face by receiver — `typeof receiver === 'function'` is a
static write — and runs at BOTH write paths. A glyphed name goes through the set
trap; a bare name installs an own accessor on first touch and never reaches the
trap again, so guarding only the trap checks a bare key once and never after
(measured). The settlement sentinels are exempt, since seeding writes PENDING
before any value exists.

**Type tokens are real constructor references; a union is an array.** `:` and
`=` both read as the annotation — an interface body has no real assignments to
be ambiguous with. TYPE_REF is keyed by the constructor and each row carries
whichever mechanism applies: `typeof` separates primitive from boxed (so
`Number` rejects `new Number(5)`) but collapses every object to `'object'`;
`Object.prototype.toString` separates object kinds but cannot reject a boxed
primitive.

**Checked at compile time:** every member exists, inherited ones included; a
method requirement is not satisfied by a field; the TIER matches exactly — `$`
and `Δ` are different lanes with different identity and notification; and the
GRAIN matches exactly — a `setup` requirement means *await delivers everything*,
which `mixed` does not promise.

Methods and modifiers are consumed by that check and are NOT carried into the
emit — only `name -> token` is read at runtime.

[NOTE] a member naming a DOM intrinsic (`id`, `title`) passes the guard and is
then coerced by the platform, so a `Number`-typed `id` still stores `"0"`.
[OPEN] arity is deliberately not checked: `.length` stops at the first default
or rest parameter, so an interface demanding `rename(n)` would reject
`rename(n, opt = 1)` — a strictly more capable implementation.

### 2.4.15 Structured goto [[C-GOTO]]

Label blocks NEST, and compile to nested loop+switch pairs — the only legal
encoding of a jump to a later block in JavaScript, since `break` reaches only an
ENCLOSING label, never a later sibling.

    goto [ yield ] [ Action ] [ Target ] ;
      Action := this | continue | break     (elided -> this)
      Target := <label> | super             (elided -> this block)

|            | this block | parent | a named block |
|------------|-----------|--------|---------------|
| restart    | `goto` = `goto this` | `goto super` | `goto outer` |
| advance    | `goto continue` | `goto continue super` | `goto continue outer` |
| leave      | `goto break` | `goto break super` | `goto break outer` |

`goto return` leaves every level (`goto void` is an alias). Inserting `yield`
after `goto` suspends first: the state is set BEFORE the suspension, so whatever
resumes the machine lands where you said, not where you left.

    goto X              __s<lvl(X)> = 'X';      continue __L<lvl(X)>;
    goto continue X     __s<lvl(X)> = after(X); continue __L<lvl(X)>;
    goto break X        break __L<lvl(X)>;
    goto return         break __L0;
    goto super (top)    continue __F;   — restarts the FUNCTION, locals re-initialised

**The grammar is a TABLE.** Surface syntax resolves through two rows into a
three-instruction machine, in the shape of chimera's SIGIL_REF — aliases are
bare strings, and nothing outside the tables knows what `continue` or `super`
mean:

    GOTO_ASM   JUMP (set a state, continue that loop) · EXIT (break a level) · FRAME
    GOTO_ACT   this / continue / break / return · `void: 'return'` is an alias row
    GOTO_TGT   super / this · anything else is a label, resolved through the index

An action returns the NODE it lands on, so BOTH the level and the state come
from one place and an action may move levels. (resolving the state and
the level separately made a new `redo` action emit `__s1 = "o"` for a block at
level 0.) Un-retiring `jump`, adding an action, adding a target word, or
swapping the desugaring is one row each — verified by patching the tables alone.

**Rulings.** Action first, so `goto continue` is a prefix of
`goto continue super`. Targets are NAMED rather than counted, so a refactor
cannot silently repoint a jump; `super` is the one relative form and reaches
exactly one level, because "my parent" survives refactoring and a count does
not. Every block must end in a terminator — implicit fall-through is refused,
since it would make source order semantic and blocks are nodes, not lines.
`goto continue` from the last block at a level means `goto break`: the
sub-machine ran off its end, so control returns to the enclosing block.

**`goto yield` requires a generator body** (`*name()`). Forcing one would
silently change what the member RETURNS — a value becomes an iterator — so the
author declares it, and the diagnostic names the fix.

**Every jump is braced**, or `if (c) goto x;` leaks its continue past the `if`
(measured). **Locals do not cross an edge**: each block is its own `case { … }`,
so two blocks may reuse a name and anything shared is declared above the first
label — C's rule about jumping over an initialisation, reached by the same
constraint. **The function frame wraps preamble, machine and postamble
together**, or the postamble loses the preamble's locals (also measured).


### 2.4.16 A block initialiser emits a LABELLED BLOCK
### 2.4.17 LHS `try` — a declaration modifier [[C-TRYLHS]]

`try` also sits in the modifier column, alongside `static` and the lane sigils,
where it softens the WHOLE initialiser:

    try x = risky();                        soft, no suspension
    try x = await load();                   soft, suspends
    try x = await a() + await b();          multi-operand — no braces needed
    try ?x = await send();                  lanes compose
    static try x = await load();            face first, then the hazard it wraps

**Braces are optional and mean only a BLOCK BODY** — they are required when a
clause follows, since a clause needs something to attach to:

    try x = { await a() + await b() };
    try x = { s(); return v(); } catch (e) { … };

**The value rule is the block rule** (C-BLOCKINIT): one expression statement
auto-returns; multiple STATEMENTS need an explicit `return`. Multiple OPERATORS
do not — an expression is one statement however many operators it has.

**LHS and RHS converge where the initialiser IS one operand.** `try x = await y()`
and `x = try await y()` emit the same code, which is agreement rather than
ambiguity — the same way `(x)` and `x` agree. They diverge as soon as the
initialiser is larger than the operand: LHS covers all of it, RHS covers one
operand and leaves the rest hard.

### 2.4.18 `try` in expression position, everywhere [[C-TRYEXPR]]

`try` is a unary operator wherever an expression can appear, not only in a
field initialiser:

    m() { const a = try f(); return g(try await h()) ?? C; }

In a field the emit is a labelled block, because the field body is a generator
and can `yield`. In a method body there is no generator, so the emit is an
IIFE — `(() => { try { return f(); } catch (e) { return undefined; } })()`,
async and awaited when the operand suspends, so a rejection is caught rather
than returned. The block value rule applies to both the body and a `catch`
clause: one expression statement auto-returns.

**Native `try` is untouched.** A `try` at a statement boundary — after `;`, `{`,
`}`, or at the start of a body — is JavaScript's own statement. Ours is the one
that follows something wanting a value: `=`, `(`, `,`, `return`, an operator.

### 2.4.19 `try` is a unary operator [[C-TRYOP]]

Exactly like `void` and `typeof`:

    void f()          ->  undefined, always
    try  f()          ->  f()'s value, or undefined if it throws
    try  f() + 1      ->  (try f()) + 1        precedence, not a rule we wrote
    try (f() + 1)     ->  parens widen the operand
    try await g()     ->  the operand is `await g()`; unaries chain right-to-left
    try { … }         ->  a BLOCK operand — the one addition beyond `void`

The operand ends where `typeof`'s would: one unary expression with its member and
call chain, or a parenthesised group. Everything after it is a TAIL, OUTSIDE the
try — so `try await load() ?? CACHED` yields CACHED with no special case, which
needs no extent rule at all.

**A CLAUSE needs the block.** `typeof x catch { … }` is meaningless, and
`try await me() catch { … }` has the same shape — nothing delimits what the
catch guards. So `catch`/`finally` are legal only after `try [await] { … }`,
and the diagnostic names the fix.

**`try` without `await` is a plain-slot member.** It softens without suspending,
so it takes its own FIELD row: the same emit as the spine form, minus the yield.
No seed, no partition, no grain obligation on the class.

**`await` never introduces a block.** `await { … }` is refused, pointing at
`try { … }` or `try await { … }` — the braces belong to `try`, and an object
literal there needs parentheses, as in an arrow body.

### 2.4.20 A block initialiser emits a LABELLED BLOCK, not an IIFE [[C-BLOCKINIT]]

The form is `try await { … }`. The modifier LEADS, matching the landed
`defer await` — the slot before `await` answers a question ABOUT the await:
`defer` is WHEN, `try` is WHAT ON FAILURE. `await` never introduces a block,
because an implicit try made softness depend on punctuation alone: `await load()`
rejected and `await { load() }` swallowed, and nothing in the source said so.

`await try` was considered and rejected: it reads as "awaiting the try" rather
than "trying the await", and it would put the modifier after the head word while
`defer await` puts it before.

`try await { … }` in initialiser position is a block body for a field. It emits

    try { ølabel_x: { const a = yield f(); { var øvalue_x = a + 1; break ølabel_x; }; } }
    catch (e) {}
    this.x = øvalue_x;

so the suspensions belong to the GENERATOR the engine already drives — no
closure, no promise wrapper, and `this` untouched because no function boundary
is crossed. Measured at 1.33x the IIFE form on equal work (one closure and one
promise saved per settlement). The value register is a `var`, declared where the
value first lands, so the catch has nothing to reset (C-VAR).

Two claims about the IIFE that are FALSE and were checked: it does not break
`this` (an async arrow inherits it), and it does not break `super` — `super` is
unavailable inside the hook either way, because the body is a function
EXPRESSION, not a method, so there is no home object.

**It is a PRIMARY EXPRESSION.** Whatever follows the closing brace applies to
the block's result, after the soft catch — `?? CACHED`, `?.length`, a ternary,
arithmetic. Nothing needed enabling; the block yields a value like any other.
(the tail was parsed and then DROPPED, so a fallback vanished
silently.)

**Braces are SOFT.** Anything thrown inside yields `undefined` and the element
survives; `await load()` without braces stays hard.

**The value.** A body that is exactly one expression statement auto-returns it.
Otherwise ordinary function-body rules apply: an owned `return` gives the value,
its absence gives `undefined` — mirroring the spec rather than subsuming it.

**The conversion is scope-aware.** Only awaits belonging to THIS body become
yields; one inside a nested function or arrow stays an await, because a `yield`
there is a SyntaxError. `return` is rewritten by editing the KEYWORD and the
terminator, never the expression between them — an await inside it has its own
edit and must survive — and the result is braced so a braceless
`if (c) return x;` keeps its body. Both were live bugs during the cut.

### 2.4.21 The await GATE — halting without binding [[C-BARRIER]]

    mixed class Tab extends Div {
        setup a = await first();
        await gate();              ← suspends, binds NOTHING
        setup b = await second();
    }

**It is not a new capability.** Every suspending spine member already halts what
follows it — the settlement law is top-down, so `setup a = await first();` gates
`b` exactly as `await gate();` does. Measured, the two orderings are identical:

    setup a = await slow(a);  →  a-start a-done b-start b-done
    await slow(gate);        →  gate-start gate-done b-start b-done

The gate's whole contribution is the ABSENCE of a binding. Without it, halting
for a side effect forces a throwaway field (`setup _ = await gate()`), which
costs a public property, a name nobody wants, and a seed entry advertising a
key that means nothing. The gate halts and leaves no trace.

An LHS await takes **no assignment**, and exactly **one** modifier:

    await gate();          halts HERE
    defer await gate();    starts HERE, halts at the TAIL
    await x = y();         ✖ LHS await is only legal as a sequencing declaration
    setup await gate();     ✖ `setup` is what a bare await already IS

`defer` is admitted because it is the one word that CHANGES the gate — the work
starts where the gate stands and the halt moves to the tail, so siblings settle
in between. `setup` would be a second spelling of the default. Before the rule,
both refused forms silently produced a field literally named `await`.

It seeds nothing (there is no key to advertise), declares no lifecycle of its
own (there is no binding to give one), and takes `static` to pick the face like
any other member. The face still needs a grain, because the member suspends.
Nothing steps outside the class: the generator carries the gate, the same as it
carries every other suspension.

### 2.4.22 `'use implicit'` — the blocking lane as the class default [[C-IMPLICIT]]

    export default mixed class* Engine extends Instance {
        'use implicit';

        static const schema = await net.get('/schema');   // setup, implied
        static async const region = await geo.detect();   // a departure, still named
    }

A cached field that suspends must name its lane (C-CACHED). A class whose fields
are uniformly blocking can say so once instead:

**Whole class, from the directive, and it must be the FIRST member** — a reader
must never scroll to learn which rules are in force. It applies to both faces.
Inside functions it does not apply; a function body is always explicit.

**Only `setup` becomes implicit.** `async` and `defer` are the departures and are
still named, which is the whole point of a lane word. And the directive is
stripped: emitted verbatim it would define a property called `"use implicit"`.

### 2.4.23 `try static { … }` — a soft static block [[C-TRYSTATIC]]

    try static { risky(); }                       -> static { try { risky(); } catch (e) {} }
    try static { risky(); } catch (e) { log(e); } -> the author's catch is kept
    try static { risky(); } finally { done(); }   -> so is a finally
    static try { risky(); }                       -> the commuted order, same emit

`try` in front of a static BLOCK wraps it. Without a tail, a bare catch is
supplied, so a failing block leaves the class usable instead of poisoning
class-evaluation. An author's own `catch` or `finally` is kept verbatim.

BOTH ORDERS ARE LEGAL and emit the same bytes, as everywhere else `static` and
`try` meet. Each reads better in a different case, which is most of why neither
is canonical: bare, `try static { risky(); }` wins, because `static try {` makes
a reader expect the `catch` that a bare soft block does not write. With a tail,
`static try { … } catch (e) { … }` wins, because the catch sits beside its
`try`. Write whichever the line calls for.

`static { a, b } = await f()` is a destructuring FIELD, not a block, and the two
are told apart by one token of lookahead past the closing brace: an `=` makes it
a field, no `=` makes it a block. JavaScript itself rejects `static { … } = x`,
so the spelling was free.

### 2.4.24 The declaration column [[C-COLUMN]]

    [static] [try] [yield] [memo] [lane] [ply|let|pin|get|set|const|azo|enum] name ( = [await] expr | as expr )
     └FACE┘ └── the ACTIONS ──┘  └───────── the SLOT ─────────┘

    static try yield async const socket = await wss.connect();
    static     yield async const stream = await api.stream();
    static try       setup const schema = await api.get();
    static                 const version = '1.0.0';
                memo setup async let   rows   = await page();

THE ORDER IS THE EMIT'S ORDER, not a reading. `static` leads because JavaScript
admits nothing before `static` in a class member except visibility — and
Instance already spends that slot on `public` inside a package. The descriptor
sits last because that is where JavaScript puts a declaration keyword.
Instance's own words fill the middle, and `try` sits closest to what it wraps.

That last part is structural, not stylistic. **JavaScript cannot wrap a class
element in `try` at all** — `class A { try { static x = 1 } }` is a SyntaxError —
so `try` can only ever reach a member's INITIALISER or BODY, never the member
itself. The emit says so plainly:

    static try { risky(); }          ->  static { try { risky(); } catch (e) {} }
    static try const x = await f();  ->  try { var øvalue_x = yield f(); } catch (e) {}

`try` is therefore the NARROWEST-scoped word on the column, not the widest, and
writing it outermost would claim a containment the language cannot express.

THIS GOVERNS NAMED DECLARATIONS ONLY. The unnamed forms — `try await gate()`,
`try await { … }`, `try static { … }` — are statements, not declarations; they
are not on this column and they put `try` first. *A soft static block* has the
reason the two sides differ, and why a reader feels it before they can name it.

The cost is real and worth naming. With `try` first, every fallible member had
it in column one and a reviewer scanned one vertical line for hazards. Now it
lands at column one or after `static`, depending. That is a FORMATTING loss
rather than a grammatical one — padding the optional `static` column restores
the line, which is what the blocks above do.

`memo` joins the actions and the slot, sitting against the lane it modifies: it
is not an action in its own right, and it is meaningless without a lane to
reorder.

ORDER IS ENFORCED, BUT NOT TOTALLY. `yield` must precede the lane; `yield async`
is refused, naming the order, while `yield async const` — lane after yield — is
the accepted spelling of the same intent. `static` and `try` are the exception:
`static` and `try` COMMUTE and compile to the same bytes. BOTH ORDERS ARE LEGAL
and neither is canonical — `try static async get fn()` and
`static try async get fn()` are the same declaration, as are `try static { … }`
and `static try { … }`. The written order above is how this document spells it,
not a rule.

`try` IS THE ONLY WORD THAT MAY STAND LEFT OF `static`. Every other modifier
describes a named member — a lane says who waits for a value, a descriptor says
how a slot behaves — and a bare `static { … }` block has neither a value nor a
slot for them to describe. `try` is the one modifier that also composes with the
block, and that is what earns it the outer position. So `yield static const x`,
`defer static const x` and `const static x` are all REFUSED, naming the word
that moved.

That is a deliberate refusal to decide. The two orders were argued at length:
`try` first aligns every hazard at one column and reads as an imperative;
`static` first fixes the left edge, brackets the variable middle against the
descriptor on the right, and matches what the compiler's diagnostic happens to
name. Neither argument beat the other, and a coin-flip dressed as a principle
would have been worse than an honest tie. Pick one per file.

WHAT THE ORDER DOES NOT DO is tell you what `try` means. A field's `try` wraps a
one-time evaluation; a method's wraps the body on every call, forever. Those are
genuinely different, but the difference is carried by `=` against `(`, which is
unambiguous and cannot be written the wrong way round. Order was considered as a
second, redundant signal for it and dropped: a signal that can disagree with the
thing it signals is worse than no signal.

Commuting must be TOTAL, though. The static BLOCK form once took only
`try static {`, so the commuted `static try {` matched no path, fell through to
the modifier loop, and was SILENTLY DROPPED — accepted, compiled clean, emitted
nothing at all. A form that commutes must commute everywhere, or the freedom is
a trap for whoever uses it.

`try` and `static` are INDEPENDENT: `static` picks the face, `try` decides what
happens if the initialiser throws, and neither contains the other. So the order
is chosen for reading, not derived from containment — unlike `try` against the
lane, which it genuinely wraps.

### 2.4.25 The blocking lane is spelled `setup` [[C-VSYNC]]

`setup` is **verisync** — from Latin *verus*, true, and *setup*, together in time.
A verified temporal barrier: the enclosing face will not settle until every
`setup` field has fully resolved. Not fire-and-forget, not optimistic — a
boundary between unresolved and resolved state that the compiler enforces.

> *mnemonic: very setup. much wow.*

It does not mean synchronous. It means the face WAITS — a blocking
*asynchronous* operation. `sync` read as its own opposite often enough to be
worth the rename, and `setup` carries the right intuition from graphics, where
it names a wait for the next frame that does not freeze the machine.

    setup class Tab { … }              the class face waits
    setup const x = await f();         this field halts settlement
    setup set save(v) { … }            FIFO: every write, in order
    let setup y = engine.search;       halt THIS frame until it resolves

Bare `setup` is refused AT THE CLASS HEAD, naming the fix. It is still accepted
on a FIELD, as is `bsync`, so the blocking lane answers to three spellings there
and one at the head. All three normalise to the same internal name at the parse
boundary and emit identical bytes, so nothing below depends on which was
written — but the inconsistency is real, and retiring two of the three is the
outstanding Perl's Razor debt on this ruling.

### 2.4.26 Sync is the default lane [[C-SYNCDEFAULT]] — DEPRECATED

**This ruling is being withdrawn.** The lane is expected to become mandatory on
every suspending field, because eliding it makes two very different programs
differ by one easily-missed word:

    setup const x = await f();     halts the settlement lane until f() resolves
         const x = f();           does not halt at all

Cached fields (`let` / `const`) already REQUIRE the lane — see C-CACHED. Plain
fields still default to setup for now. Written as it currently stands:

A field that suspends and names no lane IS setup:

    x       = await f();      // setup — the face waits
    setup x  = await f();      // the same, said twice
    ?x      = await f();      // fan — nobody waits
    &x      = await f();      // acquire — starts here, joins at the tail

`await` already means "the enclosing context waits" everywhere in JavaScript, so
the word restates the operator. The SIGILS mark the lanes that DEPART from that
reading — `?` fires and forgets, `&` starts early — and those deserve marking
precisely because they are surprising.

**Two rules survive untouched, and they are separate from this one.** A
lifecycle WORD still requires an await (C-FANAWAIT): the word and the await are
different statements, and `async f = work()` is still refused. And the FACE must
still declare its own grain (C-DECLARE) — `class E { x = await f(); }` is
refused exactly as before, because a suspending field is grained whether or not
it names a lane. Containment sees the implicit lane too: a bare-await field in
an `async class` is refused as a spine member.

### 2.4.27 A lifecycle word and an await are two different statements [[C-FANAWAIT]]

The WORD says who waits. The AWAIT says the value arrives later. Both are
written, on every lane:

    async f = await work();    ✓
    async f = work();          ✖ a fan whose right-hand side never says it is one

This holds on EVERY lane. Without it a lifecycle word could be silently
discarded — you asked the class to wait and it did not. A word that is ignored
is worse than one that is redundant.
### 2.4.28 A non-thenable must still resume

A field whose awaited expression evaluates to a literal `undefined` HANGS
settlement:

    setup x = await nada();        // nada() -> undefined   HANGS
    setup x = await pnil();        // Promise -> undefined   fine
    setup x = try await nada();                              HANGS

The partition was INNOCENT: it is detected by identity (`=== element` -> setup,
`=== DETACH` -> async, else mixed), never by value. The real site was the pump,
which hands each yielded value to a Chimera Effect — and an Effect resumes from
a THENABLE's resolution. Given a plain value there is nothing to resolve, so
the resume never comes. `yield 7` hangs identically, so it was never
about `undefined` at all.

    yield undefined                -> NEVER RESUMED
    yield 7                        -> NEVER RESUMED
    yield Promise.resolve(7)       -> resumed with 7

The fix is one line in the pump: a non-thenable is wrapped, a thenable is not.
It costs exactly what JS charges for `await 1` — ONE MICROTASK, since native
`await` on a non-thenable defers too (ES2019). No working path changes, because
`Promise.resolve(p) === p` for a native promise, and a thenable takes the
unchanged branch.

Found because a pin wrote `try await chain.load().length` — a Promise has no
`.length` — and the whole suite hung with no error at all.

### 2.4.29 Suspension is read off TOKENS, not text [[T-SUSPGREP]]

Whether a field suspends decided the whole downstream shape — seed, partition,
grain obligation — and it was a raw `/\bawait\b/` over the initialiser text.
That counts the word where it is not an operator:

    v = f("await me");     ← a STRING        → seeded and deferred. wrong.
    v = o.await;           ← a MEMBER name   → seeded and deferred. wrong.
    v = { await: 1 }.await ← a KEY           → seeded and deferred. wrong.
    v = `await ${x}`;      ← a TEMPLATE      → seeded and deferred. wrong.

Each also dragged a grain requirement onto the class (C-DECLARE) for a field
that never suspends. The lexer already separates these — a literal is ONE
token, a member name is preceded by `.`, a key is followed by `:` — so the
predicate reads tokens. A computed key (`{ [await k()]: 1 }`) and a ternary arm
(`q ? await a() : b()`) still suspend, as they must. The
deeper answer is to DECLARE suspension rather than infer it (a head `await`,
sketched but not landed); the inference has to be right either way.

### 2.4.30 A rejection is raised AT the suspension, on BOTH faces [[T-SOFTFACE]]

`try await gate()` caught on the INSTANCE face and not on the STATIC one, from
identical emitted code:

    instance: try await bad()   ->  a = 1        soft, caught
    static:   try await bad()   ->  REJECTED     soft, NOT caught

The static driver did `const v = await r.value` bare, so a rejection threw in the
DRIVER and escaped the generator entirely — the emitted
`try { yield bad(); } catch (e) {}` ran its catch and the class face rejected
anyway. The instance side had always used `it.throw(err)` to raise the rejection
at the suspension, author-first, letting the body recover.Both faces agree: soft
catches, hard rejects.

### 2.4.31 The drain source is evaluated INSIDE the generator [[T-DRAINSRC]]

`await for` is not a form. `rows[]* = await stream()` drains an async iterator,
a setup iterator, an array, and a PROMISE of any of them; the `for` variant did
not await the source, so it threw on the last case and handled nothing the plain
form does not. Refused, naming the fix.


A bare `await` there is a SyntaxError. `await src()` drops the whole marker
and does not await the source; a plain `await src()` must become a YIELD, not be
dropped — dropping it works for an async generator (not thenable) but loses a
PROMISE of an iterable, which is the case `await for` could never handle.

    rows[]* = await stream();   ->  const __s = (stream());
    rows[]* = await stream();       ->  const __s = (yield stream());
    rows[]* = await fetchList();    ->  const __s = (yield fetchList());   a promise of an array


### 2.4.32 Destructuring fields [[C-DESTRUCT]]

    { users, metrics } = await fetchDashboard();
    [head, tail]       = await pair();
    { total: count }   = await stats();
    try { a, b }       = await mayFail();

Native class fields are one name to one expression, so a payload has to be
unpacked in the constructor — or bound to a throwaway field and re-read. Neither
is needed here.

The pattern is REWRITTEN to target `this`: `({ users: this.users } = v)`.
Emitting the pattern as written would assign to bindings that do not exist, a
ReferenceError in strict mode. Every bound name is SEEDED before the partition,
so all of them advertise as pending, not just the first. An alias binds the
LOCAL name — `{ total: count }` gives `count`, never `total`.

A soft pattern reads from an empty source on failure, so every name lands
`undefined` rather than throwing on a destructure of nothing.

It is SPINE ONLY, and the reason is one thing said three ways: a pattern binds
several names from ONE settled value, so anything needing a per-name sentinel or
a per-name face has nothing to hang it on.

    { a: { b } } = await f();     ✖ nesting — write the inner binding as its own field
    ?{ a, b }    = await f();     ✖ a fan needs a key to park its sentinel under
    &{ a, b }    = await f();     ✖ so does an acquire
    yield { a }  = await f();     ✖ emitting needs one value; a pattern binds several

`static { … }` is JavaScript's own static BLOCK, so a static pattern is not
available — the syntax is already taken.

### 2.4.33 A computed key may suspend — on the spine only [[T-DYNKEY]]

    [await key()] = 1;                  //  ->  this[yield key()] = 1;

A computed key is an ordinary expression position, so JavaScript admits `await`
there inside an async function and `yield` there inside a generator. Almost
nobody knows this; it falls out of the grammar (`[AssignmentExpression]`) rather
than from any use. Superset uses it: the field's NAME arrives with its value,
after the partition, as `this[yield key()]`.

It suspends, so it is a BLOCKER IN ITS PLACE (C-CASCADE): the split can fall on
it, the fields below it wait for it, and a `defer` above it joins after it.
Every computed field now runs in its place (T-FIELDKEY); this is the one whose
key waits.
It used to be emitted last, after every other field and after the defer joins
— out of source order, and held up by a `defer` written above it.

Such a field is UNSEEDED and invisible to static checks — no `PENDING` sentinel
(there is no key to write it under), no sibling-wall entry, no interface guard,
no tier. That is not a hole in the model; a field that names itself at runtime
has opted out of compile-time analysis by construction.

It is legal on the spine and nowhere else, for one reason in three forms: every
other lane needs the name BEFORE the value.

    try [await k()] = 1;    ✖  a failed key is undefined, and this[undefined]
                               writes a field literally named "undefined"
    ?[await k()]   = 1;     ✖  a fan needs a key to park its sentinel under
    &[await k()]   = 1;     ✖  so does an acquire

### 2.4.34 A template interpolation is code, not text [[T-TEMPLATEAWAIT]]

    s = `${await g()}`;

The tokens inside `${ … }` are ordinary tokens. The scanner tokenises each
interpolation and merges its spans into the enclosing list, so the `await` is
seen by `suspends()` — the field seeds and settles — and by the await-to-yield
rewrite. A template treated as one opaque literal would leave a bare `await`
inside the generator, and the field would not even be recognised as suspending.

### 2.4.35 An `await` in a nested function is not the field's [[T-NESTEDAWAIT]]

    f = async () => await x();      // valid JavaScript; the field does NOT suspend

The `await` belongs to the arrow's scope. `suspends()` counts only the field's
OWN tokens, so this is a plain field and the class needs no grain — exactly as
the block rewrite already leaves a nested arrow's awaits alone. Without the
scope test the compiler demanded a lifecycle for a field that has none, and
refused a program JavaScript accepts.

### 2.4.36 A field ends at a NEWLINE, not at a semicolon [[T-ASI]]

JavaScript inserts a semicolon at a line break when the next token cannot
continue the expression, so `class Tab { x = 1 }` is legal. The initialiser span
scanned to the next `;` at depth 0 instead, and with no semicolon it SWALLOWED
the following member:

    x = await f()
    y = 2            <- became part of x's initialiser, emitting invalid JS

every suspending field without a trailing semicolon consumed its
neighbour. `fieldNeedsASI` applies the language's own test — a token at depth 0
that BEGINS A NEW LINE ends the field, but only when the PREVIOUS token could
end an expression. After `+` or `,` the expression is incomplete, so
`await g()` on the next line continues it rather than starting a member. Words
that expect an operand (`await`, `new`, `typeof`, `return`, `try`) never precede
an insertion either.

### 2.4.37 `await(x)` is grouping, not a call — and `.y` binds tighter [[T-AWAITPAREN]]

`await` is a unary operator, so the parentheses in `await(load())` are grouping.
Both spellings are the same expression, and the compiler must treat them so —
the strip was `/^await\s+/`, which demanded a space, so `await(x)` missed the
fast path and took an async-IIFE wrap it did not need. `\b` is the correct
boundary; the lexer has already proven the token.

The sharper half is precedence. Member access binds TIGHTER than await, so:

    await(load()).catch(f)   ===   await( load().catch(f) )

It reads as "await the value, then `.catch` the result", and means "attach the
catch to the PROMISE, then await". it recovers, because the catch ran
first. That is usually what the author wanted — but by accident, not by the
grouping they wrote.

### 2.4.38 The RHS is one suspension [[T-MULTIAWAIT]]

`await` is meaningless inside the plain generator the emit produces, so the
LEADING await may become the `yield` — but ONLY when it governs the whole
expression. `await y()` does; `await y() + 1` does not, because await binds to
`y()`, so stripping it yields `y() + 1`, a Promise concatenated with 1. The
chain after `await` is therefore walked with the LEXER, and the fast path also
requires the remainder to be await-free. Everything else is wrapped whole in an
async IIFE: awaits and precedence stay intact, and the generator yields ONE
promise, so the assignment is the single suspension point.

    setup v = await y();          →  this.v = yield y();                              (fast path)
    setup v = await y() + 1;      →  this.v = yield (async () => await y() + 1)();     (await binds to y())
    setup t = await a() + await b();  →  wrapped whole — precedence preserved
    setup v = await f(await g());     →  wrapped whole — the INNER await would survive

Without the wrap each of those would emit `await` inside `function*` — invalid
JavaScript, silently. The string-literal case is excluded via `stripLits`, so
`await g("await me")` takes no wrap it does not need.

### 2.4.39 `void super()` degrades; `return super()` would not [[T-VOIDSUPER]]

`void` is the operator meaning EVALUATE AND DISCARD, and it is legal
JavaScript — so a detached class run through a plain toolchain becomes a plain
super call with no join, which is what detached MEANS. `return super()` would
have read as termination and killed the rest of the constructor body.

### 2.4.40 Featureless classes are untransformed, not byte-identical [[T-UNTOUCHED]]

    const Tab = class extends Div {};   →   const Tab = class extends Div {\n};

The suite pins that no Instance hook is injected. It does NOT pin byte

### 2.4.41 A computed key runs with its field, not with the class — a departure [[T-FIELDKEY]]

    let n = 0;
    class A { [`k${n++}`] = 1; }        // JavaScript: the key runs ONCE, at definition
    new A(); new A();                    // both instances get k0, and n is 1

**JavaScript splits a computed field in two.** The key in the brackets runs
once, while the class is being defined — in source order with every other
computed key, before any static value — and under the SURROUNDING `this`, with
the class's own name still in its TDZ (`class D { [D.name] = 1 }` throws). Only
the value after `=` runs per instance. So the key of an instance field belongs
to the class side, and `this` in it is neither the instance nor the class but
whatever `this` was outside. Measured, all of it.

**Instance departs: a key runs with its field.** It is evaluated where its
field is defined, in its face's generator — on every `new` for an instance
field, once for a static — and `this` in it is the class body's `this`, the
same on both sides of the `=`: the instance, or the class.

    x = 1;
    [`k${n++}`] = this.x + 1;          ->  this[`k${n++}`] = this.x + 1;
    static [this.base + 'tat'] = 1;     ->  this[this.base + 'tat'] = 1;    (static hook)

Three reasons. The faces do not cross (C-ONESIDE): a key run at definition is
a class-side dependency of an instance field, so `[await key()]` would make the
class settle an instance field's name, one failure would poison every instance,
and a key read from changing state would be stale for every instance after the
first. One rule covers every key: `[await key()]` already ran per instance
(T-DYNKEY), because its name arrives with its value. And definition order is
synchronous order (C-CASCADE): the key runs in its place, so it can read the
fields above it — `[this.kind] = …`.

What it costs, against JavaScript:

- a key with a side effect or a fresh value runs per instance: `[n++]` gives
  `k0`, `k1`, …, and an inline `[Symbol('id')]` gives each instance its own
  symbol. Keep the symbol in a variable to share it, as anything that reads it
  later already does;
- naming the class inside a key works, where JavaScript throws;
- a computed field cannot be seeded — its name does not exist until it runs —
  so it has no TDZ binding: read before its definition, it falls through to
  anything inherited, and it enumerates after the seeded fields below it.

Only the spine is built for a computed field: no lane or `setup`. Every other
modifier — `async`, `defer`, `try`, `yield`, `memo`, a descriptor, `untracked`
— is refused by name, because it would need the key held across a wait.
Computed METHOD names are unchanged: a method is defined once, on the
prototype, and its key runs as JavaScript runs it. A class the compiler leaves
alone — one that extends nothing (T-UNTOUCHED) — keeps JavaScript's rule.

Measured before this ruling: `['k'] = …` stayed a native class field and ran
when `super()` returned, ahead of every compiled field — `x = 1; ['k'] =
this.x + 1` gave `NaN` — and a `static ['k']` ran before the static hook.
`['k'] = await p()` and `setup ['k'] = …` passed through as invalid output.

## 2.5 Emit and map

### 2.5.1 An unknown modifier is a silent bare field [[T-JUNKFIELD]]

A word the column does not know is not refused. It is read as a BARE FIELD named
after itself, and the real declaration is parsed as the next member:

    banana const x = 1;        →   this.banana = undefined;
                                   this.x = 1;

Zero diagnostics. The same happens for every word reserved for future lanes —
`memo`, `setup async`, `watch`, `enum` all behave this way until they are implemented:

    memo defer const x = await f();   →   this.memo = undefined;
                                          this.x = yield ødefer_x;    // plain defer

So `memo defer` today is not `memo` applied to `defer`. It is a junk property
plus an unmodified `defer`, and it COMPILES CLEAN, which makes the feature look
present when it is absent.

The consequence for anyone extending the column: **compiling is not evidence
that a lane exists.** A new word must be checked against the EMIT, and a word
that is spoken for but not yet built must be refused by name, so the failure
arrives at the declaration instead of much later at a property nobody declared.

**A KNOWN word before `as` is the mirror case** (RULED 2026-10-13). The column
reads a signature word as a modifier whenever another word follows it, and `as`
is a word: `const indexed as f()` took `indexed` for the participle and left `as`
as the field's name. The refusal that followed named `as` ("`as` is not a
modifier") or `memo`, never the word the author meant as the name. The walk now
stops at an `as` that binds — an expression follows it on its line — and refuses
the word before it, by name:

    async sync const indexed as migrate.indexes();
      →  `indexed` is a signature word, so it cannot name a field bound with `as` —
         before `as` it reads as a modifier, and `as` is left as the name. Rename the field.

`as` itself stays a name where it is one (`const as = 5`, `static as() {}`). A
signature word before `=` is a name today (`const indexed = 5`): the column reads
a word as a modifier only when another word follows it.

### 2.5.2 The source map cannot change a byte [[T-MAPBYTES]]

Offsets ride on every op, so `{ sourceMap: true }` produces an identical
`code` string to a plain compile — asserted, and by design not an assertion
that CAN fail. Regions ABUT MID-LINE: a region's first fragment continues the
previous region's last line, so splitting each region independently injects a
phantom newline per boundary. A boundary line keeps the mapping of whichever
region OPENED it.

### 2.5.3 A value register is a `var`, declared where it lands [[C-VAR]]

A soft field's value crosses a `try`: it is written inside, and read on the line
after. It used to be declared ahead of the `try` and assigned inside it:

    let øvalue_x;
    try { ølabel_x: { øvalue_x = yield f(); } } catch (e) { øvalue_x = undefined; }
    this.x = øvalue_x;

It is a `var` now, declared where the value FIRST lands (RULED 2026-10-13):

    try { ølabel_x: { var øvalue_x = yield f(); } } catch (e) {}
    this.x = øvalue_x;

`var` is scoped to the FUNCTION — here the face's settlement generator — not to
the block it is written in. So the binding the `try` writes is the one the next
line reads, and every other write names it too: a later `return` rewritten as a
write, or the author's own catch. A block body writes it more than once, and only
the first write carries `var`; a body that never writes it opens its `try` with
`var øvalue_x;`, so the line after still has a binding.

A `var` is hoisted, holding `undefined` until it is written. Two facts make that
enough, and the reset in the catch dead:

- **each field runs once per generator.** The generator is driven once per
  construction, and once per class for the class face, and no emitted field
  stands in a loop, so a register never carries a value from an earlier pass;
- **nothing throws after the write.** Every write is followed by the `break` out
  of the label, or ends the `try`, so a failure always lands before it.

So a failure leaves the register `undefined` by itself, and the default catch is
empty. An author's catch, `finally` and tail are untouched.

**The same idiom runs through the compiler's own source**: where a `try` assigns
a value, the value is declared there, `try { var t = lex(text); } catch (e) { … }`,
not `let t; try { t = lex(text); }`. A default the old declaration carried is
read as `undefined` instead (`cur === null` became `cur === undefined`). `var` is
never written where its function scope would change the meaning:

- at a script's top level, where it would become a property of the global;
- in a loop whose iterations close over it, where `let` gives each its own
  binding;
- beside a `let` or `const` of the same name in the function, which is an early
  SyntaxError.

## 2.6 Cross-module traps

These bit the compiler but are handled in core; `doc-map` does not reach them,
so they carry no anchors.

- **A class cannot be called without `new`.** Core's boot gate called every
  provided function as a factory (`typeof val === 'function' ? val(GLOBAL)`),
  which killed the compiler the moment it became a class. The gate now
  distinguishes the two (`_isClass`), so any module may publish as a class.
- **`await` on an element hangs.** The Meta get-trap serves a callable for
  `then`, so promise machinery treats a setup-grain element as a thenable and
  spins. Suite pins that touch iterable faces construct without `await` for
  this reason.
- **A Proxy over a builtin with internal slots throws.** `Map`, `Set`, `Date`,
  `Promise` methods called through a transparent proxy raise "incompatible
  receiver", and private fields raise on brand checks. This is why the kernel's
  skin admits plain objects and arrays only.

---

# Part 3 — Rulings

### 3.0 Async init priority — definition order is synchronous order [[C-CASCADE]]

**The architecture is built on this ruling; every other one assumes it.**

A class body is a list of definitions, run top-down on each face, as
JavaScript runs it. Instance mirrors that order and extends it to values that
take time — that is what the settlement generator is for.

    mixed class* Config extends Div {
        static pin version = 1;
        static setup schema = await load();
        static const LIMIT = 10;
        static async stats as fetchStats();
        static enum MODE = 'live';
    }

    ø.pin(this, 'version', 1);
    ø.pending(this, 'schema', 'LIMIT', 'MODE'); // @seed
    yield (yield);                    // @partition
    this.schema = yield load();
    ø.const(this, 'LIMIT', 10);
    ø.fan(this, 'stats', fetchStats());
    ø.enum(this, 'MODE', 'live');

1. **A blocking async blocks the DEFINITION of every field after it on its
   face, until it settles** — not only their settlement: their definition. The
   fields below a `setup` wait for it as the statements below an `await` do.
2. **A fan blocks nothing.** It is still in order — it starts in its place,
   after everything above it — but the field after it is defined at once. In
   practice definition order is synchronous order: an awaited statement holds
   the lines below it, a promise started and not awaited does not.
3. **A field may be declared anywhere in the body.** Nothing has to sit at the
   top. A row is DESCRIBED where its field is defined: `LIMIT` has no row until
   `schema` clears, because the row rides the write that defines it
   (`Superset.define`, C-DEFINE).
4. **Before its definition a field is in its TDZ.** The seed makes the key
   exist from the top of the hook — so it shadows an inherited name the way
   `let` shadows an outer binding from the top of its block — hidden, pliable,
   without a row. The first real write is the definition, and it installs the
   row. Fields are not hoisted, as `let` and `const` are not; that is also why
   `var` is gone (C-PIN).
   - **Class face: a TDZ.** Reading or deleting a static before it settles
     throws `ReferenceError` — `Cannot access static 'LIMIT' of Config before
     it settles`. A class is reachable by name the moment its declaration
     evaluates; nothing hands it to you to await first.
   - **Instance face: no TDZ, for now.** A pending field reads `undefined`:
     `new` hands you a thenable and you await it (C-ONESIDE). Its definition
     waits all the same — until it lands it does not enumerate and has no row.
5. **`await super()` is a blocker above every instance field** (C-ONESIDE), so
   a `setup class` describes and defines its whole instance face after the
   parent settles.

Until `Config` settles, `Config.version` is 1, `Object.keys(Config)` is
`['version']`, and `LIMIT` and `MODE` exist only as bindings: hidden,
configurable, unreadable. After `await Config`, `LIMIT` is non-enumerable and
non-configurable and `MODE` enumerates — each from its definition.

**Two moves are contracts, not exceptions.** `defer` starts its work where it
stands and writes at the local tail (T-ORDER): it joins only once every
other member of its face is defined — fans included, started but not
necessarily landed — so it never holds up a field below it, and its row is
described at the tail, where it is defined. A field past a blocker that REJECTS is never
defined: poisoning writes the sentinel into its cell and the key stays hidden.

**Measured before this ruling:** every row was described first in its hook, so
the seed installed each post-blocker key under its final row. `pin` and `enum`
statics enumerated while reading them threw — a key you could list and not
read — and `const` had locked a key that was not yet defined. And a subclass
that had already written one static held a store, so a second, inherited static
it wrote went into that store with no property of its own.

**One seam, no copies.** A plain write with a row is one `Superset.define`,
row and value together (C-DEFINE). For every other shape the compiler cuts the
face's ops at every suspension — the partition, a blocking field, a batch
barrier, a suspending emit, key or constructor statement — and opens each
segment with one row line for the fields it defines — the descriptor words with
the names as a list, `ø.let(this, ['x'])` (`describeOps`). The core has one seed (`seedKey`: a
hidden, pliable accessor), one definition (`defineKey`: the first write that is
not a sentinel installs the row), and one TDZ message (`tdz`); `describeHost`
never applies a row to a seeded key. C-ONESIDE (3.14) says when a field
SETTLES and C-SEED (3.15) that its key EXISTS; this ruling names what lies
between them — when it is DEFINED.

### 3.1 One axis, no third vocabulary [[C-FLIP]]

FORM is the one table (`{ setup: 'await', mixed: 'yield', async: 'void' }`) and
LINK is derived from it — the identity plus the inverse — so the spelling and
the semantics cannot drift apart.

the take/forward/detach vocabulary existed only to be translated
into, and is deleted on both sides — the grain words ARE the link semantics.
A super-form is another SPELLING of the same word. `cap` remains the absence —
an unmarked bare `super()`.

    setup class    joins its parent, serially. WAS `async class`.
    mixed class   parallel levels, both in the chain.
    async class   RESERVED for detached.

The rename is behaviour-preserving, but a migrated and an un-migrated
`async class` are indistinguishable after the fact — so the word is refused
rather than reinterpreted.

### 3.2 Every grain question, answered once [[C-GRAIN]]

`grains(rec, code)` returns `head` (the class word's own link), `link` (what
the constructor does), `mode` (the super-form to emit), `cls` / `inst` (the
per-face grains), `dInst` (the instance word as declared), and `parts` (the
constructor parse). They were four functions that each re-parsed the
constructor: `ctorParts` ran FIVE times per class, now once.

`iterable` and `untracked` are STRUCTURAL modifiers on a different axis: they
never enter containment or the matrix. On a method `untracked` wraps the body;
on a field it is a participle on the row (C-UNTRACKED).

### 3.3 A face that declares field grains must declare its own [[C-DECLARE]]

**Silence is an error, never an inference.** Four rules, all hard
`SyntaxError`s. Custom keywords are `setup` / `async` / `mixed` / `defer` and
the `@` `&` `?` shorthands.

    1. grained STATIC  → the CLASS head must be marked
    2. grained FIELD   → the INSTANCE face needs a grain from SOMEWHERE: a
                         constructor word, a super-form, or the class grain.
                         An authored constructor that declares neither
                         inherits the class grain, exactly as a synthesized
                         one does — only silence everywhere is refused.
    3. any child of a declared `setup class` → MUST `await super()`, every grain
    4. declared lifecycle vs face grain → checked against ADMITS regardless of
       whether the initialiser suspends

    class A extends Div { static setup cfg = await p(); }   ✖ head declares no grain
    class B extends Div { setup b = await p();
                          constructor(){ super(); } }      ✖ ctor declares no grain
    class C extends Div { setup b = await p(); }            ✖ no ctor, and no class
                                                              grain for one to inherit

The constructor may declare its grain as a WORD or as a SUPER-FORM —
`constructor(){ await super(); }` says `setup` exactly as `setup constructor`
does, because a super-form is another spelling of the word (C-FLIP) — or it may
declare NEITHER and inherit the class grain:

    mixed class Ticket extends Div {
      /* mixed */ constructor(id = mintId()) { yield super(); this.token = id; }
    }

With no authored constructor one is SYNTHESIZED from the class grain, so the
class word serves both faces either way.

Containment is judged on the DECLARED lifecycle, whether or not the initialiser
suspends: `setup class L { async b = p(); }` is refused because `b` is a fan by
declaration and a `setup` class admits none. Only an UNdeclared field is judged
by its text.

C-UNMARKED's "containment never forces an annotation". It does
now, in one direction: declaring a field lifecycle forces the face to declare
its grain. Silence is still computed where nothing is declared.

### 3.4 Unmarked is not declared [[C-UNMARKED]]

Collapsing "unmarked" into "mixed" made strictness unreachable — every
unannotated class counted as open, so a `setup` child could only extend an
explicitly `setup` ancestry. A declared `mixed` says "there are fans here";
silence says nothing. For a locally visible class the compiler can SEE whether
the face holds a fan. (Narrowed by C-DECLARE: a face that declares any field
lifecycle must declare its own grain — silence is only computed where nothing
was declared.)

### 3.5 Sigils are lifecycles [[C-SIGILS]]

    @name   SYNC     seeded, settles after the partition — the class waits
    &name   ACQUIRES starts where it stands, joins at the tail

The `defer` KEYWORD is the same thing as `&`. Statics keep the WORDS, not the
sigils: `static @x` is refused with the fix in the message.

### 3.6 Containment [[C-CONTAIN]]

<!-- verify:ADMITS -->
```js
{ sync: ['sync', 'defer'], mixed: ['sync', 'defer', 'async'], async: ['async'] }
```

`setup` and `defer` share a cell because both JOIN — they differ in timing, not
guarantee. Only a FAN opens a class, which is what `mixed` claims. UNMARKED IS
MIXED, so containment never forces an annotation.

TWO INIT PHASES, TWO GRAINS: the head governs the CLASS side, the constructor
the INSTANCE side. `mixed class Tab { setup constructor(){…} }` is legal — open
statics, closed instances.

THE SUPER-FORM DOES NOT CONSTRAIN THE FIELDS. `void super()` detaches from the
PARENT and says nothing about own fields.

<!-- verify:SLOT_LANE -->
```js
{ fan: 'async', acquire: 'defer' }
```

(anything else is lane 'sync'.)

### 3.7 The cap rule [[C-CAP]]

A `setup` constructor CAPS the chain, so it may extend only a `setup` parent. An
opaque parent has no known grain and is ASSUMED setup — permitted rather than
falsely refused. Measured cost of the rule's absence:
`class C extends P { tag = 1 }` over a settling P let `await new C()` resolve
with the parent's field unsettled — undefined, no throw, no sentinel.

### 3.8 The contract is inherited [[C-INHERIT]]

`setup` requires a setup ancestor, `async` an async one, `mixed` accepts any. A
promise cannot be kept over an ancestor that already disclaimed it. Checked PER
FACE. An unknown parent is assumed closed.

### 3.9 A declared setup parent orders the chain [[C-SYNC-PARENT]]

DECLARED, not computed: keying on the computed grain cost every plain subclass
its synchronous prefix (`new B().v` read undefined — measured), because a
fanless unmarked class counts as closed yet has promised nothing.

### 3.10 The inheritance matrix [[C-MATRIX]]

    CONSERVATION     a child may not DROP a join its parent mandates
    MATERIALIZATION  a child may not AWAIT a join its parent refuses

                   parent setup   parent mixed   parent async
    await super()      ok            ok           refused  (nothing to await)
    yield super()      ok            ok           refused  (nothing to aggregate)
    void  super()    refused       refused          ok     (nothing to strand)
    bare  super()    refused       refused          ok     (the cap rule)

### 3.11 Conservation rulings [[C-CONSERVE]]

Conservation is NOT waived for a declared `async class`: waiving it
makes the parent's settled half permanently unobservable through the child.
Conservation and the cap rule are SUBSUMED by the ordering rule: only a
declared `setup` parent mandates a join, so `mixed` accepts every link.

### 3.12 The only yields [[C-IR]]

Exactly two: `yield (yield [this])` — the partition — and `this.x = yield EXPR`.
v8's name-yields sat in the synchronous prefix where pausing means nothing;
removing them changed nothing observable (identical pending state, settled
values, 66/66 partition counts) and let the seed collapse to one statement.

### 3.13 Comprehensions: the star is mandatory [[C-DRAINS]]

`name[]*` fills an ARRAY, `name{}*` an OBJECT. The
bare form is REFUSED with a diagnostic naming the spelling, so a file written
against the old grammar fails loudly instead of changing meaning.

The SOURCE decides drain vs spread: an initialiser that suspends drains through
the generator, one that does not spreads eagerly. The TIER decides whether the
filling is observable — a bare name assigns ONCE, any tier sigil accumulates in
place. Tier meanings moved under the split-lane ruling: `$` is the ATOMIC lane,
`Δ`/`Σ` the proxy lanes; observability follows the PRESENCE of a sigil.

**The drain is the runtime's generator, delegated to** (RULED 2026-10-12):

    rows[]* = await s();     ->  this.rows = yield* ø.drain((yield s()));
    map{}* = await pairs();  ->  this.map = yield* ø.drain((yield pairs()), {});
    Δrows[]* as s();         ->  this.Δrows = []; yield* ø.drain((yield s()), this.Δrows);
    yield* stream();         ->  yield* ø.drain((stream()), _ => ø.emit(this, _));

`ø.drain(src, into)` yields each step of the source to the hook's driver exactly
as the inline loop did, so the settlement protocol — one suspension per item,
the author's catch first on a rejection — is unchanged; what the emit loses is a
loop and five registers per drain. `into` is a new array, a new object, the
field itself (the tiered form, so every push lands on the reactive array), or a
function called with each item (the tee).

### 3.14 The settlement law, and the one difference between the faces [[C-ONESIDE]]

**Nothing past a blocking async is defined until that blocker settles.
Order is top-down. Both faces, same law.** What a definition is — when its
row is described, what its key looks like before then — is C-CASCADE (3.0).
The faces do not cross: a blocking static does not defer instance fields, and
a blocking field does not defer statics — never the twain shall meet.

`await super()` is not an exception to this; it IS the law. `this` is in TDZ
until `super()` returns, so an awaited super is a blocking async sitting ABOVE
every instance field — split 0 falls out of the general rule rather than
overriding it. A `setup class` with no authored constructor synthesizes one with
`await super()`, which is why every field of a `setup class` settles together.
A `mixed` link (`yield super()`) aggregates rather than blocks, so its fields
split at the first blocker of their own.

    mixed class A extends Div { a = 1; setup b = await p(); c = 3;
                                mixed constructor(){ yield super(); } }
        a immediate · b, c seeded and settled in order

    setup class B extends Div { a = 1; setup b = await p(); }
        both deferred — the synthesized `await super()` blocks above them

    class C extends Div { static setup cfg = await p(); n = 1; }
        n immediate — the static's blocker is on the other face

**The one difference between the faces is what a PRE-SETTLEMENT READ does.** An
element is handed to you by `new` and is thenable, so pending is part of that
handshake: the value setup answers `undefined` and you await. A class is
reachable by name the moment its declaration evaluates, with no handshake
object to point at, so an unsettled static is a program error and throws a
`ReferenceError` — an ordinary TDZ read. Consistently loud beats the old
sentinel leak, which was loud on coercion and silent on every test.

Instance fields and statics settle by the SAME rules. v8 drifted three ways:
plain fields past the split seeded on one side only; an `async` grain forcing
split 0 on one side only; class-side fans past the split dropped ENTIRELY.

The split is the one legitimately per-side thing: an element does not exist
until `new`, but a class OBJECT exists from the moment the declaration is
evaluated, so the class side splits at its first blocking member on any grain.
Keyed on the folded LINK, not the raw word.

### 3.15 Seeding [[C-SEED]]

Everything past the split is seeded so its key exists during the synchronous
prefix — plain members too. A FAN is never seeded: fire-and-forget has no
pending state to advertise.

The seed is a BINDING, not a definition (C-CASCADE): a hidden, pliable key
with no row, which shadows an inherited name and reads as a TDZ on the class
face. The field's first real write defines it and installs its row.

One call seeds a face — `ø.pending(this, 'a', 'b')`, in source order —
through the same [[Set]] a field write takes. It replaced an `Object.assign` of
one repeated sentinel per name. A `#private` name has no string to pass, so it
seeds through its own accessor (`this.#p = Symbol.for('??')`).

### 3.16 Monomorphic emit [[C-EMIT]]

ONE hook shape at BOTH faces — `this[Symbol.new](function* () { … })`. The
receiver carries the face; the leaf class is never named. The emitted @-tokens
are OUTPUT PROTOCOL, retained in full and suite-pinned.

### 3.17 Anonymous classes and per-instance keys [[C-ANON]]

The hook never names the class. the private cell
key is an INSTANCE field (`#ǁxǁ = Symbol()`), minted post-super and pre-hook,
so factories and mixins get isolated keys and the emit carries no class
reference. The TIER rides as the cell's second argument, since symbol keys
carry no sigil.

### 3.18 The core protocol [[C-PROTOCOL]]

The hook is `this[Symbol.new](function* () { … })`. A `*[Symbol.new]()` MEMBER
in a chain is doubly dead: it shadows the hook and swallows the child's call,
and nothing drives its own body.

### 3.19 Double-sided sigils — banned [[C-SIGIL]]

A name may carry a tier run as a PREFIX or as a SUFFIX, never both:
`Δcount$`, `Σx$`, `$vΔ` all throw TypeError — in the compiler at parse and in
the kernel at the store gate. TypeError, not SyntaxError, because the words are
legal and the combination is a kind of key that cannot exist.

### 3.20 The compiler owns the page from its import [[C-CAPTURE]]

    <script src="i_superset-10.97.js"></script>
    <script>  mixed class Tab extends Div { … }  </script>

At import, while the parser is still running, the compiler writes an UNCLOSED
`<template>`. Everything after it becomes template content, which the HTML spec
makes inert — scripts do not execute, images do not load, stylesheets do not
apply — and at EOF the "in template" insertion mode pops the template off the
stack of open elements, so it self-closes unaided. At DOMContentLoaded the
capture is walked and the page is put back.

THE CAPTURE IS THE POINT, not a side effect. The alternative to owning the
document is regexing a source string for script tags, which is reimplementing
the HTML tokenizer badly. The parser has already done that work correctly and
handed back a tree; this declines to throw it away. Everything the hydrator
touches is a NODE — `script.textContent`, `node.tagName` — and never a match
offset.

REWRITE, THEN APPEND ONCE — THE BROWSER IS THE SCHEDULER. While the capture is
still detached, every block that is ours is compiled and its source REPLACED
with the resulting JavaScript; then the whole fragment is appended in one move
and the ordinary script-execution rules produce exactly the order the page
asked for. Fetching for an external block happens in the rewrite pass, before
anything is live, so the append stays synchronous and the browser sees one
complete tree.

This is why `async` and `defer` are supported rather than special-cased. A
hand-rolled walk that ran each block itself has to reimplement a scheduler that
already exists, and gets it subtly wrong: the first version of this ran
everything in a sequential await loop, which inverted a plain `<script>` placed
after an Instance block. Letting the attributes survive and the browser act on
them is both less code and more correct.

HYDRATION RUNS AT `interactive`, WHICH IS STILL BEFORE DOMContentLoaded.
Parsing ends, readiness flips to "interactive", the deferred scripts run, and
only then does DCL fire — so "interactive" is the same slot a deferred script
occupies and the last moment still in front of the event. Hydrating AT DCL, as
this first did, put every captured block after it: a `defer` block ran after the
event it is contracted to precede, and the page's own DCL listeners saw an empty
document. `DOMContentLoaded` stays wired as a backstop for a readyState that is
polyfilled or never transitions; hydration is idempotent, so whichever arrives
first wins.

The recovery is not total. The rewrite pass awaits a fetch for any EXTERNAL
block, and that await can carry the append past DCL. A page whose blocks are all
inline takes no await at all and hydrates synchronously inside the
readystatechange handler, wholly before the event.

CAPTURE STILL SHIFTS THE PAGE'S SCRIPT TIMELINE, and that much is inherent —
nothing inside the capture can run before the capture closes. Within
the shifted timeline RELATIVE order is exact: inline scripts run in tree order,
`defer` and `async` are ignored on inline scripts precisely as the spec ignores
them, and an external classic script is put back on the in-order list with
`async = false`, since a dynamically inserted external script would otherwise
default to running whenever it lands. What cannot be recovered is ABSOLUTE
timing: an `async` script that would have run mid-parse now runs at hydration.
A `defer` script, however, lands back where it belongs — hydration at
"interactive" is precisely the window deferred scripts occupy.

WHAT IT COSTS. Nothing after the import renders until DOMContentLoaded, and
resources inside the capture are not fetched early, because the preload scanner
sees inert content. The import therefore belongs as late in `<head>` as it can.

THE REFUSAL IS LOUD, and it is the reason this is safe to use. Capture only
works from a parser-blocking classic script during parsing; `async`, `defer`,
or injection after load would either have `document.write` ignored or have it
blow the document away. A silent non-capture is the worst outcome available —
every Instance block on the page would run as JavaScript and throw, with raw
markup rendering behind it. So the guard throws, naming the cause, rather than
continuing without capture. This is the one place where inertness depends on a
preceding script having succeeded; `<script type="text/instance">` needs no
capture at all and remains the right choice for a page that only wants a few
inert blocks.

GLOBAL BY DEFAULT. A plain compiler tag owns every script after it: any
captured JavaScript, typed or not, is Instance source and needs no keyword.
`sandbox` on the compiler tag narrows the compiler to the blocks that opt in:

    <script src="i_superset-10.97.js" sandbox></script>
    <script superset>  mixed class Tab extends Div { … }  </script>

The routing:

    superset               always compiled, whatever the type says
    an Instance type       always compiled, as on an uncaptured page
    a `.is` source         always compiled
    JavaScript             compiled in global mode — untyped, any JavaScript type,
                           an inline module; left alone under sandbox
    an external module     left native: inlined, it would resolve its imports
                           against the page instead of its own URL
    a data block           never compiled — importmap, JSON, templates, the rest

The mode is the one escape hatch: to keep a library native, scope the compiler
with `sandbox` and mark your own blocks `superset`. A data block used to be
treated as Instance source because its type was unrecognized, which would have
compiled an import map or a JSON-LD block into a script; data is now left alone.

The first three DECLARE Instance source. JavaScript in global mode is CLAIMED by
the mode, and the difference shows only on failure. A declared block
that cannot be fetched or compiled is not JavaScript, so it is refused and does
not run. A claimed script that cannot be fetched or compiled is handed back to
the browser exactly as written, to run as the plain script its author wrote,
with a warning that its deletes are not observed.

`override` is retired, because it is what a plain tag now does; it still loads,
with a warning, and `sandbox` wins if both appear. `<script super>` is the
retiring name of `superset` and still works, with a warning.

SRI SURVIVES THE COMPILER. The browser checks `integrity` on its own script-load
path, and a compiler that fetches the source itself would bypass that check. So
the fetch CARRIES the attribute: `fetch()` enforces `integrity` natively — the
browser's own parser, strongest-hash rule and refusal — and the compiler never
sees bytes the browser would not have run. Credentials and referrer follow the
tag's `crossorigin` and `referrerpolicy`. Failure needs no special case: a
claimed script whose fetch fails — network, CORS, `file://`, or a tampered
byte — is handed back with its `integrity` intact, and the browser's own check
then has the final word. A tampered declared block is refused outright.

Every fetch starts at once and is consumed in tree order, so the page waits for
its slowest script rather than the sum. Fetched scripts are inlined before the
append, which removes the race a captured external script otherwise runs
against the inline blocks around it. The cost is timing: a page with any
captured external script of ours hydrates after its fetches land, which usually
means after DOMContentLoaded. A page whose captured blocks are all inline takes
no await and still hydrates synchronously, before it.

ONE HYDRATION, EVEN ACROSS AWAITS. `hydrate()` is wired to two signals, and a
second import attaches a hydrator of its own; removing the capture is what makes
the later callers no-ops. The capture used to be removed only after the rewrite
pass — and that pass awaits fetches, so a call arriving mid-fetch found the
capture still in place and hydrated the page a second time, running every
script twice. The capture is now unmarked synchronously, before the first await.

GLOBAL MEANS THE WHOLE SCRIPT IS INSTANCE. Ordinary JavaScript comes through
unchanged — measured on plain classes, generators, regular expressions, a
minified IIFE and async code, with only `delete` rewritten — but Instance gives
a class that extends an element its own semantics. A native web component
(`class Card extends HTMLElement`) becomes an Instance element class, and its
private fields become reactive cells. A component library loaded through an
script after the compiler therefore runs as Instance — or, under `sandbox`,
natively.

BYPASS. `bypass` (or `data-bypass`) on a script asks the compiler to leave it
alone, and wins over `superset`. Under `sandbox` it is always honoured. In global
mode it is refused — the script is compiled like any other, with a warning —
unless the compiler tag allows it:

    allow-bypass              any script may bypass
    allow-bypass="external"   external scripts only
    allow-bypass="inline"     inline scripts only

A value the compiler does not know allows nothing. Bypass skips compiling, never
the nonce gate or Trusted Types: a bypassed script goes back exactly as the parser
would have run it and no more trusted than that, or `<script bypass src=…>` would
be the laundering the nonce gate exists to stop. Measured in Chrome: injected
bypass scripts are refused, a nonced one runs uncompiled, no violations. The
core's scan honours `bypass` too, so nothing in Instance compiles a bypassed block.

`<x-script>` is RETIRED. It was a registered custom element whose class did
nothing while the compiler compiled its content; its content was HTML text, so a
`<` before a letter had to be written `&lt;`, and a stray tag could swallow the
rest of the page. The runtime recovery for that, the editor's quick fix and the
element itself are gone: the joke cost more than it was worth. `<script superset>`
is the raw-text form.

STRICT CSP AND TRUSTED TYPES. Measured in Chrome 153 under `script-src
'nonce-…' 'strict-dynamic'; require-trusted-types-for 'script'; trusted-types
superset`: every legitimate script runs — plain, compiled, top-level await, an
Instance element, a nonced external script — with no violations, and injected
scripts without the nonce do not run. `super-demo/super-demo.html` is that test,
alongside the capture itself, and reports its own results. Four rules make it so.

NOTHING GAINS TRUST BY BEING PUT BACK. Under `'strict-dynamic'` a script inserted
by a trusted script is itself trusted — and in Chrome that holds for an inline
script too, nonce or not (measured). Hydration re-inserts every captured script,
so a script the parser would have refused came back trusted: the capture
laundered it. With the previous compiler both an injected external and an
injected inline script ran. Now, when the compiler tag carries a nonce, every
captured script that would execute must carry the same one, or it is put back
inert. The nonce is read through the IDL property — the browser blanks the
attribute after insertion — and it is never written anywhere.

ONE NAMED POLICY. Under Trusted Types the capture's `document.write` and compiled
script text are sinks. Both go through a single policy, `superset`, which the
page's `trusted-types` directive must allow. It is private to the compiler's
closure and narrow even so: createHTML accepts only the capture tag, createScript
only the text the compiler handed it on the line before. The previous compiler
could not run under Trusted Types at all — the capture's write was refused.

TRUST IS RE-ASSERTED, NEVER WIDENED. What hydration puts back is a clone, which is
not parser-inserted, so under Trusted Types even an unchanged script reads as
tampered and is refused (measured). Every script that passed the nonce gate gets
its own text back through the policy: the same text, so the same trust the parser
gave it — and the same hash, so a hash-based CSP still matches. Text the compiler
did change cannot match a hash-only policy; such a page needs a nonce.

NO EVAL. The compiler never calls the Function constructor; every refused call
would have been a violation report reading "this library evals". Top-level await
is found from the token stream — agreeing with the engine on 49 of 50 cases, and
right where the engine is not: `await (f)()` parses as a call to a function named
`await`. A package manifest is read as the data it is. Fetching an external
script is governed by `connect-src`, not `script-src`; a fetch that policy refuses
fails like any other, and a claimed script goes back to the browser under its own
nonce.

A hydrated block is left in the document as what it became: ordinary inline
JavaScript, so the compiled source is what devtools shows. Two attributes are
removed and one is kept, and the distinction is worth stating because it is not
about tidiness.

`src` and an Instance `type` are removed because THEY DECIDE WHETHER THE BLOCK
RUNS. A leftover `src` would have the browser fetch and execute the original
Instance source as JavaScript; a leftover `text/instance` is a data block the
browser refuses to execute at all — and removing it is also what keeps core's
scan from finding an already-run block and running it twice.

`superset` is KEPT. It is the author's intent, it reads correctly in devtools,
and nothing needs it gone. `integrity` is removed from an inlined script: the
fetch verified it, and it means nothing on an inline script.

WHETHER A BLOCK HAS ALREADY BEEN TAKEN is answered by a module-private symbol
installed with a bare `defineProperty` — non-enumerable, non-writable,
non-configurable — and not by an attribute. The `data-instance` attribute it
replaced was not expensive, since the mutation happened on a detached fragment
with no observer watching, but it was wrong in kind: a private bookkeeping fact
written into the public document, where it serialises into `outerHTML`, reaches
anyone's CSS and selectors, and survives into a saved page. A fact that belongs
to one module belongs on a key only that module holds.

A WeakSet would also serve, and would be strictly more private — a symbol key
is still reachable through `Object.getOwnPropertySymbols`. The symbol is one
property slot on an element that is about to be collected anyway, against a set
that must be allocated and traced. Neither matters at this scale; the cheaper
one wins. The mark does NOT survive cloning, so the rewrite pass clones first
and marks the clones.

TOP-LEVEL YIELD gets a generator, and only when it is there. `run()` wraps a
block in an async arrow, which is a SyntaxError around `yield`; a block with a
top-level `yield` is wrapped in an async generator and drained instead. It is
not done unconditionally because the wrapper is not free: declarations inside a
generator are function-scoped, so a class declared in a wrapped block is not
visible to the next block, while an unwrapped one is. Paying that everywhere
would quietly change what a page means.

A block that AWAITS at top level is wrapped in an async body, as one that
yields is wrapped in a generator. Whether it awaits is asked of the engine —
plain body fails, async body parses — since a lexical scan cannot tell
`async () => await x` from a top-level await. Wrapping makes the block's
declarations function-scoped, so it happens only where it must.

THE SCAFFOLDING GOES BEFORE THE PAGE COMES BACK. The capture template is
removed before the restored content is appended, because inline scripts run
during the append: removed afterwards, it was visible to every restored script.
By the time any of them runs, the page reads as the author wrote it.

THE CAPTURE LIVES IN THE COMPILER, AND IS ON BY DEFAULT. `i_super-1.0.js` is retired:

    <script src="i_core-0.89.o.js"></script>
    <script src="i_chimera-18.4.2.js"></script>
    <script src="i_dsl-8.0.0.js"></script>
    <script src="i_superset-10.97.js"></script>   ← last; owns the page from here

A page that hosts Instance source as DATA rather than code opts out with
`nocapture` on the compiler tag — the suite does, since its blocks are test
cases a harness runs. An external script loaded after the compiler is captured
with the page, and is announced in the console, since an inline block may run
before it arrives. The compiler loads LAST, and refuses
otherwise: it captures everything after it, and at hydration an inline block
runs on insertion without waiting for external scripts, so a captured core
could arrive after the blocks that need it. Classic scripts load from
`file://`, so a page whose Instance source is inline needs no server.

The async guard reads the NATIVE `async` boolean where there is one, and the
attribute otherwise. Instance's DSL installs an element method named `async`,
and where a script element has no native property — jsdom has none — the
method shows through, truthy, and a good page was refused.

### 3.21 `yield` carries the blocking lane [[C-YIELDLANE]]

When a declaration says `yield` and names no lane, the lane is the blocking
one. `yield const x = await f()` and `yield setup const x = await f()` compile
to the same bytes.

This is not an overload. The emit for a blocking field was always

    this.x = yield f();

so the word was sitting in the output the whole time, and `yield` in JavaScript
already means precisely *hand this out and park the frame* — which is the
blocking lane's entire behaviour. The rule follows from the two halves being
the same act: a field that emits must block in order to have something to emit,
so a declaration that says `yield` has already named its lane.

AN EXPLICIT LANE STILL WINS, and the useful case is the one that disagrees:
`yield async const x = await f()` stays detached, emitting when it lands. Only
the omitted lane is filled in.

`sync` is NOT retired by this. `sync const x` blocks without emitting, and
that remains the only way to have a blocking field that stays off the stream.
The two words answer different questions — `yield` says *block and emit*,
`setup` says *block* — and a language with both can express a private blocking
field, which a language with only `yield` cannot.

Nor could `yield` replace `setup` everywhere even if that loss were accepted:
`setup` is also the class-head grain word, and `yield class Foo {}` is already
valid JavaScript — a yield expression whose operand is a class expression,
legal inside exactly the generators these constructors compile to. The word is
available in the lane slot and taken at the class head.

### 3.22 `try` on a method is permanent [[C-SOFTMETHOD]]

On a FIELD, `try` wraps a one-time evaluation. On a METHOD it wraps the BODY, on
every call, for the life of the function:

    static try connect() { … }
    ->  static connect() { return ø.soft(() => { … }); }

The word cannot stay in the text. Left there, the soft-EXPRESSION rewriter reads
`try connect()` as a tried call and emits an IIFE with the method body stapled
on after it — invalid JavaScript, carrying no diagnostic. It is lifted at parse
and reapplied to the body.

A RUNTIME HELPER, NOT A `try`/`catch`, and the reason is narrow: inside an async
function `try { return p }` DOES NOT catch p's rejection, because the promise
settles after the block is left. A body wrap would therefore leave
`return fetch(u)` silently hard. The helper inspects what the body returned and
attaches the recovery to the promise instead, so a bare return is soft without
rewriting anyone's `return` statements.

A GENERATOR takes a direct `try`/`catch` instead: its body holds `yield`, and an
arrow cannot.

Which of the two meanings applies is decided by `=` against `(`, never by word
order — `static` and `try` commute, and a signal that can contradict itself is
worse than none.

### 3.23 Descriptors describe a method's slot [[C-METHODDESC]]

`let`, `const` and `enum` apply to methods and accessors, answering the same two
questions they answer for a field — can it be written, can it be seen:

    static const connect() { … }    the method cannot be replaced
    enum ping() { … }               the method is visible to enumeration

A descriptor cannot ride in the text either: `static const connect() {}` is not
JavaScript, and passing it through emitted invalid output with no diagnostic. It
is lifted and reapplied AFTER the class exists — the first moment the method
property is there to redescribe — as
`ø.redescribe(this.prototype, {const:['connect']})`, first in the static
hook — a method slot lives on the prototype, so that is the object named.

`get` and `set` share the descriptor slot and are NOT lifted. They are
JavaScript's own words and the emit needs them where they stand.

A field's descriptor is chosen when its accessor is installed; a method is
already on the prototype by the time the class body closes. Same three answers,
two different moments.

### 3.24 Only `try` may precede `static` [[C-STATICLEFT]]

    try static yield const x = await f();     ok — try commutes with static
    static try yield const x = await f();     ok — the same declaration
    yield static      const x = await f();    refused
    defer static      const x = await f();    refused
    const static            x = 1;            refused

The outer position is not open seating. `static` says which FACE owns the
member; everything to its right describes a member on that face. A lane answers
*who waits for this value*, a descriptor answers *how does this slot behave* —
and a bare `static { … }` block has no value and no slot, so neither word has
anything to say about it.

`try` does compose with the block, because a block has a body and a body can
fail. That is the whole of its claim to the outer position, and it is why it is
the only word with one.

The refusal names the word that moved rather than reciting the grammar, because
the fix is always to move that one word and never to rewrite the line.

### 3.25 The background waterfall — `async setup` [[C-WATERFALL]]

    async setup const step1 = await migrate.a();    // starts immediately
    async setup const step2 = await migrate.b();    // starts once step1 lands

Detached, so nothing waits for it; ordered, so each one STARTS only after the
previous `async setup` field on that element has resolved. `setup` means what it
means here — *in sequence* — applied to a lane that doesn't block.

It is the mirror of `memo`. `memo` starts everything at once and holds back the
WRITES; the waterfall holds back the STARTS themselves, which is why its
right-hand side is compiled as a thunk rather than evaluated where it stands.
The chain is per lane, so a waterfall never delays a plain `async` field. A step
that never resolves stalls every step after it — inherent to a waterfall, and
invisible at the call site.

### 3.26 One table for every word [[C-WORDTABLE]]

Every modifier the column knows lives in a single table in the compiler, one
row per word, and the sets the parser consults — grains, lanes, aliases, the
head-strip list, reserved words — are computed views over it. Renaming a word is
one key; retiring one is a `retiring:` field that the diagnostics read.

The table exists because the sets used to be maintained by hand, six of them,
and they drifted independently: adding a lane meant remembering every place it
had to go, and a seventh — the sigil word map — was hiding outside them all.
Making the table the only source means a word cannot be half-added.

### 3.27 `as` — bind to what the right side produces [[C-AS]]

    let   token  as auth();          // the value — blocks, writable
    enum  region as geo.detect();    // the value — blocks, visible
    const task   =  fetchTask();     // the promise itself

`as` binds a field to what its right-hand side PRODUCES; `=` binds it to the
expression's value as written. It is the `= await` pair fused into one
operator, and it implies the blocking lane when no other lane is named — so
`let token as auth()` is `setup let token = await auth()`, byte for byte.

IT IS DECIDED BY SYNTAX, NOT BY TYPE. `as` is a token, so the compiler knows at
parse time which fields suspend. The partition stays compile-time, and every
`=` field keeps its place in the synchronous prefix. A design where `=` itself
unwrapped whatever turned out to be thenable would have to push every
call-initialized field past the partition, because the pre-partition region
cannot suspend — and it would let a helper changing from setup to async
silently change a class's settlement timeline.

`=` IS THE ESCAPE HATCH. Nothing unwraps unless it says `as` or names a lane,
so holding a raw promise needs no extra word.

With a lane, `as` is a no-op — every lane already unwraps — so
`async let x as f()` is `async let x = await f()`.

Only the outermost value unwraps: combining promises
still needs an `await` on each operand inside the expression.

The precedent is Python's `with open(p) as f`, which binds `f` to what the
manager produces rather than to the manager. In JavaScript `as` renames in
`import` and `export`; in TypeScript it asserts a type after an EXPRESSION.
After a field NAME it is neither.

PATTERNS AND COMPREHENSIONS BIND THE SAME WAY:

    { users, metrics } as dash();      // destructure what dash() produces
    [head, tail]       as split();
    rows[]*            as stream();    // drain what stream() produces
    static { sa, sb }  as config();    // a field — `as` is a binding, not a block

Each is byte-identical to its `= await` form. `static { … } as` is told apart
from JavaScript's static block by the same test as `static { … } =`: a block
is followed by nothing that binds, and `as` binds.

`get` on a field briefly spelled `const x as y` in one word, and is retired
for that reason — see `C-GETFIELD`.

### 3.28 `get` — a getter before `(`, a descriptor before `=` [[C-GETFIELD]]

    get x() { return … }       // an accessor — JavaScript's getter
    get x = 1;                 // a field — the hidden, pliable constant
    get x as fetchX();         // the same, bound to what fetchX() produces
    set x = 1;                 // a field — the per-class constant (C-SHADOW)

Before a method, `get` is JavaScript's getter, unchanged. Before a binding — `=`
or `as` — it is a descriptor: hidden, pliable, constant. The two read the same
way to anyone outside the class body, since both mean *this value can be read
but not assigned*; the difference, stored or computed, is invisible from
outside. The modifier loop cannot tell which until it reaches what follows the
name, so the field and pattern paths convert it there.

`set` before a binding takes the same path and is `const`'s row under its own
word: hidden, locked, constant, and — the one difference — a subclass may
declare its own (C-SHADOW). It was refused, then an alias of `const`; an alias
in the descriptor column failed Perl's Razor and is gone.

`get` on a field has had three earlier meanings. It was first silently dropped,
compiling as a plain field. It then meant `setup const` in one word, which `as`
made a second spelling of `const x as y`, so it was retired. It is now a
descriptor with no lane semantics of its own: `get x as f()` unwraps because of
`as`, not because of `get`. A field NAMED `get` or `set` is still a field.

### 3.29 `delete` is observed by rewrite [[C-DELETE]]

    delete el.x;                     →  ø.delete(el, 'x', function(){return !this}());
    delete el[key()];                →  ø.delete(el, key(), …);
    delete el?.[k];                  →  ø.delete(el, () => (k), …, true);
    Reflect.deleteProperty(el, k);   →  ø.reflectDelete(el, k);

NO RUNTIME ARRANGEMENT CAN SEE A DELETE. `delete el.x` runs the element's own
[[Delete]], which looks only at its own properties and runs no user code. It
never walks the prototype chain — a prototype proxy's `deleteProperty` trap
fires only when the proxy itself is the object — and a DOM node cannot be a
proxy, since a proxy fails the platform's brand checks. So any prototype,
shared or per-element, is invisible to it. The compiler is not: it rewrites
every member delete it sees.

Each helper keeps native semantics — the same result, the same TypeErrors, the
key converted exactly once — and then, if the property was a reactive field,
writes `undefined` through the store, which notifies its subscribers at the
moment of deletion and makes the next read return `undefined` rather than the
value the store still held.

A COMPUTED KEY NEEDS NOTHING SPECIAL. The key expression moves into an argument,
so it is evaluated once, at the same moment, in the same scope, as native. An
optional LAST link passes the key as a thunk, so a nullish object short-circuits
to `true` without evaluating it. Strictness is read at runtime by
`function(){return !this}()`, which inherits the strictness of the code around it.

NOT REWRITTEN, left to native: `delete identifier`, `delete super.x`, a
parenthesised operand, an optional link before the last, and `Reflect` reached
through an alias or a computed name — finding those means tracking values
through the program. A delete in code the compiler never sees — an external
script, `eval` — is still invisible, and still leaves the stale read.

Only pliable fields can be deleted at all: `let`, `pin`, `const`, `set` and `enum`
are non-configurable, and refuse natively.

### 3.30 `await this` — a sequence point, not a self-wait [[C-AWAITTHIS]]

    async let peers as discover();
    await this;
    const plan as build(this.peers);

`await this` waits for every fan declared above it. Each fan registers the
promise of its WRITE as it starts — `Superset.inflight` — and leaves the set when
it settles; `await this` compiles to a wait on that set, `Superset.landed`.
Settlement runs top to bottom, so at that moment the set holds exactly the fans
above. The wait is allSettled: a rejected fan has already written `!!`.

TAKEN LITERALLY IT DEADLOCKED. A gate compiles to `yield <expression>`, and an
element is thenable while it settles, so `await this` made the element wait on
its own construction — compiled clean, and hung forever. It now means the one
thing it can usefully mean.

`defer await this` is refused: it would move the wait to the tail, where a bare
`await this;` already waits for every fan — a second spelling of the same thing.
The helper is `Superset.landed`, not `Instance.settle` —
that name belongs to the API retired in 0.89.j, whose stale call sites must keep
failing loudly.

A NEVER-SETTLING fan — a subscription, an endless stream — holds construction at
the next `await this`. That is the meaning, not a defect: the author placed the
wait.

### 3.31 A yielded string is a value [[T-STRINGYIELD]]

    const label as 'text';             // was undefined; now 'text'

The drivers once read any string a settlement generator yielded as a per-field
position marker — a NAME-YIELD — and resumed the generator with nothing. The
compiler stopped emitting name-yields in v9, so every string a driver sees is a
value a field is waiting on, and reading it as a marker bound `undefined`: `as
'text'` and `setup x = await 'text'` were undefined where `as 5` was 5, on both
faces. Every driver that runs AFTER the partition now resolves a string to
itself. The two that run only the synchronous prefix — the class face's prefix
runner and the debugger's step() — still read strings as breakpoints, which is
harmless: the prefix cannot suspend, so no value string can reach them.

### 3.32 The descriptor slot — seven words, eight cells [[C-DESCRIPTOR]]

    ply   a = 1;     -CW   hidden, pliable, mutable
    let   b = 1;     --W   hidden, locked, mutable
    pin   c = 1;     E-W   visible, locked, mutable          (was `var` — C-PIN)
    get   d = 1;     -C-   hidden, pliable, constant
    const e = 1;     ---   hidden, locked, constant          one value for the hierarchy
    set   e = 1;     ---   the same cell, one value per class (C-SHADOW)
    azo   f = 1;     EC-   visible, pliable, constant
    enum  g = 1;     E--   visible, locked, constant
          h = 1;     ECW   a native field, on both faces

A field's storage is three independent attributes: Enumerable, Configurable,
Writable. That is eight combinations, and each has exactly one spelling — seven
keywords and the bare field. Each keyword is one ROW of a table in the runtime,
`Instance.DESCRIPTORS`, which is the only place the meaning lives; the compiler
passes the keyword with the field it describes, inside the face's own hook and
on its own `this`: `ø.let(this, 'count', 0)` in the instance hook with
the element as `this`, the same call in the static hook with the class as
`this` (C-RUNTIME, C-DEFINE).

THE AXES READ AS INTENT. Enumerable is *public or internal*. Configurable is
*pliable or locked*: a pliable field can be deleted or redefined, which is what
a test needs to mock it, and a locked field refuses both. Writable is *state or
constant*. So `let` is internal strict state, `azo` a public mockable constant,
and so on — the word names the cell, and the cell names the intent. The one
word outside the grid is `set`, which shares `const`'s cell and differs on an
axis the attributes do not carry — whether a subclass may have its own value.
That axis is C-SHADOW's; the row carries it as `s: true`.

PLIABLE CONSTANTS ARE MOCKABLE. A plain write to a `get` or `azo` field throws,
like any constant. But a test can delete it and add it back, or replace it with
`Object.defineProperty`. A fresh install starts unsealed and seals again on its
new settling write, so the mock behaves as the original did. A locked constant
— `const`, `enum` — can be neither deleted nor redefined.

THE BARE FIELD IS A NATIVE FIELD, ON BOTH FACES. A custom element written in
plain JavaScript shows its fields in `Object.keys` and JSON, and so does a bare
Instance field — and so does an expando written from outside. Internal state
says so: a descriptor keyword, a sigil (virtual) or a `#private` (invisible).
With that, all eight cells are distinct on both faces.

Until 0.89.o an element HID its bare fields. It was a 50-50 call, made because
hiding was otherwise inexpressible. Measured against the right baseline — a
custom element with fields, not a bare `div` — it was a departure from native,
not parity; and with bare hidden, no keyword could give an element an ordinary
field at all. The keywords made it unnecessary. The default is one row,
`BARE_ROW`, in the runtime.

THE KEYWORDS ARE ABSOLUTE. Their rows fix every attribute, including on the
class face, so `static let` and `static const` are internal there too. Only a
bare field is visible by default, on either face, which keeps native parity:
JavaScript has `x = 1` and `static x = 1`, but no `static const`.

Before the table, one flag drove both a field's configurability and its
setter's seal, so configurable always equalled writable and four of the eight
cells could not be expressed. `Superset.describe` also takes a raw `{ e, c, w }`
row, as its JSON where a kind would stand, for experiments or a future keyword.

Writable is the SETTER's behaviour: a field is an accessor, and an accessor has
no `writable` attribute, so an unwritable field is one whose setter seals on its
settling write and throws after it.

A destructuring pattern describes every name it binds — `const { g, h } = o`
seals both. On a METHOD the rows apply through `Superset.redescribe`, with an
unset visibility treated as hidden, since native methods are non-enumerable.

### 3.33 `enum` — a descriptor and a type, one word [[C-ENUM]]

As a DESCRIPTOR it is the visible constant: enumerable true, configurable
false, writable false, and the setter THROWS rather than failing silently. It
is the LOCKED public constant — `azo` is the pliable one, and `pin` the
writable public field — and that is its reason to exist: `const` gives
immutability, `enum` gives immutability that a consumer can discover by walking
the object.

At TOP LEVEL the same word declares an enum TYPE. When the left says `enum` and
the right is enum-shaped, it is both at once and the compiler writes
`new Enum(RHS)`.

ENUM-SHAPED is `{ A, B }` — shorthand properties, no colon. The space is free:
that literal is valid JavaScript syntax, but it reads bindings that a class body
does not have, so it can only ever have thrown `ReferenceError: A is not
defined` at runtime. Nothing that worked before stops working. `enum` is also a
future reserved word in ECMAScript, so it can never collide with a user's
identifier — `let enum = 1` is a SyntaxError in every engine. Taking it costs
nothing and forecloses nothing.

Both uses answer the same question — *this name has a fixed set of values that
callers are meant to see* — so the shared word carries information rather than
merely saving one. `Enum` is a runtime constructor and does not yet exist; the
descriptor half can ship without it, the type half cannot.

### 3.34 `memo` — FCFS becomes FIFO [[C-MEMO]]

A lane decides WHEN a value is assigned. `memo` decides in what ORDER, and
nothing else: assignment happens in source order even when the values resolve
out of order. The work still starts at the same point and still finishes when it
finishes; only the write is held back to its turn.

It is load-bearing on exactly the lanes whose memory is first-come-first-served
— `setup async` and `async` — and a no-op on the lanes that are already strict, so
`memo defer ≡ defer` and `memo yield ≡ yield`. That is not redundancy to be
optimised away. A modifier that composes everywhere and changes something in
half the cases is one rule; a modifier legal only on two named lanes is two
rules and a table of exceptions. The no-op cases are the price of the word
meaning one thing.

MEMO(R)IZE IS THE MODEL. A result that arrives in its turn is assigned at once.
A result that arrives early is CACHED, and stays cached until the order reaches
it — at which point it is assigned, and anything already cached behind it drains
in the SAME SYNCHRONOUS PASS. Nothing is scheduled and nothing is chained: every
result is captured the instant it arrives, and only the WRITE holds for its turn.

    memo async let a = await slow();     // 60ms
    memo async let b = await mid();      // 30ms
         async let c = await fast();     //  0ms — not memo'd
    memo async let d = await quick();    // 10ms

    c writes at 0.  d arrives at 10 and is cached.  b arrives at 30 and is
    cached.  a arrives at 60, completes the prefix, and a, b and d are assigned
    in source order in one pass.

THE PASS IS ATOMIC, which is the point of the cache rather than a chain. A chain
of promises produces the same ORDER but spreads the writes across a microtask
each, so an observer can catch the prefix half-written and a reactive host gets
one notification round per field instead of one for the drain.

`memo` SPLITS BY LANE — one cursor per lane, not one per element. A single
cursor would let a detached `memo async` result hold up a `memo setup async` write: a
blocking barrier stalled by something nobody waits for. Lanes differ in who
waits, and a modifier reaching across them would undo that distinction.

WHAT IT COSTS. A memo'd field cannot be read before every earlier memo'd field
in its lane has landed, so `memo` on a slow early field delays every later
memo'd write in that lane to the slow one's time — `d` above resolves at 10ms
and is not readable until 60. That is inherent to ordered assignment, and it is
invisible at the call site.

So in a mixed run the memo'd fields of one lane write in source order relative
to each other, and every other field writes on arrival. The total write order is
not readable from source order alone — a reader has to filter for the memo'd
subsequence of the lane in question. That is the cost of `memo` composing
everywhere instead of governing a group, and it is the cheaper of the two: the
alternative is a word whose meaning depends on its neighbours.

`memo` is meaningless alone. A bare `memo const x = …` with no lane has nothing
to reorder and is refused, naming the lane as the fix.

### 3.35 `setup async` — the lane that changes at the lane change [[C-BATCH]]

Contiguous `setup async` lines fire in parallel and form one group; the boundary is
the LANE CHANGE, so the group ends at the first line that is not `setup async`. Within
the group memory is FCFS: the first value to resolve is the first assigned, and
source order is not preserved unless `memo` restores it.

The group is delimited by adjacency rather than by a brace because the thing
being grouped is already a run of lines in the column — a block would be a
second way to say what the lane already says, and a reader would have to check
both.

A RUN IS CONTIGUITY ON ONE FACE. Any intervening member ends it — but the other
face never intervenes, because it is not in that face's list at all. A
`static batch` line sitting inside an instance run leaves that run intact and
opens a run of its own.

The starts are emitted INLINE, not hoisted. Hoisting is global, and a hoisted
start would fire a run that sits behind an earlier run's barrier — the work
would begin before settlement had reached it.

**The run is ONE call, at its barrier** (RULED 2026-10-12). Each member's start
is a binding where the member stands, and the last member's line names them all:

    setup async a = await f();              ->  const øbatch_a = f(); // @batch-start
    setup async try indexed let b = await g();  const øbatch_b = g(); // @batch-start
                                                yield ø.batch(this, ['a', øbatch_a], ['b', øbatch_b, 'try indexed']);

A member is its field, its handle and its words. The runtime lands each as it
resolves (an `indexed` one through the memo cursor of the batch lane), lands a
`try` member `undefined` on rejection, and returns the barrier, which rejects the
moment a member without `try` does; the `yield` waits on it. Before, each member
was its own call under a string id (`'b137'`) and a second call, `batchWait`,
closed the run, with a table on the side to join the two. `defer async` emits
the same line at the tail, over `ødefer_` handles.

FAILURE IS PER MEMBER, exactly as it is on every other lane. A member with `try`
that rejects writes `undefined` and the run carries on; a member without `try`
rejects the barrier the moment it fails — fast, and hard. There is no group-level
choice between `Promise.all` and `allSettled`, because `try` is a member's word
and cannot be allowed to decide its neighbours' failure semantics. Nor would
`all` buy atomicity: writes land as they arrive, so some fields are already
written by the time any rejection surfaces.

`memo` COMPOSES WITHOUT EITHER KNOWING THE OTHER. `memo setup async` does not break a
run — it is the same lane — and within the run a memo'd member routes its write
through the memo cursor for the batch lane while its plain siblings write on
arrival. Batch owns the group and the barrier; memo owns the write order.

`setup async` does NOT require `class*`. The star gates EMISSION, not blocking:
`defer` is a blocking lane that needs no star today, and `setup async` joins it. Only
an explicit `yield` member makes a class say so.

The runtime already has an unrelated `batch()` — Chimera's write coalescer,
which folds several signal writes into one notification. They share a word and
not a meaning, and neither is reachable from the other's position: one is a lane
in a declaration column, the other a function call. Stated here so that a reader
meeting `batch let rows = …` does not infer that the assignment is wrapped in a
signal transaction. It is not.

### Lanes, read left to right — `setup` [[C-LANES2X2]]

`setup` is the blocking lane. A two-word lane reads left to right: the first
word says how the run meets the constructor, the second how its lines meet each
other. Word order is meaning, so the two compounds are inverses by construction.

|              | lines in turn  | lines as they land |
| ------------ | -------------- | ------------------ |
| **joined**   | `setup`        | `setup async`      |
| **detached** | `async setup`  | `async`            |

`setup async` is the old `batch`: the run starts together, each value is written
as it lands, and the run joins at the lane change. `async setup` is the old
`async sync`, the background waterfall. `defer async` (the old `defer batch`)
reads the same way: joined at the constructor's end, written as each lands. The
rule also predicts its refusals: `async defer` asks a detached run to join at the
constructor's end, a contradiction. The compiler normalises every new spelling
once, right after the modifier loop, to the words the rest of it already knows.

| spelling                  | status                                              |
| ------------------------- | --------------------------------------------------- |
| `vsync`, `bsync`, `layer` | retired — refused by name, at fields and class heads, naming `setup` |
| `sync`, `synch`           | retiring — still compile as `setup`                 |
| `batch`, `defer batch`    | retiring — still compile as `setup async`, `defer async` |
| `async sync`              | retiring — still compiles as `async setup`          |

A method named `setup()` stays a method: a lane word is only read as one when a
word or a field follows it, never `(`.

`indexed` is `memo`'s participle spelling. It describes how the writes land —
in source order — so like `untracked` it may follow the lane, and the two
commute: `setup async indexed untracked let v as f()`. `memo` still compiles.

`set` before a field is the per-class constant — `const`'s row, with shadowing
allowed (C-SHADOW). Before a method it is still JavaScript's setter —
`set x(v) { … }` never reaches the field path.

### 3.36 Compound lanes — two words, one slot [[C-COMPOUND]]

`defer async` and `defer join` are single lane values that happen to be spelled
with a space. They are not a lane plus a modifier, and the two words cannot be
reordered or separated.

THE LANE SLOT IS CONTIGUOUS. Nothing may be written between the halves of a
compound — `defer const batch x` is refused, naming the pair. This is the one
adjacency rule the column carries, and it is NOT a statement about where the
descriptor goes: the descriptor may sit before the lane or after it, both are
legal and both emit the same bytes. What is forbidden is putting it INSIDE a
value.

    memo  [descriptor]  defer async  [descriptor | get | set]  name

The rule earns itself. Without it, `defer const batch x` has two readings — a
compound split by a descriptor, or two lanes with a descriptor between them —
and no fact in the source distinguishes them. With it, there is one reading and
a refusal for everything else.

A FIELD NAMES ONE LANE. Two lane words that are not a compound are refused by
name: `batch defer`, `async defer`. This mattered more than it looks. Before the
rule, a second lane word was SILENTLY DROPPED — the lane was resolved by
`mods.find`, which takes whichever it meets first, so `defer async` compiled as
plain `defer` and `batch defer` compiled as something else again, both without a
diagnostic. Two spellings, two different meanings, neither of them the one
written.

| lane | boundary | memory | physics |
| --- | --- | --- | --- |
| `setup` | immediate | strict | halts on this line until it resolves |
| `setup async` | lane change | FCFS | contiguous lines in parallel; first resolved is assigned first |
| `defer` | local tail | strict | parallel, assigns at the constructor's `}`, top to bottom |
| `defer async` | local tail | FCFS | parallel, waits at the tail, assigns as each lands |
| `defer join` | leaf tail | strict | barrier pushed to `new.target`'s constructor `}` |
| `async` | none | FCFS | detached; the state updates whenever it lands |

Every lane starts the work at the same point. They differ only in WHERE THE FACE
JOINS and whether memory is ordered — which is why the matrix has two axes and
not six independent behaviours.

`defer` is deliberately `<script defer>`: `new` is being given
`DOMContentLoaded` meaning. Under inheritance the tail is per class level and
FIFO — each level's deferred fields land at that level's closing brace.

`defer async` IS BOTH HALVES AND NEITHER ALONE, and it needed nothing new built.
The START is where the member stands, the way `defer`'s is (T-ORDER), so the
work begins there and runs while the fields below it settle. The WRITE
is the batch runtime's, so members land first-come-first-served rather than in
source order. The BARRIER sits at the local tail, where the deferred assignments
already were. Two mechanisms that existed, paired for the first time.

### 3.37 `defer join` — the barrier moves to the leaf [[C-DEFERJOIN]]

`defer join` pushes the tail from the local class level to `new.target`'s
constructor `}` — the bottom of the chain, not the level that declared it. One
barrier for the whole construction instead of one per level.

THE VALUE IS UNREADABLE IN EVERY SUBCLASS CONSTRUCTOR BODY, including the body
of the very class whose tail it waits for. This is not a gap to be closed later;
it follows from where the barrier sits. By the time the leaf's `}` is reached,
every constructor body in the chain has already run. A `defer join` field is
therefore write-once-late and read-only-after — available to methods, to the
settled element, and to anything downstream of `await new`, and to no
constructor anywhere.

Naming it is the whole of the ruling: a reader who expects the declaring class
to be able to see its own field is reasoning about `defer`, which can, and the
difference is exactly the word `join`.

### 3.38 The static constructor [[C-STATICCTOR]] — SKETCH

    mixed class* Engine extends Div {
        static set schema;                   // blank: declared, written once below
        static enum region;
        static pin attempts = 0;
        static constructor*() {
            this.attempts++;                 // before super(): runs at definition, on the class
            yield super();                   // join the parent's class side
            const cfg = await load();
            this.schema = await net.get(cfg);
            this.region = await geo.detect();
        }
    }
    await Engine;                            // joins the static constructor

**The class face has a constructor of its own.** `static constructor*()` runs
when the class is defined, with `this` the class, through the hook the instance
constructor already uses: the body rides the same ops (`CTOR_PREFIX`, the
partition, `CTOR_TAIL`), its `await`s become the driver's yields, and `await
Klass` joins it the way `await new Klass()` joins the instance side. Both faces
work the same way; only the receiver differs. The emitted static block is the
same `this[Symbol.new](function* K_Static() { … })` as before, so the runtime
learned nothing new.

The body sits where JavaScript would run it: after the static field
initialisers declared above it. The part before `super()` goes in ahead of the
seed and the partition and runs synchronously at definition; the rest follows
the settles.

`super()` on the class face is a JOIN, nothing more. `await super()` orders this
class side after its parent's; `yield super()` joins it in parallel; the head
grain must agree (`setup class` takes `await`, `mixed class` takes either, an
`async class` takes none). The instance side's rule that the SUPER FORM picks
the handshake carries over unchanged; without a `super()` the head decides, as
it always has for statics. The partition is forced whenever the body joins or
suspends, because the driver reads the FIRST yield as the handshake and an
author's `await` must never be that yield.

Refused by name, each with the fix:

- parameters — nothing calls a static constructor;
- arguments to `super()` — it joins, it does not run the parent's constructor
  again (P-6 holds that alternative);
- a bare `super()` — say `yield` or `await`; `void super()` is not built;
- an `await` before `super()` — the parent has not settled;
- a `yield` that emits without the star — `static constructor*()`, the rule the
  instance constructor already follows;
- a lane or grain word on it — the class head declares the class side's grain;
- a second static constructor, or a `static { … }` block beside it — a class
  has one place where its class side runs;
- `try` on the class head — it would soften the class face (P-6); not built.

SKETCH means: built and suite-pinned as above; static fields keep their lanes
beside it, and `static { … }` still compiles in a class without one. Whether
`super(…)` should ever CONSTRUCT — run the parent's body for the subclass — is
P-6's open question, and switching would change what these bodies do.

### 3.39 A blank declaration keeps its write [[C-BLANK]]

    static set schema;                  blank: declared, not written
    static const id = undefined;        written: sealed at undefined
    const token;                        filled once, in the constructor

**A declaration with no initialiser declares the field and writes nothing.** It
lowers to `this.x = Symbol.for('..'); // @blank` — BLANK, the third settlement
sentinel beside PENDING (`??`) and POISONED (`!!`) — so the field exists from the
declaration, visible if its row says so and shadowing at once in a subclass,
while a read gives `undefined`, as `x;` does in JavaScript. A sentinel never
seals, so a read-only row seals on its first real write. An explicit
`= undefined` IS a real write and seals there; the two are told apart at the
declaration, where the difference is syntax, and the sentinel carries it.

A blank is not PENDING: nothing is on its way, `await Klass` does not wait for
it, and a blank static reads `undefined` rather than throwing. Lowering it to
`undefined` instead — what `x;` means in JavaScript — made the lowering the write:
a blank `const`, `get`, `azo` or `enum` sealed at `undefined` and could never be
filled. `const x;` followed by `this.x = seed;`, the fix T-FIELDPARAM's
diagnostic prescribes, threw at construction, and the static constructor could
not fill the blanks it exists to fill. (A blank `set` or `get` escaped by losing
its row and compiling to a plain field; both now keep it.)

Precedent: Java's blank `final`. Known edge: a blank field named like a native
element property routes the sentinel through the native setter — the same bug
`title` has.

### 3.40 Shadowing: `const` is one value, `set` is one per class [[C-SHADOW]]

    class A extends Div { static const x = 1;  static set y = 1;  static let z = 1; }
    class B extends A   { static const x = 2; }       // refused: x is const in A
    class C extends A   { static set y = 2; }         // C.y is 2, A.y is 1, both sealed
    class D extends A   {}                            // D.y reads A's; D.z = 2 gives D its own

A compiled declaration is a [[Set]]: `static set y = 1` is `this.y = 1`. So
the question "may a subclass declare its own?" is the question "what does a
write through a subclass do?", and JavaScript answers by row: a writable
property shadows (the subclass gets its own copy), a read-only one throws. The
runtime does exactly that, with the subclass's copy under the subclass's row —
its own when it declared one, the parent's when it climbed — rather than the
plain property it used to mint. One row is let past the throw: `set`, the
per-class constant, carries `s: true` and shadows. `const` and `enum` are one
value for the whole hierarchy; `get` and `azo` are pliable and shadow like any
redefinable property.

A hard violation THROWS: a `const` redeclared in a subclass is a SyntaxError
when the parent is in view, and a TypeError at runtime when it is not. Under
`try` the declaration is a warning and the write fails softly.

NOT YET on the instance face: every level writes the same element, and its seal
is one bit, so a per-level `set` cannot yet tell a subclass's write from a
second write. A subclass redeclaring a parent's instance `set` is refused by
name until the seal knows its level.

### 3.41 `pin` — the visible, locked, mutable row [[C-PIN]]

`var` is retiring; `pin` takes its row. JavaScript's `var` is hoisted,
function-scoped and redeclarable — the opposite of a locked field — and a linter
flags it on sight. A `pin` is pinned in place (non-configurable) and public
(enumerable), and its value moves. `var` still compiles, normalised at the
parse boundary with a warning that names the replacement; the runtime table
holds one word per row and does not know it.

### 3.42 The runtime is `Superset`, not `Instance` [[C-RUNTIME]]

    this[Symbol.new](function* øTab() {
        ø.let(this, 'count', 0);                                // the ELEMENT
        ø.define(this, 'untracked let', 'cache', {});
        …
    static {
        this[Symbol.new](function* øTab_Static() {
            ø.implement(this, IBase);                           // the CLASS
            ø.redescribe(this.prototype, {const:['save']});
            ø.set(this, 'schema'); // @blank
            …
    save() { return ø.soft(() => { … }); }
    ø.fan(this, 'n', f());
    yield ø.batch(this, ['a', øbatch_a], ['b', øbatch_b, 'try indexed']);

**A fan is one call.** `async x = await f()` is `ø.fan(this, 'x', f())`: the
runtime lands the value, poisons the field on rejection (author-first, as `=`
on a rejected await would) and registers the write in flight for `await this`.
The lane's second word rides as the mode — `ø.fan(this, 'y', g(), 'indexed')`
lands in source order among the indexed fans; `ø.fan(this, 'z', () => h(),
'delay')` is the waterfall, and takes a thunk, since that is the one lane that
must not evaluate its expression where it stands. A destructuring fan names
every bound name and lands through its pattern, `ø.fan(this, ['a', 'b'], f(),
_ => { ({ a: this.a, b: this.b } = _); })`, so each name is poisoned on
rejection. The emit used to spell all three itself — `ø.inflight(this,
Promise.resolve(f()).then(_ => { this.x = _; }, _ => { this.x = Symbol.for('!!');
}))` — and so spelt the sentinel; it spells none now, as for BLANK (RULED
2026-10-12).

**What compiled output calls lives in one namespace, off the element model.**
`Superset` is a class of static helpers in the core — `define` and one method
per descriptor word (`ply`, `let`, `pin`, `get`, `const`, `set`, `azo`,
`enum`), `describe`, `redescribe`, `pending`, `implement`, `mixin`, `lane`, `fan`, `batch`, `drain`, `memo`, `waterfall`,
`inflight`, `landed`, `soft`, `untrack`, `emit`, `cell`, `delete`,
`reflectDelete` — each taking its host as the first argument where it needs one,
so one body serves both faces. Nothing of it is a static of `Instance`, so no
element class inherits it: `Div.describe` and `Div.batch` no longer exist, and
the class face shows the element model and nothing else. Nothing of it needs
the compiler, so output compiled at build time runs against the core alone.

**The emit writes it `ø`.** `ø` is a global the core binds as a getter onto
`Superset`, so `ø === Superset` whichever half loaded first, and every emitted
call is eight characters shorter. The name is ONE switch in the compiler, kept
as an object so it can be flipped back: `RUNTIME = { ref: 'ø' }`, public as
`Superset.runtime`; setting `ref` to `'Superset'` restores the long spelling.
Every suite pin accepts either spelling except the one case that pins the
default itself. Any other name would need a binding of its
own. `ø` does not collide with the emit's registers (`ødefer_d`, always a word
after the `ø`) or generator names (`øTab`); a page binding of its own named `ø`
would shadow the global, and that is the price of the short name.

Before this the helpers were statics and symbol-keyed methods on `Instance`,
mirrored on both faces and relayed through every metaclass: `this[Symbol.for(
'Instance.inflight')](p)` was a symbol lookup and a proxy hop per call, and
`Instance.describe(this.prototype, ["a"], 'let')` was emitted once per keyword
per face, in static blocks of its own.

EACH FACE DESCRIBES ITSELF, in its own hook, on its own `this`. Instance rows
are described on the ELEMENT, every construction (the row is one frozen object
per kind, held by reference, so the cost is a Map per element); static rows on
the CLASS. Each row is described where its field is defined (C-CASCADE): the
rows above the first blocker open the hook, and the rest follow the blocker
they wait for. The two objects never appear in one call, and no separate
`static { }` block exists for the rows. Because a parent level now installs an accessor
before a child level describes, a child's row may TIGHTEN one already installed
(`ply` then `let`): a configurable own accessor is re-installed under the new
row. Interfaces, package mixins and method slots are class-level facts and open
the static hook too; a method slot is named by its object, `this.prototype`.

The compiler IS also `Superset` — `new Superset(src)` is the compilation — and
the two halves are one object: the compiler's class takes the global name when
it loads, and whichever half loads second puts the runtime behind it
(`Object.setPrototypeOf`), so `Superset.compile` and `Superset.soft` resolve on
the same name in either order. The core's body is gated on its extensions, so
the compiler usually comes first. The hook protocol is unchanged: `Symbol.new`,
`Instance.iterate` and `Instance.detach` stay where they were, because they are
the element model's, not the emit's. `Instance.DESCRIPTORS` stays public as
data. `Instance.consts` and `Instance.enums`, the pre-table pair, are gone.

### 3.43 `untracked` on a field — a cell nobody can subscribe to [[C-UNTRACKED]]

    untracked let cache = {};          // reads register no edge, writes trigger nothing
    static untracked pin hits = 0;     // the same on the class face
    untracked probe() { … }            // the METHOD form, unchanged: the body runs untracked

**On a field, `untracked` is a participle on the row, not a wrapper.** The kernel
already carries the axis — T, in the trit: volatile, UNTRACKED, semantic — and
a field is a cell in the store, so the keyword names what that cell's T axis is.
The compiler passes it with the descriptor, `ø.define(this, 'untracked let',
'cache', {})`, the row gains `t: 0`, and the runtime tunes
the cell once, when the store mints it (`Signal.untracked(handle)`, the one
export this needed). From then on an effect that reads the field takes no edge
and a write to it wakes nobody; the value itself is live, not a snapshot.

It was a no-op on fields: the word was accepted, carried in the modifiers, and
dropped at emit. The method form is unchanged — a wrapper is right for a body,
which has no cell. `untracked` is the first participle; `volatile` (T = 1),
`shallow` / `deep` (C) and `any` / `all` (A) are the same shape, one axis each,
and the table stays what it is: the attributes a word fixes. The participle adds
an axis beside them.

### 3.44 `define` — the row rides the write [[C-DEFINE]]

    let x = 1;                        ->  ø.let(this, 'x', 1);
    setup const b = await f();        ->  ø.const(this, 'b', yield f());
    pin raw = f();                    ->  ø.pin(this, 'raw', f());
    static set schema;                ->  ø.set(this, 'schema'); // @blank
    untracked let cache = {};         ->  ø.define(this, 'untracked let', 'cache', {});
    plain = 2;                        ->  this.plain = 2;                      (no row, no call)
    const { g, h } = o;               ->  ø.const(this, ['g', 'h']);           (the row; then the pattern writes)
    async let x = await f();          ->  ø.let(this, ['x']);                  (the row; the fan writes when it lands)

**A plain write with a row is one call, named by its descriptor.** The runtime
has one method per descriptor word — `ply`, `let`, `pin`, `get`, `const`,
`set`, `azo`, `enum`, made from the DESCRIPTORS table, so a new row gets its
word for free — and each is `define(host, kind, name, value)` with the kind
filled in: describe the one name, then write the value, in that order. The
call replaced the pair a described field used to be — a `describe` for the
segment and a plain assignment — so "described at its definition" (C-CASCADE)
is no longer an arrangement between two lines but the shape of the one line,
and the line reads as the declaration it came from. A row that carries a
participle has no word of its own, so it names its kind to `define`.

**No value is a blank.** `static set schema;` writes nothing, and its call
passes nothing: `ø.set(this, 'schema')` writes the BLANK sentinel, while
`ø.set(this, 'schema', undefined)` — what `= undefined` compiles to — spends
the one write (C-BLANK). The argument count carries the distinction the source
makes, so the emit spells no sentinel.

`get` and `set` are the descriptor words, not accessors: `ø.set(this, 'x', v)`
is `set x = v` from the source, the per-class constant (C-SHADOW).

**The `yield` sits INSIDE the call.** `define` never looks at its value: a
promise bound with `=` is stored raw, as `=` has always stored it, and an
awaited value arrives settled because the generator suspends in the argument.
The write therefore lands exactly where `this.b = yield f()` landed it — after
the await, author-first on rejection (T-SOFTFACE) — and nothing about
settlement moved. A first draft returned a promise and had the generator yield
the call; that version awaited `pin raw = f()` and broke the raw `=`.

**What keeps a row line.** `define` covers the plain rows — the
synchronous write, the single awaited write, and a `defer`'s join, which is a
single awaited write at the tail (`ø.const(this, 'history', yield ødefer_history)`).
A shape with more than one
statement, more than one name, or a value that is not the write keeps a row
line in its segment: a destructuring pattern, a tee (`yield let`), a `try` or
block initialiser, a batch member, a fan, a private cell, a drain. The row line
is spelled by the same words, with the NAMES AS A LIST: `ø.let(this, ['x'])`
describes and writes nothing, and the value arrives by its own path — a fan's
landing, a batch, the pattern's assignment. One line per segment, one call per
kind (`ø.define(this, 'untracked let', ['v']); ø.const(this, ['w']);`); a row
with a participle names its kind to `define`, as its write does. The list is
what tells the row line from a blank: `ø.let(this, 'x')` declares a blank
(C-BLANK), `ø.let(this, ['x'])` writes nothing at all. Bare fields have no row
and stay `this.x = …`.

The emit no longer calls `Superset.describe` (RULED, 2026-10-12: compiled output
reads in the descriptor words throughout). It stays in the runtime as the
general form, the one that takes a raw `{ e, c, w }` row, and for output
compiled before the change.

### 3.45 The door call feeds a formula [[C-OPERAND]]

    s.Φ.subtotal((Φ, unit) => Φ.qty * (unit ?? 1));
    s.get('subtotal');            // 2        (qty = 2, no operand)
    s.Φ.subtotal(99);             // feed 99
    s.get('subtotal');            // 198 — the main lane reads formula(lens, 99), live
    s.Φ.subtotal(99);             // the same operand: nothing moves
    s.Φ.subtotal = 7;             // ASSIGN: a value replaces the formula, edges and operands go
    s.Φ.subtotal((Φ, unit) => …); // a new formula answers with the operands still bound

**A field's formula is a record: the body, its lens, and its OPERANDS.** The lens
is the door the body receives first; the operands are what the door CALL feeds
it — `s.Φ.total(99)` binds 99, and from then on the main lane reads
`formula(lens, 99)`. Binding the same operands again changes nothing; new
operands mark the field stale, so the next read applies them, and a push
formula runs at once. Operands SURVIVE a formula replacement: the operand is
the field's input and the formula is how it is processed, and a new formula
answering with the old input avoids a transient run on nothing. They go with
the formula when a value is written over it.

**Three spellings, fixed at the field, never by what it holds.** ASSIGNMENT
stores: `s.Φ.x = v`, `s.set('x', v)`, `handle.set(v)` and the quiet door call
`s.Φ('x', v)` all land a value, and over a formula they RETYPE it — the body,
its dependency edges, its gate, its membrane and its cache go together, so no
watcher of the key is ever woken again by the old dependency. A function
stored this way is DATA. A CALL WITH A FUNCTION installs: `s.Φ.x(fn)` replaces
whatever formula was there; the old edges are dropped at once and consumers
recompute on their next read. A CALL WITH A VALUE feeds: on a field holding a
formula it binds operands; on a plain field it writes. A formula that declares
nothing beyond the lens ignores what is bound (RULED: acceptable, the freeze
having its own spelling).

**The bare call is one shape for every node that is not a factory.** `h()`
reads the value lane, `h(fn)` installs, `h(v)` feeds or writes — whether or not
the node carries keys. A store's keys are reached through `.get(key)`,
`.set(key, value)` and the doors, never through the store's own call (RULED:
default write). A factory — `Signal.Store(fn)`, `Computed`, `Effect` — answers
by signature, as before: its arguments name a memo leaf.

Measured before the ruling: writing a value over a formula by `.set` or a
keyed write kept the old formula's edges live; assigning through a door
defined a frozen own property on the handle and broke the door for good;
calling an accessor-backed node froze it instead of reaching its setter.
Pinned now, with the operand cases, in the suite.

### 3.46 The host is its store node — the element, and the class [[C-ADOPT]]

    const el = new Box();                 // a real <div>
    Signal.isSignal(el)                   // true: the node brand is on the element
    el[REACTIVE_STORE] === el             // the element is its own store
    Signal(Signal.ptrOf(el)) === el       // the arena's canonical handle for its slot
    Object.keys(el)                       // ['a', …]: nothing of the node is visible
    el.dispose();                         // the node and its keys die; a plain div remains

**An element IS its Chimera node.** At the mint, core adopts the element
(`Signal.Store.adopt(element)`): Chimera's base constructor hands the element
back through the return override, so GraphNode's private fields — the node
brand — land on the element itself, exactly as they land on a minted handle.
No prototype changes (a div stays a div), no callable wrapper, no own property
but the store brand. Before this, each element had a Store handle minted into a
side table (`STORE`), reached by a WeakMap lookup on every field read; the
element and its reactive state were two objects joined by a table. They are one
object now, and `storeOf(element)` is an own-property identity read.

**The store surface is verbs of the host.** An element cannot inherit the Store
prototype — `get`, `set`, `has` on an element would be user fields — so core
never calls a method on a store. It calls Chimera's host-first verbs:
`Signal.read(h, k)`, `write(h, k, v)`, `has(h, k)`, `remove(h, k)`,
`door(h, name, owner)`, `dictOf(h)`, `release(h)`. On a Store handle each does
what the method of the same meaning does. A door over an element is a
Proxy over a callable surrogate, answering from the element; every door form
works on it (`el.Φ(fn)`, `el.Φ.x(fn)`, `el.Φ.x(v)`, `el.Φ('x', v)`, `el.Φ({…})`,
`el.Φ.x = v`, `new el.Φ()`), and `el.Φ()` is the element.

**The class is its store node too.** A class is adopted at its FIRST STATIC
WRITE — the static trap's first touch, a subclass's shadow of an inherited
static (C-SHADOW), or the lift of a native sigil static — exactly as an
element is at its mint, and the `STORE` side table is gone. Each class that
writes a static is its own node: a subclass is adopted at its own first write,
never through its parent, and a subclass that has written nothing carries no
node. Adoption is once: a class whose node was released keeps the dead brand,
and its later writes land as plain properties, as a disposed element's do. A
class that cannot take new properties is never adopted — it could take neither
the brand nor the write that asked for a store — and `adopt` refuses such a
host before it brands anything.

    class P extends Div { static x = 1; }
    class Q extends P {}
    Q.y = 2;                              // Q's first static write: Q is its own node
    Q.x                                   // 1: the class that OWNS the property owns the value
    P[REACTIVE_STORE] === P && Q[REACTIVE_STORE] === Q

An inherited static resolves by OWNERSHIP, as a native property does: every
class holding a static has its own accessor for it, made for that class and
closed over it, so the accessor a lookup finds names the store — whoever runs
it, with no climb up the chain and no probe of any store's contents. (A
subclass that had a store of its own for any other static used to answer from
that store, which does not hold the key: `Q.y = 2` made `Q.x` read undefined.
It was so before adoption too.) An element's accessors stay shared, one per
name and row: an element's fields are its own, and nothing inherits them.
The native sigil lift (`static $label = v` declared in plain JavaScript)
writes into the class's own store, the same one its other statics reach; it
used to keep a second Store per class, closed over by its accessors.

A class is callable, so "minted handle" is never `typeof === 'function'`: it is
the PROTOTYPE's answer, `h instanceof Signal`. A door over a class stands on the
surrogate, since a class's own non-configurable `prototype` would bind every
door to the Proxy invariants; the door call `S.door(K, '$')()` is the class,
and the store API through the door is bound to it. A class assigned to a native
property is a value, not a handle binding. The arena's canonical lane reads the
brand with `genOf` for every host, so `Signal(Signal.ptrOf(K)) === K`.

**The store's state is private.** The dictionary, the deep-proxy cache, the
quorum table, the cascade flag and the engine moved from four symbol-keyed own
properties on the handle into the node's private bag, reached through
`stateOf`/`dictOf`. On an element they would otherwise be own properties; in
the bag they are state behind one slot, and a subclass of an adopted class can
never find its parent's dictionary through the static chain.

**Lifetime is STRONG (RULED).** The arena holds an adopted element in its
handle lane for the node's lifetime, as it holds every handle: an element is
never collected because it left the document. `dispose()` — the one explicit
teardown — releases the element's own node: its keys die, the node is tagged,
the recycle clears the lane, and the store brand is removed, so a disposed
element reads and writes as a plain element. Before adoption the element's
separate Store handle was never disposed at all: one arena slot per element,
held for the life of the arena.

A CLASS is held the same way, and dispose on a class disposes it (RULED,
owner, 2026-10-13). `K.dispose()` with no element named, `K.teardown()`,
`K[Instance.DISPOSE]()` and their async twins dispose the class's live
instances and then release its own node: its statics' cells and its static
effects die, the store brand goes, and the arena lets the class go, so a
dropped class is collected. A disposed class reads and writes as a plain
class, as a disposed element does; a subclass that inherits one of its
statics reads it as undefined, since the class that owned the value is gone.
A subclass's dispose leaves its parent alone, and `K.dispose(el)` still
disposes the element it names. (`K.dispose()` used to throw: the class face
reached `Instance.dispose` with no element. The class verbs disposed the live
instances and left the class's own node in the arena for good.)

**C-OWNERELEMENT is decided for elements by an earlier ruling.** CONSTRUCTION
IS OPAQUE runs every element construction under `Signal.untrack`, so no node is
active when an element is minted and it can never become the running effect's
child — switch or no switch. `Signal.ownElements` (default `false`) governs
direct adoption inside a run (`Signal.Store.adopt` called from an effect body);
the ruling stays open for that case only.

**Measured, in Chromium.** Field read and write at parity with the side table
(the brand test is 1.6 ns against the WeakMap's 8.4, spent again on reaching
the private bag from core); door reads about a third faster; 553 of 554 cases.
Two measured "don'ts" for the hot path: a private-name `in` check costs 10 ns
and a private accessor reached through a static 28 ns, where a private field
read costs 2; and a ternary whose alternative calls a WeakMap costs 15 ns where
the same test through a local costs 4.5. Static helper calls inside core's
field getter are not inlined, so `deref`'s liveness test and `dictOf` stay
inline there.

**Measured, the class face (Node + jsdom, medians of nine interleaved runs;
Chromium after a full suite run agrees within its noise).** Field read and
write, the cell paths and the canonical lane are unchanged within noise. The
lane reads the brand with `genOf` for every host: 27 ns for a cell either way,
and 42 for a class, where keeping the `[GEN]` getter for callables sent a class
through the Meta trap at 349. A static read costs 196 ns against the side
table's 166 in a cold window, and the same — 148 against 150 — once the element
face has warmed the accessor code the two faces share. An inherited static
costs 179 ns and is right, where it was 59 and undefined; the class's own
accessor is what makes it cheap, since a climb asking each class
`Object.hasOwn` (a call V8 does not inline, 16 ns) cost it 240.

### 3.47 Every node is one surface [[C-ONENODE]]

    const c = new Signal.State(5);        // a cell
    c.set('a', 1);  c.get('a');           // its first key grows its bag: a cell with keys
    c.$.a(); c.Δ.b = 3;                   // the doors answer on it
    c(); c.set(6); c.clear(); c.delete(); // and its lane is what it always was

    const s = new Signal.Store({ x: 1 }); // a store
    s(); s.set(9); s.Φ(10);               // has a value lane of its own: read, loud write
    s(() => s.get('x') * 100);            // and takes a formula like any node

    const eff = new Signal.Effect(fn);    // ONE arena slot: the body sits on the head
    eff.delete();                         // the empty signature retypes the head; eff lives
    const comp = new Signal.Computed(fn); // one slot, lazy: a stale PULL formula on the head

**A node has a value lane and, on demand, keys.** `Signal.State`, `Signal.Store`
and the reactive handle of a field are one shape: the bare verbs are the lane's
— `get()` reads it, `set(v)` is the loud write, `update(fn)` rewrites it,
`clear()` empties it, `delete()` disposes the node — and a key names a field:
`get(k)`, `set(k, v)`, `has(k)`, `delete(k)`, `update(k, fn)`, the doors. The
first key asked of a cell makes its bag (dictionary, proxy cache, quorums) and
brands it a store; until then a cell costs one null slot. A Store is a node
born with its bag, and its head is a STATE node from birth — tracked and
semantic, like any cell — so `s()` subscribes a reader and `s.set(v)` notifies
on change. The combinators (`map`, `filter`, `combine`, `effect`) take any node,
a store's lane included. `freeze()` freezes the lane and the keys together,
`thaw()` reopens both; a factory head stays open, being the mount of its
variants rather than a value. The host-first verbs (`Signal.read/write`) grow a
cell's bag the same way; `has` and `remove` answer without making one.

**What `set(obj)` meant is gone.** A single argument to `set` is the lane's value
whatever its type; the seed form lives in the constructor (`new Signal.Store({…})`).
The silent third argument (`set(k, v, true)`) stays.

**The empty signature is the head.** A factory — `Signal.Store(fn)`, `Computed`,
`Effect` — answers by signature, and the signature `[]` names the head node
itself: the body is installed in the head's value lane and the trie's root
points at it, so an Effect or a Computed is ONE arena slot where it was two (an
inert head and a leaf). The head is never in the LRU queue — a store cannot
evict itself — and `delete()` of the empty signature retypes it to the state
node it was born as (consumers learn, as of a leaf's death; the store and its
other variants live on; the next call re-arms). `clear()` drops every variant,
the head's body with them. A `Computed` is armed at construction as a stale
PULL formula and not run (lazy, as ruled), which makes it readable wherever a
field is read: core files a sigiled getter's Computed under its key, and the
door and `get(key)` now read its value. An `Effect` arms through the call at
construction, so the arming run still assigns its role. `detach()`/`attach()`
on a factory head now park and resume the body, since the body is the head's.
A disposed factory head answers `undefined` and mints nothing.

**Why the untracked trit could not mark a head.** The inert mint
`encode(1,0,0,0,0)` (TRIT_STORE) is also an untracked State cell; a lane that
switched the head to tracked on first use would have switched such cells too.
The head is therefore a state node from birth; the component mint keeps the
inert spelling.

**Measured, in Chromium.** The cell paths are unchanged (bare call, `get`,
`set` within noise of stage 4); an Effect costs one slot and about 3.5 µs to
construct against 5.5; field read, write and door read at parity; heap per
element unchanged (5.3 KB, the Maps and field nodes). 559 cases, 542 pass.

# Part 4 — Proposed: designed, not adopted

Staging for rulings that were settled in discussion but are **not** part of the
language. Nothing here is in Parts 0–3, nothing here has an anchor, and
nothing here is implemented. A ruling leaves this part in one of two
directions: it is adopted and moves into Parts 0–3 with a `[[C-NAME]]` anchor
and a `doc:` pointer, or it is declined and stays here as the record of why.

The distinction from Parts 0–3 is not confidence. It is commitment: this part
is allowed to contradict itself and to hold both sides of an open question.
Parts 0–3 are not.

---

## P-1 · The `yield` collapse — HELD

**The proposal.** `yield` becomes the single word for blocking settlement,
retiring `vsync` / `bsync` / `latch`. It means *emit and suspend*, which is
what `yield` has always meant in JavaScript and what the emit already spelled:

```js
// source:  vsync const db = await open();
// emit:    this.db = yield open();          ← it was always yielding
```

**What is measured and not in doubt.** `sync`, `vsync` and `bsync` compile to
*byte-identical output* — three spellings, one behaviour, which is a standing
Perl's Razor violation whatever is done about it. And the emit for a blocking
field is already `this.x = yield expr`. The observation at the centre of the
proposal is correct.

**Why it is held.** The collapse is load-bearing in the literal sense: it
carries other rulings, and adopting it would settle them by side effect rather
than on their own merits. Three things ride on it —

- **Every blocking field emits.** Settlement and the settlement stream become
  one mechanism. No blocking field can be private. The original note judged
  this an acceptable loss; it is a loss either way, and it should be paid
  deliberately, not inherited.
- **The star gate becomes universal.** Today the star gates EMISSION only:
  `vsync`, `defer` and `async` all work in a plain `mixed class`, and only an
  explicit `yield` member forces `class*` (measured). Under the collapse every
  blocking field emits, so nearly every class needs a star. The §7.2 rule "if
  it blocks settlement, it yields, so the star gate applies" is *false today*
  and becomes true only as a consequence of this change.
- **`el[METADATA]` acquires its motivation.** See P-3.

**MEASURED, on revisiting.** Three numbers decide the shape of this, and none
of them were known when it was designed:

1. **`yield` cannot replace `vsync` at the CLASS HEAD.** `vsync` is not only a
   field lane — `vsync class Foo extends Div {}` is the class grain word, and
   64 of the corpus's 273 `vsync` sites are that form. `yield class Foo {}` is
   *already valid JavaScript*: a yield expression whose operand is a class
   expression, legal inside exactly the generators these constructors compile
   to. The word cannot be taken there. So `vsync` survives the collapse no
   matter what, and the result is `vsync class` beside `yield const x` — one
   concept, two words, split across two levels. Today it is one word at both.
   That is a Perl's Razor REGRESSION, and it is the opposite of the reason the
   collapse was proposed.

2. **The code it deletes is small.** The emit machinery it was supposed to
   merge is already one mechanism: `assertYieldRule` is five lines, `EMITS`
   occurs three times in core, and emission is a thin wrapper around the same
   generator settlement already uses. What the collapse actually removes is
   `LANE_ALIAS` plus six inline normalisations and two reverse translations —
   on the order of twenty lines in a 2,900-line compiler.

3. **The migration is 365 sites**, of which 64 are impossible (see 1).

**Done instead, and independent of any decision here.** All six normalisations
now route through `canonLane` / `isBlocking` / `sayLane` beside `LANE_ALIAS`.
Renaming a surface spelling was an edit in six scattered ternaries where a
missed one failed silently; it is now an edit to the word sets and one reverse
map. That was the recoverable part of this proposal's value, and it cost
nothing: no surface change, suite unmoved at 511/494/1/16, zero of 69
documented examples changed verdict.

**The gentle path, if the insight is what matters.** `yield const x = await f()`
is refused today for one reason only — `yield` sets the emit flag and no lane,
so the field "suspends without naming its lane" (measured). Letting `yield`
ALSO stand for the blocking lane when no other lane is present makes
`yield const x` mean *block and emit*, which is the design's actual claim, in
one place in the modifier loop, with no migration and no class-head problem.
What it does NOT do is retire anything: `vsync` keeps meaning *block without
emitting*, so the three spellings and their twenty lines stay. It buys the
semantics and not the deletion.

**Cost of holding.** The three-spelling redundancy stays. `vsync` remains the
blocking lane and `yield` remains a separate slot meaning *also emit*.

**The deletion is available separately.** One word for the blocking lane at
both positions removes exactly the code the collapse would have removed, and
costs 92 sites rather than 365 with none impossible. `sync`, `vsync` and
`bsync` are byte-identical on the surface; bare `sync` is accepted at the field
lane and REFUSED at the class head, which is the live inconsistency. Choosing
`vsync` for both and retiring the other two is the Perl's Razor win that was
actually sitting there.

**If it is ever adopted**, the migration is not a rename: `vsync const x` and
`yield vsync const x` mean different things today, and the collapse merges them.
Each site is a decision.

---

## P-2 · `watch` — DECLINED, spelled `yield async`

**The proposal.** A seventh lane for "detached, but executes strictly in order
in the background" — a background waterfall. The argument for its own word was
that the behaviour is not predictable from either `async` or `yield` alone.

**Declined.** The combination is kept as it is spelled today. Note the order:
`async yield` is REFUSED — the compiler names the canonical order in the error —
and the accepted spelling is **`yield async`**, which compiles and emits through
`Instance.emit`:

```js
yield async const x = await f();   →   this.x = ø.emit(this, …)
```

The case for a new word was that a reader cannot predict the compound from its
parts. That is an argument to DOCUMENT the compound, which costs a paragraph,
rather than to mint a word, which costs a slot in the lane grammar and a row in
every matrix forever. Perl's Razor is not satisfied by "the compound is
surprising" — it asks whether choosing `watch` over `yield async` tells the
reader something `yield async` obscures, and both say detached-and-emitting.

**Reopen if**: `yield async` turns out NOT to guarantee background ordering. The
ordering claim is the part that has not been measured. If the ordering has to be
built rather than merely named, it is a behaviour and not a spelling, and it
earns its word.

---

## P-3 · `el[METADATA]` — the settlement trace — HELD, depends on P-1

**The proposal.** A parallel log on the element carrying what the stream cannot:

```js
el[METADATA] === [ { prop: null, value: 'connecting' },
                   { prop: 'db',  value: 'DB' },
                   { prop: null, value: 'ready' } ]
```

Entry `i` corresponds to stream item `i`, since both come from the same emit. A
symbol on the *value* does not work — a primitive silently drops it (measured).

**Why it is held.** Its first justification is downstream of P-1. The argument
was: *since every blocking field emits, the stream cannot distinguish a field
settling from a bare `yield 'label'`.* Without the collapse, only explicit
`yield` members emit, so the ambiguity is much narrower — a reader who wrote
`yield` knows they wrote it. The problem it solves is mostly created by P-1.

**What survives independently.** The second use does stand alone: a settlement
TRACE — which fields settled, in what order, with what values — makes `batch`'s
FCFS ordering and `memo`'s reordering visible without instrumenting anything.
Since `batch` and `memo` are now adopted, this use becomes real the moment they
are built. Bounded by field count, so it can be kept after settlement closes.

That makes P-3 a genuine candidate on its own merits once `batch` and `memo`
exist — it is held for sequencing, not for doubt. Revisit after `memo` lands,
when there is something to trace.

---

## P-4 · `try` and batch grouping — OPEN

`try batch` and `batch` group together; if one throws hard, the batch throws
hard. Agreed as a starting point and explicitly flagged for refinement.

The unresolved part: a `try` field is soft by declaration, and a hard throw
from a sibling in the same group reaches past that softness. Either the group
boundary respects `try` — in which case `try batch` and `batch` are two groups
and the adjacency rule needs a second clause — or `try` is per-field and the
group's failure is a separate event from the field's. Both are defensible; the
choice needs a case that distinguishes them.

Blocked on `batch` being implemented, since the distinguishing case is a
behaviour to run, not an argument to have.

---

## P-5 · `C-SYNCDEFAULT` withdrawal — OPEN

Marked deprecated. Cached fields already require a lane, so finishing the
withdrawal means every suspending field names its lane.

The migration is not mechanical. Each site needs a decision even though the
answer is almost always `vsync`, and "almost always" is exactly the condition
under which a mechanical migration ships a wrong answer quietly.

---

## P-6 · `static constructor` and `try` on the class head — SKETCHED (C-STATICCTOR), `try` HELD

The class face gets a constructor of its own. Static fields keep their
descriptors; the static constructor says WHEN they get their values, as
ordinary code. A sketch is built — see C-STATICCTOR for what compiles and what
is refused by name; C-BLANK and C-SHADOW for the rulings it needed. This entry
keeps the open question and the part not built.

```js
try mixed class* Engine extends Instance {
    static set schema;                   // declared: hidden, sealed on its first write
    static enum region;                  // declared: public, sealed on its first write
    static let attempts = 0;

    static constructor*() {
        yield super();
        const cfg = await load();        // under `try`: const cfg = try await load();
        this.schema = await net.get(cfg);
        this.region = await geo.detect();
    }
}
```

Settled in discussion:

- One static constructor per class. A `static { }` block beside one is refused
  (fold it in); in a class without one it still compiles.
- Fields keep the descriptor column on both faces. The static side keeps its
  lanes too, for now: the lane machinery is the same on both faces apart from
  the receiver, and the static constructor rides it rather than replacing it.
  `const` is one value for the hierarchy, `set` one per class (C-SHADOW), and
  a blank declaration keeps its write (C-BLANK) — these are what let the
  example declare its statics above and fill them below.
- The star stays: `static constructor*()`, as `constructor*()` on the instance
  face.
- `static constructor` is legal JavaScript only as a METHOD (a static FIELD named
  `constructor` is a syntax error). The compiler gives that ordinary method a
  meaning: it runs when the class is defined.
- `try` on the class head softens the CLASS FACE only: static fields and the
  static constructor. Instances keep per-field `try`, and `await new` still
  rejects. It applies the unary `try` to every top-level statement of the static
  constructor, so `const cfg = await load()` becomes `const cfg = try await
  load()`: scope and `const` survive, and a failure reads `undefined`. Wrapping
  each statement in its own `try { }` block was rejected: it hides a `const`
  from the next line.
- A failed soft write does not happen, so a `set` or `enum` field stays
  unwritten and unsealed, open to a retry. Precedent: the sentinel never seals.
- Soft means "does not reject", not "silent". Every swallowed failure goes to
  `console.warn`, naming the class and the member.

OPEN — arguments. A function implies parameters, and nothing calls a class's own
static constructor, so the question is what `super(…)` means on the class face.
The sketch builds JOIN and refuses parameters and arguments by name; switching
later would change what existing static constructors do.

- **Join** (built). `super()` waits for the parent's setup, which ran once, for
  the parent. Parameters are refused, since nothing could supply them.
  Per-subclass configuration goes through a static method or a `set` field the
  subclass declares.
- **Construct** (the instance analogy). Every class runs the whole chain of
  static constructors, the way every element runs the whole chain of
  constructors: the parent's body runs once for the parent, its parameters at
  their defaults, and again for each subclass, with `this` the subclass and the
  arguments its `super(…)` passed. Close precedent: Python's
  `__init_subclass__`. Gives parameterised base classes and automatic
  per-subclass registration; repeats the parent's one-time work for every
  subclass unless the body guards it, and replaces today's join.

Current state: `static constructor*()` compiles and runs (C-STATICCTOR). `try`
on the class head is refused by name; it used to emit `try class …`, which is
not valid JavaScript, with no diagnostic. Also pending from the same
discussion, each loud or harmless until built: a per-level `set` on the
instance face (refused by name, C-SHADOW); `await Sub` on a subclass that
declares no statics of its own resolves at once instead of joining its
parent's; `new.target` inside a compiled constructor body reads `undefined`,
because the body runs inside the hook's generator (`this.this` is the route
that works); and `K.this` on a class that extends `Instance` directly returns
`globalThis` at any depth.

## P-7 · `with` — a view by interface — STASIS

STASIS: an idea kept because it may have merit later. Nothing is planned for
it, and nothing in it is designed past this note.

`with` is the one reserved word the superset has not placed. Where it is free:
native `with` is a statement, dead in strict code (every class body and
module), and `a with b` is a SyntaxError in every mode, so the OPERATOR
position is free everywhere. A class body is not free: `with` is a legal member
name, and JavaScript now uses it there for "a copy with changes"
(`Array.prototype.with`, ES2023; Temporal's `.with()`).

    const counter = el with ICounter;   // a live view showing only ICounter's members
    const next    = point with { x: 0 }; // a copy with the change, as Array#with does

The idea is access control by what is HANDED OUT rather than by what is
declared. A view passes reads, writes and calls through to the real object —
methods run with the real THIS, so `#private` and the interface guard still
work — and anything outside the interface is simply absent for whoever holds
it. A view can be revoked (a revoked Proxy throws on any use), so an element
could cut off every view of itself when it unmounts. `private` and `protected`
decide access by where code lives; `with` would decide it by what the caller
was given. It is `Symbol.unscopables` turned around: a list of names a `with`
leaves out, against a view that shows only the names its interface lists. Two
shapes, one word, as `enum` has: an interface on the right narrows, an object
literal on the right copies.

Known costs: a view of an element is a Proxy, not a Node, so it is handed to
code and never to the DOM, and `view !== el`. The class-head spelling
`extends B with C` is avoided because Dart and Scala read it as mixins, which
`using package` already covers.

## P-0 · The column's sub-order — SETTLED, not yet migrated

**Decided: the descriptor comes BEFORE the lane.**

    [try] [static] [memo] [let|const|enum] [lane] name

`try` may sit either side of `static` (they commute); the lane is last, hard
against the name; `get`/`set` leave the descriptor slot and join the construct,
so an accessor reads `static async get peers()` and takes no descriptor except
where one is not mutually exclusive with it.

**Why, in order of weight.**

1. **The grid.** `const`/`enum`/`let` land at ONE fixed offset on every line,
   lane or no lane. Lane-first leaves that column ragged, because it shifts by
   the width of whatever lane precedes it — `yield` against `defer` against
   `batch`. The effect is small per line and relentless down a file.
2. **The question's shape.** `const async region` asks *what is this, then how
   does it arrive*. `async const region` asks the reverse. Storage is the more
   permanent fact about a field; arrival is a detail of one construction.
3. **One grammar for fields and methods.** `static const async fetchAll()` keeps
   `async fetchAll()` intact, which lane-first cannot. This is the provable
   argument and the weakest of the three by feel.

**What it costs, and why the cost is affordable.** `const yield handshake` reads
worse than `yield const handshake` — the one line where lane-first clearly wins,
on what is about to become the most common lane. It is affordable for a reason
decided elsewhere: **`'use implicit'` exists precisely so the blocking lane is
the one you do not write.** The most frequent lane is the one that disappears
from the page, so the worst-reading combination is also the rarest. That is not
a happy accident to lean on quietly; it is the justification, and it belongs
next to the ruling.

Lane-first also keeps two smaller advantages that should be recorded rather than
forgotten: adding a lane to an existing field is a PREPEND (`const config` ->
`defer const config`) where descriptor-first makes it a mid-line insert, and a
prepend reviews better; and under lane-first exactly one word always precedes
the name.

**Measured cost of the flip.**

| | sites | of which blocking lane |
| --- | --- | --- |
| `testsuite-089o.html` | 21 | 17 |
| `superset.md` | 41 | 16 |

Sixty-two in total — far smaller than the `vsync` retirement, because most
fields carry no descriptor at all and are untouched by the sub-order. Thirty-three
of the sixty-two are blocking-lane sites that vanish outright in any class
carrying `'use implicit'`.

**Sequencing.** Both orders compile today, so the flip is convention before it
is enforcement. Do it WITH the `vsync` retirement rather than before it: that
migration rewrites the same lines, and the blocking-lane sites are the ones
where `const yield` would otherwise be written by hand and then deleted again.

---

## Pending anchors

`superset.md` now carries rulings for features that are not yet in the
compiler, so these anchors have **no `doc:` pointer yet**. The doc-map
invariant is bidirectional; when `tools/doc-map.js` is rebuilt it will fail on
all six until each feature lands and takes its pointer:

| anchor | closes when | status |
| --- | --- | --- |
| `[[T-JUNKFIELD]]` | the unknown-modifier refusal exists | **CLOSED** |
| `[[C-DESCRIPTOR]]` | the descriptor slot admits `enum` | **CLOSED** |
| `[[C-ENUM]]` | `enum` is parsed as a descriptor | **CLOSED** (descriptor half) |
| `[[C-MEMO]]` | `memo` modifies a lane instead of becoming a field | open |
| `[[C-BATCH]]` | `batch` is a lane | open |
| `[[C-COMPOUND]]` | the lane slot accepts two-word values | open |
| `[[C-DEFERJOIN]]` | `defer join` reaches `new.target`'s tail | open |
| `[[C-STATICCTOR]]` | `static constructor*()` compiles and runs | **CLOSED** (sketch) |
| `[[C-BLANK]]` | a blank declaration keeps its write | **CLOSED** |
| `[[C-SHADOW]]` | `const` one per hierarchy, `set` one per class | **CLOSED** (class face) |
| `[[C-PIN]]` | `var` retires to `pin` | **CLOSED** |
| `[[C-CASCADE]]` | rows described at definition; the seed is a hidden binding | **CLOSED** |
| `[[C-DEFINE]]` | a plain write with a row is one `Superset.define` | **CLOSED** |
| `[[C-OPERAND]]` | the door call feeds a formula's operands; assignment stores; the bare call writes | **CLOSED** |
| `[[C-ADOPT]]` | the host is its store node — the element at its mint, the class at its first static write; the store surface is verbs of the host | **CLOSED** (both faces) |
| `[[C-OWNERELEMENT]]` | an element is never the running effect's child | **CLOSED** for elements (by CONSTRUCTION IS OPAQUE); open for direct adoption, switch off |
| `[[C-ONENODE]]` | one surface for every node: a lane and, on demand, keys; the empty signature is the head | **CLOSED** |

`[[T-JUNKFIELD]]` was closed first, and it is what makes the rest fail loudly
instead of silently: `memo`, `batch`, `watch`, `latch` and `join` are now
RESERVED BY NAME and refused in the modifier column, so a declaration using one
fails at the declaration rather than minting `this.memo = undefined`.

## Outstanding within an adopted ruling

**`C-CASCADE`, a WRITE from outside.** Reading or deleting a static in its TDZ
throws; assigning one from outside the class does not, yet. The write defines
the key early, and if its row is `const` the class's own definition then
refuses. Refusing the outside write means telling the hook's writes from
everyone else's — a batch member lands from a promise callback, outside any
generator step — so it waits until something needs it.

**`C-ENUM`, the TYPE half.** `enum` ships as a DESCRIPTOR only. The type form —
`enum Colour = { A, B }` compiling to `new Enum(RHS)` — is not built, because
`Enum` does not exist in the runtime (measured: no occurrence in any module).
Today `enum Colour = { A, B }` is accepted as an enum-descriptor field holding
an ordinary object literal, which throws `ReferenceError: A is not defined` at
settlement unless `A` and `B` are genuinely in scope.

That is a gap, not a trap: the ruling already states the descriptor half can
ship alone and the type half cannot. It was deliberately NOT given a refusal,
because `enum x = { A, B }` with `A` and `B` actually in scope is a legitimate
descriptor field, and refusing by shape would reject it. The refusal becomes
correct only once `Enum` exists and the shape means something.

## Held after global capture

**Late readiness replay.** A captured external script of ours delays hydration
past DOMContentLoaded, so a restored script that registers for
`DOMContentLoaded` — or for `load`, if that has also passed — waits forever.
Proposed: while restored scripts run, a listener for a readiness event that has
already fired is called once, asynchronously, as the browser would have.

## Runtime CSP work (found by the audit; the compiler is clean)

**Apps run through the Function constructor** (core, the app loader): under a
policy without `'unsafe-eval'` no app runs. Proposed: hand the compiled body to a
nonced, policy-blessed script element that registers a function, which the core
then calls with `app`, `host` and `shadow` — the same scope, no eval — and run an
app script only if it carries the page's nonce, which keeps markup from becoming
code without the server's say-so.

**`innerHTML` writes are Trusted Types sinks**: core (class templates), DSL
(string-built DOM), platform (router outlets, six sites). Each needs a policy or a
DOM API — `replaceChildren()` for the clearing ones.

**`new Function('return this')`** in core is a dead path in any browser (`this`
is the window there) but reads as eval in an audit; `globalThis` replaces it.

**UTF-8 dependence.** Core (line 477) and Chimera (line 54) use non-ASCII
identifiers, so a page that does not decode them as UTF-8 — no charset declared,
and none sent by the server — fails to parse them (measured: both break when read
as windows-1252). Proposed: ASCII-only module sources, with `\u` escapes where a
non-ASCII name is wanted.

## Lanes: `latch` replaces `sync` (ADOPTED as `setup` — see C-LANES2X2; the table below used the working name)

`latch` is the blocking lane. `sync` and its aliases (`synch`, `layer`, `vsync`,
`bsync`) and `batch` become retiring aliases. A two-word lane reads left to
right: the first word says how the run meets the constructor, the second how its
lines meet each other.

|              | lines in turn  | lines as they land |
| ------------ | -------------- | ------------------ |
| **joined**   | `latch`        | `latch async`      |
| **detached** | `async latch`  | `async`            |

`latch async` is the old `batch`: the run starts together, each value is written
as it lands, and the run joins at the lane change. `async latch` is the old
`async sync`, the background waterfall: detached, each line starting when the
previous one lands. The two are inverses by construction — word order is
meaning, so a transposed pair compiles, and this table is the rule that makes it
learnable. `defer async` (the old `defer batch`) reads the same way: joined at
the constructor's end, written as each lands. `memo` is unchanged: it holds
writes to source order, and is a no-op where lines already go in turn.

## Descriptors: `set` is the hidden strict constant (SUPERSEDED by C-SHADOW; `indexed` adopted alongside as memo's participle spelling)

`set` was adopted as `const`'s alias, which failed Perl's Razor. It now differs:
`const` is one value for the hierarchy, `set` one per class (C-SHADOW). `get` →
`pin` is withdrawn: `pin` is the word that replaced `var` (C-PIN).

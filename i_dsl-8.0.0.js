/**!
* @license FSL-1.1
* @description Direct Element Architecture — Instance 0.89.c
*/
/* ═══════════════════════════════════════════════════════════════════════════
 * Instance DSL v8 — placement/selection grammar plus the argument and content
 * grammar the element constructor delegates to.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';
/* ===== v8 DSL ===== */
// DSL-v8.js — placement/selection grammar as a loadable Instance plugin.
// Resolver contract: default export is a factory(GLOBAL) returning the extension value.
function DSL_PLUGIN(GLOBAL) {
  const document = GLOBAL.document ?? globalThis.document;
class DSLError extends Error {
  constructor(msg, raw = '') {
    super(`[DSL] ${msg}${raw ? ` — "${raw}"` : ''}`);
    this.name = 'DSLError';
  }
}

/* ═══════════════════════════════════════════════════════════════
   DSL – final grammar (with normalisation)
   ═══════════════════════════════════════════════════════════════ */
class DSL {
  /* ── Public API (unchanged) ────────────────────────────────────── */
  static parse(str)    { return new DSL(str)._exec(); }
  static targets(ast, root) { return ast ? new DSL(ast.raw)._resolve(ast, root ?? document) : []; }
  static place(ast, el, target) { if (ast && el && target) DSL.#insert(ast.placement, el, target, ast.ordinalIndex); return el; }
  static route(ast, el, root) { return DSL.place(ast, el, DSL.targets(ast, root)[0]); }
  static pipe(str, el, root) { return DSL.route(DSL.parse(str), el, root); }

  /* ── ARGUMENT GRAMMAR (moved out of core, 0.89.c) ──────────────────────────
   * `new Div('@append to body', 'hello')` mixes ONE placement directive with
   * content. Splitting that argument list is grammar, so it belongs here: core
   * was hardcoding `arg[0] === '@'`, which put the DSL's sigil in a module that
   * otherwise knows nothing about the DSL. Now core asks, and the sigil has one
   * owner — change it here and nothing else needs to know. */
  static isDirective(arg) { return typeof arg === 'string' && arg[0] === '@'; }

  /* Split an argument list into { route, content }. The FIRST directive is the
   * placement; any later one is content, which keeps a stray '@handle' string
   * from being silently eaten as a second placement. */
  static split(args) {
    let route = null;
    const content = [];
    for (const arg of args) {
      if (route === null && DSL.isDirective(arg)) route = arg;
      else content.push(arg);
    }
    return { route, content };
  }

  /* ── CONTENT NORMALISATION (moved out of core, 0.89.c) ─────────────────────
   * Turn an argument list into children. Node passes through, an HTML-looking
   * string is parsed, everything else becomes text. Returns a DocumentFragment,
   * or null when there is nothing to append — the caller keeps its own fast
   * path for the single-plain-string case, which never allocates a fragment. */
  static content(items, doc = document) {
    if (!items || !items.length) return null;
    const frag = doc.createDocumentFragment();
    for (const item of items) {
      if (item instanceof Node) frag.appendChild(item);
      else if (typeof item === 'string') {
        if (DSL.#HTML.test(item)) {
          const temp = doc.createElement('div');
          temp.innerHTML = item;
          while (temp.firstChild) frag.appendChild(temp.firstChild);
        } else frag.appendChild(doc.createTextNode(item));
      }
      else if (item != null) frag.appendChild(doc.createTextNode(String(item)));
    }
    return frag;
  }
  static #HTML = /<[^>]+>/;
  static isMarkup(s) { return DSL.#HTML.test(s); }

  /* ── Reserved vocabulary ───────────────────────────────────────── */
  // verbs: prepend/append are container-inserts ≡ firstchild/lastchild
  static #VERB = {
    before: 'before', after: 'after', wrap: 'wrap', replace: 'replace',
    prepend: 'firstchild', append: 'lastchild'
  };
  static #ORDINALS = new Map([
    ['first',1],['second',2],['third',3],['fourth',4],['fifth',5],
    ['sixth',6],['seventh',7],['eighth',8],['ninth',9],['tenth',10],['last',-1]
  ]);
  static #ORD_RE = /^(?:the\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last)\b/i;

  // absolute generation (from the root selector) of a depth word
  static #genOf(word) {
    if (word === 'child') return 1;
    if (!/^(?:great-)*grandchild$/.test(word)) return 0;
    return (word.match(/great-/g)?.length ?? 0) + 2;
  }

  #raw; #s;
  constructor(str) { this.#raw = str; this.#s = String(str ?? '').trim(); }

  #ast(props = {}) {
    return Object.assign(
      { placement: 'append', container: null, singular: false, raw: this.#raw }, props
    );
  }

  /* ── Top-level parser ──────────────────────────────────────────── */
  _exec() {
    let s = this.#s;
    if (!s) throw new DSLError('Empty selector', this.#raw);

    // sigil + base plurality
    let singular = true;
    if (s.startsWith('@@'))      { singular = false; s = s.slice(2).trim(); }
    else if (s.startsWith('%'))  { return this.#instanceAst(s.slice(1), false); } // bare %Name (singular)
    else if (s.startsWith('@'))  { s = s.slice(1).trim(); }
    else throw new DSLError('Selectors must start with @ or @@', this.#raw);

    if (!s) throw new DSLError('Empty selector after sigil', this.#raw);

    // @every / @each prefix → plural — but "every <ordinal>" is ordinal repetition, not this
    if (/^(?:every|each)\b/i.test(s)) {
      const after = s.replace(/^(?:every|each)\s*/i, '');
      if (!DSL.#ORD_RE.test(after)) {
        singular = false;
        s = after.trim();
        if (!s) throw new DSLError('Missing selector after @every/@each', this.#raw);
      }
    }

    // %Name after the sigil → instance selector (whole body)
    if (s.startsWith('%')) return this.#instanceAst(s.slice(1), !singular);

    const defaultPlural = !singular;
    s = this.#normalize(s);

    // verb? (placement acts on a selected set)
    const vm = /^(before|after|wrap|replace|prepend|append)\b/i.exec(s);
    if (vm) {
      const op = DSL.#VERB[vm[1].toLowerCase()];
      let rest = s.slice(vm[0].length).trim();
      rest = rest.replace(/^(?:to|within|of)\s+/i, '').trim(); // optional connector sugar
      if (!rest) throw new DSLError(`Placement "${vm[1]}" requires a selector`, this.#raw);
      const container = this.#parseContainer(rest, defaultPlural);
      return this.#ast({ placement: op, container, singular });
    }

    // verbless: the expression *is* the placement (the new element takes the named slot)
    const head = this.#matchOrdinalHead(s);
    if (head) {
      let op, ordinalIndex;
      if (head.ordinal === 1)       op = 'firstchild';
      else if (head.ordinal === -1) op = 'lastchild';
      else { op = 'nth'; ordinalIndex = head.ordinal; }
      const container = this.#parseContainer(head.rest, defaultPlural);
      return this.#ast({ placement: op, container, singular, ordinalIndex });
    }

    // bare selector → append into the matched element(s)
    const container = this.#parseContainer(s, defaultPlural);
    return this.#ast({ placement: 'append', container, singular });
  }

  #instanceAst(name, plural) {
    return this.#ast({
      instance: true, singular: !plural,
      container: { type: 'selector', selector: name.trim(), plural, instance: true }
    });
  }

  // one-word firstchild/lastchild ≡ the ordinals "first/last child"
  // (not when it is part of a selector token like .firstchild)
  #normalize(s) { return s.replace(/(?<![.#\w-])(first|last)child\b/gi, '$1 child'); }

  /* ── Container parser (recursive, right-to-left via the first " of ") ── */
  #parseContainer(str, defaultPlural) {
    str = str.trim();

    const head = this.#matchOrdinalHead(str);
    if (head) {
      const inner = this.#parseContainer(head.rest, defaultPlural);
      return {
        type: 'ordinal',
        ordinal: head.ordinal, fromLast: head.fromLast, every: head.every,
        depthWord: head.depthWord, filter: head.filter, container: inner
      };
    }

    // base selector segment
    let plural = defaultPlural;
    let sel = str;
    if (/^(?:every|each)\b/i.test(sel)) {
      plural = true;
      sel = sel.replace(/^(?:every|each)\s*/i, '').trim();
      if (!sel) throw new DSLError('Empty selector after every/each', this.#raw);
    }
    if (sel.startsWith('%')) return { type: 'selector', selector: sel.slice(1).trim(), plural, instance: true };

    // ancestor / route arrows — longest symbols first so <= / <<= are not shadowed by < / <<
    for (const a of [
      { sym: '<<=', kind: 'route',    dir: 'any' },
      { sym: '<=',  kind: 'route',    dir: 'immediate' },
      { sym: '<<',  kind: 'ancestor', dir: 'any' },
      { sym: '<',   kind: 'ancestor', dir: 'immediate' },
    ]) {
      const idx = sel.indexOf(a.sym);
      if (idx !== -1) {
        const left = sel.slice(0, idx).trim();
        const target = sel.slice(idx + a.sym.length).trim();
        if (!left || !target) throw new DSLError(`Invalid arrow expression "${a.sym}"`, this.#raw);
        const node = { type: 'selector', selector: left, plural, target };
        node[a.kind] = a.dir;
        return node;
      }
    }

    if (!sel) throw new DSLError('Empty selector', this.#raw);
    return { type: 'selector', selector: sel, plural };
  }

  /* ── Ordinal head: [the] [every] <ord> [from last] [depth] [selector] of <rest> ──
     Returns null when there is no " of " (→ it is a plain selector segment).
     Throws when " of " is present but the leading word is not a valid ordinal
     ("of" is reserved and only ever introduces an ordinal container). */
  #matchOrdinalHead(str) {
    const m = /\sof(?=\s|$)/i.exec(str); // " of " or a trailing/dangling "of"; ignores "-of-" inside selectors
    if (!m) return null;

    let head = str.slice(0, m.index).trim();
    const rest = str.slice(m.index + m[0].length).trim();
    if (!rest) throw new DSLError('Missing container after "of"', this.#raw);

    head = head.replace(/^the\s+/i, '');
    let every = false;
    if (/^every\s+/i.test(head)) { every = true; head = head.replace(/^every\s+/i, '').trim(); }

    const om = /^([a-z]+)\b/i.exec(head);
    if (!om) throw new DSLError('Malformed ordinal expression', this.#raw);
    const ordWord = om[1].toLowerCase();
    if (!DSL.#ORDINALS.has(ordWord)) throw new DSLError(`Invalid ordinal "${ordWord}"`, this.#raw);
    const ordinal = DSL.#ORDINALS.get(ordWord);

    let tail = head.slice(om[0].length).trim();

    let fromLast = false;
    if (/^from\s+last\b/i.test(tail)) { fromLast = true; tail = tail.replace(/^from\s+last\s*/i, '').trim(); }

    let depthWord = null;
    const dm = /^((?:great-)*grandchild|child)\b/i.exec(tail);
    if (dm) { depthWord = dm[1].toLowerCase(); tail = tail.slice(dm[0].length).trim(); }

    return { ordinal, fromLast, every, depthWord, filter: tail || null, rest };
  }

  /* ── Resolution (selection mode) ───────────────────────────────── */
  _resolve(ast, scope) {
    if (ast.instance) throw new DSLError('Instance selector (%) resolution is not yet implemented', ast.raw);
    if (!ast.container) throw new DSLError('No container in AST', ast.raw);
    const { els } = this.#resolveContainer(ast.container, scope);
    if (!els.length) throw new DSLError('No elements found for the given expression', ast.raw);
    return els;
  }

  // returns { els, gen }, where gen is the absolute generation from the root selector
  #resolveContainer(c, scope) {
    if (c.type === 'selector') {
      if (c.instance) throw new DSLError('Instance selector (%) resolution is not yet implemented', this.#raw);
      let raw = [...scope.querySelectorAll(c.selector)];

      if (c.ancestor) {
        raw = raw.filter(el => c.ancestor === 'immediate'
          ? !!el.parentElement?.matches(c.target)
          : !!el.closest(c.target));
      } else if (c.route) {
        const seen = new Set();
        for (const el of raw) {
          const found = c.route === 'immediate'
            ? (el.parentElement?.matches(c.target) ? el.parentElement : null)
            : el.closest(c.target);
          if (found) seen.add(found);
        }
        raw = [...seen];
      }
      return { els: c.plural ? raw : raw.slice(0, 1), gen: 0 };
    }

    // ordinal container
    const { els: innerEls, gen: innerGen } = this.#resolveContainer(c.container, scope);
    const thisGen = c.depthWord ? DSL.#genOf(c.depthWord) : innerGen + 1;
    const descend = Math.max(1, thisGen - innerGen);

    const out = [];
    for (const inner of innerEls) {
      let pool = DSL.#descend(inner, descend);
      if (c.filter) pool = pool.filter(e => e.matches(c.filter));
      if (c.every) out.push(...DSL.#everyNth(pool, c.ordinal, c.fromLast));
      else { const picked = DSL.#pickNth(pool, c.ordinal, c.fromLast); if (picked) out.push(picked); }
    }
    return { els: out, gen: thisGen };
  }

  static #descend(root, d) {
    let cur = [...root.children];
    for (let i = 1; i < d; i++) cur = cur.flatMap(e => [...e.children]);
    return cur;
  }

  static #pickNth(pool, ord, fromLast) {
    if (!pool.length) return null;
    if (fromLast) { const i = pool.length - ord; return i >= 0 ? pool[i] : null; }
    if (ord === -1) return pool[pool.length - 1];
    return pool[ord - 1] ?? null;
  }

  static #everyNth(pool, ord, fromLast) {
    const out = [];
    if (ord === -1) { if (pool.length) out.push(pool[pool.length - 1]); return out; }
    if (fromLast) { for (let i = pool.length - ord; i >= 0; i -= ord) out.push(pool[i]); }
    else { for (let i = ord - 1; i < pool.length; i += ord) out.push(pool[i]); }
    return out;
  }

  /* ── Insertion ─────────────────────────────────────────────────── */
  static #insert(placement, element, target, ordinalIndex) {
    switch (placement) {
      case 'before':     target.insertAdjacentElement('beforebegin', element); break;
      case 'after':      target.insertAdjacentElement('afterend',    element); break;
      case 'firstchild': target.insertAdjacentElement('afterbegin',  element); break;
      case 'nth': {
        const ref = target.children[(ordinalIndex ?? 1) - 1];
        if (ref) target.insertBefore(element, ref); else target.appendChild(element);
        break;
      }
      case 'wrap':       target.insertAdjacentElement('beforebegin', element); element.appendChild(target); break;
      case 'replace':    target.insertAdjacentElement('beforebegin', element); target.remove(); break;
      case 'lastchild':
      case 'append':
      default:           target.appendChild(element); break;
    }
  }
}

  return { DSL, DSLError };
}



globalThis[Symbol.for('Instance/DSL')] = DSL_PLUGIN;
})();
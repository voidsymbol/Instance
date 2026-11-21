/* Instance Platform 1.0 */
(function () {
'use strict';

const __K = globalThis[Symbol.for('Instance')]('latest', 'platformkit');
if (__K == null) throw new Error(
	'Instance PLATFORM: core did not publish the "platformkit" domain \u2014 load order is core \u2192 chimera \u2192 dsl \u2192 platform.');
const { CORE_TAGS, MINTED, Signal, _RT, _httpGET, _looksLikeURL, _nsFire,
        createElement, Instance } = __K;
let _I18N = __K._I18N;

class Router extends Instance {

	#childObs = null;
	#mounted = false;
	['@mount']() {
		this.#mounted = true;
		Router.configure({ base: this.getAttribute('base') || '', history: this.getAttribute('history') || 'push' });
		this.#registerAll();
		this.#childObs = new MutationObserver(() => this.#registerAll());
		this.#childObs.observe(this, { childList: true });

		Router.wire();
	}
	['@removal']() { this.#unregister(); }
	['@insertion']() { if (this.#mounted) this.#registerAll(); }
	['@unmount']() {
		if (this.#childObs) { this.#childObs.disconnect(); this.#childObs = null; }
		this.#unregister();
	}
	#buildRouteMap() {
		const routes = [...this.querySelectorAll('route')];
		const routeMap = {}, namedMaps = {};
		routes.forEach(route => {
			const path = route.getAttribute('path');
			if (!path) return;
			const src = route.getAttribute('src');
			const namedAttrs = [...route.attributes].filter(a => a.name !== 'path' && a.name !== 'src');
			namedAttrs.forEach(a => { if (!namedMaps[a.name]) namedMaps[a.name] = {}; namedMaps[a.name][path] = a.value; });
			if (src) routeMap[path] = src;
		});
		return { routeMap, namedMaps };
	}
	#registerAll() {
		const { routeMap, namedMaps } = this.#buildRouteMap();
		const defaultOutlet = document.querySelector('outlet:not([name])') || document.querySelector('outlet') || document.querySelector('[data-outlet]');
		if (defaultOutlet && Object.keys(routeMap).length) Router._register(defaultOutlet, routeMap, {});
		Object.entries(namedMaps).forEach(([name, map]) => {
			const outlet = document.querySelector('outlet[name="' + name + '"]');
			if (outlet && Object.keys(map).length) Router._register(outlet, map, {});
		});
	}
	#unregister() {
		const d = document.querySelector('outlet:not([name])') || document.querySelector('outlet');
		if (d) Router._unregister(d);
	}

	static configure(opts) { Object.assign(_RT.config, opts || {}); return Router; }
	static navigate(path, opts) { Router.push(path, !!(opts && opts.replace)); return Router; }
	static back()    { history.back();    return Router; }
	static forward() { history.forward(); return Router; }
	static before(fn) { if (typeof fn === 'function') _RT.guards.push(fn); return Router; }
	static on(ev, fn)  { if (_RT.listeners[ev]) _RT.listeners[ev].add(fn); return Router; }
	static off(ev, fn) { if (_RT.listeners[ev]) _RT.listeners[ev].delete(fn); return Router; }
	static get current() { return Object.assign({}, _RT.current); }
	static get path() { if (!_RT.path) _RT.path = new Signal.State(_RT.current.path); return _RT.path; }
	static _unregister(outlet) { _RT.tables.delete(outlet); return Router; }
	static _register(outlet, routeMap, options) {
		const table = [];
		for (const pattern of Object.keys(routeMap))
			table.push({ pattern, compiled: Router.compile(pattern), source: routeMap[pattern], options: options || {} });
		_RT.tables.set(outlet, table);

		if (!_RT.path) _RT.path = new Signal.State(_RT.current.path);
		Router.wire();
		return Router;
	}

	static parse(full) {
		const u = new URL(full, (typeof location !== 'undefined' && location.origin && location.origin !== 'null' && location.origin) || 'http://x');
		const query = {}; u.searchParams.forEach((v, k) => { query[k] = v; });
		return { path: u.pathname || '/', query, hash: u.hash ? u.hash.slice(1) : '' };
	}
	static compile(pattern) {
		const names = [];
		const rx = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
			.replace(/\*/g, '(?<wild>.*)')
			.replace(/:(\w+)/g, (_, n) => { names.push(n); return '(?<' + n + '>[^/]+)'; });
		return { rx: new RegExp('^' + rx + '/?$'), names };
	}
	static match(compiled, path) {
		const m = compiled.rx.exec(path);
		if (!m) return null;
		const out = {};
		if (m.groups) for (const k of Object.keys(m.groups)) if (m.groups[k] !== undefined) out[k] = decodeURIComponent(m.groups[k]);
		return out;
	}
	static push(path, replace) {
		const c = _RT.config;
		if (c.history === 'hash') { if (replace) location.replace('#' + path); else location.hash = path; }
		else if (c.history === 'memory') { Router._navigate(path); }
		else {
			const full = c.base + path;
			if (replace) history.replaceState({}, '', full); else history.pushState({}, '', full);
			Router._navigate(path);
		}
	}
	static _navigate(pathOrFull, fromPopstate) {
		const parsed = _RT.config.history === 'hash'
			? Router.parse((location.hash && location.hash.slice(1)) || '/')
			: Router.parse(pathOrFull);
		const from = Object.assign({}, _RT.current);
		const to = { path: parsed.path, query: parsed.query, hash: parsed.hash, params: {} };
		const guards = _RT.guards.slice(); let i = 0;
		(function next(redirect) {
			if (redirect && typeof redirect === 'string') { Router.push(redirect, false); return; }
			if (i < guards.length) { guards[i++](from, to, next); return; }
			Router.commit(from, to, parsed, !!fromPopstate);
		})();
	}
	static commit(from, to, parsed, fromPopstate) {
		let matched = null, matchParams = {}, matchOutlet = null, matchSource = null;
		for (const [outlet, table] of _RT.tables) {
			for (const entry of table) {
				const params = Router.match(entry.compiled, parsed.path);
				if (params !== null) {
					matched = entry; matchParams = params; matchOutlet = outlet;
					matchSource = typeof entry.source === 'function' ? entry.source.call(outlet, params, parsed) : entry.source;
					break;
				}
			}
			if (matched) break;
		}
		if (!matched) { _RT.listeners.error.forEach(fn => { try { fn(new Error('No route matched: ' + parsed.path)); } catch (e) {} }); return; }
		to.params = matchParams;
		_RT.current = Object.assign({}, to);
		if (_RT.path) _RT.path.set(parsed.path);
		if (_RT.config.scroll && !fromPopstate && typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, 0);
		const ctx = { from, to, params: matchParams, query: parsed.query, hash: parsed.hash };
		if (matchOutlet && typeof matchOutlet['@routeleave'] === 'function') matchOutlet['@routeleave'](ctx);
		const _after = () => {
			if (typeof matchOutlet['@routeenter'] === 'function') matchOutlet['@routeenter'](Object.assign({ el: matchOutlet }, ctx));
			if (typeof matchOutlet['@navigate'] === 'function') matchOutlet['@navigate'](ctx);
			_RT.listeners.navigate.forEach(fn => { try { fn(from, to); } catch (e) {} });
		};
		if (matchSource instanceof Node) { matchOutlet.innerHTML = ''; matchOutlet.appendChild(matchSource); _after(); }
		else if (typeof matchSource === 'string' && _looksLikeURL(matchSource))
			Promise.resolve(typeof matchOutlet.get === 'function' ? matchOutlet.get(matchSource) : _httpGET(matchSource))
				.then(html => { matchOutlet.innerHTML = String(html); _after(); }, () => _after());
		else _after();
	}
	static wire() {
		if (_RT.wired || typeof document === 'undefined') return;
		_RT.wired = true;
		document.addEventListener('click', (e) => {
			const anchor = e.target && e.target.closest && e.target.closest('a[href]');
			if (!anchor) return;
			const inRouter = anchor.closest('router, [data-router]');
			const href = anchor.getAttribute('href');
			if (!href || /^(https?:|\/\/|mailto:|tel:)/.test(href)) return;
			if (!inRouter) {
				let known = false;
				for (const [, table] of _RT.tables) for (const entry of table) if (Router.match(entry.compiled, Router.parse(href).path)) { known = true; break; }
				if (!known) return;
			}
			e.preventDefault();
			Router.push(href, false);
		}, false);
		if (typeof window !== 'undefined') {

			window.addEventListener('popstate', () => { if (_RT.config.history !== 'hash') Router._navigate(location.pathname + location.search + location.hash, true); });
			window.addEventListener('hashchange', () => { if (_RT.config.history === 'hash') Router._navigate((location.hash && location.hash.slice(1)) || '/', true); });
		}
	}
}
void Instance.define(Router);

;(function () {
	const __IVC = globalThis[Symbol.for('Instance')];
	if (typeof __IVC !== 'function' || typeof __IVC.provide !== 'function') throw new Error(
		'Instance PLATFORM: no IVC broker \u2014 the platform vocabulary extends Instance and cannot run standalone. Load core first.');
	__IVC.provide({ module: 'platform', value: { Router, applyIntl: _applyIntl },
		from: '0.89.c', to: '0.92.z' });
})();

function _applyIntl(el) {
	const key = el.getAttribute && el.getAttribute('key');
	if (!key || !_I18N) return;
	const val = _I18N[key];
	if (val != null) el.textContent = val;
}

function _inlineLink(el, hrefFn, rel) {
	const text = (el.textContent || '').trim();
	if (!text) return;
	const a = document.createElement('a');
	a.href = hrefFn(text);
	if (rel) a.rel = rel;
	a.textContent = text;
	el.textContent = ''; el.appendChild(a);
}

function _activatable(el, onFire) {
	el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0');
	el.addEventListener('click', onFire);
	el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') el.click(); });
}

class Static extends Instance {
	['@mount']() { this.setAttribute('data-static', ''); }
}
class Email extends Instance {
	['@mount']() { _inlineLink(this, t => 'mailto:' + t, null); }
}
class Tel extends Instance {
	['@mount']() { _inlineLink(this, t => 'tel:' + t.replace(/\s/g, ''), null); }
}
class Website extends Instance {
	['@mount']() { _inlineLink(this, t => t.startsWith('http') ? t : 'https://' + t, 'external noopener noreferrer'); }
}
class Mailto extends Instance {
	['@mount']() {
		const to = this.getAttribute('to') || '', subject = this.getAttribute('subject') || '', body = this.getAttribute('body') || '';
		const params = new URLSearchParams();
		if (subject) params.set('subject', subject);
		if (body) params.set('body', body);
		const query = params.toString();
		const a = document.createElement('a');
		a.href = 'mailto:' + to + (query ? '?' + query : '');
		a.innerHTML = this.innerHTML || to;
		this.innerHTML = ''; this.appendChild(a);
	}
}
class Logout extends Instance {
	['@mount']() {
		this.style.cursor = 'pointer';
		_activatable(this, () => {
			const endpoint = this.getAttribute('href') || this.getAttribute('action') || '/api/logout';
			const redirect = this.getAttribute('redirect') || '/';
			const F = typeof fetch === 'function' ? fetch : globalThis.fetch;
			Promise.resolve(F ? F(endpoint, { method: 'POST' }) : null).then(() => { try { Router.navigate(redirect); } catch (e) { location.href = redirect; } });
		});
	}
}
class Reset extends Instance {
	['@mount']() { _activatable(this, () => { const form = this.closest('form'); if (form) form.reset(); }); }
}
class Portal extends Instance {
	['@mount']() {
		const target = document.querySelector(this.getAttribute('target') || 'body');
		if (!target) return;
		const frag = document.createDocumentFragment();
		[...this.childNodes].forEach(n => frag.appendChild(n));
		target.appendChild(frag);
		this._portalTarget = target;
	}
}

class IntlElement extends Instance {
	static id = 'intl';
	['@mount']() { _applyIntl(this); }
}

class Async extends Instance {
	#obs = null;
	['@mount']() {
		this.setAttribute('inert', '');
		const src = this.getAttribute('src');
		if (src) this.#fetch(src);
		this.#obs = new MutationObserver(ms => { ms.forEach(m => { if (m.attributeName === 'src') { const ns = this.getAttribute('src'); if (ns) this.#fetch(ns); } }); });
		this.#obs.observe(this, { attributes: true, attributeFilter: ['src'] });
	}
	['@unmount']() { if (this.#obs) { this.#obs.disconnect(); this.#obs = null; } }
	reload() { const u = this.getAttribute('src'); if (u) this.#fetch(u); return this; }
	async #fetch(url) {
		try {
			const F = typeof fetch === 'function' ? fetch : globalThis.fetch;
			const response = await F(url);
			const contentType = (response.headers && response.headers.get && response.headers.get('content-type')) || '';
			let nodes = [];
			if (contentType.includes('application/json')) {
				const data = await response.json();
				const parent = this.parentElement;
				if (parent) _nsFire(parent, '@async', { src: url, data, el: this, type: 'json' });
				this.setAttribute('data-loaded', ''); this.removeAttribute('inert');
				return;
			}
			if (contentType.startsWith('text/')) {
				const html = await response.text();
				const template = document.createElement('template');
				template.innerHTML = html;
				nodes = [...template.content.childNodes];
			}
			this.setAttribute('data-loaded', ''); this.removeAttribute('inert');
			const parent = this.parentElement;
			if (nodes.length) this.replaceWith(...nodes); else this.replaceWith();
			if (parent) _nsFire(parent, '@async', { src: url, nodes, el: this, type: 'html' });
		} catch (err) {
			this.setAttribute('data-error', ''); this.removeAttribute('inert');
			const errChild = this.querySelector(':scope > error');
			if (errChild) errChild.style.display = '';
			else console.warn('[Instance] <async> fetch failed: ' + err.message + ' (' + url + ')');
			const parent = this.parentElement;
			if (parent) _nsFire(parent, '@async', { src: url, error: err, el: this, type: 'error' });
		}
	}
}

class Sync extends Instance {
	#timer = null; #last = '';
	['@mount']() { this.#start(); }
	['@insertion']() { if (LC_MOUNTED.has(this)) this.#start(); }
	['@removal']() { this.#stop(); }
	['@unmount']() { this.#stop(); }
	stop()  { this.#stop(); return this; }
	start() { this.#start(); return this; }
	#stop() { if (this.#timer) { clearInterval(this.#timer); this.#timer = null; } }
	#start() {
		if (this.#timer) return;
		const interval = parseInt(this.getAttribute('interval') || '5000', 10);
		this.#poll();
		this.#timer = setInterval(() => this.#poll(), interval);
	}
	async #poll() {
		const src = this.getAttribute('src');
		if (!src) return;
		this.setAttribute('data-syncing', '');
		try {
			const F = typeof fetch === 'function' ? fetch : globalThis.fetch;
			const r = await F(src, { cache: 'no-store' });
			const text = await r.text();
			if (text !== this.#last) {
				this.#last = text;
				this.innerHTML = text;
				this.removeAttribute('data-error');
				const parent = this.parentElement;
				if (parent) _nsFire(parent, '@async', { src, el: this, type: 'sync' });
			}
		} catch (e) { this.setAttribute('data-error', ''); }
		this.removeAttribute('data-syncing');
	}
}

class Route extends Instance {}

class Outlet extends Instance {
	['@mount']() { this.setAttribute('data-outlet', this.getAttribute('name') || ''); }
}

void Instance.define(Static); void Instance.define(Email); void Instance.define(Tel);
void Instance.define(Website); void Instance.define(Mailto); void Instance.define(Logout);
void Instance.define(Reset); void Instance.define(Portal); void Instance.define(IntlElement);
void Instance.define(Async); void Instance.define(Sync); void Instance.define(Route); void Instance.define(Outlet);

})();

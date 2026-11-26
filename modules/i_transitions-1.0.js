/* Instance Transitions 1.0 · build micuseve
 * Copyright © 2026 Instance
 * Licensed under the Instance Source License v1.4 (the "License"). You may not use this file except in compliance
 * with the License. You may obtain a copy of the License at https://codeberg.org/voidsymbol/The-Instance-Source-License/
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific
 * language governing permissions and limitations under the License. */
(function () {
'use strict';

const _host = () => (typeof globalThis !== 'undefined' ? globalThis : self);

const BUILT_INS = {
	'fade-in':    { from: { opacity: 0 }, to: { opacity: 1 }, duration: 200, easing: 'ease-out' },
	'fade-out':   { from: { opacity: 1 }, to: { opacity: 0 }, duration: 150, easing: 'ease-in' },
	'slide-up':   { from: { opacity: 0, transform: 'translateY(12px)' },  to: { opacity: 1, transform: 'translateY(0)' }, duration: 250, easing: 'ease-out' },
	'slide-down': { from: { opacity: 0, transform: 'translateY(-12px)' }, to: { opacity: 1, transform: 'translateY(0)' }, duration: 250, easing: 'ease-out' },
	'slide-left': { from: { opacity: 0, transform: 'translateX(12px)' },  to: { opacity: 1, transform: 'translateX(0)' }, duration: 250, easing: 'ease-out' },
	'slide-right':{ from: { opacity: 0, transform: 'translateX(-12px)' }, to: { opacity: 1, transform: 'translateX(0)' }, duration: 250, easing: 'ease-out' },
	'scale-in':   { from: { opacity: 0, transform: 'scale(0.95)' }, to: { opacity: 1, transform: 'scale(1)' },    duration: 200, easing: 'cubic-bezier(0.34,1.56,0.64,1)' },
	'scale-out':  { from: { opacity: 1, transform: 'scale(1)' },    to: { opacity: 0, transform: 'scale(0.95)' }, duration: 150, easing: 'ease-in' },
	'blur-in':    { from: { opacity: 0, filter: 'blur(4px)' }, to: { opacity: 1, filter: 'blur(0px)' }, duration: 250, easing: 'ease-out' },
	'blur-out':   { from: { opacity: 1, filter: 'blur(0px)' }, to: { opacity: 0, filter: 'blur(4px)' }, duration: 200, easing: 'ease-in' },
};

function _trCss(frame) {
	const css = {};
	for (const k of Object.keys(frame)) {
		const v = frame[k];
		if (k === 'y')     { css.transform = ((css.transform || '') + ' translateY(' + (typeof v === 'number' ? v + 'px' : v) + ')'); continue; }
		if (k === 'x')     { css.transform = ((css.transform || '') + ' translateX(' + (typeof v === 'number' ? v + 'px' : v) + ')'); continue; }
		if (k === 'scale') { css.transform = ((css.transform || '') + ' scale(' + v + ')'); continue; }
		if (k === 'blur')  { css.filter = 'blur(' + (typeof v === 'number' ? v + 'px' : v) + ')'; continue; }
		css[k] = typeof v === 'number' && k !== 'opacity' ? v + 'px' : String(v);
	}
	if (css.transform) css.transform = css.transform.trim();
	return css;
}
function _trResolve(el, name) {
	if (name && typeof name === 'object') return name;
	const raw = String(name);
	const shadow = raw.startsWith('::');
	const core = shadow ? raw.slice(2) : raw;
	const Klass = el.constructor;
	if (shadow) {
		const sh = Klass && Klass.shadow;
		const cfg = sh && typeof sh === 'object' && sh.transitions && sh.transitions[core];
		if (cfg) return Object.assign({}, cfg, { _name: core, _scope: 'shadow' });
	} else {
		const cfg = Klass && Klass.transitions && Klass.transitions[core];
		if (cfg) return Object.assign({}, cfg, { _name: core, _scope: 'local' });
		if (BUILT_INS[core]) return Object.assign({}, BUILT_INS[core], { _name: core, _scope: 'builtin' });
	}
	if (Instance.debug) console.warn("[Instance] transition '" + raw + "' not found");
	return null;
}
function _trRun(target, config) {
	return new Promise((resolve) => {
		const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
		const applyFinal = () => { const f = _trCss(config && config.to || {}); for (const k of Object.keys(f)) target.style[k] = f[k]; };
		if (!config || reduced) { if (config && config.to) applyFinal(); resolve(target); return; }
		const fromCSS = _trCss(config.from || {});
		const toCSS = _trCss(config.to || {});
		const opts = { duration: config.duration != null ? config.duration : 200, delay: config.delay || 0, easing: config.easing || 'ease', fill: 'forwards' };
		try {
			const a = target.animate([fromCSS, toCSS], opts);
			a.onfinish = () => resolve(target);
			a.oncancel = () => resolve(target);
		} catch (e) { applyFinal(); resolve(target); }
	});
}

const __IVC = _host()[Symbol.for('Instance')];
if (typeof __IVC !== 'function' || typeof __IVC.provide !== 'function') throw new Error(
	'Instance TRANSITIONS: no IVC broker \u2014 transitions extend Instance and cannot run standalone. Load core first.');
__IVC.provide({ module: 'transitions', value: { resolve: _trResolve, run: _trRun, css: _trCss, presets: BUILT_INS },
	from: '0.89.c', to: '0.92.z' });
})();

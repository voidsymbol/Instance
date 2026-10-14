/**!
* @license FSL-1.1
* @description Direct Element Architecture — Instance 0.89.c
*/
/* ═══════════════════════════════════════════════════════════════════════════
 * Instance FORMS v1 — the form/input/textarea/select namespace CONTENT.
 *
 * DEFINES NO ELEMENTS. It registers facades on tags the platform already has,
 * which is what separates it from PLATFORM: that module fills GAPS in the tag
 * vocabulary, this one AUGMENTS elements that already exist. Nothing here has
 * to be present when the document is read — a facade is built on first property
 * access — so this may load at any point after core.
 *
 * Reads core's namespace plumbing once, through the §11a seam.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';
/* Resolved through the IVC broker: version first, sub-domain second. 'latest' takes
 * the newest registered build; pin the exact string ('0.89.d') to bind this module to
 * one. IVC is total, so the named error below is the only thing a missing host can
 * produce. */
const __IVC = globalThis[Symbol.for('Instance')];
const __NS = typeof __IVC === 'function' ? __IVC('latest', 'namespaces') : undefined;
if (__NS == null) throw new Error(
	'Instance FORMS: no Instance build publishes the "namespaces" domain — load order is core → forms.');
const { _NAMESPACES, _nsCleanup, _nsFire, _nsSig, _nsRAF } = __NS;

/* ═══ §11 FORMS — namespace CONTENT (extracted to modules/i_forms-1.0.js) ═══ */
_NAMESPACES.set('form', function initFormNamespace(el) {
	const loading   = _nsSig(false);
	const valid     = _nsSig(el.checkValidity ? el.checkValidity() : true);
	const dirty     = _nsSig(false);
	const submitted = _nsSig(false);
	const errors    = _nsSig({});
	const _values = () => Object.fromEntries([...new FormData(el)].map(([k, v]) => [k, v]));
	let _initial = {};
	const _syncValid = () => valid.set(el.checkValidity ? el.checkValidity() : true);
	const _syncDirty = () => dirty.set(JSON.stringify(_values()) !== JSON.stringify(_initial));
	const _showError = (name, message) => {
		const span = el.querySelector('[data-error="' + name + '"]');
		if (span) span.textContent = message == null ? '' : message;
	};
	const _clearErrors = () => {
		errors.set({});
		el.querySelectorAll('[data-error]').forEach(sp => { sp.textContent = ''; });
		el.querySelectorAll('.instance-field--invalid').forEach(f => {
			f.classList.remove('instance-field--invalid');
			f.classList.add('instance-field--valid');
		});
	};
	const _updateFormClasses = () => {
		const v = valid.peek(), d = dirty.peek(), l = loading.peek(), su = submitted.peek();
		el.classList.toggle('instance-form--valid', v);
		el.classList.toggle('instance-form--invalid', !v);
		el.classList.toggle('instance-form--dirty', d);
		el.classList.toggle('instance-form--pristine', !d);
		el.classList.toggle('instance-form--loading', l);
		el.classList.toggle('instance-form--submitted', su);
	};
	// NOTE: 0.73 synced classes via one effect over all four signals; under this
	// kernel's CONSENSUS default a 4-dep effect fires only when all four settle in
	// one batch — so classes sync explicitly at every mutation site instead.
	const _rules = () => (el.constructor && el.constructor.fields) || {};
	async function _validateField(name, value) {
		const rules = _rules()[name];
		if (!rules) return null;
		if (rules.match) {
			const other = new FormData(el).get(rules.match);
			if (value !== other) return rules.message != null ? rules.message : ('Must match ' + rules.match);
		}
		if (rules.validate) {
			const result = await rules.validate(value);
			if (typeof result === 'string') return result;
			if (result === false) return rules.message != null ? rules.message : 'Invalid';
		}
		return null;
	}
	async function _validateAll() {
		const data = new FormData(el);
		const errs = {};
		const native = el.checkValidity ? el.checkValidity() : true;
		if (!native) {
			[...el.elements].forEach(field => {
				if (!field.name || (field.validity && field.validity.valid)) return;
				const rules = _rules()[field.name];
				const msgKey = field.validity ? Object.keys(Object.getPrototypeOf(field.validity).constructor.prototype).find(k => k !== 'valid' && field.validity[k]) : null;
				const custom = rules && rules.messages ? rules.messages[msgKey] : undefined;
				errs[field.name] = custom != null ? custom : field.validationMessage;
			});
		}
		for (const [name, value] of data.entries()) {
			const err = await _validateField(name, String(value));
			if (err) errs[name] = err;
		}
		return errs;
	}
	const _onInput = (e) => {
		_syncValid(); _syncDirty(); _updateFormClasses();
		const field = e.target;
		if (!field || !field.name) return;
		const container = (field.closest && field.closest('[data-field]')) || field.parentElement;
		if (container) {
			container.classList.toggle('instance-field--dirty', true);
			const fv = field.validity ? field.validity.valid : true;
			container.classList.toggle('instance-field--valid', fv);
			container.classList.toggle('instance-field--invalid', !fv);
		}
		_nsFire(el, '@change', {
			field, name: field.name, value: field.value,
			valid: field.validity ? field.validity.valid : true,
			values: _values()
		});
	};
	const _onBlur = (e) => {
		const field = e.target;
		if (!field || !field.name) return;
		const container = (field.closest && field.closest('[data-field]')) || field.parentElement;
		if (container) container.classList.add('instance-field--touched');
	};
	const _onSubmit = async (e) => {
		e.preventDefault();
		submitted.set(true); loading.set(true); _updateFormClasses();
		const errs = await _validateAll();
		if (Object.keys(errs).length > 0) {
			loading.set(false); _updateFormClasses();
			errors.set(errs);
			Object.entries(errs).forEach(([name, msg]) => _showError(name, msg));
			Object.keys(errs).forEach(name => {
				const field = el.elements[name];
				const container = field && ((field.closest && field.closest('[data-field]')) || field.parentElement);
				if (container) { container.classList.add('instance-field--invalid'); container.classList.remove('instance-field--valid'); }
			});
			_nsFire(el, '@invalid', { errors: errs, fields: el.elements, first: el.querySelector(':invalid') || el.elements[Object.keys(errs)[0]] });
			return;
		}
		_clearErrors();
		_nsFire(el, '@submit', { values: _values(), valid: true, form: el, reset: () => el.reset() });
		loading.set(false); _updateFormClasses();
		el.classList.add('instance-form--success');
	};
	const _onReset = () => {
		_clearErrors(); dirty.set(false); submitted.set(false);
		valid.set(el.checkValidity ? el.checkValidity() : true); _updateFormClasses();
		el.classList.remove('instance-form--success', 'instance-form--error');
		_nsFire(el, '@reset', { form: el });
		_nsRAF(() => { _initial = _values(); });
	};
	el.addEventListener('input',  _onInput, { passive: true });
	el.addEventListener('change', _onInput, { passive: true });
	el.addEventListener('blur',   _onBlur,  { capture: true, passive: true });
	el.addEventListener('submit', _onSubmit);
	el.addEventListener('reset',  _onReset, { passive: true });
	_nsRAF(() => { _initial = _values(); });
	_updateFormClasses();
	_nsCleanup(el, () => {
		el.removeEventListener('input',  _onInput);
		el.removeEventListener('change', _onInput);
		el.removeEventListener('blur',   _onBlur, { capture: true });
		el.removeEventListener('submit', _onSubmit);
		el.removeEventListener('reset',  _onReset);
	});
	return Object.freeze({
		loading, valid, dirty, submitted, errors,
		validate:    () => _validateAll().then(errs => Object.keys(errs).length === 0),
		values:      _values,
		setValue:    (name, value) => { const f = el.elements[name]; if (f) { f.value = value; f.dispatchEvent(new Event('input', { bubbles: true })); } },
		setError:    (name, msg) => { errors.set(Object.assign({}, errors.peek(), { [name]: msg })); _showError(name, msg); },
		clearErrors: _clearErrors,
		focus:       (name) => { const f = el.elements[name]; if (f && f.focus) f.focus(); }
	});
});

function _nsControl(events) {
	return function initControlNamespace(el) {
		const value   = _nsSig(el.value != null ? el.value : '');
		const valid   = _nsSig(el.validity ? el.validity.valid : true);
		const touched = _nsSig(false);
		const dirty   = _nsSig(false);
		const _initial = el.value != null ? el.value : '';
		const _onIn = () => { value.set(el.value); valid.set(el.validity ? el.validity.valid : true); dirty.set(el.value !== _initial); };
		const _onBlur = () => touched.set(true);
		events.forEach(t => el.addEventListener(t, _onIn, { passive: true }));
		el.addEventListener('blur', _onBlur, { passive: true });
		_nsCleanup(el, () => { events.forEach(t => el.removeEventListener(t, _onIn)); el.removeEventListener('blur', _onBlur); });
		return Object.freeze({ value, valid, touched, dirty });
	};
}
_NAMESPACES.set('input',    _nsControl(['input', 'change']));
_NAMESPACES.set('textarea', _nsControl(['input']));
_NAMESPACES.set('select',   _nsControl(['change']));

/* ═══ §10 PLATFORM — router + the platform-gap vocabulary (extracted to modules/i_platform-1.0.js) ═══ */

/* FORMS is a PUSH module — it writes four facades into core's _NAMESPACES map and
 * has no API anyone calls. It still provide()s, because the policy is one shape for
 * every module: without it `('latest','forms')` resolves to nothing, the compatibility
 * range is never checked, and the module is invisible to anything enumerating what is
 * loaded. What it publishes is the manifest of what it registered. */
__IVC.provide({ module: 'forms', value: { namespaces: [..._NAMESPACES.keys()] },
	from: '0.89.c', to: '0.89.z' });
})();
// Exo Vault on a page: tells the browser which sign-in field you're in (and where it is, for Exo Vault's menu
// beside it) and what a sign-in form sends, and fills what you pick in that menu. It runs before the page's own
// scripts; the browser decides which site this is, never the page. Not in frames yet.
(() => {
  if (window.top !== window || !window.chrome || !window.chrome.webview || window.__exoVaultFill) return;
  const webview = window.chrome.webview;
  const post = webview.postMessage.bind(webview);
  const stringify = JSON.stringify.bind(JSON);
  const send = m => { try { post('exo-vault\t' + stringify(m)); } catch (_) { /* the page took chrome.webview away */ } };
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const getValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').get;
  const setSelect = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  const USER_KEY = 'exo-vault-user';

  const words = el => [el.name, el.id, el.getAttribute('autocomplete'), el.getAttribute('placeholder'), el.getAttribute('aria-label')]
    .filter(Boolean).join(' ').toLowerCase();
  const shown = el => {
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== 'hidden';
  };
  const textual = el => el instanceof HTMLInputElement && /^(text|email|tel|url|)$/i.test(el.type || 'text') && !el.disabled;
  const passwords = scope => [...scope.querySelectorAll('input[type=password]')].filter(el => !el.disabled && shown(el));
  // A field's form, else the document or shadow root it lives in (a sign-in inside a web component).
  const scopeOf = el => el.form || (el.getRootNode && el.getRootNode()) || document;
  // The field itself, not the web component an event was retargeted to.
  const fieldOf = e => (e.composedPath && e.composedPath()[0]) || e.target;

  // The username for a form: the field the page marks as one, else the last text field before its first password.
  const usernameIn = scope => {
    const inputs = [...scope.querySelectorAll('input')].filter(el => textual(el) && shown(el));
    const marked = inputs.find(el => /username|email/.test(el.getAttribute('autocomplete') || ''));
    if (marked) return marked;
    const pw = passwords(scope)[0];
    if (!pw) return inputs.find(el => el.type === 'email' || /user|login|email|account|identifier/.test(words(el))) || null;
    let last = null;
    for (const el of inputs) if (el.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING) last = el;
    return last;
  };

  const kindOf = el => {
    if (!(el instanceof HTMLInputElement) || el.disabled || el.readOnly) return null;
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase(), w = words(el), type = (el.type || 'text').toLowerCase();
    if (type === 'password') return /new-password/.test(ac) || /\b(new|confirm|repeat|retype|create)/.test(w) ? 'new-password' : 'password';
    if (!textual(el)) return null;
    if (/one-time-code/.test(ac) || /\b(otp|totp|2fa|mfa|one.?time|verification.?code|auth.?code|security.?code|passcode)\b/.test(w)) return 'otp';
    if (/^cc-(number|name|exp|csc)/.test(ac) || /card.?number|cardnumber|cc.?num/.test(w)) return 'card';
    if (usernameIn(scopeOf(el)) === el) return 'username';
    return null;
  };

  // The field you're in and what it is, worked out once per focus (a frame after it, so a field the page makes
  // writable on focus counts); scrolling only measures it again.
  let current = null, kind = undefined, context = null, frame = 0, offscreen = false;
  const report = () => {
    frame = 0;
    if (!current || !current.isConnected) return;
    if (kind === undefined) {
      kind = kindOf(current);
      const pws = kind ? passwords(scopeOf(current)) : [];
      context = { signup: pws.length > 1 || pws.some(el => kindOf(el) === 'new-password'), pw: pws.length > 0 };
    }
    if (!kind) return;
    const r = current.getBoundingClientRect();
    // Scrolled out of sight: the menu goes until it's back, instead of floating over the Bar.
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) {
      if (!offscreen) { offscreen = true; send({ e: 'blur' }); }
      return;
    }
    offscreen = false;
    send({ e: 'focus', kind, x: r.left, y: r.top, w: r.width, h: r.height, signup: context.signup, pw: context.pw, filled: !!getValue.call(current) });
  };
  const queue = () => { if (!frame) frame = requestAnimationFrame(report); };
  const focusOn = el => { current = el; kind = undefined; offscreen = false; queue(); };

  let typed = false, filling = false;
  // Focus moved by a fill doesn't open the menu again.
  addEventListener('focusin', e => { if (filling) return; const el = fieldOf(e); if (!(el instanceof HTMLInputElement)) { current = null; return; } typed = false; focusOn(el); }, true);
  // Typing your own puts the menu away.
  addEventListener('input', e => { if (e.isTrusted && fieldOf(e) === current && !typed) { typed = true; send({ e: 'typing' }); } }, true);
  addEventListener('focusout', e => { if (fieldOf(e) === current && kind) send({ e: 'blur' }); }, true);
  addEventListener('scroll', () => { if (kind && current && current.matches(':focus')) queue(); }, true);
  addEventListener('resize', () => { if (kind && current && current.matches(':focus')) queue(); });
  // A click on a field that already had focus opens the menu again.
  addEventListener('pointerdown', e => { const el = fieldOf(e); if (el instanceof HTMLInputElement && el.matches(':focus')) focusOn(el); }, true);

  // What a sign-in sends: on submit, on a click on its button, or on Enter in its password. Several of those for one
  // sign-in (a click that submits) send once, the latest; the same one twice in a row isn't sent again.
  let pending = null, wait = 0, lastSent = '', lastAt = 0;
  const remember = el => { try { if (kindOf(el) === 'username' && getValue.call(el)) sessionStorage.setItem(USER_KEY, getValue.call(el)); } catch (_) { /* storage off */ } };
  const collect = scope => {
    const pws = passwords(scope).map(el => ({ kind: kindOf(el), value: getValue.call(el) })).filter(p => p.value);
    if (!pws.length) return;
    const user = usernameIn(scope);
    let username = user ? getValue.call(user) : '';
    try { if (!username) username = sessionStorage.getItem(USER_KEY) || ''; } catch (_) { /* storage off */ }
    const fresh = pws.filter(p => p.kind === 'new-password').map(p => p.value);
    const old = pws.find(p => p.kind === 'password');
    pending = { e: 'submit', username, password: fresh[0] || (old && old.value) || '', previous: fresh.length && old ? old.value : '' };
    clearTimeout(wait);
    wait = setTimeout(flush, 250);
  };
  const flush = () => {
    clearTimeout(wait);
    if (!pending) return;
    const m = stringify(pending);
    if (m !== lastSent || Date.now() - lastAt > 5000) send(pending);
    lastSent = m;
    lastAt = Date.now();
    pending = null;
  };
  // A form that signs in by going to the next page leaves before the wait is up: what it sent goes as the page goes.
  addEventListener('pagehide', flush, true);
  // A button that signs in, not the page's show-password eye or "Forgot password?".
  const NOT_SUBMIT = /show|hide|reveal|toggle|visib|forgot|reset|eye|clear|cancel|back/i;
  const submits = el => {
    const label = [el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent].filter(Boolean).join(' ').trim();
    if (NOT_SUBMIT.test(label) || NOT_SUBMIT.test(el.className || '')) return false;
    if (el instanceof HTMLButtonElement) return el.type === 'submit' || /sign.?in|log.?in|continue|next|submit/i.test(label);
    if (el instanceof HTMLInputElement) return el.type === 'submit' || (el.type === 'button' && /sign.?in|log.?in|continue|next|submit/i.test(el.value || ''));
    return /sign.?in|log.?in|continue|next|submit/i.test(label);
  };
  addEventListener('change', e => remember(e.target), true);
  addEventListener('submit', e => collect(e.target), true);
  addEventListener('click', e => {
    const target = fieldOf(e);
    const button = target instanceof Element && target.closest('button, input[type=submit], input[type=button], [role=button]');
    if (!button || !submits(button)) return;
    const scope = button.form || button.closest('form') || scopeOf(button);
    if (passwords(scope).length) collect(scope);
  }, true);
  addEventListener('keydown', e => { const el = fieldOf(e); if (e.key === 'Enter' && el instanceof HTMLInputElement && el.type === 'password') collect(scopeOf(el)); }, true);

  // Filling, as if typed: the page's own listeners see each value arrive.
  const put = (el, value) => {
    if (!el || value == null) return;
    el.focus();
    if (el instanceof HTMLSelectElement) setSelect.call(el, value);
    else setValue.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const fill = data => {
    filling = true;
    try { fillFields(data); } finally { filling = false; }
  };
  const fillFields = data => {
    const scope = current && current.isConnected ? scopeOf(current) : document;
    const pws = passwords(scope);
    if (data.username != null) {
      const user = usernameIn(scope) || (current && kindOf(current) === 'username' ? current : null);
      put(user, data.username);
      remember(user);
    }
    if (data.password != null) {
      const olds = pws.filter(el => kindOf(el) === 'password'), news = pws.filter(el => kindOf(el) === 'new-password');
      // A new password (from the generator) goes in every new-password field; a saved one in the sign-in's.
      if (data.generated) (news.length ? news : pws).forEach(el => put(el, data.password));
      else (olds.length ? olds : news.slice(0, 1)).forEach(el => put(el, data.password));
    }
    if (data.otp != null) put(current && kindOf(current) === 'otp' ? current : [...scope.querySelectorAll('input')].find(el => kindOf(el) === 'otp'), data.otp);
    if (data.card) {
      const by = name => [...scope.querySelectorAll(`input[autocomplete~="${name}"], select[autocomplete~="${name}"]`)][0];
      put(by('cc-number') || (current && kindOf(current) === 'card' ? current : null), data.card.number);
      put(by('cc-name'), data.card.name);
      put(by('cc-exp'), data.card.expiry);
      put(by('cc-csc'), data.card.cvv);
    }
    if (current && current.isConnected) current.focus();
  };
  Object.defineProperty(window, '__exoVaultFill', { value: fill, writable: false, configurable: false, enumerable: false });
})();

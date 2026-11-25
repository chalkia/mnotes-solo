/**
 * mNotes Unified Dialogs & Toast Module (Variant C / 2.8)
 * Provides window.mDialog (alert, confirm, dangerConfirm, prompt, choice)
 * and window.mToast (show), plus override-able wrappers mAlert/mConfirm/mPrompt/showToast.
 */
(function (root) {
    'use strict';

    function tr(key, fallback) {
        return typeof root.t === 'function' ? root.t(key, fallback) : fallback;
    }

    let activeToast = null;
    let activeToastTimer = null;

    const mToast = {
        show: function (msg, type = 'info', opts = {}) {
            if (activeToast && activeToast.parentNode) {
                clearTimeout(activeToastTimer);
                activeToast.parentNode.removeChild(activeToast);
                activeToast = null;
            }

            const o = (opts && typeof opts === 'object') ? opts : {};
            const durationMs = (typeof o.durationMs === 'number' && o.durationMs > 0) ? o.durationMs : 3000;
            const hasAction = Boolean(o.actionLabel && typeof o.onAction === 'function');

            const div = document.createElement('div');
            activeToast = div;
            div.id = 'mnotesActiveToast';
            div.className = 'mnotes-toast mnotes-toast-' + (type || 'info') + (hasAction ? ' has-action' : '');

            const dot = document.createElement('span');
            dot.className = 'mnotes-toast-dot';
            div.appendChild(dot);

            const textSpan = document.createElement('span');
            textSpan.className = 'mnotes-toast-msg';
            textSpan.innerHTML = msg == null ? '' : String(msg);
            div.appendChild(textSpan);

            if (hasAction) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'toast-action-btn';
                btn.textContent = o.actionLabel;
                btn.onclick = function (ev) {
                    ev.stopPropagation();
                    clearTimeout(activeToastTimer);
                    if (div.parentNode) div.parentNode.removeChild(div);
                    if (activeToast === div) activeToast = null;
                    o.onAction();
                };
                div.appendChild(btn);
            }

            document.body.appendChild(div);

            requestAnimationFrame(function () {
                div.classList.add('is-visible');
            });

            activeToastTimer = setTimeout(function () {
                div.classList.remove('is-visible');
                setTimeout(function () {
                    if (div.parentNode) div.parentNode.removeChild(div);
                    if (activeToast === div) activeToast = null;
                }, 260);
            }, durationMs);
        }
    };

    let activeResolve = null;
    let activeCleanup = null;

    function getOverlay() {
        return document.getElementById('mDialogOverlay');
    }

    function openDialog(opts) {
        const overlay = getOverlay();
        if (!overlay) return null;

        if (activeCleanup) {
            const prevResolve = activeResolve;
            activeCleanup();
            if (prevResolve) prevResolve(opts.fallbackValue);
        }

        const card = overlay.querySelector('.mdialog-card');
        const iconEl = overlay.querySelector('.mdialog-icon');
        const titleEl = overlay.querySelector('.mdialog-title');
        const msgEl = overlay.querySelector('.mdialog-msg');
        const bodyEl = overlay.querySelector('.mdialog-body');
        const actionsEl = overlay.querySelector('.mdialog-actions');

        if (!card || !iconEl || !titleEl || !msgEl || !bodyEl || !actionsEl) return null;

        const tone = opts.tone || 'info';
        card.className = 'mdialog-card mdialog-tone-' + tone + (opts.mode ? ' mdialog-mode-' + opts.mode : '');
        iconEl.innerHTML = opts.iconHtml || '<i class="fas fa-info-circle"></i>';
        titleEl.textContent = opts.title || '';
        titleEl.style.display = opts.title ? '' : 'none';
        msgEl.textContent = opts.message || '';
        msgEl.style.display = opts.message ? '' : 'none';

        bodyEl.innerHTML = '';
        actionsEl.innerHTML = '';
        if (opts.buildBody) opts.buildBody(bodyEl);

        return new Promise((resolve) => {
            activeResolve = resolve;

            const finish = (val) => {
                if (activeCleanup) activeCleanup();
                activeResolve = null;
                resolve(val);
            };

            const onKey = (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    finish(opts.cancelValue);
                } else if (e.key === 'Enter' && opts.onEnter) {
                    if (document.activeElement && document.activeElement.classList.contains('mbtn-safe-focus')) {
                        return;
                    }
                    opts.onEnter(e, finish);
                }
            };

            const onBackdrop = (e) => {
                if (e.target === overlay && opts.cancelOnBackdrop !== false) {
                    finish(opts.cancelValue);
                }
            };

            const vv = root.visualViewport;
            const onViewportResize = () => {
                if (!vv) return;
                const offset = Math.max(0, root.innerHeight - vv.height - vv.offsetTop);
                overlay.style.paddingBottom = offset > 0 ? offset + 'px' : '';
            };

            activeCleanup = () => {
                overlay.style.display = 'none';
                overlay.classList.remove('is-open');
                overlay.style.paddingBottom = '';
                document.removeEventListener('keydown', onKey, true);
                overlay.removeEventListener('click', onBackdrop);
                if (vv) vv.removeEventListener('resize', onViewportResize);
                activeCleanup = null;
            };

            if (opts.buildActions) opts.buildActions(actionsEl, finish);

            overlay.style.display = 'flex';
            overlay.classList.add('is-open');
            document.addEventListener('keydown', onKey, true);
            overlay.addEventListener('click', onBackdrop);
            if (vv) {
                vv.addEventListener('resize', onViewportResize);
                onViewportResize();
            }

            if (opts.afterOpen) opts.afterOpen(overlay, card);
        });
    }

    const mDialog = {
        alert: function (params) {
            const p = typeof params === 'string' ? { message: params } : (params || {});
            const tone = p.tone || 'info';
            const iconMap = {
                info: '<i class="fas fa-info-circle"></i>',
                warning: '<i class="fas fa-exclamation-circle"></i>',
                danger: '<i class="fas fa-exclamation-triangle"></i>'
            };
            const promise = openDialog({
                mode: 'alert',
                tone: tone,
                iconHtml: iconMap[tone] || iconMap.info,
                title: p.title || tr('msg_notice', 'Ενημέρωση'),
                message: p.message || '',
                cancelValue: undefined,
                fallbackValue: undefined,
                buildActions: (actionsEl, finish) => {
                    const ok = document.createElement('button');
                    ok.type = 'button';
                    ok.className = 'mbtn mbtn-primary';
                    ok.textContent = p.okText || tr('btn_ok', 'Εντάξει');
                    ok.onclick = () => finish(undefined);
                    actionsEl.appendChild(ok);
                },
                onEnter: (e, finish) => { e.preventDefault(); finish(undefined); },
                afterOpen: (_ov, card) => {
                    const ok = card.querySelector('.mbtn-primary');
                    if (ok) ok.focus();
                }
            });
            if (!promise) {
                if (typeof root.alert === 'function') root.alert(p.message || '');
                return Promise.resolve();
            }
            return promise;
        },

        confirm: function (params) {
            const p = typeof params === 'string' ? { message: params } : (params || {});
            const promise = openDialog({
                mode: 'confirm',
                tone: p.tone || 'info',
                iconHtml: '<i class="fas fa-question-circle"></i>',
                title: p.title || tr('idx_auto_12', 'Επιβεβαίωση'),
                message: p.message || '',
                cancelValue: false,
                fallbackValue: false,
                buildActions: (actionsEl, finish) => {
                    const cancel = document.createElement('button');
                    cancel.type = 'button';
                    cancel.className = 'mbtn mbtn-secondary btn-secondary';
                    cancel.textContent = p.cancelText || tr('btn_cancel', 'Ακύρωση');
                    cancel.onclick = () => finish(false);

                    const ok = document.createElement('button');
                    ok.type = 'button';
                    ok.className = 'mbtn mbtn-primary';
                    ok.textContent = p.okText || tr('btn_ok', 'Εντάξει');
                    ok.onclick = () => finish(true);

                    actionsEl.appendChild(cancel);
                    actionsEl.appendChild(ok);
                },
                onEnter: (e, finish) => { e.preventDefault(); finish(true); },
                afterOpen: (_ov, card) => {
                    const ok = card.querySelector('.mbtn-primary');
                    if (ok) ok.focus();
                }
            });
            if (!promise) {
                return Promise.resolve(typeof root.confirm === 'function' ? root.confirm(p.message || '') : false);
            }
            return promise;
        },

        dangerConfirm: function (params) {
            const p = typeof params === 'string' ? { message: params } : (params || {});
            const promise = openDialog({
                mode: 'danger',
                tone: 'danger',
                iconHtml: '<i class="fas fa-exclamation-triangle"></i>',
                title: p.title || tr('idx_auto_12', 'Επιβεβαίωση'),
                message: p.message || '',
                cancelValue: false,
                fallbackValue: false,
                buildActions: (actionsEl, finish) => {
                    const cancel = document.createElement('button');
                    cancel.type = 'button';
                    cancel.className = 'mbtn mbtn-secondary btn-secondary mbtn-safe-focus';
                    cancel.textContent = p.cancelText || tr('btn_cancel', 'Ακύρωση');
                    cancel.onclick = () => finish(false);

                    const danger = document.createElement('button');
                    danger.type = 'button';
                    danger.className = 'mbtn mbtn-danger';
                    danger.textContent = p.dangerText || tr('btn_delete', 'Διαγραφή');
                    danger.onclick = () => finish(true);

                    actionsEl.appendChild(cancel);
                    actionsEl.appendChild(danger);
                },
                afterOpen: (_ov, card) => {
                    const cancel = card.querySelector('.mbtn-safe-focus');
                    if (cancel) cancel.focus();
                }
            });
            if (!promise) {
                return Promise.resolve(typeof root.confirm === 'function' ? root.confirm(p.message || '') : false);
            }
            return promise;
        },

        prompt: function (params) {
            const p = typeof params === 'string' ? { message: params } : (params || {});
            let inputEl = null;
            let chkEl = null;
            const promise = openDialog({
                mode: 'prompt',
                tone: p.tone || 'info',
                iconHtml: '<i class="fas fa-pen"></i>',
                title: p.title || tr('idx_auto_12', 'Επιβεβαίωση'),
                message: p.message || '',
                cancelValue: null,
                fallbackValue: null,
                buildBody: (bodyEl) => {
                    inputEl = document.createElement('input');
                    inputEl.type = p.inputType || 'text';
                    inputEl.className = 'mdialog-input';
                    inputEl.value = p.defaultValue != null ? String(p.defaultValue) : '';
                    if (p.placeholder) inputEl.placeholder = p.placeholder;
                    bodyEl.appendChild(inputEl);

                    if (p.checkbox && typeof p.checkbox === 'object') {
                        const lbl = document.createElement('label');
                        lbl.className = 'mdialog-checkbox-row';
                        chkEl = document.createElement('input');
                        chkEl.type = 'checkbox';
                        chkEl.checked = Boolean(p.checkbox.defaultChecked);
                        const span = document.createElement('span');
                        span.textContent = p.checkbox.label || '';
                        lbl.appendChild(chkEl);
                        lbl.appendChild(span);
                        bodyEl.appendChild(lbl);
                    }
                },
                buildActions: (actionsEl, finish) => {
                    const cancel = document.createElement('button');
                    cancel.type = 'button';
                    cancel.className = 'mbtn mbtn-secondary btn-secondary';
                    cancel.textContent = p.cancelText || tr('btn_cancel', 'Ακύρωση');
                    cancel.onclick = () => finish(null);

                    const ok = document.createElement('button');
                    ok.type = 'button';
                    ok.className = 'mbtn mbtn-primary';
                    ok.textContent = p.okText || tr('btn_save', 'Αποθήκευση');
                    ok.onclick = () => {
                        const val = inputEl ? inputEl.value : '';
                        finish(p.checkbox ? { value: val, checked: chkEl ? chkEl.checked : false } : val);
                    };

                    actionsEl.appendChild(cancel);
                    actionsEl.appendChild(ok);
                },
                onEnter: (e, finish) => {
                    e.preventDefault();
                    const val = inputEl ? inputEl.value : '';
                    finish(p.checkbox ? { value: val, checked: chkEl ? chkEl.checked : false } : val);
                },
                afterOpen: () => {
                    if (inputEl) {
                        inputEl.focus();
                        if (p.selectOnOpen) inputEl.select();
                    }
                }
            });
            if (!promise) {
                const res = typeof root.prompt === 'function' ? root.prompt(p.message || '', p.defaultValue || '') : null;
                return Promise.resolve(p.checkbox && res !== null ? { value: res, checked: Boolean(p.checkbox.defaultChecked) } : res);
            }
            return promise;
        },

        choice: function (params) {
            const p = params || {};
            const promise = openDialog({
                mode: 'choice',
                tone: p.tone || 'info',
                iconHtml: '<i class="fas fa-list-ul"></i>',
                title: p.title || tr('idx_auto_12', 'Επιλογή'),
                message: p.message || '',
                cancelValue: null,
                fallbackValue: null,
                buildBody: (bodyEl) => {
                    const list = document.createElement('div');
                    list.className = 'mdialog-choice-list';
                    (p.options || []).forEach((opt) => {
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.className = 'mdialog-choice-btn' + (opt.primary ? ' is-primary' : '');
                        btn.dataset.choiceId = opt.id;
                        const main = document.createElement('span');
                        main.className = 'mdialog-choice-label';
                        main.textContent = opt.label || '';
                        btn.appendChild(main);
                        if (opt.subtitle) {
                            const sub = document.createElement('span');
                            sub.className = 'mdialog-choice-sub';
                            sub.textContent = opt.subtitle;
                            btn.appendChild(sub);
                        }
                        btn.onclick = () => {
                            if (activeResolve) {
                                const res = activeResolve;
                                if (activeCleanup) activeCleanup();
                                activeResolve = null;
                                res(opt.id);
                            }
                        };
                        list.appendChild(btn);
                    });
                    bodyEl.appendChild(list);
                },
                buildActions: (actionsEl, finish) => {
                    const cancel = document.createElement('button');
                    cancel.type = 'button';
                    cancel.className = 'mbtn mbtn-secondary btn-secondary';
                    cancel.textContent = p.cancelText || tr('btn_cancel', 'Ακύρωση');
                    cancel.onclick = () => finish(null);
                    actionsEl.appendChild(cancel);
                }
            });
            return promise || Promise.resolve(null);
        }
    };

    root.mDialog = mDialog;
    root.mToast = mToast;

    // Thin override-able wrappers for backwards compatibility and Playwright mocks
    if (typeof root.showToast !== 'function') {
        root.showToast = function (msg, type, opts) {
            return mToast.show(msg, type, opts);
        };
    }
    if (typeof root.mAlert !== 'function') {
        root.mAlert = function (msg, opts) {
            return mDialog.alert(typeof msg === 'string' ? { message: msg, ...(opts || {}) } : msg);
        };
    }
    if (typeof root.mConfirm !== 'function') {
        root.mConfirm = function (msg, isDanger) {
            return isDanger ? mDialog.dangerConfirm({ message: msg }) : mDialog.confirm({ message: msg });
        };
    }
    if (typeof root.mPrompt !== 'function') {
        root.mPrompt = function (msg, defaultVal, checkboxOpts) {
            return mDialog.prompt({
                message: msg,
                defaultValue: defaultVal || '',
                checkbox: checkboxOpts || null
            });
        };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { mDialog, mToast };
    }
})(typeof window !== 'undefined' ? window : globalThis);

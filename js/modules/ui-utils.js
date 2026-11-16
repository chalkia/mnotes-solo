/**
 * mNotes UI Utilities & Gestures Module
 */

window.mNotes = window.mNotes || {};
window.mNotes.ui = window.mNotes.ui || {};
window.mNotes.ui.utils = window.mNotes.ui.utils || {};

(function(utilsMod) {

    // --- Wake Lock ---
    utilsMod.requestWakeLock = async function() {
        if (!('wakeLock' in navigator)) return;
        
        // Αν ο χρήστης δεν θέλει wake lock, το απελευθερώνουμε αν υπάρχει
        if (typeof userSettings !== 'undefined' && !userSettings.wakeLock) {
            if (wakeLock !== null) utilsMod.releaseWakeLock();
            return;
        }

        // Αν υπάρχει ήδη, δεν κάνουμε τίποτα
        if (wakeLock !== null) return;

        try {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('💡 [Wake Lock] Active.');
            
            wakeLock.addEventListener('release', () => {
                console.log('💡 [Wake Lock] Released.');
            });
        } catch (err) {
            console.error(`💡 [Wake Lock] Failed: ${err.name}, ${err.message}`);
        }
    };

    utilsMod.releaseWakeLock = function() {
        if (wakeLock !== null) {
            wakeLock.release().then(() => { 
                wakeLock = null; 
                console.log('💡 [Wake Lock] Released manually.');
            });
        }
    };

    // --- Resizers ---
    utilsMod.initResizers = function() {
        const d = document; 
        const leftResizer = d.getElementById('dragMeLeft'); 
        const rightResizer = d.getElementById('dragMeRight'); 
        
        if(leftResizer) { 
            leftResizer.addEventListener('mousedown', (e) => { 
                e.preventDefault(); 
                d.addEventListener('mousemove', onMouseMoveLeft); 
                d.addEventListener('mouseup', onMouseUpLeft); 
            }); 
        }
        
        if(rightResizer) { 
            rightResizer.addEventListener('mousedown', (e) => { 
                e.preventDefault(); 
                d.addEventListener('mousemove', onMouseMoveRight); 
                d.addEventListener('mouseup', onMouseUpRight); 
            }); 
        } 

        function onMouseMoveLeft(e) { 
            let newWidth = e.clientX; 
            if(newWidth < 200) newWidth = 200; 
            if(newWidth > 500) newWidth = 500; 
            d.documentElement.style.setProperty('--nav-width', newWidth + 'px'); 
        }
        
        function onMouseMoveRight(e) { 
            let newWidth = window.innerWidth - e.clientX; 
            if(newWidth < 250) newWidth = 250; 
            if(newWidth > 600) newWidth = 600; 
            d.documentElement.style.setProperty('--tools-width', newWidth + 'px'); 
        }
        
        function onMouseUpLeft() { 
            d.removeEventListener('mousemove', onMouseMoveLeft); 
            d.removeEventListener('mouseup', onMouseUpLeft); 
        }
        
        function onMouseUpRight() { 
            d.removeEventListener('mousemove', onMouseMoveRight); 
            d.removeEventListener('mouseup', onMouseUpRight); 
        }
    };

    // --- Gestures ---
    utilsMod.setupGestures = function() { 
        var startDist = 0; 
        var startSize = 1.3; 
        
        document.addEventListener('touchstart', function(e) { 
            if(e.touches.length === 2 && e.target.closest('.col-stage')) { 
                startDist = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY); 
                var val = getComputedStyle(document.documentElement).getPropertyValue('--lyric-size').trim(); 
                startSize = parseFloat(val) || 1.3; 
            }
        }, {passive: false}); 
        
        document.addEventListener('touchmove', function(e) { 
            if(e.touches.length === 2 && e.target.closest('.col-stage')) { 
                e.preventDefault(); 
                var dist = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY); 
                if(startDist > 0) { 
                    var scale = dist / startDist; 
                    var newSize = startSize * scale; 
                    if(newSize < 0.8) newSize = 0.8; 
                    if(newSize > 3.0) newSize = 3.0; 
                    document.documentElement.style.setProperty('--lyric-size', newSize + "rem"); 
                }
            }
        }, {passive: false});

        document.addEventListener('touchend', function(e) {
            if(e.touches.length < 2) {
                startDist = 0;
                if (typeof applyScrollBtnVisibility === 'function') applyScrollBtnVisibility();
            }
        });
    };

    // --- Navigation & Drawer ---
    utilsMod.switchMobileTab = function(tabName) {
        const viewMap = {
            'library': 'sidebar',        
            'stage': 'mainZone',         
            'tools': 'rhythmTools'       
        };

        ['sidebar', 'mainZone', 'rhythmTools'].forEach(id => { 
            const el = document.getElementById(id); 
            if (el) el.classList.remove('mobile-view-active'); 
        });
        
        const targetId = viewMap[tabName]; 
        const targetEl = document.getElementById(targetId);
        
        if (targetEl) targetEl.classList.add('mobile-view-active'); 
        
        const btns = document.querySelectorAll('.tab-btn-mob'); 
        btns.forEach(b => b.classList.remove('active'));
        if (tabName === 'library' && btns[0]) btns[0].classList.add('active');
        if (tabName === 'stage' && btns[1]) btns[1].classList.add('active');
        if (tabName === 'tools' && btns[2]) btns[2].classList.add('active');

        document.querySelectorAll('.drawer-btn').forEach(btn => btn.classList.remove('active'));
        const drawerBtn = document.querySelector(`.drawer-btn[onclick*="'${tabName}'"]`);
        if (drawerBtn) drawerBtn.classList.add('active');
        
        const controlsDiv = document.getElementById('drawer-player-controls');
        if (controlsDiv) controlsDiv.style.display = (tabName === 'stage') ? 'block' : 'none';

        document.querySelectorAll('.floating-window').forEach(fw => {
            fw.style.display = (tabName === 'stage') ? 'flex' : 'none';
        });

        const svl = document.getElementById('stageVisualLayer');
        if (svl && window.isVisualLayerOpen) { 
            svl.style.display = (tabName === 'stage') ? 'flex' : 'none';
        }
    };

    // --- Draggable Drawer Handle & Navigation Drawer ---
    utilsMod.justDraggedHandle = false;
    utilsMod.isDraggingHandle = false;

    utilsMod.applyDrawerHandlePos = function(pos) {
        const handle = document.getElementById('drawerHandle');
        if (!handle) return;
        if (!pos || typeof pos !== 'object') {
            pos = { edge: 'right', y: 0.5 };
        }
        const edge = pos.edge === 'left' ? 'left' : 'right';
        const yRatio = (typeof pos.y === 'number' && !isNaN(pos.y)) ? pos.y : 0.5;

        if (edge === 'left') {
            document.body.classList.add('drawer-left');
        } else {
            document.body.classList.remove('drawer-left');
        }

        const winH = window.innerHeight || 600;
        const handleH = handle.offsetHeight || 60;
        const minTop = 45;
        const maxTop = Math.max(minTop, winH - handleH - 65);
        let targetTop = Math.round(yRatio * winH - handleH / 2);
        if (targetTop < minTop) targetTop = minTop;
        if (targetTop > maxTop) targetTop = maxTop;

        handle.style.top = targetTop + 'px';
        handle.style.transform = 'none';
    };

    utilsMod.setupDraggableHandle = function() {
        const handle = document.getElementById('drawerHandle');
        if (!handle) return;

        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let startTop = 0;
        let currentYRatio = 0.5;
        let currentEdge = 'right';
        let activePointerId = null;
        let holdTimer = null;

        function clearHold() {
            if (holdTimer) {
                clearTimeout(holdTimer);
                holdTimer = null;
            }
        }

        handle.addEventListener('pointerdown', function(e) {
            if (e.button !== 0 && e.pointerType === 'mouse') return;

            activePointerId = e.pointerId;
            try {
                handle.setPointerCapture(e.pointerId);
            } catch(err) { /* ignore */ }

            isDragging = false;
            utilsMod.isDraggingHandle = false;
            startX = e.clientX;
            startY = e.clientY;
            startTop = handle.getBoundingClientRect().top;

            clearHold();
            holdTimer = setTimeout(function() {
                if (activePointerId !== null && !isDragging) {
                    isDragging = true;
                    utilsMod.isDraggingHandle = true;
                    handle.classList.add('dragging');
                    if (typeof navigator.vibrate === 'function') {
                        try { navigator.vibrate(20); } catch(err) { /* ignore */ }
                    }
                }
            }, 300);
        });

        handle.addEventListener('pointermove', function(e) {
            if (activePointerId === null || e.pointerId !== activePointerId) return;

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const dist = Math.hypot(dx, dy);

            if (!isDragging) {
                if (dist > 6) {
                    clearHold();
                    isDragging = true;
                    utilsMod.isDraggingHandle = true;
                    handle.classList.add('dragging');
                    if (typeof navigator.vibrate === 'function') {
                        try { navigator.vibrate(20); } catch(err) { /* ignore */ }
                    }
                } else {
                    return;
                }
            }

            e.preventDefault();

            const winW = window.innerWidth || 360;
            const winH = window.innerHeight || 600;
            const handleH = handle.offsetHeight || 60;
            const minTop = 45;
            const maxTop = Math.max(minTop, winH - handleH - 65);

            let newTop = startTop + dy;
            if (newTop < minTop) newTop = minTop;
            if (newTop > maxTop) newTop = maxTop;

            handle.style.top = newTop + 'px';
            handle.style.transform = 'none';
            currentYRatio = (newTop + handleH / 2) / winH;

            if (e.clientX < winW / 2) {
                currentEdge = 'left';
                document.body.classList.add('drawer-left');
            } else {
                currentEdge = 'right';
                document.body.classList.remove('drawer-left');
            }
        });

        function endDrag(e) {
            clearHold();

            if (activePointerId !== null && e.pointerId === activePointerId) {
                try {
                    handle.releasePointerCapture(activePointerId);
                } catch(err) { /* ignore */ }
                activePointerId = null;
            }

            if (isDragging) {
                isDragging = false;
                utilsMod.justDraggedHandle = true;
                setTimeout(function() {
                    utilsMod.justDraggedHandle = false;
                    utilsMod.isDraggingHandle = false;
                }, 150);

                handle.classList.remove('dragging');

                if (typeof userSettings !== 'undefined') {
                    userSettings.drawerHandlePos = { edge: currentEdge, y: currentYRatio };
                    safeSetLocal('mnotes_settings', JSON.stringify(userSettings));
                }
                utilsMod.applyDrawerHandlePos({ edge: currentEdge, y: currentYRatio });
            }
        }

        handle.addEventListener('pointerup', endDrag);
        handle.addEventListener('pointercancel', endDrag);
    };

    utilsMod.toggleRightDrawer = function() {
        if (utilsMod.isDraggingHandle || utilsMod.justDraggedHandle) return;
        const d = document.getElementById('rightDrawer'); if(!d) return;
        const isOpen = d.classList.contains('open');
        
        if (isOpen) { 
            d.classList.remove('open');
            document.removeEventListener('click', utilsMod.closeDrawerOutside); 
        } 
        else { 
            d.classList.add('open'); 
            setTimeout(() => { document.addEventListener('click', utilsMod.closeDrawerOutside); }, 100); 
            utilsMod.setupDrawerListeners(d); 
        }
    };

    utilsMod.closeDrawerOutside = function(e) {
        const d = document.getElementById('rightDrawer'); const h = document.getElementById('drawerHandle');
        if (d && d.classList.contains('open') && !d.contains(e.target) && !h.contains(e.target)) { utilsMod.toggleRightDrawer(); }
    };

    utilsMod.setupDrawerListeners = function(drawer) {
        let touchStartX = 0; let touchStartY = 0;
        drawer.ontouchstart = (e) => {  touchStartX = e.changedTouches[0].screenX; touchStartY = e.changedTouches[0].screenY; };
        drawer.ontouchend = (e) => {
            let touchEndX = e.changedTouches[0].screenX; let touchEndY = e.changedTouches[0].screenY;
            const diffX = touchEndX - touchStartX; const diffY = touchEndY - touchStartY;
            const isLeft = document.body.classList.contains('drawer-left');
            if (Math.abs(diffX) > Math.abs(diffY)) {
                if (isLeft && diffX < -50) {
                    utilsMod.toggleRightDrawer();
                } else if (!isLeft && diffX > 50) {
                    utilsMod.toggleRightDrawer();
                }
            }
        };
    };

    utilsMod.switchDrawerTab = function(tabName) {
        if (!isMobileView()) return;
        if (tabName === 'stage' && typeof currentSongId !== 'undefined' && currentSongId) {
            const titleEl = document.getElementById('mainAppTitle');
            if (!titleEl || titleEl.innerText.trim() === '') {
                if (typeof loadSong === 'function') loadSong(currentSongId);
            }
        }
        utilsMod.switchMobileTab(tabName);
        utilsMod.toggleRightDrawer();
    };

    // --- AutoScroll & Bluetooth ---
    utilsMod.scrollTimer = null;
    utilsMod.scrollBtnTimeout = null;
    utilsMod.scrollStartTimeout = null;
    utilsMod.scrollCountdownTimer = null;
    utilsMod.scrollPaused = false;
    utilsMod.scrollAccumulator = 0;
    utilsMod.scrollLastFrame = 0;

    function getCurrentSongObj() {
        if (typeof currentSongId === 'undefined' || !currentSongId || typeof library === 'undefined') return null;
        return library.find(x => x.id === currentSongId) || null;
    }

    function updateCountdownBadge(secRemaining) {
        let badge = document.getElementById('scrollCountdownBadge');
        const inPlay = document.body.classList.contains('play-mode') || window.isPlayModeActive;
        if (secRemaining === null || secRemaining <= 0 || inPlay) {
            if (badge) badge.remove();
            return;
        }
        if (!badge) {
            const titleEl = document.getElementById('mainAppTitle');
            if (!titleEl) return;
            badge = document.createElement('span');
            badge.id = 'scrollCountdownBadge';
            badge.className = 'scroll-countdown-badge';
            titleEl.appendChild(badge);
        }
        badge.textContent = `⏳ ${Math.ceil(secRemaining)}s`;
    }

    utilsMod.computeSmartStartDelaySec = function(song, fixedEl, scrollEl) {
        const hasIntro = !!(song && song.intro && String(song.intro).trim());
        const baseDelay = (typeof userSettings !== 'undefined' && typeof userSettings.scrollDelay !== 'undefined')
            ? parseInt(userSettings.scrollDelay, 10)
            : 10;
        const introSec = hasIntro ? (isNaN(baseDelay) ? 5 : baseDelay) : 0;

        const fixedLines = fixedEl ? fixedEl.querySelectorAll('.line-row').length : 0;
        const scrollLines = scrollEl ? scrollEl.querySelectorAll('.line-row').length : 0;
        const totalLines = fixedLines + scrollLines;
        if (fixedLines === 0 || scrollLines === 0 || totalLines === 0) {
            return introSec;
        }

        let durationSec = 0;
        if (song && Number(song.duration) > 0) {
            durationSec = Number(song.duration);
        } else if (song && Number(song.bpm) > 0 && (Number(song.measures) > 0 || Number(song.bars) > 0)) {
            const bars = Number(song.measures || song.bars);
            durationSec = (bars * 4 * 60) / Number(song.bpm);
        } else {
            durationSec = totalLines * 3.5;
        }

        return Math.round(introSec + (fixedLines / totalLines) * durationSec);
    };

    function getActiveScrollTargets() {
        const fixedEl = document.getElementById('fixed-container');
        const scrollEl = document.getElementById('scroll-container');
        const mainZone = document.getElementById('mainZone');
        const viewPlayer = document.getElementById('view-player');
        const stageHeight = viewPlayer ? viewPlayer.clientHeight : (window.innerHeight || 740);

        const targets = [];
        if (fixedEl && fixedEl.innerText.trim() && fixedEl.scrollHeight > stageHeight * 0.60 && fixedEl.scrollHeight > fixedEl.clientHeight + 2) {
            targets.push(fixedEl);
        }
        if (scrollEl && scrollEl.scrollHeight > scrollEl.clientHeight + 2) {
            targets.push(scrollEl);
        } else if (mainZone && mainZone.scrollHeight > mainZone.clientHeight + 2) {
            targets.push(mainZone);
        } else if (scrollEl) {
            targets.push(scrollEl);
        }
        return targets;
    }

    function updateSpeedPillUI(show) {
        const pill = document.getElementById('scrollSpeedPill');
        const valEl = document.getElementById('scrollSpeedValue');
        const song = getCurrentSongObj();
        const mult = (song && Number(song.scroll_speed) > 0) ? Number(song.scroll_speed) : 1.0;
        if (valEl) valEl.textContent = `${mult.toFixed(1)}×`;
        if (pill) pill.style.display = show ? 'inline-flex' : 'none';
    }

    utilsMod.adjustAutoScrollSpeed = function(delta) {
        const song = getCurrentSongObj();
        const cur = (song && Number(song.scroll_speed) > 0) ? Number(song.scroll_speed) : 1.0;
        const next = Math.min(2.5, Math.max(0.5, Math.round((cur + delta) * 10) / 10));
        if (song) {
            song.scroll_speed = next;
            if (typeof window.persistContextLibrary === 'function' && typeof window.library !== 'undefined') {
                window.persistContextLibrary(window.library);
            }
        }
        updateSpeedPillUI(true);
    };

    utilsMod.stopAutoScroll = function() {
        if (utilsMod.scrollTimer) {
            cancelAnimationFrame(utilsMod.scrollTimer);
            utilsMod.scrollTimer = null;
        }
        if (utilsMod.scrollStartTimeout) {
            clearTimeout(utilsMod.scrollStartTimeout);
            utilsMod.scrollStartTimeout = null;
        }
        if (utilsMod.scrollCountdownTimer) {
            clearInterval(utilsMod.scrollCountdownTimer);
            utilsMod.scrollCountdownTimer = null;
        }
        utilsMod.scrollPaused = false;
        utilsMod.scrollAccumulator = 0;
        utilsMod.scrollLastFrame = 0;
        updateCountdownBadge(null);
        updateSpeedPillUI(false);

        const btn = document.getElementById('floatingScrollBtn');
        const btnIcon = document.getElementById('scrollBtnIcon');
        if (btn) {
            btn.classList.remove('hidden');
            btn.style.opacity = '1';
        }
        if (btnIcon) btnIcon.className = 'fas fa-arrows-alt-v';
    };

    function beginScrollLoop(targets) {
        const btn = document.getElementById('floatingScrollBtn');
        const btnIcon = document.getElementById('scrollBtnIcon');
        if (btn) {
            if (btnIcon) btnIcon.className = 'fas fa-pause';
            btn.style.opacity = '0.6';
        }
        updateSpeedPillUI(true);

        let targetIdx = 0;
        utilsMod.scrollPaused = false;
        utilsMod.scrollAccumulator = 0;
        utilsMod.scrollLastFrame = performance.now();

        function step(now) {
            if (!utilsMod.scrollTimer) return;
            const dt = Math.min(0.1, Math.max(0, (now - utilsMod.scrollLastFrame) / 1000));
            utilsMod.scrollLastFrame = now;

            if (!utilsMod.scrollPaused && targets[targetIdx]) {
                const container = targets[targetIdx];
                const baseSpeed = (typeof userSettings !== 'undefined' && userSettings.scrollSpeed) ? parseInt(userSettings.scrollSpeed, 10) : 50;
                const song = getCurrentSongObj();
                const mult = (song && Number(song.scroll_speed) > 0) ? Number(song.scroll_speed) : 1.0;
                const pxPerSec = Math.max(4, (baseSpeed * 0.45) * mult);

                utilsMod.scrollAccumulator += pxPerSec * dt;
                if (utilsMod.scrollAccumulator >= 1) {
                    const delta = Math.floor(utilsMod.scrollAccumulator);
                    utilsMod.scrollAccumulator -= delta;
                    container.scrollTop += delta;
                }

                if (container.scrollTop + container.clientHeight >= container.scrollHeight - 2) {
                    if (targetIdx < targets.length - 1) {
                        targetIdx++;
                        utilsMod.scrollAccumulator = 0;
                    } else {
                        utilsMod.stopAutoScroll();
                        return;
                    }
                }
            }
            utilsMod.scrollTimer = requestAnimationFrame(step);
        }

        utilsMod.scrollTimer = requestAnimationFrame(step);
    }

    utilsMod.startScrollNow = function() {
        if (!utilsMod.scrollStartTimeout) return false;
        clearTimeout(utilsMod.scrollStartTimeout);
        utilsMod.scrollStartTimeout = null;
        if (utilsMod.scrollCountdownTimer) {
            clearInterval(utilsMod.scrollCountdownTimer);
            utilsMod.scrollCountdownTimer = null;
        }
        updateCountdownBadge(null);
        const targets = getActiveScrollTargets();
        if (targets.length > 0) beginScrollLoop(targets);
        return true;
    };

    utilsMod.toggleAutoScrollPause = function() {
        if (!utilsMod.scrollTimer) return;
        utilsMod.scrollPaused = !utilsMod.scrollPaused;
        const btnIcon = document.getElementById('scrollBtnIcon');
        if (btnIcon) btnIcon.className = utilsMod.scrollPaused ? 'fas fa-play' : 'fas fa-pause';
    };

    utilsMod.toggleAutoScroll = function(e) {
        if (e) e.stopPropagation();

        if (utilsMod.scrollTimer) {
            utilsMod.stopAutoScroll();
            return;
        }
        if (utilsMod.scrollStartTimeout) {
            utilsMod.stopAutoScroll();
            return;
        }

        const targets = getActiveScrollTargets();
        if (targets.length === 0) return;

        const song = getCurrentSongObj();
        const fixedEl = document.getElementById('fixed-container');
        const scrollEl = document.getElementById('scroll-container');
        const delaySec = utilsMod.computeSmartStartDelaySec(song, fixedEl, scrollEl);

        if (delaySec <= 0) {
            beginScrollLoop(targets);
            return;
        }

        const btn = document.getElementById('floatingScrollBtn');
        const btnIcon = document.getElementById('scrollBtnIcon');
        if (btn && btnIcon) btnIcon.className = 'fas fa-hourglass-half';
        updateSpeedPillUI(true);

        let remaining = delaySec;
        updateCountdownBadge(remaining);
        utilsMod.scrollCountdownTimer = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
                clearInterval(utilsMod.scrollCountdownTimer);
                utilsMod.scrollCountdownTimer = null;
                updateCountdownBadge(null);
            } else {
                updateCountdownBadge(remaining);
            }
        }, 1000);

        // Εκτός Play: πάτημα στην κάτω περιοχή (#scroll-container) = «ξεκίνα τώρα»
        if (scrollEl && !scrollEl._smartStartBound) {
            scrollEl._smartStartBound = true;
            scrollEl.addEventListener('click', function() {
                if (document.body.classList.contains('play-mode') || window.isPlayModeActive) return;
                if (utilsMod.scrollStartTimeout) utilsMod.startScrollNow();
            });
        }

        utilsMod.scrollStartTimeout = setTimeout(function() {
            utilsMod.scrollStartTimeout = null;
            if (utilsMod.scrollCountdownTimer) {
                clearInterval(utilsMod.scrollCountdownTimer);
                utilsMod.scrollCountdownTimer = null;
            }
            updateCountdownBadge(null);
            beginScrollLoop(targets);
        }, delaySec * 1000);
    };

    utilsMod.setupBluetoothPedals = function() {
        const LEFT_KEYS = new Set(['PageUp', 'ArrowUp', 'ArrowLeft']);
        const RIGHT_KEYS = new Set(['PageDown', 'ArrowDown', 'ArrowRight', ' ', 'Enter']);

        let holdTimer = null;
        let holdFired = false;
        let activeKey = null;

        function runPedalAction(action, dir) {
            if (action === 'song') {
                if (typeof navVisiblePlaylist === 'function') navVisiblePlaylist(dir);
                return;
            }
            if (action === 'autoscroll') {
                if (utilsMod.scrollStartTimeout) {
                    utilsMod.startScrollNow();
                } else if (utilsMod.scrollTimer) {
                    utilsMod.toggleAutoScrollPause();
                } else {
                    utilsMod.toggleAutoScroll();
                }
                return;
            }
            // Default: 'scroll' (80% screen)
            utilsMod.scrollStagePage(dir);
        }

        document.addEventListener('keydown', function(e) {
            // Settings modal pedal tester
            const settingsModal = document.getElementById('settingsModal');
            if (settingsModal && settingsModal.style.display === 'flex') {
                const out = document.getElementById('pedalTestOutput');
                if (out && (LEFT_KEYS.has(e.key) || RIGHT_KEYS.has(e.key))) {
                    e.preventDefault();
                    out.textContent = `Έφτασε: ${e.key === ' ' ? 'Space' : e.key} (${e.code || e.key})`;
                }
                return;
            }

            var editorView = document.getElementById('view-editor');
            if (editorView && editorView.classList.contains('active-view')) return;

            const isTyping = ['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable;
            if (isTyping) return;

            const isLeft = LEFT_KEYS.has(e.key);
            const isRight = RIGHT_KEYS.has(e.key);
            if (!isLeft && !isRight) return;

            e.preventDefault();
            const dir = isLeft ? -1 : 1;

            // Visual layer (PDF or Image) override
            if (window.isVisualLayerOpen) {
                if (document.getElementById('stage-pdf-canvas')) {
                    if (dir > 0 && typeof window.nextPdfPage === 'function') window.nextPdfPage();
                    else if (dir < 0 && typeof window.prevPdfPage === 'function') window.prevPdfPage();
                } else {
                    const vc = document.getElementById('visualLayerContent');
                    if (vc) vc.scrollBy({ top: vc.clientHeight * 0.80 * dir, behavior: 'smooth' });
                }
                return;
            }

            const holdEnabled = (typeof userSettings !== 'undefined' && !!userSettings.pedalHoldForSong);
            const action = isLeft
                ? ((typeof userSettings !== 'undefined' && userSettings.pedalLeftAction) || 'scroll')
                : ((typeof userSettings !== 'undefined' && userSettings.pedalRightAction) || 'scroll');

            if (!holdEnabled) {
                if (e.repeat) return;
                runPedalAction(action, dir);
                return;
            }

            if (e.repeat || activeKey) return;
            activeKey = e.key;
            holdFired = false;
            const holdMs = (typeof window.__PEDAL_HOLD_MS === 'number') ? window.__PEDAL_HOLD_MS : 600;
            holdTimer = setTimeout(() => {
                holdTimer = null;
                holdFired = true;
                if (typeof navVisiblePlaylist === 'function') navVisiblePlaylist(dir);
            }, holdMs);
        });

        document.addEventListener('keyup', function(e) {
            if (!activeKey || e.key !== activeKey) return;
            const isLeft = LEFT_KEYS.has(e.key);
            const dir = isLeft ? -1 : 1;
            const action = isLeft
                ? ((typeof userSettings !== 'undefined' && userSettings.pedalLeftAction) || 'scroll')
                : ((typeof userSettings !== 'undefined' && userSettings.pedalRightAction) || 'scroll');

            if (holdTimer) {
                clearTimeout(holdTimer);
                holdTimer = null;
            }
            const didHold = holdFired;
            activeKey = null;
            holdFired = false;
            if (!didHold) {
                runPedalAction(action, dir);
            }
        });
    };

    utilsMod.scrollStagePage = function(direction) {
        var container = document.getElementById('scroll-container');
        if (!container || container.scrollHeight <= container.clientHeight + 5) container = document.getElementById('mainZone');
        if (!container) return;

        var amount = container.clientHeight * 0.80 * direction;
        container.scrollBy({ top: amount, behavior: 'smooth' });
    };

    utilsMod.setupStageTapZones = function() {
        var viewPlayer = document.getElementById('view-player');
        if (!viewPlayer) return;
        
        viewPlayer.addEventListener('click', function(e) {
            // Ignore if clicking on buttons or inputs
            var target = e.target;
            if (target.tagName === 'BUTTON' || target.closest('button') || target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'A') return;
            
            // Ignore if Play mode or auto-scroll is active
            if (document.body.classList.contains('play-mode') || window.isPlayModeActive) return;
            if (utilsMod.scrollTimer || utilsMod.scrollStartTimeout) return;
            
            // Ignore if we are in PDF view (it has its own tap zones)
            if (window.isVisualLayerOpen && document.getElementById('stage-pdf-canvas')) return;

            var rect = viewPlayer.getBoundingClientRect();
            var x = e.clientX - rect.left;
            var width = rect.width;
            var edgeRatio = (typeof isMobileView === 'function' && isMobileView()) ? 0.12 : 0.3;
            
            if (x < width * edgeRatio) {
                utilsMod.scrollStagePage(-1);
            } else if (x > width * (1 - edgeRatio)) {
                utilsMod.scrollStagePage(1);
            }
        });
    };

    utilsMod.applyScrollBtnVisibility = function() {
        setTimeout(function() {
            var btn = document.getElementById('floatingScrollBtn');
            if (!btn) return;
            var wantsBtn = (typeof userSettings !== 'undefined' && typeof userSettings.showScrollBtn !== 'undefined') ? userSettings.showScrollBtn : true;
            if (!wantsBtn) { btn.style.display = 'none'; return; }
            var container = document.getElementById('scroll-container');
            if (!container || container.scrollHeight <= container.clientHeight + 5) container = document.getElementById('mainZone');
            var needsScroll = false;
            if (container && container.scrollHeight > container.clientHeight + 10) needsScroll = true;
            btn.style.display = needsScroll ? 'flex' : 'none';
        }, 150); 
    };

    utilsMod.init = function() {
        utilsMod.initResizers();
        utilsMod.setupGestures();
        utilsMod.setupStageTapZones();
        utilsMod.setupDraggableHandle();

        const initialHandlePos = (typeof userSettings !== 'undefined' && userSettings) ? userSettings.drawerHandlePos : null;
        utilsMod.applyDrawerHandlePos(initialHandlePos);

        let isCurrentlyMobile = isMobileView();
        if (isCurrentlyMobile && typeof utilsMod.switchMobileTab === 'function') {
            utilsMod.switchMobileTab('library');
        }
        window.addEventListener('resize', () => {
            if (typeof applyMobileForce === 'function') applyMobileForce(); 
            if (typeof utilsMod.applyDrawerHandlePos === 'function') {
                const pos = (typeof userSettings !== 'undefined' && userSettings) ? userSettings.drawerHandlePos : null;
                utilsMod.applyDrawerHandlePos(pos);
            }
            const isNowMobile = isMobileView();

            if (isCurrentlyMobile !== isNowMobile) {
                isCurrentlyMobile = isNowMobile; 
                if (isNowMobile) {
                    const d = document.getElementById('rightDrawer');
                    if (d) d.classList.remove('open');
                    document.querySelectorAll('.col-nav, .col-tools').forEach(el => el.classList.remove('mobile-view-active'));
                    const colStage = document.querySelector('.col-stage');
                    if (colStage) colStage.classList.add('mobile-view-active');
                } else {
                    document.querySelectorAll('.col-nav, .col-tools, .col-stage').forEach(el => el.classList.remove('mobile-view-active'));
                    if (typeof toViewer === 'function') toViewer(true);
                }
            }
        });
    };

    window.runPlayCountdown = function(delaySeconds, onComplete, onCancel) {
        if (!delaySeconds || delaySeconds <= 0) {
            onComplete();
            return;
        }
        
        if (window.activePlayCountdown) {
            window.activePlayCountdown.cancel();
        }
        
        const overlay = document.createElement('div');
        overlay.id = 'play-countdown-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 999999;
            font-family: 'Outfit', 'Inter', sans-serif;
            color: #fff;
            animation: fadeInPlayDelay 0.25s ease-out;
        `;
        
        if (!document.getElementById('play-delay-keyframes')) {
            const style = document.createElement('style');
            style.id = 'play-delay-keyframes';
            style.innerHTML = `
                @keyframes fadeInPlayDelay {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes numChangePlayDelay {
                    0% { transform: scale(0.6); opacity: 0; }
                    25% { transform: scale(1.15); opacity: 1; }
                    75% { transform: scale(1); opacity: 1; }
                    100% { transform: scale(0.9); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }
        
        const circle = document.createElement('div');
        circle.style.cssText = `
            width: 150px;
            height: 150px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.08);
            border: 4px solid var(--accent, #00ff00);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 5rem;
            font-weight: 900;
            margin-bottom: 25px;
            text-shadow: 0 4px 10px rgba(0, 0, 0, 0.5);
            box-shadow: 0 0 40px rgba(0, 255, 0, 0.2), inset 0 0 20px rgba(255, 255, 255, 0.05);
            transition: all 0.2s;
        `;
        
        const label = document.createElement('div');
        label.style.cssText = `
            font-size: 1.3rem;
            font-weight: bold;
            letter-spacing: 2px;
            margin-bottom: 35px;
            text-transform: uppercase;
            color: rgba(255, 255, 255, 0.85);
            text-shadow: 0 2px 5px rgba(0, 0, 0, 0.3);
        `;
        const isEl = (typeof currentLang !== 'undefined' && currentLang === 'el');
        label.innerText = isEl ? 'ΧΡΟΝΟΣ ΠΡΟΕΤΟΙΜΑΣΙΑΣ' : 'PREPARATION TIME';
        
        const cancelBtn = document.createElement('button');
        cancelBtn.style.cssText = `
            padding: 12px 30px;
            border-radius: 30px;
            border: 1px solid rgba(255, 255, 255, 0.25);
            background: rgba(255, 255, 255, 0.08);
            color: #fff;
            font-weight: bold;
            font-size: 0.95rem;
            cursor: pointer;
            transition: all 0.2s;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
        `;
        cancelBtn.innerText = isEl ? 'Ακύρωση' : 'Cancel';
        cancelBtn.onmouseover = () => {
            cancelBtn.style.background = '#dc3545';
            cancelBtn.style.borderColor = '#dc3545';
            cancelBtn.style.transform = 'scale(1.05)';
        };
        cancelBtn.onmouseout = () => {
            cancelBtn.style.background = 'rgba(255, 255, 255, 0.08)';
            cancelBtn.style.borderColor = 'rgba(255, 255, 255, 0.25)';
            cancelBtn.style.transform = 'scale(1)';
        };
        
        overlay.appendChild(circle);
        overlay.appendChild(label);
        overlay.appendChild(cancelBtn);
        document.body.appendChild(overlay);
        
        let timeLeft = delaySeconds;
        circle.innerText = timeLeft;
        circle.style.animation = 'numChangePlayDelay 1s infinite';
        
        let interval = setInterval(() => {
            timeLeft--;
            if (timeLeft <= 0) {
                clearInterval(interval);
                circle.innerText = 'Go!';
                circle.style.borderColor = '#28a745';
                circle.style.boxShadow = '0 0 50px rgba(40, 167, 69, 0.5)';
                setTimeout(() => {
                    cleanup();
                    onComplete();
                }, 500);
            } else {
                circle.innerText = timeLeft;
            }
        }, 1000);
        
        function cleanup() {
            clearInterval(interval);
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
            window.activePlayCountdown = null;
        }
        
        cancelBtn.onclick = () => {
            cleanup();
            if (onCancel) onCancel();
        };
        
        window.activePlayCountdown = {
            cancel: () => {
                cleanup();
                if (onCancel) onCancel();
            }
        };
    };

    // --- Aliases ---
    window.requestWakeLock = utilsMod.requestWakeLock;
    window.releaseWakeLock = utilsMod.releaseWakeLock;
    window.initResizers = utilsMod.initResizers;
    window.setupGestures = utilsMod.setupGestures;
    window.switchMobileTab = utilsMod.switchMobileTab;
    window.toggleRightDrawer = utilsMod.toggleRightDrawer;
    window.applyDrawerHandlePos = utilsMod.applyDrawerHandlePos;
    window.switchDrawerTab = utilsMod.switchDrawerTab;
    utilsMod.toggleCompactStageBar = function(e) {
        if (e) e.stopPropagation();
        document.body.classList.toggle('stage-tools-open');
    };

    let playFadeTimer = null;
    let playArmTimer = null;

    function clearPlayTimers() {
        if (playFadeTimer) { clearTimeout(playFadeTimer); playFadeTimer = null; }
        if (playArmTimer) { clearTimeout(playArmTimer); playArmTimer = null; }
    }

    function schedulePlayFade() {
        clearPlayTimers();
        const fadeMs = (typeof window.__PLAY_FADE_MS === 'number') ? window.__PLAY_FADE_MS : 10000;
        playFadeTimer = setTimeout(() => {
            playFadeTimer = null;
            if (!document.body.classList.contains('play-mode')) return;
            document.body.classList.remove('play-armed');
            document.body.classList.add('play-dimmed');
        }, fadeMs);
    }

    utilsMod.enterPlayMode = function() {
        if (document.body.classList.contains('play-mode')) return;
        document.body.classList.add('play-mode');
        document.body.classList.remove('play-dimmed', 'play-armed', 'stage-tools-open');
        window.isPlayModeActive = true;

        const drawer = document.getElementById('rightDrawer');
        if (drawer) drawer.classList.remove('open');

        const playIcon = document.getElementById('stagePlayIcon');
        if (playIcon) playIcon.className = 'fas fa-stop';

        if (typeof utilsMod.requestWakeLock === 'function') utilsMod.requestWakeLock();

        const smartScroll = (typeof userSettings === 'undefined' || userSettings.smartScrollOnPlay !== false);
        if (smartScroll && !utilsMod.scrollTimer && !utilsMod.scrollStartTimeout) {
            utilsMod.toggleAutoScroll();
        }

        schedulePlayFade();
    };

    utilsMod.exitPlayMode = function() {
        clearPlayTimers();
        document.body.classList.remove('play-mode', 'play-dimmed', 'play-armed');
        window.isPlayModeActive = false;

        const playIcon = document.getElementById('stagePlayIcon');
        if (playIcon) playIcon.className = 'fas fa-play';

        utilsMod.stopAutoScroll();
    };

    utilsMod.handleStagePlayBtn = function(e) {
        if (e) e.stopPropagation();
        if (!document.body.classList.contains('play-mode')) {
            utilsMod.enterPlayMode();
            return;
        }
        // Σε Play: 1ο πάτημα -> φωτίζεται πλήρως (play-armed), 2ο πάτημα εντός 3s -> STOP
        if (document.body.classList.contains('play-armed')) {
            utilsMod.exitPlayMode();
            return;
        }
        clearPlayTimers();
        document.body.classList.remove('play-dimmed');
        document.body.classList.add('play-armed');
        const armMs = (typeof window.__PLAY_ARM_MS === 'number') ? window.__PLAY_ARM_MS : 3000;
        playArmTimer = setTimeout(() => {
            playArmTimer = null;
            if (!document.body.classList.contains('play-mode')) return;
            document.body.classList.remove('play-armed');
            document.body.classList.add('play-dimmed');
        }, armMs);
    };

    window.toggleAutoScroll = utilsMod.toggleAutoScroll;
    window.stopAutoScroll = utilsMod.stopAutoScroll;
    window.startScrollNow = utilsMod.startScrollNow;
    window.adjustAutoScrollSpeed = utilsMod.adjustAutoScrollSpeed;
    window.computeSmartStartDelaySec = utilsMod.computeSmartStartDelaySec;
    window.toggleCompactStageBar = utilsMod.toggleCompactStageBar;
    window.enterPlayMode = utilsMod.enterPlayMode;
    window.exitPlayMode = utilsMod.exitPlayMode;
    window.handleStagePlayBtn = utilsMod.handleStagePlayBtn;
    window.applyScrollBtnVisibility = utilsMod.applyScrollBtnVisibility;
    window.setupBluetoothPedals = utilsMod.setupBluetoothPedals;
    window.scrollStagePage = utilsMod.scrollStagePage;
    window.setupStageTapZones = utilsMod.setupStageTapZones;
    window.initUIUtils = utilsMod.init;

    // ✅ Stubs για dead references από το Babushka refactor
    
    window.showLoader = function(id, msg) {
        // Placeholder για συμβατότητα — η εμφάνιση loader γίνεται μέσω toast
        if (msg && typeof showToast === 'function') showToast(msg, 'info');
    };

    window.hideLoader = function(id) {
        // Placeholder για συμβατότητα
    };

    window.closeMediaOverlay = function() {
        const overlay = document.getElementById('mediaOverlay');
        if (overlay) overlay.style.display = 'none';
    };

    window.loadRhythmTab = function(tab) {
        // Εμφάνιση modal και εναλλαγή ενεργού tab
        const modal = document.getElementById('rhythmLoadModal');
        if (modal) modal.style.display = 'flex';
        ['tabRhythmSystem','tabRhythmPersonal','tabRhythmBand'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.classList.remove('active');
        });
        const activeTab = document.getElementById(
            tab === 'presets' ? 'tabRhythmSystem' :
            tab === 'personal' ? 'tabRhythmPersonal' : 'tabRhythmBand'
        );
        if (activeTab) activeTab.classList.add('active');
        // Αν υπάρχει AudioEngine, εκτελεί την αναζήτηση
        if (typeof AudioEngine !== 'undefined' && typeof AudioEngine.searchRhythms === 'function') {
            AudioEngine.searchRhythms(tab);
        }
    };

})(window.mNotes.ui.utils);

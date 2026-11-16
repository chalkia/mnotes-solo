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

    utilsMod.toggleAutoScroll = function(e) {
        if (e) e.stopPropagation(); 

        var container = document.getElementById('scroll-container');
        if (!container || container.scrollHeight <= container.clientHeight) {
            container = document.getElementById('mainZone');
        }
        if (!container) return;

        var btn = document.getElementById('floatingScrollBtn');
        var btnIcon = document.getElementById('scrollBtnIcon');
        var header = document.querySelector('.player-header-container');
        var mainHeaderContent = document.querySelector('.header-main-content');
        var metaInfoBox = document.querySelector('.meta-info-box');

        if (utilsMod.scrollTimer || utilsMod.scrollStartTimeout) {
            if (utilsMod.scrollTimer) clearInterval(utilsMod.scrollTimer);
            if (utilsMod.scrollStartTimeout) clearTimeout(utilsMod.scrollStartTimeout);
            utilsMod.scrollTimer = null;
            utilsMod.scrollStartTimeout = null;
            
            if (header) header.style.display = 'block'; 
            if (mainHeaderContent) mainHeaderContent.style.display = 'block';
            if (metaInfoBox) {
                metaInfoBox.style.display = 'block';
                metaInfoBox.style.borderTop = '';
                metaInfoBox.style.marginTop = '';
            }
            if (btn) {
                btn.classList.remove('hidden');
                btn.style.opacity = '1';
                if (btnIcon) btnIcon.className = "fas fa-play";
            }
            return;
        }

        var speedSetting = (typeof userSettings !== 'undefined' && userSettings.scrollSpeed) ? parseInt(userSettings.scrollSpeed) : 50;
        var intervalTime = 220 - speedSetting; 
        if (intervalTime < 10) intervalTime = 10;
        var delaySec = (typeof userSettings !== 'undefined' && typeof userSettings.scrollDelay !== 'undefined') ? parseInt(userSettings.scrollDelay) : 10;

        if (header) {
            if (metaInfoBox) {
                if (mainHeaderContent) mainHeaderContent.style.display = 'none';
                metaInfoBox.style.borderTop = 'none';
                metaInfoBox.style.marginTop = '0';
            } else {
                header.style.display = 'none';
            }
        }
        if (btn && btnIcon) btnIcon.className = "fas fa-hourglass-half";

        utilsMod.scrollStartTimeout = setTimeout(function() {
            utilsMod.scrollStartTimeout = null;
            if (btn) {
                if (btnIcon) btnIcon.className = "fas fa-pause";
                btn.style.opacity = '0.3';
            }
            utilsMod.scrollTimer = setInterval(function() {
                container.scrollTop += 1; 
                if (container.scrollTop + container.clientHeight >= container.scrollHeight - 2) {
                    clearInterval(utilsMod.scrollTimer);
                    utilsMod.scrollTimer = null;
                    if (btn) btn.style.opacity = '1';
                    if (header) header.style.display = 'block';
                    if (mainHeaderContent) mainHeaderContent.style.display = 'block';
                    if (metaInfoBox) {
                        metaInfoBox.style.display = 'block';
                        metaInfoBox.style.borderTop = '';
                        metaInfoBox.style.marginTop = '';
                    }
                    if (btn) {
                        btn.classList.remove('hidden');
                        if (btnIcon) btnIcon.className = "fas fa-play";
                    }
                }
            }, intervalTime);
        }, delaySec * 1000); 
    };

    utilsMod.setupBluetoothPedals = function() {
        document.addEventListener('keydown', function(e) {
            var editorView = document.getElementById('view-editor');
            if(editorView && editorView.classList.contains('active-view')) return;

            // Check if user is typing in an input or textarea
            const isTyping = ['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable;
            if (isTyping) return;

            // PDF Stage override
            if (window.isVisualLayerOpen && document.getElementById('stage-pdf-canvas')) {
                if (e.key === 'PageDown' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'ArrowRight') {
                    e.preventDefault();
                    if (typeof window.nextPdfPage === 'function') window.nextPdfPage();
                    return;
                }
                if (e.key === 'PageUp' || e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                    e.preventDefault();
                    if (typeof window.prevPdfPage === 'function') window.prevPdfPage();
                    return;
                }
            }

            // Normal stage Page scrolling override when auto-scroll is not running
            if (!window.scrollInterval) {
                if (e.key === 'PageDown' || e.key === 'ArrowDown' || e.key === ' ') {
                    e.preventDefault();
                    utilsMod.scrollStagePage(1);
                    return;
                }
                if (e.key === 'PageUp' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    utilsMod.scrollStagePage(-1);
                    return;
                }
            } else {
                if (e.key === 'PageDown' || e.key === 'ArrowDown' || e.key === ' ') {
                    e.preventDefault();
                    utilsMod.toggleAutoScroll();
                    return;
                }
            }

            if (e.key === 'ArrowRight' && typeof navVisiblePlaylist === 'function') navVisiblePlaylist(1);
            if (e.key === 'ArrowLeft' && typeof navVisiblePlaylist === 'function') navVisiblePlaylist(-1);
        });
    };

    utilsMod.scrollStagePage = function(direction) {
        var container = document.getElementById('scroll-container');
        if (!container || container.scrollHeight <= container.clientHeight + 5) container = document.getElementById('mainZone');
        if (!container) return;

        var amount = container.clientHeight * 0.85 * direction;
        container.scrollBy({ top: amount, behavior: 'smooth' });
    };

    utilsMod.setupStageTapZones = function() {
        var viewPlayer = document.getElementById('view-player');
        if (!viewPlayer) return;
        
        viewPlayer.addEventListener('click', function(e) {
            // Ignore if clicking on buttons or inputs
            var target = e.target;
            if (target.tagName === 'BUTTON' || target.closest('button') || target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'A') return;
            
            // Ignore if auto-scroll is active
            if (window.scrollInterval) return;
            
            // Ignore if we are in PDF view (it has its own tap zones)
            if (window.isVisualLayerOpen && document.getElementById('stage-pdf-canvas')) return;

            var rect = viewPlayer.getBoundingClientRect();
            var x = e.clientX - rect.left;
            var width = rect.width;
            
            if (x < width * 0.3) {
                utilsMod.scrollStagePage(-1);
            } else if (x > width * 0.7) {
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
    window.toggleAutoScroll = utilsMod.toggleAutoScroll;
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

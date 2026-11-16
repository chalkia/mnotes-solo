/**
 * mNotes Visuals & Stage Layer Module
 */

window.mNotes = window.mNotes || {};
window.mNotes.ui = window.mNotes.ui || {};
window.mNotes.ui.visuals = window.mNotes.ui.visuals || {};

(function(visualsMod) {

    const ZOOM_STEPS = [100, 125, 150];
    let zoomStep = 0;
    let lastTouchTs = 0;

    visualsMod.openLayer = function(contentHtml) {
        if (typeof window.switchView === 'function') {
            window.switchView('stage');
        }
        
        const layer = document.getElementById('stageVisualLayer');
        const content = document.getElementById('visualLayerContent');
        if (!layer || !content) return;
        
        content.innerHTML = contentHtml;

        if (isMobileView()) {
            const isStageActive = document.querySelector('.tab-btn-mob[onclick*="stage"]')?.classList.contains('active');
            layer.style.display = isStageActive ? 'flex' : 'none';
        } else {
            layer.style.display = 'flex';
        }
        window.isVisualLayerOpen = true;
    };

    visualsMod.closeLayer = function() {
        zoomStep = 0;   // επόμενη εικόνα ξεκινά πάντα στο 100%
        const layer = document.getElementById('stageVisualLayer');
        if (layer) layer.style.display = 'none';
        window.isVisualLayerOpen = false;
    };

    /* Ανάγνωση παρτιτούρας στη σκηνή.
       Προεπιλογή: πλήρες πλάτος, ελεύθερο ύψος, κάθετη κύλιση — ίδια κίνηση
       με τους στίχους. Το προηγούμενο max-height:100% + object-fit:contain
       σμίκρυνε μια A4 σε ~600px ύψος σε tablet landscape, δηλαδή
       δυσανάγνωστη.
       Double-tap: κύκλος 100→125→150→100. Κύκλος και όχι ρύθμιση, ώστε να
       μην μπαίνει τίποτα στο UI: ο μουσικός δοκιμάζει επί τόπου.
       Χρησιμοποιείται width (layout) και ΟΧΙ transform: scale — το transform
       δεν επεκτείνει την περιοχή κύλισης, οπότε η ζουμαρισμένη εικόνα δεν θα
       μπορούσε να διαβαστεί ολόκληρη. (07/09/2026) */
    function renderImageInLayer(url, name) {
        zoomStep = 0;
        visualsMod.openLayer(`<img id="stageSheetImage" src="${url}" style="width:100%; max-width:100%; height:auto; display:block; border-radius:4px; box-shadow:0 0 30px rgba(0,0,0,0.5);" alt="${name}">`);
    }

    visualsMod.showImage = function(url, name) {
        if (typeof window.resolveAttachmentUrl === 'function') {
            Promise.resolve(window.resolveAttachmentUrl(url, name)).then(resolved => {
                if (!resolved) return;
                renderImageInLayer(resolved.url, name);
                setupStageImageZoom();
            });
            return;
        }
        renderImageInLayer(url, name);
        setupStageImageZoom();
    };

    function setupStageImageZoom() {

        const img = document.getElementById('stageSheetImage');
        if (!img) return;

        function cycleZoom() {
            zoomStep = (zoomStep + 1) % ZOOM_STEPS.length;
            const z = ZOOM_STEPS[zoomStep];
            // Καμία transition: animating width σημαίνει reflow σε κάθε frame
            // πάνω σε εικόνα 1800px. Στη σκηνή θέλουμε ακαριαία απόκριση.
            img.style.maxWidth = (z === 100) ? '100%' : 'none';
            img.style.width = z + '%';
        }

        /* Ποντίκι. Πολλά tablets στέλνουν ΚΑΙ συνθετικό dblclick μετά από
           double-tap· χωρίς αυτό το φράγμα το zoom άνοιγε κι έκλεινε αμέσως
           και ο χρήστης έβλεπε μόνο ένα τρέμουλο. */
        img.addEventListener('dblclick', function (e) {
            if (Date.now() - lastTouchTs < 700) return;
            e.preventDefault();
            cycleZoom();
        });

        let lastTap = 0, lastX = 0, lastY = 0, startX = 0, startY = 0;

        img.addEventListener('touchstart', function (e) {
            if (e.touches.length !== 1) return;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        }, { passive: true });

        img.addEventListener('touchend', function (e) {
            lastTouchTs = Date.now();
            if (e.changedTouches.length !== 1) return;
            const t = e.changedTouches[0];

            // (α) Το δάχτυλο δεν μετακινήθηκε μέσα στο tap ⇒ δεν ήταν κύλιση.
            if (Math.hypot(t.clientX - startX, t.clientY - startY) > 12) { lastTap = 0; return; }

            const dt = lastTouchTs - lastTap;
            // (β) Τα ΔΥΟ taps πρέπει να είναι και στο ίδιο σημείο. Χωρίς αυτό,
            //     ένα flick για κύλιση κι ένα tap για να σταματήσει η αδράνεια
            //     μετρούσαν ως double-tap — ακούσιο zoom στη σκηνή.
            const near = Math.hypot(t.clientX - lastX, t.clientY - lastY) < 40;

            if (dt > 40 && dt < 320 && near) {
                e.preventDefault();
                cycleZoom();
                lastTap = 0;
            } else {
                lastTap = lastTouchTs;
                lastX = t.clientX;
                lastY = t.clientY;
            }
        });
    };

    visualsMod.showScore = function(url, name) {
        if (typeof window.beforeOpenAttachmentUrl === 'function' && !window.beforeOpenAttachmentUrl(url, name)) {
            return;
        }
        const isABC = (url.toLowerCase().includes('.abc?') || url.toLowerCase().endsWith('.abc'));
        
        if (isABC) {
            visualsMod.openLayer(`<div id="stage-abc-paper" style="background:#fff; color:#000; padding:20px; border-radius:8px; width:95%; max-height:90%; overflow-y:auto;"></div>`);
            
            fetch(url).then(r => r.text()).then(abcText => {
                if (typeof ABCJS !== 'undefined') {
                    ABCJS.renderAbc("stage-abc-paper", abcText, { 
                        responsive: "resize",
                        add_classes: true,
                        staffwidth: 800
                    });
                } else {
                    document.getElementById('stage-abc-paper').innerHTML = `<pre style="white-space:pre-wrap; font-family:monospace;">${abcText}</pre>`;
                }
            }).catch(err => {
                console.error(err);
                showToast(t('msg_err_generic_retry'), "error");
            });
        } else {
            visualsMod.showImage(url, name);
        }
    };

    visualsMod.currentPdfObj = null;
    visualsMod.currentPdfPage = 1;

    function renderPdfInLayer(url, name) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdf.worker.min.js';

        visualsMod.openLayer(`
            <div id="stage-pdf-container" style="position:relative; width:100%; height:100%; display:flex; justify-content:center; align-items:center;">
                <canvas id="stage-pdf-canvas" style="max-width:100%; max-height:100%; object-fit:contain; border-radius:4px; box-shadow:0 0 30px rgba(0,0,0,0.5);"></canvas>
                <div id="pdf-tap-left" style="position:absolute; left:0; top:0; width:30%; height:100%; cursor:pointer; z-index:115;" onclick="window.prevPdfPage()"></div>
                <div id="pdf-tap-right" style="position:absolute; right:0; top:0; width:30%; height:100%; cursor:pointer; z-index:115;" onclick="window.nextPdfPage()"></div>
                <div id="pdf-page-info" style="position:absolute; bottom:10px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.7); color:#fff; padding:5px 15px; border-radius:15px; font-size:0.85rem; font-weight:bold; z-index:115; pointer-events:none;"></div>
            </div>
        `);

        const loadingTask = pdfjsLib.getDocument(url);
        loadingTask.promise.then(function(pdf) {
            visualsMod.currentPdfObj = pdf;
            visualsMod.currentPdfPage = 1;
            visualsMod.renderPdfPage();
        }).catch(function(reason) {
            console.error(reason);
            if (typeof showToast !== 'undefined') showToast(t('msg_err_pdf_load', 'Σφάλμα φόρτωσης PDF'), 'error');
        });
    }

    visualsMod.showPdf = function(url, name) {
        if (typeof pdfjsLib === 'undefined') {
            if (typeof showToast !== 'undefined') showToast(t('msg_pdfjs_not_loaded', 'Η βιβλιοθήκη PDF.js δεν φορτώθηκε.'), 'error');
            return;
        }
        if (typeof window.resolveAttachmentUrl === 'function') {
            Promise.resolve(window.resolveAttachmentUrl(url, name)).then(resolved => {
                if (!resolved) return;
                renderPdfInLayer(resolved.url, name);
            });
            return;
        }
        renderPdfInLayer(url, name);
    };

    visualsMod.renderPdfPage = function() {
        if (!visualsMod.currentPdfObj) return;

        visualsMod.currentPdfObj.getPage(visualsMod.currentPdfPage).then(function(page) {
            // Check if mobile for scaling. Usually sheet music needs higher resolution.
            const scale = (typeof isMobileView === 'function' && isMobileView()) ? 1.0 : 1.5;
            const viewport = page.getViewport({ scale: scale });
            const canvas = document.getElementById('stage-pdf-canvas');
            if (!canvas) return;
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            const renderContext = {
                canvasContext: context,
                viewport: viewport
            };
            page.render(renderContext);

            const info = document.getElementById('pdf-page-info');
            if (info) {
                info.innerText = `Σελίδα ${visualsMod.currentPdfPage} / ${visualsMod.currentPdfObj.numPages}`;
            }
        });
    };

    visualsMod.nextPdfPage = function() {
        if (!visualsMod.currentPdfObj || visualsMod.currentPdfPage >= visualsMod.currentPdfObj.numPages) return;
        visualsMod.currentPdfPage++;
        visualsMod.renderPdfPage();
    };

    visualsMod.prevPdfPage = function() {
        if (!visualsMod.currentPdfObj || visualsMod.currentPdfPage <= 1) return;
        visualsMod.currentPdfPage--;
        visualsMod.renderPdfPage();
    };
    visualsMod.toggleViewMode = function() {
        const s = library.find(x => x.id === currentSongId);
        if (!s) return;
        
        const parentExists = s.parent_id && window.library.find(x => x.id === s.parent_id);
        const isCloneObj = (s.is_clone && parentExists) || !!parentExists;
        const isBandMaster = !!s.group_id && !isCloneObj;

        if (isCloneObj && parentExists) {
            if (typeof window.loadSong === 'function') {
                window.loadSong(s.parent_id, true);
            }
            return;
        }

        if (isBandMaster) {
            const myClone = window.library.find(c => c.parent_id === s.id && c.is_clone && (window.currentUser && c.user_id === window.currentUser.id));
            if (myClone && !showingOriginal) {
                if (typeof window.loadSong === 'function') {
                    window.loadSong(myClone.id);
                }
                return;
            }
        }

        showingOriginal = !showingOriginal;
        visualsMod.renderPlayerWithOverrides(s);
        
        if (showingOriginal) {
            showToast(t('msg_view_band_original', "View: Band Original"), "info");
            document.body.classList.add('viewing-original');
        } else {
            showToast(t('msg_view_my_settings', "View: My Settings"), "info");
            document.body.classList.remove('viewing-original');
        }
    };

    visualsMod.renderPlayerWithOverrides = function(s) {
        if (!s) return;

        if (showingOriginal) {
            if (typeof state !== 'undefined') {
                state.t = 0; 
                state.c = 0;
            }
        } 
        else if (s.personal_transpose || s.personal_transpose === 0) {
            if (typeof state !== 'undefined') state.t = s.personal_transpose;
        }

        if (typeof renderPlayer === 'function') renderPlayer(s);
        
        visualsMod.updateToggleButton(s);
    };

    visualsMod.updateToggleButton = function(s) {
        const btn = document.getElementById('btnToggleView');
        if (!btn) return;

        btn.style.display = 'none'; 

        const parentExists = s.parent_id && window.library.find(x => x.id === s.parent_id);
        const isCloneObj = (s.is_clone && parentExists) || !!parentExists;
        const isBandMaster = !!s.group_id && !isCloneObj;

        const showBadge = () => {
            btn.style.display = 'inline-flex';
            btn.style.cssText = [
                'display:inline-flex',
                'align-items:center',
                'gap:5px',
                'padding:3px 10px',
                'border-radius:12px',
                'font-size:0.78rem',
                'font-weight:600',
                'letter-spacing:0.4px',
                'border:1px solid var(--border-color, rgba(255,255,255,0.15))',
                'background:rgba(255,255,255,0.07)',
                'color:var(--text-muted, rgba(255,255,255,0.5))',
                'cursor:pointer',
                'pointer-events:auto',
                'user-select:none',
            ].join(';');

            const isPersonal = (typeof currentGroupId === 'undefined' || currentGroupId === 'personal');

            if (isCloneObj) {
                if (isPersonal) {
                    btn.innerHTML = `<i class="fas fa-star" style="font-size:0.7rem"></i> ${t('lbl_master_version', 'Master')}`;
                } else {
                    btn.innerHTML = `<i class="fas fa-users" style="font-size:0.7rem"></i> ${t('lbl_band_version', 'Band Version')}`;
                }
            } else {
                const myClone = window.library.find(c => c.parent_id === s.id && c.is_clone && (window.currentUser && c.user_id === window.currentUser.id));
                if (myClone) {
                    btn.innerHTML = `<i class="fas fa-user" style="font-size:0.7rem"></i> ${t('lbl_my_version', 'My Version')}`;
                } else {
                    btn.innerHTML = `<i class="fas fa-user" style="font-size:0.7rem"></i> ${t('lbl_my_settings', 'My Settings')}`;
                }
            }
        };

        if (isBandMaster) {
            const hasOverrides = s.has_override || (s.personal_notes && s.personal_notes.trim() !== "") || (s.personal_transpose && s.personal_transpose !== 0);
            const myClone = window.library.find(c => c.parent_id === s.id && c.is_clone && (window.currentUser && c.user_id === window.currentUser.id));
            if (hasOverrides || showingOriginal || myClone) {
                showBadge();
            }
            return;
        }

        if (isCloneObj && parentExists) {
            showBadge();
            return;
        }
    };

    visualsMod.renderStickyNotes = function(s) {
        const stickyArea = document.getElementById('stickyNotesArea'); 
        if (!stickyArea) return;

        const condText = document.getElementById('conductorNoteText'); 
        const persText = document.getElementById('personalNoteText');
        const personalNotesMap = JSON.parse(localStorage.getItem('mnotes_personal_notes') || '{}'); 
        const myNote = personalNotesMap[s.id] || "";
        
        stickyArea.style.cssText = "display:none; position:absolute; top:70px; left:15px; right:15px; background:#fff9c4; color:#000; border:1px solid #fbc02d; padding:15px; border-radius:4px; z-index:100; box-shadow:0 10px 25px rgba(0,0,0,0.5); cursor:pointer;";
        stickyArea.title = t('title_click_close_note', "Πατήστε πάνω στη σημείωση για να κλείσει");
        stickyArea.onclick = visualsMod.toggleStickyNotes; 
        
        if (s.conductorNotes) { 
            if (condText) {
                condText.style.display = 'block'; 
                condText.innerHTML = `<b style="color:#c62828;"><i class="fas fa-bullhorn"></i> ${t('lbl_maestro', 'Band Notes:')}</b><br><span style="color:#111; white-space:pre-wrap; font-size:0.95rem;">${s.conductorNotes}</span>`; 
            }
        } else { 
            if (condText) condText.style.display = 'none'; 
        }
        
        if (myNote) { 
            if (persText) {
                persText.style.display = 'block'; 
                persText.style.marginTop = s.conductorNotes ? "12px" : "0"; 
                persText.innerHTML = `<b style="color:#1565c0;"><i class="fas fa-user-edit"></i> ${t('lbl_me', 'My Notes:')}</b><br><span style="color:#111; white-space:pre-wrap; font-size:0.95rem;">${myNote}</span>`; 
            }
        } else { 
            if (persText) persText.style.display = 'none'; 
        }
    };

    visualsMod.toggleStickyNotes = function() { 
        const area = document.getElementById('stickyNotesArea'); 
        if (area) { 
            area.style.display = (area.style.display === 'none' || area.style.display === '') ? 'block' : 'none'; 
        } 
    };

    visualsMod.cycleIntroSize = function() {
        window.introSizeLevel = (window.introSizeLevel + 1) % 3;
        localStorage.setItem('mnotes_intro_size', window.introSizeLevel);
        if (typeof currentSongId !== 'undefined' && currentSongId) {
            var s = library.find(x => x.id === currentSongId);
            if (s && typeof renderPlayer === 'function') {
                renderPlayer(s);
            }
        }
    };

    // --- Aliases ---
    window.openVisualLayer = visualsMod.openLayer;
    window.closeVisualLayer = visualsMod.closeLayer;
    window.showImageInLayer = visualsMod.showImage;
    window.showScoreInLayer = visualsMod.showScore;
    window.showPdfInLayer = visualsMod.showPdf;
    window.nextPdfPage = visualsMod.nextPdfPage;
    window.prevPdfPage = visualsMod.prevPdfPage;
    window.toggleViewMode = visualsMod.toggleViewMode;
    window.renderPlayerWithOverrides = visualsMod.renderPlayerWithOverrides;
    window.updateToggleButton = visualsMod.updateToggleButton;
    window.renderStickyNotes = visualsMod.renderStickyNotes;
    window.toggleStickyNotes = visualsMod.toggleStickyNotes;
    window.cycleIntroSize = visualsMod.cycleIntroSize;

})(window.mNotes.ui.visuals);

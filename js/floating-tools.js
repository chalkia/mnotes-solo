/* ===========================================================
   FLOATING TOOLS & ATTACHMENTS v2.0 (Multi-Window Support)
   =========================================================== */

const FloatingTools = {
    instances: {}, // map of id -> { el: DOMElement, isMinimized: boolean }
    
    // Helper to generate a unique ID based on the URL
    getIdFromUrl: function(url) {
        let hash = 0;
        for (let i = 0; i < url.length; i++) {
            const char = url.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return 'fw_' + Math.abs(hash);
    },

    // Φέρνει το παράθυρο μπροστά
    bringToFront: function(viewerId) {
        const viewers = document.querySelectorAll('.floating-window');
        viewers.forEach(v => {
            if (v.id === viewerId) v.style.zIndex = 501;
            else v.style.zIndex = 500;
        });
    },

    // Κλείνει ΟΛΑ τα παράθυρα
    closeAll: function() {
        Object.keys(this.instances).forEach(id => this.close(id));
    },

    close: function(viewerId) {
        if (!viewerId) {
            this.closeAll();
            return;
        }
        
        const instance = this.instances[viewerId];
        if (instance && instance.resizeObserver) {
            instance.resizeObserver.disconnect();
        }
        
        const viewer = document.getElementById(viewerId);
        if (viewer) {
            viewer.remove();
        }
        delete this.instances[viewerId];
    },

    loadContent: function(url, type, customTitle = null) {
        if (typeof window.beforeOpenAttachmentUrl === 'function' && !window.beforeOpenAttachmentUrl(url, customTitle || type)) {
            return;
        }
        if (typeof window.resolveAttachmentUrl === 'function' && typeof url === 'string' && url.startsWith('local://')) {
            Promise.resolve(window.resolveAttachmentUrl(url, customTitle || type)).then(resolved => {
                if (!resolved) return;
                this.loadContent(resolved.url, resolved.mime || type, customTitle);
            });
            return;
        }

        const viewerId = this.getIdFromUrl(url);
        
        // Αν υπάρχει ήδη, απλά φέρτο μπροστά
        if (this.instances[viewerId] && document.getElementById(viewerId)) {
            this.bringToFront(viewerId);
            return;
        }

        const viewer = document.createElement('div');
        viewer.id = viewerId;
        viewer.className = 'floating-window';
        viewer.dataset.url = url;
        
        // Initial generic styles
        const isMob = typeof isMobileView === 'function' && isMobileView();
        const leftPos = isMob ? '10px' : '10%';
        viewer.style.cssText = `position:fixed; top:15%; left:${leftPos}; width:450px; height:550px; max-width:calc(100vw - 20px); max-height:calc(100dvh - 40px); background:var(--bg-panel); border:1px solid var(--accent); border-radius:8px; z-index:501; display:flex; flex-direction:column; box-shadow:0 10px 30px rgba(0,0,0,0.5); overflow:hidden; resize:both; min-width:250px; min-height:200px;`;
        
        // ✨ ΝΕΟ: Έλεγχος Stage Visibility για κινητά
        if (isMob) {
            const mainZone = document.getElementById('mainZone');
            const isStageActive = mainZone ? mainZone.classList.contains('mobile-view-active') : true;
            if (!isStageActive) viewer.style.display = 'none';
        }
        
        const titleText = customTitle || type || "Attachment";
        const isABC = (url.toLowerCase().includes('.abc?') || url.toLowerCase().endsWith('.abc'));
        const iconClass = isABC ? 'fas fa-music' : 'fas fa-file';

        const isPdf = (type && type.toLowerCase().includes('pdf')) || url.toLowerCase().endsWith('.pdf');
        const expandBtnHtml = isPdf ? `<button onclick="FloatingTools.expandToStage('${viewerId}', '${url}', '${titleText.replace(/'/g, "\\'")}')" style="background:none; border:none; color:var(--accent); cursor:pointer; margin-right:15px;" title="Προβολή στο Stage"><i class="fas fa-expand"></i></button>` : '';

        viewer.innerHTML = `
            <div class="fw-header" id="${viewerId}-header" style="background:#111; padding:10px; cursor:move; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--accent);">
                <span class="fw-title" style="color:var(--text-main); font-weight:bold; font-size:0.9rem; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; max-width:70%;"><i class="${iconClass}"></i> ${titleText}</span>
                <div class="fw-controls">
                    ${expandBtnHtml}
                    <button onclick="FloatingTools.toggleMinimize('${viewerId}')" style="background:none; border:none; color:#fff; cursor:pointer; margin-right:15px;"><i class="fas fa-minus"></i></button>
                    <button onclick="FloatingTools.close('${viewerId}')" style="background:none; border:none; color:var(--danger); cursor:pointer;"><i class="fas fa-times"></i></button>
                </div>
            </div>
            <div class="fw-body" id="${viewerId}-body" style="flex:1; background:#fff; overflow:hidden;">
                <div style="padding:20px; text-align:center; color:#666;">
                    <i class="fas fa-spinner fa-spin fa-2x"></i>
                    <p>Loading...</p>
                </div>
            </div>
            <div class="fw-resizer" id="${viewerId}-resizer" style="position:absolute; bottom:0; right:0; width:15px; height:15px; cursor:se-resize;"></div>
        `;

        document.body.appendChild(viewer);
        this.instances[viewerId] = { el: viewer, isMinimized: false };

        // Events για z-index
        viewer.addEventListener('mousedown', () => this.bringToFront(viewerId));
        viewer.addEventListener('touchstart', () => this.bringToFront(viewerId), {passive: true});

        this.makeDraggable(viewer, viewerId);
        this.makeResizable(viewer, viewerId);

        // Add ResizeObserver to catch native browser resizes
        const resizeObserver = new ResizeObserver(() => {
            if (!this.instances[viewerId]?.isMinimized) {
                this.saveLayout(viewerId);
            }
        });
        resizeObserver.observe(viewer);
        this.instances[viewerId].resizeObserver = resizeObserver;
        
        // Φόρτωση του περιεχομένου
        const body = document.getElementById(`${viewerId}-body`);
        const cleanType = type ? type.toLowerCase() : 'pdf';
        
        if (isABC || cleanType === 'text/plain') {
            body.innerHTML = `<div id="${viewerId}-abc-paper" style="padding:15px; background:white; color:black; height:100%; overflow-y:auto; box-sizing:border-box;"></div>`;
            fetch(url)
                .then(res => res.text())
                .then(abcSource => {
                    if (typeof ABCJS !== 'undefined') {
                        const vt = (typeof state !== 'undefined' && state) ? ((state.t || 0) - (state.c || 0)) : 0;
                        const renderOptions = {
                            responsive: "resize",
                            paddingleft: 0,
                            paddingright: 0,
                            add_classes: true,
                            staffwidth: 400,
                            visualTranspose: vt
                        };

                        // Check for custom mNotes tab directive (Format: %%mnotes-tab: instrument[:tuning])
                        const tabInfo = (typeof window.parseMnotesTab === 'function')
                            ? window.parseMnotesTab(abcSource)
                            : { enabled: false };
                        if (tabInfo.enabled && tabInfo.tuning) {
                            renderOptions.tablature = [{
                                instrument: (tabInfo.instrument === 'bass' ? 'bass' : 'guitar'),
                                tuning: tabInfo.tuning
                            }];
                        }

                        ABCJS.renderAbc(`${viewerId}-abc-paper`, abcSource, renderOptions);
                        const svgs = document.querySelectorAll(`#${viewerId}-abc-paper svg`);
                        svgs.forEach(svg => { 
                            svg.style.fill = "black"; 
                            svg.style.stroke = "black";
                            // Hide clef on tab staff
                            svg.querySelectorAll('.abcjs-tab-staff .abcjs-clef').forEach(clef => clef.style.display = 'none');
                        });
                    } else {
                        document.getElementById(`${viewerId}-abc-paper`).innerHTML = "ABCJS not loaded.";
                    }
                }).catch(err => {
                    document.getElementById(`${viewerId}-abc-paper`).innerHTML = "Error: " + err.message;
                });
        } else if (cleanType.includes('pdf')) {
            body.innerHTML = `<iframe src="${url}#toolbar=0" style="width:100%; height:100%; border:none;"></iframe>`;
        } else if (cleanType.includes('image') || ['jpg', 'jpeg', 'png', 'webp'].some(t => cleanType.includes(t))) {
            body.innerHTML = `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:#111;"><img src="${url}" style="max-width:100%; max-height:100%; object-fit:contain;"></div>`;
        } else {
            body.innerHTML = `<iframe src="${url}" style="width:100%; height:100%; border:none;"></iframe>`;
        }

        // Επαναφορά της θέσης και μεγέθους που είχε σώσει ο χρήστης για αυτό το URL
        this.applySavedLayout(viewerId, url);
    },

    toggleMinimize: function(viewerId) {
        const instance = this.instances[viewerId];
        if (!instance) return;
        const viewer = instance.el;
        const body = document.getElementById(`${viewerId}-body`);
        
        instance.isMinimized = !instance.isMinimized;
        
        if (instance.isMinimized) {
            body.style.display = 'none';
            viewer.style.height = 'auto';
            viewer.style.width = '250px';
        } else {
            body.style.display = 'block';
            this.applySavedLayout(viewerId, viewer.dataset.url); 
        }
        this.saveLayout(viewerId);
    },

    expandToStage: function(viewerId, url, title) {
        if (typeof window.showPdfInLayer === 'function') {
            window.showPdfInLayer(url, title);
            this.close(viewerId); 
        } else {
            console.warn("window.showPdfInLayer not found");
        }
    },

    makeDraggable: function(el, viewerId) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        const header = document.getElementById(`${viewerId}-header`);
        
        header.onmousedown = dragMouseDown;
        header.ontouchstart = dragMouseDown;

        function dragMouseDown(e) {
            e = e || window.event;
            if (e.target.tagName === 'BUTTON' || e.target.parentElement?.tagName === 'BUTTON') return;
            pos3 = e.clientX || (e.touches ? e.touches[0].clientX : 0);
            pos4 = e.clientY || (e.touches ? e.touches[0].clientY : 0);
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
            document.ontouchend = closeDragElement;
            document.ontouchmove = elementDrag;
            FloatingTools.bringToFront(viewerId);
        }

        function elementDrag(e) {
            e = e || window.event;
            e.preventDefault();
            let clientX = e.clientX || (e.touches ? e.touches[0].clientX : 0);
            let clientY = e.clientY || (e.touches ? e.touches[0].clientY : 0);
            pos1 = pos3 - clientX;
            pos2 = pos4 - clientY;
            pos3 = clientX;
            pos4 = clientY;
            el.style.top = (el.offsetTop - pos2) + "px";
            el.style.left = (el.offsetLeft - pos1) + "px";
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
            document.ontouchend = null;
            document.ontouchmove = null;
            FloatingTools.saveLayout(viewerId);
        }
    },

    makeResizable: function(el, viewerId) {
        const resizer = document.getElementById(`${viewerId}-resizer`);
        resizer.addEventListener('mousedown', initResize, false);
        resizer.addEventListener('touchstart', initResize, {passive: false});

        function initResize(e) {
            e.preventDefault();
            window.addEventListener('mousemove', Resize, false);
            window.addEventListener('mouseup', stopResize, false);
            window.addEventListener('touchmove', Resize, {passive: false});
            window.addEventListener('touchend', stopResize, false);
            FloatingTools.bringToFront(viewerId);
        }
        function Resize(e) {
            let clientX = e.clientX || (e.touches ? e.touches[0].clientX : 0);
            let clientY = e.clientY || (e.touches ? e.touches[0].clientY : 0);
            el.style.width = Math.max(250, (clientX - el.offsetLeft)) + 'px';
            el.style.height = Math.max(200, (clientY - el.offsetTop)) + 'px';
        }
        function stopResize(e) {
            window.removeEventListener('mousemove', Resize, false);
            window.removeEventListener('mouseup', stopResize, false);
            window.removeEventListener('touchmove', Resize, false);
            window.removeEventListener('touchend', stopResize, false);
            FloatingTools.saveLayout(viewerId);
        }
    },

    // Αποθηκεύει το layout με βάση το URL για να το θυμάται πάντα!
    saveLayout: function(viewerId) {
        const instance = this.instances[viewerId];
        if (!instance) return;
        const el = instance.el;
        const url = el.dataset.url;
        if (!url) return;

        const storageKey = 'mnotes_viewer_layouts';
        let allLayouts = JSON.parse(localStorage.getItem(storageKey) || "{}");
        let layoutToSave = allLayouts[url] || {};

        layoutToSave.top = el.style.top;
        layoutToSave.left = el.style.left;
        layoutToSave.isMinimized = instance.isMinimized;

        if (!instance.isMinimized) {
            const rect = el.getBoundingClientRect();
            layoutToSave.width = rect.width + 'px';
            layoutToSave.height = rect.height + 'px';
        }

        allLayouts[url] = layoutToSave;
        safeSetLocal(storageKey, JSON.stringify(allLayouts));
    },

    applySavedLayout: function(viewerId, url) {
        const saved = localStorage.getItem('mnotes_viewer_layouts');
        if (!saved) return;
        const allLayouts = JSON.parse(saved);
        const layout = allLayouts[url];
        if (!layout) return;

        const instance = this.instances[viewerId];
        if (!instance) return;
        const el = instance.el;
        
        if (layout.top) el.style.top = layout.top;
        if (layout.left) el.style.left = layout.left;
        
        if (!instance.isMinimized) {
            if (layout.width) el.style.width = layout.width;
            if (layout.height) el.style.height = layout.height;
        }
        
        instance.isMinimized = !!layout.isMinimized;
        if (instance.isMinimized) {
            document.getElementById(`${viewerId}-body`).style.display = 'none';
            el.style.height = 'auto';
            el.style.width = '250px';
        }
    }
};

// 7. Γέφυρα Αυτόματης Φόρτωσης (Ανοίγει όλα τα attachments ενός τραγουδιού)
async function autoLoadAttachmentsForSong(song) {
    if (typeof FloatingTools !== 'undefined') {
        FloatingTools.closeAll(); // Κλείνει τα προηγούμενα
    }
    
    if (!song) return;

    // --- ΑΥΤΟΜΑΤΗ ΕΝΕΡΓΟΠΟΙΗΣΗ ΡΥΘΜΟΥ ---
    if (song.rhythms && song.rhythms.length > 0) {
        const r = song.rhythms[0]; // Παίρνουμε τον πρώτο συνδεδεμένο ρυθμό
        if (typeof activateSongRhythm === 'function') {
            console.log(`[AutoLoad] Activating rhythm: ${r.name}`);
            activateSongRhythm(r.url, r.name, r.bpm || null);
        }
    } else {
        // Επαναφορά στον μετρονόμο αν το τραγούδι δεν έχει ρυθμό
        if (typeof resetRhythmToDefault === 'function') {
            resetRhythmToDefault();
        }
    }
    
    if (!song.attachments || !song.attachments.length) return;
    if (typeof isMobileView === 'function' && isMobileView()) return;
    
    // Ανοίγει όλα τα attachments του συγκεκριμένου τραγουδιού
    song.attachments.forEach((doc, idx) => {
        // Καθυστέρηση ελάχιστη για να μπουν με ελαφρώς διαφορετικό offset αν δεν έχουν σωσμένο layout
        setTimeout(() => {
            const isImage = (doc.type && doc.type.toLowerCase().includes('image')) || (doc.url && /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(doc.url));
            const isABC = doc.url && (doc.url.toLowerCase().includes('.abc?') || doc.url.toLowerCase().endsWith('.abc'));
            
            let docFileType = 'pdf';
            if (isImage) docFileType = 'image';
            else if (isABC) docFileType = 'score';
            
            FloatingTools.loadContent(doc.url, docFileType, doc.name);
        }, idx * 100);
    });
}

/**
 * mNotes Band & Maestro Hub Module
 */

window.mNotes = window.mNotes || {};
window.mNotes.ui = window.mNotes.ui || {};
window.mNotes.ui.band = window.mNotes.ui.band || {};

(function(bandMod) {

    bandMod.updateUI = function() {
        const isGod = roleCan('EDIT_BAND_MASTER');
        const isBandContext = (typeof currentGroupId !== 'undefined' && currentGroupId !== 'personal');

        if (!isBandContext) { return; }

        
    };

    bandMod.savePerformanceNotes = async function() { /* deprecated */ };

    bandMod.refreshSyncVisibility = function(song) {
        const btnSync = document.getElementById('btnSyncFromBand');
        if (!btnSync) return;

        btnSync.style.display = 'none';

        if (currentGroupId === 'personal' && song && song.id) {
            let isShared = false;
            
            if (typeof myGroups !== 'undefined') {
                myGroups.forEach(g => {
                    const bandData = JSON.parse(localStorage.getItem('mnotes_band_' + g.group_id) || "[]");
                    if (bandData.some(s => s.id === song.id)) isShared = true;
                });
            }

            if (isShared) {
                btnSync.style.display = 'inline-block';
                btnSync.title = t('title_sync_band');
            }
        }
    };

    // --- Aliases ---
    window.updateBandHubUI = bandMod.updateUI;
    window.saveMaestroNotes = bandMod.savePerformanceNotes;
    window.savePerformanceNotes = bandMod.savePerformanceNotes;
    window.refreshSyncButtonVisibility = bandMod.refreshSyncVisibility;

})(window.mNotes.ui.band);

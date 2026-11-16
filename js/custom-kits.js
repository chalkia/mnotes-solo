/* =========================================
   custom-kits.js
   Local IndexedDB storage and .mkit import/export for Custom Drum Kits
   ========================================= */

(function (global) {
  "use strict";

  const DB_NAME = "MNotesCustomKitsDB";
  const LEGACY_DB_NAME = "mStudioKitsDB";
  const MIGRATION_FLAG = "mnotes_custom_kits_migrated_v1";
  const STORE_NAME = "kits";

  class CustomKitsDatabase {
    constructor() {
      this.db = null;
      this._migrationPromise = null;
    }

    async init() {
      if (!this.db) {
        await new Promise((resolve, reject) => {
          const req = indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
              db.createObjectStore(STORE_NAME, { keyPath: "id" });
            }
          };
          req.onsuccess = (e) => {
            this.db = e.target.result;
            resolve();
          };
          req.onerror = (e) => {
            console.error("[CustomKitDB] Failed to open DB:", e);
            reject(e.target.error);
          };
        });
      }
      if (!this._migrationPromise) {
        this._migrationPromise = this._migrateLegacyDB().catch((err) => {
          console.warn("[CustomKitDB] Legacy migration skipped:", err);
        });
      }
      await this._migrationPromise;
    }

    async _migrateLegacyDB() {
      try {
        if (typeof localStorage !== "undefined" && localStorage.getItem(MIGRATION_FLAG) === "1") return;
      } catch (_) {}

      const legacyKits = await new Promise((resolve) => {
        let abortedForNew = false;
        const req = indexedDB.open(LEGACY_DB_NAME, 1);
        req.onupgradeneeded = (e) => {
          if (e.oldVersion === 0) {
            abortedForNew = true;
            e.target.transaction.abort();
          }
        };
        req.onsuccess = (e) => {
          const legacyDb = e.target.result;
          if (!legacyDb.objectStoreNames.contains(STORE_NAME)) {
            legacyDb.close();
            return resolve([]);
          }
          const tx = legacyDb.transaction([STORE_NAME], "readonly");
          const getAllReq = tx.objectStore(STORE_NAME).getAll();
          getAllReq.onsuccess = () => {
            legacyDb.close();
            resolve(getAllReq.result || []);
          };
          getAllReq.onerror = () => {
            legacyDb.close();
            resolve([]);
          };
        };
        req.onerror = () => resolve(abortedForNew ? [] : []);
      });

      for (const oldKit of legacyKits) {
        if (!oldKit || !oldKit.id) continue;
        const existing = await this.getKit(oldKit.id);
        if (existing) continue;
        const voices = {};
        if (oldKit.voices && typeof oldKit.voices === "object") {
          for (const [vId, val] of Object.entries(oldKit.voices)) {
            if (!val) continue;
            if (typeof val === "object" && val.audioBase64) {
              voices[vId] = { audioBase64: val.audioBase64, label: val.label || vId.toUpperCase() };
            } else if (typeof Blob !== "undefined" && val instanceof Blob) {
              voices[vId] = { audioBase64: await this._blobToBase64(val), label: vId.toUpperCase() };
            }
          }
        }
        const migrated = {
          id: oldKit.id,
          name: oldKit.name || oldKit.id,
          type: "mKit",
          version: 1,
          author: (global.userProfile && global.userProfile.email) || "Anonymous",
          voices,
          createdAt: oldKit.timestamp ? new Date(oldKit.timestamp).toISOString() : new Date().toISOString()
        };
        const tx = this.db.transaction([STORE_NAME], "readwrite");
        await new Promise((res, rej) => {
          const putReq = tx.objectStore(STORE_NAME).put(migrated);
          putReq.onsuccess = () => res();
          putReq.onerror = () => rej(putReq.error);
        });
      }

      try {
        if (typeof localStorage !== "undefined") localStorage.setItem(MIGRATION_FLAG, "1");
      } catch (_) {}
    }

    async getTransaction(mode = "readonly") {
      await this.init();
      return this.db.transaction([STORE_NAME], mode);
    }

    // Convert a File/Blob to Base64
    _blobToBase64(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }

    // Save kit from Blobs (File Inputs)
    async saveKit(id, name, voiceBlobs) {
      const voices = {};
      for (const [vId, blob] of Object.entries(voiceBlobs)) {
        if (blob) {
          voices[vId] = {
            audioBase64: await this._blobToBase64(blob),
            label: vId.toUpperCase()
          };
        }
      }

      const kitData = {
        id,
        name,
        type: "mKit",
        version: 1,
        author: (global.userProfile && global.userProfile.email) || "Anonymous",
        voices,
        createdAt: new Date().toISOString()
      };

      const tx = await this.getTransaction("readwrite");
      const store = tx.objectStore(STORE_NAME);
      return new Promise((resolve, reject) => {
        const req = store.put(kitData);
        req.onsuccess = () => resolve(kitData);
        req.onerror = () => reject(req.error);
      });
    }

    async getKit(id) {
      const tx = await this.getTransaction("readonly");
      const store = tx.objectStore(STORE_NAME);
      return new Promise((resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    async deleteKit(id) {
      const tx = await this.getTransaction("readwrite");
      const store = tx.objectStore(STORE_NAME);
      return new Promise((resolve, reject) => {
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }

    async getAllKitsMetadata() {
      const tx = await this.getTransaction("readonly");
      const store = tx.objectStore(STORE_NAME);
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => {
          const kits = req.result || [];
          // Επιστρέφουμε μόνο τα βασικά στοιχεία, όχι όλο το Base64 για ταχύτητα
          resolve(kits.map(k => ({
            id: k.id,
            name: k.name,
            author: k.author,
            createdAt: k.createdAt
          })));
        };
        req.onerror = () => reject(req.error);
      });
    }

    // --- Export / Import ---

    async exportKitFile(id) {
      const kit = await this.getKit(id);
      if (!kit) throw new Error("Kit not found");

      const jsonStr = JSON.stringify(kit, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `${kit.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.mkit`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    async importKitFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const data = JSON.parse(e.target.result);
            if (data.type !== "mKit") throw new Error("Invalid format. Must be an .mkit file.");
            
            // Assign a new ID to avoid collisions
            data.id = 'custom_' + Date.now().toString(36);
            data.importedAt = new Date().toISOString();

            const tx = await this.getTransaction("readwrite");
            const store = tx.objectStore(STORE_NAME);
            const req = store.put(data);
            req.onsuccess = () => resolve(data);
            req.onerror = () => reject(req.error);
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = () => reject(new Error("File read error"));
        reader.readAsText(file);
      });
    }
  }

  global.CustomKitDB = new CustomKitsDatabase();

})(window);

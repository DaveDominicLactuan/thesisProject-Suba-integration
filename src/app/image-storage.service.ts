import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Firestore, doc, setDoc } from '@angular/fire/firestore';
import { serverTimestamp } from 'firebase/firestore';


export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}


export interface StoredImage {
  original: string;
  withBoxes: string;
  boxes: any[];
  faceDetected: boolean;
  faceData?: any[];
  timestamp: string;
  detectionMessage: string;
  // Optional fields used by other pages/components
  filename?: string; // ✅ Add this
  statusMessage?: string;
  hasPrediction?: boolean;
  prediction?: { type: string; shape: string; severity?: string };
  // S3 upload keys for session copying
  originalS3Key?: string;
  withBoxesS3Key?: string;
}

export interface ImageSession {
  id: string;
  name: string;
  imageKeys: string[]; // original image keys
  created: string;
}

@Injectable({
  providedIn: 'root'
})
export class ImageStorageService {

    
  private storedImages: StoredImage[] = [];
  private entryMap: Map<string, StoredImage> = new Map();
  // simple in-memory session store
  private sessions: ImageSession[] = [];
  // Track last created session for UI handoff between pages
  private lastCreatedSessionId: string | null = null;
  private lastCreatedSessionName: string | null = null;

  // persistence keys
  private SESSIONS_KEY = 'app_image_sessions_v1';
  private LAST_SESSION_KEY = 'app_last_session_v1';

  // Current selected image for session-level sharing (feedback page etc.)
  private _currentImage: StoredImage | null = null;
  private _currentImage$ = new BehaviorSubject<StoredImage | null>(null);
  
    // ✅ Add a new image to storage (async-friendly)
    async addImage(image: StoredImage): Promise<void> {
      // allow callers to await persistence in future if implemented
      this.storedImages.unshift(image);
      this.entryMap.set(image.original, image);
      // keep currentImage map in sync if the same original was selected
      if (this._currentImage && this._currentImage.original === image.original) {
        this._currentImage = image;
        this._currentImage$.next(this._currentImage);
      }
      return Promise.resolve();
    }

    constructor(private firestore: Firestore) {
      // attempt to load persisted sessions and last session info
      try {
        const raw = localStorage.getItem(this.SESSIONS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as ImageSession[];
          if (Array.isArray(parsed)) this.sessions = parsed;
        }
      } catch (e) {
        console.warn('[ImageStorageService] failed to load persisted sessions', e);
        this.sessions = [];
      }

      try {
        const lastRaw = localStorage.getItem(this.LAST_SESSION_KEY);
        if (lastRaw) {
          const obj = JSON.parse(lastRaw) as { id?: string; name?: string };
          this.lastCreatedSessionId = obj?.id ?? null;
          this.lastCreatedSessionName = obj?.name ?? null;
        }
      } catch (e) {
        // ignore
      }
    }

  /**
   * Persist a session and its images to Firestore under `sessionsImages` and `images`.
   * Adds metadata such as createdBy and client info.
   */
  async saveSessionWithImagesToFirestore(sessionId: string, opts?: { createdBy?: string }): Promise<void> {
    if (!this.firestore) {
      throw new Error('Firestore not available in ImageStorageService');
    }
    const s = this.getSession(sessionId);
    if (!s) throw new Error('Session not found: ' + sessionId);
    try {
      const createdBy = opts?.createdBy ?? this.getUserIdFromLocalStorage();
      const clientInfo = {
        ua: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        platform: typeof navigator !== 'undefined' ? (navigator.platform || 'unknown') : 'unknown'
      };

      console.log('[ImageStorageService] ========== FIRESTORE SAVE SESSION ==========');
      console.log('[ImageStorageService] Session to save:', {
        id: s.id,
        name: s.name,
        createdBy: createdBy,
        imageKeysCount: s.imageKeys.length,
        imageKeysSample: s.imageKeys.slice(0, 2).map((k: string) => typeof k === 'string' ? k.substring(0, 50) + '...' : k)
      });
      
      // write session document
      const sessionRef = doc(this.firestore, 'sessionsImages', sessionId);
      const sessionData = {
        name: s.name,
        imageKeys: s.imageKeys,
        createdAt: serverTimestamp(),
        localId: s.id,
        createdBy: createdBy || null,
        clientInfo
      };
      
      console.log('[ImageStorageService] 📝 Saving session document to Firestore:', {
        docPath: `sessionsImages/${sessionId}`,
        data: {
          name: sessionData.name,
          createdBy: sessionData.createdBy,
          imageKeysCount: sessionData.imageKeys.length,
          clientInfo: sessionData.clientInfo
        }
      });
      
      await setDoc(sessionRef, sessionData);
      console.log('[ImageStorageService] ✅ Session document saved');

      // write images documents (one per imageKey)
      // IMPORTANT: imageKeys may contain filenames from copied sessions, so we need to search by both original AND filename
      for (const key of s.imageKeys) {
        console.log(`[ImageStorageService] 📝 SAVING IMAGE DOCUMENT ${key.substring(0, 50)}...`);
        
        // Try multiple lookup strategies
        let entry = this.getEntryForImage(key); // Try by original (base64)
        
        if (!entry) {
          // If not found by original, search by filename
          entry = this.storedImages.find(si => si.filename === key);
          if (entry) {
            console.log(`[ImageStorageService] ✅ Found image by filename: ${key}`);
          }
        } else {
          console.log(`[ImageStorageService] ✅ Found image by original key`);
        }
        
        // Also try searching by the full string if it looks like a base64
        if (!entry && key.startsWith('data:')) {
          entry = this.storedImages.find(si => si.original === key);
        }
        
        if (!entry) {
          console.warn(`[ImageStorageService] ❌ Image not found for key: ${key.substring(0, 50)}...`);
          console.warn(`[ImageStorageService] Available images:`, this.storedImages.map(si => ({
            filename: si.filename,
            hasOriginal: !!si.original,
            originalLength: si.original?.length || 0
          })));
          continue;
        }
        
        console.log(`[ImageStorageService] ✅ Found image:`, {
          filename: entry.filename,
          key: key.substring(0, 50) + '...',
          hasS3Original: !!entry.originalS3Key,
          hasS3WithBoxes: !!entry.withBoxesS3Key
        });
        
        const safeId = `${sessionId}_${(entry.filename || key).toString().slice(0, 50).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        const imgRef = doc(this.firestore, 'images', safeId);
        
        const imageData = {
          sessionId,
          imageKey: key,
          original: entry.original,
          withBoxes: entry.withBoxes,
          filename: entry.filename,
          timestamp: entry.timestamp,
          detectionMessage: entry.detectionMessage,
          prediction: entry.prediction ?? null,
          originalS3Key: entry.originalS3Key,
          withBoxesS3Key: entry.withBoxesS3Key,
          createdAt: serverTimestamp(),
          createdBy: createdBy || null
        };
        
        console.log(`[ImageStorageService] 📝 Saving image document to Firestore:`, {
          docPath: `images/${safeId}`,
          filename: entry.filename,
          s3KeyOriginal: entry.originalS3Key,
          s3KeyWithBoxes: entry.withBoxesS3Key,
          createdBy: createdBy,
          hasOriginal: !!entry.original,
          hasWithBoxes: !!entry.withBoxes
        });
        
        await setDoc(imgRef, imageData);
        console.log(`[ImageStorageService] ✅ Image document saved to ${safeId}`);
      }
      
      console.log('[ImageStorageService] ========== ALL IMAGES SAVED ==========');
    } catch (err) {
      console.error('[ImageStorageService] ❌ saveSessionWithImagesToFirestore FAILED');
      console.error('[ImageStorageService] Error:', err);
      console.error('[ImageStorageService] Session:', s);
      console.error('[ImageStorageService] Session imageKeys:', s?.imageKeys);
      console.error('[ImageStorageService] Service storedImages count:', this.storedImages.length);
      console.error('[ImageStorageService] Available storedImages:', this.storedImages.map(si => ({
        filename: si.filename,
        hasOriginal: !!si.original,
        originalLength: si.original?.length || 0
      })));
      throw err;
    }
  }

  /**
   * Prompt the user for a session name and save the session (local + Firestore).
   * Returns true if saved to Firestore, false if cancelled or failed.
   */
  async promptAndSaveSession(sessionId?: string): Promise<boolean> {
    try {
      // determine entry to save and default name
      const svc: any = this as any;
      let sid = sessionId ?? this.getLastCreatedSessionId();
      if (!sid) {
        // create a quick session from existing storedImages if none
        const defaultKeys = this.storedImages.length ? [this.storedImages[0].original] : [];
        const s = this.createSession(`Session ${new Date().toLocaleString()}`, defaultKeys);
        sid = s.id;
        if (typeof svc.setLastCreatedSession === 'function') svc.setLastCreatedSession(s.id, s.name);
      }

      // Show overlay prompt
      const name = await this.showSaveSessionPromptInline(sid);
      if (!name) return false; // user cancelled

      // update session name if present
      const s = this.getSession(sid!);
      if (s) s.name = name;
      try { this.persistSessions(); } catch {}

      // attempt Firestore save
      try {
        const userId = this.getUserIdFromLocalStorage();
        const createdBy = userId !== null ? userId : undefined;
        await this.saveSessionWithImagesToFirestore(sid!, { createdBy });
        await this.showFirestoreSavePromptInline(`✅ Session and images saved to Firestore: ${sid}`);
        return true;
      } catch (e) {
        console.warn('[ImageStorageService] Firestore save failed', e);
        alert('Session saved locally but failed to save to Firestore. See console for details.');
        return false;
      }
    } catch (err) {
      console.warn('[ImageStorageService] promptAndSaveSession failed', err);
      return false;
    }
  }

  private getUserIdFromLocalStorage(): string | null {
    try {
      const raw = localStorage.getItem('userData');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.userID ?? parsed?.uid ?? parsed?.id ?? null;
    } catch {
      return null;
    }
  }

  private showSaveSessionPromptInline(sessionId: string): Promise<string | null> {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.position = 'fixed'; overlay.style.left = '0'; overlay.style.top = '0'; overlay.style.width = '100%'; overlay.style.height = '100%'; overlay.style.background = 'rgba(0,0,0,0.45)'; overlay.style.display = 'flex'; overlay.style.alignItems = 'center'; overlay.style.justifyContent = 'center'; overlay.style.zIndex = '9999';
      const box = document.createElement('div');
      box.style.border = '1px solid transparent'; box.style.background = 'linear-gradient(#fff, #fff) padding-box, linear-gradient(to right, #ff512f, #f09819) border-box'; box.style.padding = '18px'; box.style.borderRadius = '8px'; box.style.minWidth = '300px'; box.style.boxShadow = '0 6px 30px rgba(0,0,0,0.3)';
      const title = document.createElement('div'); title.innerText = 'Save Session'; title.style.fontWeight = '700'; title.style.marginBottom = '8px';
      const input = document.createElement('input'); input.type = 'text'; input.placeholder = `Session ${new Date().toLocaleString()}`; input.style.width = '100%'; input.style.padding = '8px'; input.style.marginBottom = '12px'; input.style.border = '1px solid #ccc'; input.style.borderRadius = '4px';
      const btnRow = document.createElement('div'); btnRow.style.display = 'flex'; btnRow.style.justifyContent = 'flex-end'; btnRow.style.gap = '8px';
      const cancelBtn = document.createElement('button'); cancelBtn.innerText = 'Cancel'; cancelBtn.style.padding = '8px 10px'; cancelBtn.style.width = '110px'; cancelBtn.style.height = '40px'; cancelBtn.style.border = 'none'; cancelBtn.style.background = 'linear-gradient(90deg,#ff512f,#f09819)'; cancelBtn.style.color = '#fff'; cancelBtn.style.borderRadius = '6px'; cancelBtn.style.cursor = 'pointer';
      const saveBtn = document.createElement('button'); saveBtn.innerText = 'Save'; saveBtn.style.padding = '8px 10px'; saveBtn.style.width = '110px'; saveBtn.style.height = '40px'; saveBtn.style.border = 'none'; saveBtn.style.background = 'linear-gradient(90deg,#ff512f,#f09819)'; saveBtn.style.color = '#fff'; saveBtn.style.borderRadius = '6px'; saveBtn.style.cursor = 'pointer';
      cancelBtn.addEventListener('click', () => { try { document.body.removeChild(overlay); } catch {} resolve(null); });
      saveBtn.addEventListener('click', () => { const val = input.value && input.value.trim().length > 0 ? input.value.trim() : `Session ${new Date().toLocaleString()}`; try { document.body.removeChild(overlay); } catch {} resolve(val); });
      btnRow.appendChild(cancelBtn); btnRow.appendChild(saveBtn); box.appendChild(title); box.appendChild(input); box.appendChild(btnRow); overlay.appendChild(box); document.body.appendChild(overlay); setTimeout(() => input.focus(), 50);
    });
  }

  private showFirestoreSavePromptInline(message: string): Promise<void> {
    return new Promise((resolve) => {
      const overlay = document.createElement('div'); overlay.style.position = 'fixed'; overlay.style.left = '0'; overlay.style.top = '0'; overlay.style.width = '100%'; overlay.style.height = '100%'; overlay.style.background = 'rgba(0,0,0,0.45)'; overlay.style.display = 'flex'; overlay.style.alignItems = 'center'; overlay.style.justifyContent = 'center'; overlay.style.zIndex = '9999';
      const box = document.createElement('div'); box.style.border = '1px solid transparent'; box.style.background = 'linear-gradient(#fff, #fff) padding-box, linear-gradient(to right, #ff512f, #f09819) border-box'; box.style.padding = '18px'; box.style.borderRadius = '8px'; box.style.minWidth = '320px'; box.style.boxShadow = '0 6px 30px rgba(0,0,0,0.3)';
      const title = document.createElement('div'); title.innerText = 'Session Saved'; title.style.fontWeight = '700'; title.style.marginBottom = '8px';
      const body = document.createElement('div'); body.innerText = message; body.style.marginBottom = '12px'; body.style.wordBreak = 'break-word';
      const closeBtn = document.createElement('button'); closeBtn.innerText = 'Close'; closeBtn.style.padding = '8px 10px'; closeBtn.style.width = '110px'; closeBtn.style.height = '40px'; closeBtn.style.border = 'none'; closeBtn.style.background = 'linear-gradient(90deg,#ff512f,#f09819)'; closeBtn.style.color = '#fff'; closeBtn.style.borderRadius = '6px'; closeBtn.style.cursor = 'pointer'; closeBtn.addEventListener('click', () => { try { document.body.removeChild(overlay); } catch (e) {} resolve(); });
      box.appendChild(title); box.appendChild(body); box.appendChild(closeBtn); overlay.appendChild(box); document.body.appendChild(overlay);
    });
  }
  
    // ✅ Get all stored images (sync)
    getImages(): StoredImage[] {
      return this.storedImages;
    }

    // ✅ Get all stored images (async)
    async getAllImages(): Promise<StoredImage[]> {
      return Promise.resolve(this.storedImages.slice());
    }

    /** Generate a unique session ID (format: s-{timestamp}) */
    generateSessionId(): string {
      return `s-${Date.now()}`;
    }

    /** Session APIs */
    createSession(name: string, imageKeys: string[] = []): ImageSession {
      const session: ImageSession = {
        id: `s-${Date.now()}`,
        name,
        imageKeys: imageKeys.slice(),
        created: new Date().toISOString()
      };
      this.sessions.unshift(session);
      // remember last created session
      this.lastCreatedSessionId = session.id;
      this.lastCreatedSessionName = session.name;
      this.persistSessions();
      try { localStorage.setItem(this.LAST_SESSION_KEY, JSON.stringify({ id: session.id, name: session.name })); } catch {}
      return session;
    }

    /**
     * Register an existing session object (useful for cross-page handoff or copying sessions).
     * Adds the session to the internal sessions array if it doesn't already exist.
     * Used by chat-page when copying a session to another user.
     */
    registerSession(session: ImageSession): ImageSession {
      if (!session || !session.id) {
        throw new Error('Invalid session object for registration');
      }
      
      // Check if session already exists
      const existingIndex = this.sessions.findIndex(s => s.id === session.id);
      if (existingIndex !== -1) {
        // Update existing session
        this.sessions[existingIndex] = session;
        console.log('[ImageStorageService] Session updated:', session.id);
      } else {
        // Add new session
        this.sessions.unshift(session);
        console.log('[ImageStorageService] Session registered:', session.id);
      }
      
      // Persist and update last session tracking
      this.persistSessions();
      this.lastCreatedSessionId = session.id;
      this.lastCreatedSessionName = session.name;
      try { 
        localStorage.setItem(this.LAST_SESSION_KEY, JSON.stringify({ id: session.id, name: session.name })); 
      } catch {}
      
      return session;
    }

    /** Get the last created session's name (if any) */
    getLastCreatedSessionName(): string | null {
      return this.lastCreatedSessionName;
    }

    /** Get the last created session id (if any) */
    getLastCreatedSessionId(): string | null {
      return this.lastCreatedSessionId;
    }

    /** Manually set last created session (useful for cross-page handoff) */
    setLastCreatedSession(id: string | null, name: string | null): void {
      this.lastCreatedSessionId = id;
      this.lastCreatedSessionName = name;
      try { localStorage.setItem(this.LAST_SESSION_KEY, JSON.stringify({ id: id, name: name })); } catch {}
    }

    getSessions(): ImageSession[] {
      return this.sessions.slice();
    }

    getSession(id: string): ImageSession | undefined {
      return this.sessions.find(s => s.id === id);
    }

    addImageToSession(sessionId: string, imageKey: string): boolean {
      const s = this.sessions.find(x => x.id === sessionId);
      if (!s) return false;
      if (!s.imageKeys.includes(imageKey)) s.imageKeys.push(imageKey);
      // persist session changes so other pages/read-ons reload see updates
      try { this.persistSessions(); } catch (e) { /* ignore persistence failures */ }
      return true;
    }

    /**
     * Create a quick test session populated with either existing stored images
     * or synthetic placeholder keys. Useful for verifying session-page UI.
     * - name: optional session name
     * - includeStored: if true, add up to `count` actual stored image keys
     * - count: maximum number of stored images to include
     */
    createTestSession(name = 'Test Session', includeStored = true, count = 6): ImageSession {
      const keys: string[] = [];
      if (includeStored && this.storedImages && this.storedImages.length > 0) {
        for (let i = 0; i < Math.min(count, this.storedImages.length); i++) {
          keys.push(this.storedImages[i].original);
        }
      } else {
        // generate placeholder keys (these won't correspond to real images unless later added)
        for (let i = 0; i < count; i++) {
          keys.push(`placeholder-${Date.now()}-${i}`);
        }
      }
      const s = this.createSession(name, keys);
      return s;
    }

    removeSession(id: string): boolean {
      const idx = this.sessions.findIndex(s => s.id === id);
      if (idx === -1) return false;
      this.sessions.splice(idx, 1);
      this.persistSessions();
      return true;
    }

    private persistSessions(): void {
      try {
        localStorage.setItem(this.SESSIONS_KEY, JSON.stringify(this.sessions));
      } catch (e) {
        console.warn('[ImageStorageService] persistSessions failed', e);
      }
    }
  
    // ✅ Clear all stored data
    clearImages(): void {
      this.storedImages = [];
      this.entryMap.clear();
    }
  
    // ✅ Update or insert an entry by image key (e.g. base64)
    setEntryForImage(imageKey: string, entryData: StoredImage): void {
      const index = this.storedImages.findIndex(img => img.original === imageKey);
      if (index !== -1) {
        this.storedImages[index] = entryData;
      } else {
        this.storedImages.unshift(entryData);
      }
      this.entryMap.set(imageKey, entryData);
    }
  
    // ✅ Get an entry by its image key
    getEntryForImage(imageKey: string): StoredImage | undefined {
      return this.entryMap.get(imageKey);
    }

    // ✅ Get an entry by filename (useful for session copying where imageKeys contain filenames)
    getEntryByFilename(filename: string): StoredImage | undefined {
      return this.storedImages.find(img => img.filename === filename);
    }
  
    // ✅ Get all image entries as object
    getAllEntries(): { [key: string]: StoredImage } {
      const all: { [key: string]: StoredImage } = {};
      this.entryMap.forEach((value, key) => {
        all[key] = value;
      });
      return all;
    }

    /**
     * Remove a stored image by its original string (base64 or path).
     * Returns true if an item was removed, false otherwise.
     */
    async removeImageByOriginal(original: string): Promise<boolean> {
      const idx = this.storedImages.findIndex(img => img.original === original || img.withBoxes === original);
      if (idx !== -1) {
        const img = this.storedImages[idx];
        this.storedImages.splice(idx, 1);
        // remove from map as well (use original key)
        try { this.entryMap.delete(img.original); } catch (e) {}
        // clear current selection if it was the removed image
        if (this._currentImage && this._currentImage.original === img.original) {
          this._currentImage = null;
          this._currentImage$.next(null);
        }
        return Promise.resolve(true);
      }
      // also attempt to remove by searching the map key directly
      if (this.entryMap.has(original)) {
        const removed = this.entryMap.get(original)!;
        this.entryMap.delete(original);
        const i = this.storedImages.findIndex(x => x.original === original);
        if (i !== -1) this.storedImages.splice(i, 1);
        return Promise.resolve(true);
      }
      return Promise.resolve(false);
    }

    /**
     * Canonical delete API used by application pages.
     * Delegates to removeImageByOriginal for backward compatibility.
     */
    async deleteImage(original: string): Promise<boolean> {
      try {
        return await this.removeImageByOriginal(original);
      } catch (e) {
        console.warn('[ImageStorageService] deleteImage failed', e);
        return Promise.resolve(false);
      }
    }

    /** Remove a stored image by filename if available */
    async removeImageByFilename(filename: string): Promise<boolean> {
      const idx = this.storedImages.findIndex(img => img.filename === filename);
      if (idx !== -1) {
        const img = this.storedImages[idx];
        this.storedImages.splice(idx, 1);
        try { this.entryMap.delete(img.original); } catch (e) {}
        if (this._currentImage && this._currentImage.original === img.original) {
          this._currentImage = null;
          this._currentImage$.next(null);
        }
        return Promise.resolve(true);
      }
      return Promise.resolve(false);
    }

    /** Remove a stored image by its index in the array */
    removeImageByIndex(index: number): boolean {
      if (index >= 0 && index < this.storedImages.length) {
        const img = this.storedImages[index];
        this.storedImages.splice(index, 1);
        try { this.entryMap.delete(img.original); } catch (e) {}
        if (this._currentImage && this._currentImage.original === img.original) {
          this._currentImage = null;
          this._currentImage$.next(null);
        }
        return true;
      }
      return false;
    }

    /** Add an array of StoredImage objects (bulk insert). */
    async addImagesArray(images: StoredImage[]): Promise<void> {
      for (const img of images) {
        this.storedImages.unshift(img);
        this.entryMap.set(img.original, img);
      }
      return Promise.resolve();
    }

    /** Create a StoredImage object from minimal data (helper) */
    createStoredImage(data: Partial<StoredImage>): StoredImage {
      const now = new Date().toISOString();
      const si: StoredImage = {
        original: data.original ?? '',
        withBoxes: data.withBoxes ?? (data.original ?? ''),
        boxes: data.boxes ?? [],
        faceDetected: !!data.faceDetected,
        faceData: data.faceData ?? [],
        timestamp: data.timestamp ?? now,
        detectionMessage: data.detectionMessage ?? '',
        filename: data.filename,
        statusMessage: data.statusMessage,
        prediction: data.prediction
      };
      return si;
    }

    /** Convenience: create a StoredImage and add it to storage */
    async createAndAdd(data: Partial<StoredImage>): Promise<StoredImage> {
      const si = this.createStoredImage(data);
      await this.addImage(si);
      return si;
    }

    /**
     * Select a StoredImage by its original string and expose it as the current session image.
     * Returns the selected StoredImage or undefined if not found.
     */
    selectImageByOriginal(original: string): StoredImage | undefined {
      const found = this.storedImages.find(img => img.original === original || img.withBoxes === original);
      this._currentImage = found ?? null;
      this._currentImage$.next(this._currentImage);
      return found;
    }

    /** Async version of selectImageByOriginal */
    async selectImageByOriginalAsync(original: string): Promise<StoredImage | undefined> {
      const found = this.storedImages.find(img => img.original === original || img.withBoxes === original);
      this._currentImage = found ?? null;
      this._currentImage$.next(this._currentImage);
      return Promise.resolve(found);
    }

    /** Get the currently selected StoredImage (may be null) */
    getCurrentImage(): StoredImage | null {
      return this._currentImage;
    }

    /** Observable to subscribe to current selected image changes */
    getCurrentImage$(): Observable<StoredImage | null> {
      return this._currentImage$.asObservable();
    }

    /** Clear the current selected image for the session */
    clearCurrentImage(): void {
      this._currentImage = null;
      this._currentImage$.next(null);
    }

    /** Print all stored images to the console for debugging */
    printAllStoredImages(): void {
      try {
        const rows = this.storedImages.map(img => ({ filename: img.filename ?? '', original: img.original, timestamp: img.timestamp, prediction: img.prediction, statusMessage: img.statusMessage }));
        console.table(rows);
        console.group('[ImageStorage] storedImages detail');
        rows.forEach(r => console.log(r.filename || '(unnamed)', r));
        console.groupEnd();
      } catch (err) {
        console.warn('[ImageStorage] printAllStoredImages failed', err);
      }
    }

}

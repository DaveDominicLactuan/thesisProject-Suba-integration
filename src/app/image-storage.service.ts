import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';


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

    constructor() {
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
  
    // ✅ Get all stored images (sync)
    getImages(): StoredImage[] {
      return this.storedImages;
    }

    // ✅ Get all stored images (async)
    async getAllImages(): Promise<StoredImage[]> {
      return Promise.resolve(this.storedImages.slice());
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

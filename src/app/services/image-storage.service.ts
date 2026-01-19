import { Injectable } from '@angular/core';
import { Storage } from '@ionic/storage-angular';
import { BehaviorSubject, Observable } from 'rxjs';

export interface StoredImage {
  original: string; // Base64 image
  withBoxes?: string;
  boxes?: any[];
  faceDetected?: boolean;
  faceData?: any[];
  timestamp: string;
  filename: string;
  prediction?: { type: string; shape: string; severity: string };
  // New optional helpers for status/testing
  hasPrediction?: boolean;
  statusMessage?: string;
  detectionMessage?: string;
}

export interface ImageSession {
  id: string;
  name: string;
  imageKeys: string[];
  created: string;
  // cumulative number of bounding boxes across all images in this session
  totalBoundingBoxes?: number;
}

@Injectable({
  providedIn: 'root'
})
export class ImageStorageService {
  private _storage: Storage | null = null;
  private images: StoredImage[] = [];
  private _currentImage: StoredImage | null = null;
  private _currentImage$ = new BehaviorSubject<StoredImage | null>(null);
  private sessions: ImageSession[] = [];
  private readonly STORAGE_KEY = 'stored_images';
  private readonly SESSIONS_KEY = 'stored_image_sessions';

  constructor(private storage: Storage) {
    this.init();
  }

  /** Initialize Ionic Storage and load existing images */
  private async init() {
    this._storage = await this.storage.create();
    const saved = await this._storage.get(this.STORAGE_KEY);
    this.images = saved || [];
    // load persisted sessions if present
    try {
      const savedSessions = await this._storage.get(this.SESSIONS_KEY);
      this.sessions = Array.isArray(savedSessions) ? savedSessions : [];
    } catch (e) {
      this.sessions = [];
    }
    console.log('📂 Loaded images from storage:', this.images.length);
  }

  /** Add a new image and persist it, handling duplicates */
  async addImage(image: StoredImage) {
    // Check for duplicates based on the original image data
    const duplicate = this.images.find(
      img => img.original === image.original && img.timestamp === image.timestamp
    );

    if (duplicate) {
      console.warn('Duplicate image detected. Skipping addition:', image.filename);
      return; // Skip adding duplicate image
    }

    // Add the image if it's unique
    this.images.unshift(image);
    await this._storage?.set(this.STORAGE_KEY, this.images);

    // Update map selection if this was selected externally
    if (this._currentImage && this._currentImage.original === image.original) {
      this._currentImage = image;
      this._currentImage$.next(this._currentImage);
    }

    console.log(`📤 Image saved. Total stored images: ${this.images.length}`);
  }

  /** Persist sessions to storage */
  private async persistSessions(): Promise<void> {
    try {
      await this._storage?.set(this.SESSIONS_KEY, this.sessions);
    } catch (e) {
      console.warn('Failed to persist sessions', e);
    }
  }

  /** Return a copy of all images */
  getAllImages(): StoredImage[] {
    return [...this.images];
  }

  /** Async variant for compatibility */
  async getAllImagesAsync(): Promise<StoredImage[]> {
    return Promise.resolve(this.getAllImages());
  }

  /** Convenience: update or insert an entry by its original key */
  setEntryForImage(imageKey: string, entry: StoredImage) {
    const idx = this.images.findIndex(i => i.original === imageKey);
    if (idx !== -1) this.images[idx] = entry;
    else this.images.unshift(entry);
    this._storage?.set(this.STORAGE_KEY, this.images);
    // update current image subject if needed
    if (this._currentImage && this._currentImage.original === imageKey) {
      this._currentImage = entry;
      this._currentImage$.next(this._currentImage);
    }
  }

  /** Create a StoredImage and add it */
  async createAndAdd(data: Partial<StoredImage>): Promise<StoredImage> {
    const now = new Date().toISOString();
    const si: StoredImage = {
      original: data.original ?? '',
      timestamp: data.timestamp ?? now,
      filename: data.filename ?? '',
      prediction: data.prediction,
      hasPrediction: !!data.prediction,
      statusMessage: data.statusMessage
    };
    await this.addImage(si);
    return si;
  }

  /** Select a StoredImage by its original key and expose via observable */
  selectImageByOriginal(original: string): StoredImage | undefined {
    const found = this.images.find(i => i.original === original);
    this._currentImage = found ?? null;
    this._currentImage$.next(this._currentImage);
    return found;
  }

  getCurrentImage(): StoredImage | null {
    return this._currentImage;
  }

  getCurrentImage$(): Observable<StoredImage | null> {
    return this._currentImage$.asObservable();
  }

  /** Sessions */
  createSession(name: string, imageKeys: string[] = []): ImageSession {
    // compute total bounding boxes for provided keys
    let totalBoxes = 0;
    for (const k of imageKeys) {
      const img = this.images.find(i => i.original === k || (i.withBoxes && i.withBoxes === k));
      if (img && Array.isArray((img as any).boxes)) totalBoxes += (img as any).boxes.length;
    }
    const s: ImageSession = { id: `s-${Date.now()}`, name, imageKeys: [...imageKeys], created: new Date().toISOString(), totalBoundingBoxes: totalBoxes };
    this.sessions.unshift(s);
    // persist sessions
    this.persistSessions();
    return s;
  }

  getSessions(): ImageSession[] { return [...this.sessions]; }

  getSession(id: string): ImageSession | undefined { return this.sessions.find(s => s.id === id); }

  /** Get the number of images in a session */
  getSessionImageCount(sessionId: string): number {
    const s = this.sessions.find(x => x.id === sessionId);
    return s ? s.imageKeys.length : 0;
  }

  addImageToSession(sessionId: string, imageKey: string): boolean {
    const s = this.sessions.find(x => x.id === sessionId);
    if (!s) return false;
    if (!s.imageKeys.includes(imageKey)) s.imageKeys.push(imageKey);
    // if the image entry exists and has boxes, add to session total
    const img = this.images.find(i => i.original === imageKey || (i.withBoxes && i.withBoxes === imageKey));
    if (img && Array.isArray((img as any).boxes)) {
      s.totalBoundingBoxes = (s.totalBoundingBoxes || 0) + (img as any).boxes.length;
    }
    this.persistSessions();
    return true;
  }

  removeSession(id: string): boolean {
    const idx = this.sessions.findIndex(s => s.id === id);
    if (idx === -1) return false;
    this.sessions.splice(idx, 1);
    this.persistSessions();
    return true;
  }

  /** Update a session's name and persist changes */
  updateSessionName(sessionId: string, newName: string): boolean {
    const s = this.sessions.find(x => x.id === sessionId);
    if (!s) return false;
    s.name = newName;
    this.persistSessions();
    return true;
  }

  /** Clear all stored images */
  async clear() {
    this.images = [];
    await this._storage?.remove(this.STORAGE_KEY);
  }

  /** Remove a single image by its original data URL or identifier
   * Returns true if an image was removed, false otherwise
   */
  async removeImageByOriginal(original: string): Promise<boolean> {
    const before = this.images.length;
    // find the image being removed so we can adjust session counts
    const removedImage = this.images.find(img => img.original === original || (img.withBoxes && img.withBoxes === original));
    const removedBoxes = removedImage && Array.isArray((removedImage as any).boxes) ? (removedImage as any).boxes.length : 0;
    this.images = this.images.filter(img => img.original !== original);
    const after = this.images.length;
    if (after < before) {
      await this._storage?.set(this.STORAGE_KEY, this.images);
      // Also remove this image key from any sessions that reference it
      let sessionsChanged = false;
      for (const s of this.sessions) {
        const prevLen = s.imageKeys.length;
        const hadKey = s.imageKeys.includes(original);
        s.imageKeys = s.imageKeys.filter(k => k !== original);
        if (s.imageKeys.length !== prevLen) sessionsChanged = true;
        // subtract removed boxes from session total if applicable
        if (hadKey && removedBoxes > 0) {
          s.totalBoundingBoxes = Math.max(0, (s.totalBoundingBoxes || 0) - removedBoxes);
        }
      }
      if (sessionsChanged) await this.persistSessions();
      console.log(`🗑️ Removed image. Remaining images: ${this.images.length}`);
      return true;
    }
    return false;
  }

  /**
   * Canonical delete API used by application pages.
   * Delegates to removeImageByOriginal for backward compatibility.
   * Returns true if removal succeeded, false otherwise.
   */
  async deleteImage(original: string): Promise<boolean> {
    try {
      return await this.removeImageByOriginal(original);
    } catch (e) {
      console.warn('[ImageStorageService] deleteImage failed', e);
      return false;
    }
  }

  /** Return a StoredImage entry by its image key (original or withBoxes) */
  getEntryForImage(imageKey: string): StoredImage | undefined {
    return this.images.find(i => i.original === imageKey || (i.withBoxes && i.withBoxes === imageKey));
  }

  /** Remove a session only if it has no images; returns true when removed */
  removeSessionIfEmpty(sessionId: string): boolean {
    const idx = this.sessions.findIndex(s => s.id === sessionId);
    if (idx === -1) return false;
    const session = this.sessions[idx];
    if (!session.imageKeys || session.imageKeys.length === 0) {
      this.sessions.splice(idx, 1);
      this.persistSessions();
      return true;
    }
    return false;
  }
  
}

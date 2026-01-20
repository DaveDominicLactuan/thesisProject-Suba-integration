import { Injectable } from '@angular/core';
import { Storage } from '@ionic/storage-angular';
import { BehaviorSubject, Observable } from 'rxjs';
import { BoundingBox, BoxPrediction, StoredImage, ImageSession } from '../types';

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
    this.images = Array.isArray(saved) ? saved : [];

    try {
      const savedSessions = await this._storage.get(this.SESSIONS_KEY);
      this.sessions = Array.isArray(savedSessions) ? savedSessions : [];
    } catch {
      this.sessions = [];
    }

    console.log('📂 Loaded images from storage:', this.images.length);
  }

  /** Add or update an image in storage */
  async addImage(image: StoredImage) {
    // Map prediction to proper type if present
    if (image.prediction && !('type' in image.prediction)) {
      const p: any = image.prediction;
      image.prediction = {
        type: p.type || '',
        shape: p.shape || '',
        severity: p.severity || ''
      };
    }

    // Prevent duplicate originals with identical boxes
    const duplicate = this.images.find(
      img => img.original === image.original && img.withBoxes === image.withBoxes
    );
    if (duplicate) {
      console.warn('Duplicate image detected. Skipping addition:', image.filename);
      return;
    }

    this.images.unshift(image);
    await this._storage?.set(this.STORAGE_KEY, this.images);

    // Update session total bounding boxes if applicable
    for (const session of this.sessions) {
      if (session.imageKeys.includes(image.original) || (image.withBoxes && session.imageKeys.includes(image.withBoxes))) {
        if (Array.isArray(image.boxes)) {
          session.totalBoundingBoxes = (session.totalBoundingBoxes || 0) + image.boxes.length;
        }
      }
    }
    await this.persistSessions();

    // Update current image observable
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

  /** Async variant */
  async getAllImagesAsync(): Promise<StoredImage[]> {
    return Promise.resolve(this.getAllImages());
  }

  /** Update or insert an entry by its original key */
  setEntryForImage(imageKey: string, entry: StoredImage) {
    const idx = this.images.findIndex(i => i.original === imageKey);
    if (idx !== -1) this.images[idx] = entry;
    else this.images.unshift(entry);
    this._storage?.set(this.STORAGE_KEY, this.images);

    if (this._currentImage && this._currentImage.original === imageKey) {
      this._currentImage = entry;
      this._currentImage$.next(this._currentImage);
    }
  }

  /** Create a StoredImage from partial data and add it */
  async createAndAdd(data: Partial<StoredImage>): Promise<StoredImage> {
    const now = new Date().toISOString();
    const si: StoredImage = {
      original: data.original ?? '',
      timestamp: data.timestamp ?? now,
      filename: data.filename ?? '',
      prediction: data.prediction
        ? { type: data.prediction.type || '', shape: data.prediction.shape || '', severity: data.prediction.severity || '' }
        : undefined,
      hasPrediction: !!data.prediction,
      statusMessage: data.statusMessage,
      boxes: data.boxes
    };
    await this.addImage(si);
    return si;
  }

  /** Select an image by its original data URL */
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

  /** Sessions management */
  createSession(name: string, imageKeys: string[] = []): ImageSession {
    let totalBoxes = 0;
    for (const key of imageKeys) {
      const img = this.images.find(i => i.original === key || (i.withBoxes && i.withBoxes === key));
      if (img && Array.isArray(img.boxes)) totalBoxes += img.boxes.length;
    }
    const s: ImageSession = { id: `s-${Date.now()}`, name, imageKeys: [...imageKeys], created: new Date().toISOString(), totalBoundingBoxes: totalBoxes };
    this.sessions.unshift(s);
    this.persistSessions();
    return s;
  }

  getSessions(): ImageSession[] { return [...this.sessions]; }
  getSession(id: string): ImageSession | undefined { return this.sessions.find(s => s.id === id); }
  getSessionImageCount(sessionId: string): number {
    const s = this.sessions.find(x => x.id === sessionId);
    return s ? s.imageKeys.length : 0;
  }

  addImageToSession(sessionId: string, imageKey: string): boolean {
    const s = this.sessions.find(x => x.id === sessionId);
    if (!s) return false;
    if (!s.imageKeys.includes(imageKey)) s.imageKeys.push(imageKey);

    const img = this.images.find(i => i.original === imageKey || (i.withBoxes && i.withBoxes === imageKey));
    if (img && Array.isArray(img.boxes)) {
      s.totalBoundingBoxes = (s.totalBoundingBoxes || 0) + img.boxes.length;
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

  updateSessionName(sessionId: string, newName: string): boolean {
    const s = this.sessions.find(x => x.id === sessionId);
    if (!s) return false;
    s.name = newName;
    this.persistSessions();
    return true;
  }

  async clear() {
    this.images = [];
    await this._storage?.remove(this.STORAGE_KEY);
  }

  async removeImageByOriginal(original: string): Promise<boolean> {
    const removedImage = this.images.find(img => img.original === original || (img.withBoxes && img.withBoxes === original));
    const removedBoxes = removedImage?.boxes?.length ?? 0;
    const before = this.images.length;

    this.images = this.images.filter(img => img.original !== original && img.withBoxes !== original);
    const after = this.images.length;

    if (after < before) {
      await this._storage?.set(this.STORAGE_KEY, this.images);

      let sessionsChanged = false;
      for (const s of this.sessions) {
        const hadKey = s.imageKeys.includes(original);
        s.imageKeys = s.imageKeys.filter(k => k !== original);
        if (s.imageKeys.length !== s.imageKeys.length) sessionsChanged = true;

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

  async deleteImage(original: string): Promise<boolean> {
    try {
      return await this.removeImageByOriginal(original);
    } catch (e) {
      console.warn('[ImageStorageService] deleteImage failed', e);
      return false;
    }
  }

  getEntryForImage(imageKey: string): StoredImage | undefined {
    return this.images.find(i => i.original === imageKey || (i.withBoxes && i.withBoxes === imageKey));
  }

  removeSessionIfEmpty(sessionId: string): boolean {
    const idx = this.sessions.findIndex(s => s.id === sessionId);
    if (idx === -1) return false;
    const session = this.sessions[idx];
    if (!session.imageKeys?.length) {
      this.sessions.splice(idx, 1);
      this.persistSessions();
      return true;
    }
    return false;
  }
}

export type { StoredImage, ImageSession };
import { Injectable } from '@angular/core';
import { Storage } from '@ionic/storage-angular';

export interface StoredImage {
  original: string; // Base64 image
  timestamp: string;
  filename: string;
  prediction?: { type: string; shape: string; severity: string };
  // New optional helpers for status/testing
  hasPrediction?: boolean;
  statusMessage?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ImageStorageService {
  private _storage: Storage | null = null;
  private images: StoredImage[] = [];
  private readonly STORAGE_KEY = 'stored_images';

  constructor(private storage: Storage) {
    this.init();
  }

  /** Initialize Ionic Storage and load existing images */
  private async init() {
    this._storage = await this.storage.create();
    const saved = await this._storage.get(this.STORAGE_KEY);
    this.images = saved || [];
    console.log('📂 Loaded images from storage:', this.images.length);
  }

  /** Add a new image and persist it */
  async addImage(image: StoredImage) {
    this.images.unshift(image);
    await this._storage?.set(this.STORAGE_KEY, this.images);
    console.log(`📤 Image saved. Total stored images: ${this.images.length}`);
  }

  /** Return a copy of all images */
  getAllImages(): StoredImage[] {
    return [...this.images];
  }

  /** Clear all stored images */
  async clear() {
    this.images = [];
    await this._storage?.remove(this.STORAGE_KEY);
  }
}

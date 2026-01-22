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
      //The set method of the _storage object is used to save the sessions array.
      //The SESSIONS_KEY constant is used as the key under which the sessions array is stored.
      await this._storage?.set(this.SESSIONS_KEY, this.sessions);
    } catch (e) {
      console.warn('Failed to persist sessions', e);
    }
  }

  /** Return a copy of all images */
  getAllImages(): StoredImage[] {
    //returns all stored images by creating and returning a new array that c
    // contains all the elements of the this.images array.
    return [...this.images];
  }

  /** Async variant for compatibility */
  async getAllImagesAsync(): Promise<StoredImage[]> {
    //async version that returns a Promise which resolves to an array of StoredImage objects.
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
    //The current date and time are retrieved using new Date() and converted to an ISO string format 
    // using .toISOString().
    //This timestamp is used as the default value for the timestamp property 
    //if it is not provided in the data parameter.
    const now = new Date().toISOString();
    // creates a new StoredImage object (si) is created using the data parameter and default values:
    const si: StoredImage = {
      original: data.original ?? '',
      timestamp: data.timestamp ?? now,
      filename: data.filename ?? '',
      prediction: data.prediction,
      hasPrediction: !!data.prediction,
      statusMessage: data.statusMessage
    };
    //The newly created StoredImage object (si) is passed to the 
    // addImage method, which handles adding the image to the images array and persisting it to storage.
    await this.addImage(si); 
    //The function returns the newly created StoredImage object (si) to the caller.
    return si;
  }

  /** Select a StoredImage by its original key and expose via observable */
  selectImageByOriginal(original: string): StoredImage | undefined {
    //The find method is used to search the images array for an image 
    //whose original property matches the provided original key.
    const found = this.images.find(i => i.original === original);
    //The _currentImage property is updated to the found image if it exists. If 
    //found is undefined, _currentImage is set to null using the nullish coalescing operator (??).
    this._currentImage = found ?? null;
    //The BehaviorSubject _currentImage$ is updated with the new value of _currentImage.
    //This tells any subscribers (e.g., components or services) that the current image has changed.
    this._currentImage$.next(this._currentImage);
    //The function returns the found image to the caller. If no image was found, it returns undefined.
    return found;
  }

  getCurrentImage(): StoredImage | null {
    //The function provides access to the _currentImage property, 
    //which holds the currently selected image in the service.
    return this._currentImage;
  }

  getCurrentImage$(): Observable<StoredImage | null> {
    //The function provides a way to observe changes to the currently selected image (_currentImage) in real-time.
    //This is useful for components or services that need to react to changes in the selected image
    return this._currentImage$.asObservable();
  }

  /** Sessions */
  createSession(name: string, imageKeys: string[] = []): ImageSession {
    // compute total bounding boxes for provided keys
    let totalBoxes = 0;
    for (const k of imageKeys) {
      const img = this.images.find(i => i.original === k || (i.withBoxes && i.withBoxes === k));
      //If an image is found and it has a boxes property (an array), 
      //the length of the boxes array is added to totalBoxes.
      if (img && Array.isArray((img as any).boxes)) totalBoxes += (img as any).boxes.length;
    }
    const s: ImageSession = { id: `s-${Date.now()}`, name, imageKeys: [...imageKeys], created: new Date().toISOString(), totalBoundingBoxes: totalBoxes };
    //The new session is added to the beginning of the sessions array using unshift.
    this.sessions.unshift(s);
    // persist sessions
    this.persistSessions();
    return s;
  }
  
  //returns the sessions array by creating and returning a new array 
  // that contains all the elements of the this.sessions array.
  getSessions(): ImageSession[] { return [...this.sessions]; }

  // Get a session by its ID 
  getSession(id: string): ImageSession | undefined { return this.sessions.find(s => s.id === id); }

  /** Get the number of images in a session */
  getSessionImageCount(sessionId: string): number {
    //he find method is used to search the sessions array for a 
    // session whose id matches the provided sessionId.
    const s = this.sessions.find(x => x.id === sessionId);
   //If the session (s) exists, the function returns the length of the 
   // imageKeys array, which represents the number of images in the session.
    return s ? s.imageKeys.length : 0;
  }

  addImageToSession(sessionId: string, imageKey: string): boolean {
    //finds the session based on the provided sessionId.
    const s = this.sessions.find(x => x.id === sessionId);
    // If no session is found, the function returns false to indicate failure.
    if (!s) return false;
    //adds the provided imageKey to the session's imageKeys 
    //array if it is not already present.
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
    //used to search the sessions array for the session with the matching id.
    const idx = this.sessions.findIndex(s => s.id === id);
    //If findIndex returns -1, it means no session with the given id exists in the 
    // sessions array.
    //The function immediately returns false to indicate that the removal was unsuccessful.
    if (idx === -1) return false;
    //The splice method is used to remove the session at the index idx
    this.sessions.splice(idx, 1);
    //After removing the session, the persistSessions method 
    //is called to save the updated sessions array to storage
    this.persistSessions();
    return true;
  }

  /** Update a session's name and persist changes */
  updateSessionName(sessionId: string, newName: string): boolean {
    //finds the session based on the provided sessionId.
    const s = this.sessions.find(x => x.id === sessionId);
    //  If no session is found, the function returns false to indicate failure.
    if (!s) return false;
    // updates the name property of the found 
    //session to the provided newName.
    s.name = newName;
    // persists the updated sessions array to storage.
    this.persistSessions();
    // returns true to indicate that the update was successful.
    return true;
  }

  /** Clear all stored images */
  async clear() {
    //the images array is cleared by 
    //assigning an empty array to this.images.
    this.images = [];
    //can you give me a code explanation of what the 
    //function does and its different parts of its code as well. dont change the code
    await this._storage?.remove(this.STORAGE_KEY);
  }

  /** Remove a single image by its original data URL or identifier
   * Returns true if an image was removed, false otherwise
   */
  async removeImageByOriginal(original: string): Promise<boolean> {
    //The before variable stores the initial count of images in the images array. 
    //This is used later to determine if an image was actually removed.
    const before = this.images.length;
    // find the image being removed so we can adjust session counts
    const removedImage = this.images.find(img => img.original === original || (img.withBoxes && img.withBoxes === original));
    const removedBoxes = removedImage && Array.isArray((removedImage as any).boxes) ? (removedImage as any).boxes.length : 0;
    //The filter method creates a new images array that excludes the 
    //image with the matching original key
    this.images = this.images.filter(img => img.original !== original);
    //The after variable stores the new count of images in the images array.
    const after = this.images.length;
    //If the count of images (after) is less than the initial count 
    //(before), it means an image was successfully removed.
    if (after < before) {
      //The updated images array is saved to persistent storage using the STORAGE_KEY.
      await this._storage?.set(this.STORAGE_KEY, this.images);
      // Also remove this image key from any sessions that reference it
      let sessionsChanged = false;
      for (const s of this.sessions) {
        const prevLen = s.imageKeys.length;
        const hadKey = s.imageKeys.includes(original);
        s.imageKeys = s.imageKeys.filter(k => k !== original);
        //If the session's imageKeys array changes, the sessionsChanged flag is set to true.
        if (s.imageKeys.length !== prevLen) sessionsChanged = true;
        // subtract removed boxes from session total if applicable
        if (hadKey && removedBoxes > 0) {
          s.totalBoundingBoxes = Math.max(0, (s.totalBoundingBoxes || 0) - removedBoxes);
        }
      }
      //If any session was modified, the updated sessions array is saved to persistent storage.
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
    //used to search the sessions array for the session with the matching id.
    const idx = this.sessions.findIndex(s => s.id === sessionId);
    //If findIndex returns -1, it means no session with the given id exists in the 
    // sessions array. The function immediately returns false to indicate that 
    //no removal occurred.
    if (idx === -1) return false;
    //The session object is retrieved from the sessions array using the found index (idx).
    const session = this.sessions[idx];
    //If the session's imageKeys array is either undefined or has a length of 0
    if (!session.imageKeys || session.imageKeys.length === 0) {
      //The splice method is used to remove the session at the index idx
      this.sessions.splice(idx, 1);
      this.persistSessions();
      return true;
    }
    return false;
  }
  
}

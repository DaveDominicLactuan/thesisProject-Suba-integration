import { Injectable } from '@angular/core';
import { Storage } from '@ionic/storage-angular';
import { BehaviorSubject, Observable } from 'rxjs';
import { Auth } from '@angular/fire/auth';
import { onAuthStateChanged } from 'firebase/auth';
import { Firestore, collection, doc, setDoc, deleteDoc, getDocs, query, where, writeBatch } from '@angular/fire/firestore';

//image object in the session
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
  sessionId?: string; // optional link to a session
  userId?: string; // optional link to a user (if multi-user support is added)
  fileImageName?: string; // optional original filename if available
  storagePath?: string; // Cloud Storage object path for original image
  storageUrl?: string; // Cloud Storage download URL for original image
  withBoxesStoragePath?: string; // Cloud Storage object path for withBoxes image
  withBoxesStorageUrl?: string; // Cloud Storage download URL for withBoxes image
}

//session
export interface ImageSession {
  id: string;
  name: string;
  imageKeys: string[];
  created: string;
  // cumulative number of bounding boxes across all images in this session
  totalBoundingBoxes?: number;
  userId?: string; // optional link to a user (if multi-user support is added)
  sessionId?: string; // optional link to a session (for easier querying if needed)
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
  private readonly FIRESTORE_IMAGES_COLLECTION = 'images';
  private readonly FIRESTORE_SESSIONS_COLLECTION = 'sessionsImages';
  private readonly FIRESTORE_DOC_MAX_BYTES = 900_000;
  // Counter map to track image number per session
  private sessionImageCounters: Map<string, number> = new Map();

  constructor(private storage: Storage, private firestore: Firestore, private auth: Auth) {
    this.init();
  }

  private getCurrentUserId(): string | null {
    return this.auth.currentUser?.uid ?? null;
  }

  private async waitForAuthUserId(timeoutMs: number = 8000): Promise<string | null> {
    const existing = this.getCurrentUserId();
    if (existing) return existing;

    return new Promise(resolve => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve(null);
      }, timeoutMs);

      const unsubscribe = onAuthStateChanged(this.auth, user => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { unsubscribe(); } catch (e) {}
        resolve(user?.uid ?? null);
      });
    });
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
    // Initialize session counters from existing images
    this.initializeSessionCounters();
    console.log('📂 Loaded images from storage:', this.images.length);
  }

  /** Initialize session image counters from existing images */
  private initializeSessionCounters() {
    this.sessionImageCounters.clear();
    // Count images per session from existing data
    this.sessions.forEach(session => {
      const count = session.imageKeys ? session.imageKeys.length : 0;
      this.sessionImageCounters.set(session.id, count);
    });
  }

  /**
   * Generate a unique filename based on date/time and session counter.
   * Format: img_YYYYMMDD_HHMMSS_N.jpg where N is the image number in the session
   * @param sessionId Optional session ID to track counter per session
   * @param timestamp Optional timestamp (defaults to now)
   * @returns Generated filename string
   */
  generateImageFilename(sessionId?: string, timestamp?: string): string {
    const date = timestamp ? new Date(timestamp) : new Date();
    
    // Format: YYYYMMDD
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateStr = `${year}${month}${day}`;
    
    // Format: HHMMSS
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const timeStr = `${hours}${minutes}${seconds}`;
    
    // Get counter for this session (or use global counter if no session)
    const key = sessionId || 'global';
    const currentCount = this.sessionImageCounters.get(key) || 0;
    const nextCount = currentCount + 1;
    this.sessionImageCounters.set(key, nextCount);
    
    return `img_${dateStr}_${timeStr}_${nextCount}.jpg`;
  }

  /** Get the number of images with predictions in a session (or globally if no sessionId). */
  getSessionCrackCount(sessionId?: string): number {
    const hasCrack = (img: StoredImage | undefined) => !!(img && (img.hasPrediction || img.prediction));

    if (!sessionId) {
      return this.images.filter(i => hasCrack(i)).length;
    }

    const session = this.sessions.find(s => s.id === sessionId);
    if (!session || !Array.isArray(session.imageKeys)) return 0;

    let count = 0;
    for (const key of session.imageKeys) {
      const img = this.images.find(i => i.filename === key || i.original === key || (i.withBoxes && i.withBoxes === key));
      if (hasCrack(img)) count += 1;
    }
    return count;
  }

  /**
   * Generate a session-scoped filename in the form:
   * img{N}crack{M}MMDDYYYYHHMM.jpg (crack part included only when hasCrack is true)
   */
  generateSessionFilename(options: { sessionId?: string; hasCrack?: boolean; timestamp?: string } = {}): string {
    const date = options.timestamp ? new Date(options.timestamp) : new Date();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = String(date.getFullYear());
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    const dateStr = `${month}${day}${year}`;
    const timeStr = `${hours}${minutes}`;

    const sessionId = options.sessionId;
    const imgIndex = sessionId ? (this.getSessionImageCount(sessionId) + 1) : (this.images.length + 1);
    const crackPart = options.hasCrack ? `crack${this.getSessionCrackCount(sessionId) + 1}` : '';

    return `img${imgIndex}${crackPart}${dateStr}${timeStr}.jpg`;
  }

  /**
   * Get the next counter value for a session without incrementing it.
   * Useful for preview/planning purposes.
   */
  getNextImageNumber(sessionId?: string): number {
    const key = sessionId || 'global';
    const currentCount = this.sessionImageCounters.get(key) || 0;
    return currentCount + 1;
  }

  /**
   * Reset the counter for a session (e.g., when session is deleted).
   */
  private resetSessionCounter(sessionId: string) {
    this.sessionImageCounters.delete(sessionId);
  }

  /** Add a new image and persist it, handling duplicates */
  async addImage(image: StoredImage, sessionId?: string) {
    // Auto-generate filename if not provided (ALWAYS use filename as primary identifier)
    if (!image.filename || image.filename === '') {
      image.filename = this.generateImageFilename(sessionId, image.timestamp);
      console.log(`🔖 Auto-generated filename: ${image.filename}`);
    }

    // Set fileImageName for backward compatibility if not present
    if (!image.fileImageName) {
      image.fileImageName = image.filename;
    }

    // Ensure sessionId is stored in the image for reference
    if (sessionId) {
      image.sessionId = sessionId;
    }

    // Check for duplicates based on filename
    const duplicate = this.images.find(
      img => img.filename === image.filename
    );

    if (duplicate) {
      console.warn('Duplicate image detected (same filename). Skipping addition:', image.filename);
      return; // Skip adding duplicate image
    }

    // Add the image if it's unique
    this.images.unshift(image);
    await this._storage?.set(this.STORAGE_KEY, this.images);

    // Update map selection if this was selected externally
    if (this._currentImage && this._currentImage.filename === image.filename) {
      this._currentImage = image;
      this._currentImage$.next(this._currentImage);
    }

    console.log(`📤 Image saved: ${image.filename}. Total stored images: ${this.images.length}`);
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

  /** Add a session from remote source if it does not already exist locally. */
  addSessionIfNotExists(session: Partial<ImageSession>): boolean {
    if (!session || !session.id) return false;

    const exists = this.sessions.some(s => s.id === session.id);
    if (exists) return false;

    const normalized: ImageSession = {
      id: session.id,
      name: session.name || 'Untitled Session',
      imageKeys: Array.isArray(session.imageKeys) ? session.imageKeys.filter(k => !!k) : [],
      created: session.created || new Date().toISOString(),
      totalBoundingBoxes: session.totalBoundingBoxes || 0,
      userId: session.userId,
      sessionId: session.sessionId
    };

    this.sessions.unshift(normalized);
    this.sessionImageCounters.set(normalized.id, normalized.imageKeys.length);
    this.persistSessions();
    return true;
  }

  /** Add an image from remote source if it does not already exist locally. */
  async addImageIfNotExists(image: StoredImage, sessionId?: string): Promise<boolean> {
    if (!image) return false;

    const duplicateByFilename = !!image.filename && this.images.some(i => i.filename === image.filename);
    const duplicateByOriginal = !!image.original && this.images.some(i => i.original === image.original);
    if (duplicateByFilename || duplicateByOriginal) return false;

    await this.addImage(image, sessionId);
    return true;
  }

  private estimateDataUrlBytes(url: string): number {
    const commaIdx = url.indexOf(',');
    if (commaIdx === -1) return url.length;
    const b64 = url.slice(commaIdx + 1);
    const padding = (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
    return Math.floor((b64.length * 3) / 4) - padding;
  }

  private async clampDataUrlToBytes(dataUrl: string | null | undefined, maxBytes: number): Promise<string | null> {
    if (!dataUrl) return null;
    if (this.estimateDataUrlBytes(dataUrl) <= maxBytes) return dataUrl;
    if (typeof document === 'undefined') return null;

    try {
      const img = new Image();
      img.src = dataUrl;
      await new Promise(resolve => (img.onload = resolve));

      let scale = 1;
      let quality = 0.92;
      const minQuality = 0.5;
      const scaleStep = 0.85;
      const maxLoops = 8;

      for (let i = 0; i < maxLoops; i += 1) {
        const canvas = document.createElement('canvas');
        const w = Math.max(1, Math.floor((img.naturalWidth || img.width) * scale));
        const h = Math.max(1, Math.floor((img.naturalHeight || img.height) * scale));
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) break;
        ctx.drawImage(img, 0, 0, w, h);

        const candidate = canvas.toDataURL('image/jpeg', quality);
        if (this.estimateDataUrlBytes(candidate) <= maxBytes) return candidate;

        if (quality > minQuality) {
          quality = Math.max(minQuality, quality - 0.12);
        } else {
          scale = scale * scaleStep;
        }
      }
    } catch (e) {
      console.warn('[ImageStorageService] clampDataUrlToBytes failed', e);
    }

    return null;
  }

  /** Build a filename for the boxed image variant. */
  buildWithBoxesFilename(filename: string): string {
    if (!filename) return 'boxed-image.jpg';
    const dotIdx = filename.lastIndexOf('.');
    if (dotIdx === -1) return `${filename}_boxes`;
    return `${filename.slice(0, dotIdx)}_boxes${filename.slice(dotIdx)}`;
  }

  /** Persist a single session and its images to Firestore using filename as image doc ID */
  async saveSessionWithImagesToFirestore(sessionId: string): Promise<void> {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) {
      console.warn('[ImageStorageService] saveSessionWithImagesToFirestore: session not found', sessionId);
      return;
    }

    const imagesForSession: StoredImage[] = [];
    for (const key of session.imageKeys || []) {
      const img = this.images.find(i => i.filename === key || i.original === key || (i.withBoxes && i.withBoxes === key));
      if (img && img.filename) imagesForSession.push(img);
    }

    try {
      const currentUid = await this.waitForAuthUserId();
      console.log('[ImageStorageService] currentUserId for saveSessionWithImagesToFirestore', currentUid);
      if (!currentUid) {
        console.warn('[ImageStorageService] No authenticated user; skipping Firestore write');
        return;
      }
      // CRITICAL: Ensure userId is ALWAYS set to currentUid (never null)
      session.userId = currentUid;

      console.log('[ImageStorageService] Saving session to Firestore', {
        sessionId: session.id,
        sessionName: session.name,
        imageCount: imagesForSession.length,
        userId: currentUid
      });
      const sessionsCollection = collection(this.firestore, this.FIRESTORE_SESSIONS_COLLECTION);
      const imagesCollection = collection(this.firestore, this.FIRESTORE_IMAGES_COLLECTION);

      // Remove existing images for this session so Firestore reflects local state
      const existingQuery = query(imagesCollection, where('sessionId', '==', session.id), where('userId', '==', currentUid));
      const existingSnapshot = await getDocs(existingQuery);
      const deleteBatch = writeBatch(this.firestore);
      existingSnapshot.forEach(docSnapshot => deleteBatch.delete(docSnapshot.ref));
      await deleteBatch.commit();

      const batch = writeBatch(this.firestore);
      const sessionRef = doc(sessionsCollection, session.id);
      batch.set(sessionRef, {
        id: session.id,
        name: session.name,
        imageKeys: session.imageKeys || [],
        created: session.created,
        totalBoundingBoxes: session.totalBoundingBoxes || 0,
        userId: currentUid,
        sessionId: session.sessionId || null
      });

      for (const image of imagesForSession) {
        // CRITICAL: Ensure userId is ALWAYS set to currentUid (never null)
        image.userId = currentUid;
        const safeOriginal = await this.clampDataUrlToBytes(image.original, this.FIRESTORE_DOC_MAX_BYTES);
        const safeWithBoxes = await this.clampDataUrlToBytes(image.withBoxes, this.FIRESTORE_DOC_MAX_BYTES);
        const imageRef = doc(imagesCollection, image.filename);
        batch.set(imageRef, {
          timestamp: image.timestamp,
          filename: image.filename,
          userId: currentUid,
          sessionId: session.id,
          original: safeOriginal,
          withBoxes: safeWithBoxes,
          hasPrediction: image.hasPrediction || false,
          statusMessage: image.statusMessage || '',
          detectionMessage: image.detectionMessage || '',
          prediction: image.prediction || null,
          boxes: image.boxes || []
        });
      }

      await batch.commit();
      console.log(`✅ Session and images saved to Firestore: ${session.id}`);
    } catch (error) {
      console.error('[ImageStorageService] Error saving session/images to Firestore:', error);
      throw error;
    }
  }

  /** Save a StoredImage under a user document in Firestore */
  async saveImageToUser(uid: string, image: StoredImage): Promise<void> {
    try {
      const imagesCollection = collection(this.firestore, 'users', uid, 'images');
      const docId = image.filename || `${image.timestamp}_${Math.random().toString(36).substr(2, 9)}`;
      const docRef = doc(imagesCollection, docId);

      const firestoreData: any = {
        timestamp: image.timestamp,
        filename: image.filename,
        userId: image.userId || uid,
        sessionId: image.sessionId || null,
        hasPrediction: image.hasPrediction || false,
        statusMessage: image.statusMessage || '',
        detectionMessage: image.detectionMessage || '',
        prediction: image.prediction || null,
        boxes: image.boxes || [],
      };

      await setDoc(docRef, firestoreData);
      console.log(`✅ Image saved to user Firestore: ${uid}/${docId}`);
    } catch (error) {
      console.error('[ImageStorageService] Error saving image to user Firestore:', error);
      throw error;
    }
  }

  /** Save an ImageSession under a user document in Firestore */
  async saveSessionToUser(uid: string, session: ImageSession): Promise<void> {
    try {
      const sessionsCollection = collection(this.firestore, 'users', uid, 'sessions');
      const docRef = doc(sessionsCollection, session.id);
      const firestoreData: any = {
        id: session.id,
        name: session.name,
        imageKeys: session.imageKeys || [],
        created: session.created,
        totalBoundingBoxes: session.totalBoundingBoxes || 0,
        userId: session.userId || uid,
      };
      await setDoc(docRef, firestoreData);
      console.log(`✅ Session saved to user Firestore: ${uid}/${session.id}`);
    } catch (error) {
      console.error('[ImageStorageService] Error saving session to user Firestore:', error);
      throw error;
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

  /** Convenience: update or insert an entry by its filename (primary key) */
  setEntryForImage(imageKey: string, entry: StoredImage) {
    // Ensure the entry has a valid filename
    if (!entry.filename || entry.filename === '') {
      entry.filename = this.generateImageFilename(entry.sessionId, entry.timestamp);
    }
    
    const idx = this.images.findIndex(i => i.filename === imageKey);
    if (idx !== -1) this.images[idx] = entry;
    else this.images.unshift(entry);
    this._storage?.set(this.STORAGE_KEY, this.images);
    // update current image subject if needed
    if (this._currentImage && this._currentImage.filename === imageKey) {
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

  /** Select a StoredImage by its filename (primary key) and expose via observable */
  selectImageByKey(imageKey: string): StoredImage | undefined {
    // Use filename as the primary and only key
    const found = this.images.find(i => i.filename === imageKey);
    this._currentImage = found ?? null;
    this._currentImage$.next(this._currentImage);
    return found;
  }

  /** @deprecated Use selectImageByKey with filename instead. Kept for backward compatibility. */
  selectImageByOriginal(original: string): StoredImage | undefined {
    // Fallback: try to find by original if filename lookup fails
    const found = this.images.find(i => i.original === original);
    if (found && found.filename) {
      return this.selectImageByKey(found.filename);
    }
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
  createSession(name: string, imageKeys: string[] = [], userId?: string): ImageSession {
    // compute total bounding boxes for provided keys
    let totalBoxes = 0;
    for (const k of imageKeys) {
      const img = this.images.find(i => i.filename === k || i.original === k || (i.withBoxes && i.withBoxes === k));
      //If an image is found and it has a boxes property (an array), 
      //the length of the boxes array is added to totalBoxes.
      if (img && Array.isArray((img as any).boxes)) totalBoxes += (img as any).boxes.length;
    }
    const s: ImageSession = { 
      id: `s-${Date.now()}`, 
      name, 
      imageKeys: [...imageKeys], 
      created: new Date().toISOString(), 
      totalBoundingBoxes: totalBoxes,
      userId: userId
    };
    //The new session is added to the beginning of the sessions array using unshift.
    this.sessions.unshift(s);
    // Initialize counter for this new session
    this.sessionImageCounters.set(s.id, imageKeys.length);
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
    const img = this.images.find(i => i.filename === imageKey || i.original === imageKey || (i.withBoxes && i.withBoxes === imageKey));
    if (img && Array.isArray((img as any).boxes)) {
      s.totalBoundingBoxes = (s.totalBoundingBoxes || 0) + (img as any).boxes.length;
    }
    // Update the session counter to match actual image count
    const imageCount = s.imageKeys ? s.imageKeys.length : 0;
    this.sessionImageCounters.set(sessionId, imageCount);
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
    // Reset counter for this session
    this.resetSessionCounter(id);
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

  /** Remove a single image by its key (filename, original data URL, or identifier)
   * Returns true if an image was removed, false otherwise
   */
  async removeImageByOriginal(imageKey: string): Promise<boolean> {
    //The before variable stores the initial count of images in the images array. 
    //This is used later to determine if an image was actually removed.
    const before = this.images.length;
    // find the image being removed so we can adjust session counts (support filename lookup)
    const removedImage = this.images.find(img => img.filename === imageKey || img.original === imageKey || (img.withBoxes && img.withBoxes === imageKey));
    const removedBoxes = removedImage && Array.isArray((removedImage as any).boxes) ? (removedImage as any).boxes.length : 0;
    //The filter method creates a new images array that excludes the 
    //image with the matching key
    this.images = this.images.filter(img => img.filename !== imageKey && img.original !== imageKey);
    //The after variable stores the new count of images in the images array.
    const after = this.images.length;
    //If the count of images (after) is less than the initial count 
    //(before), it means an image was successfully removed.
    if (after < before) {
      //The updated images array is saved to persistent storage using the STORAGE_KEY.
      await this._storage?.set(this.STORAGE_KEY, this.images);
      
      // Remove from Firestore 'images' collection
      if (removedImage) {
        try {
          await this.deleteImageFromFirestore(removedImage);
        } catch (e) {
          console.warn('[ImageStorageService] Failed to delete image from Firestore', e);
        }
      }
      
      // Also remove this image key from any sessions that reference it (check both filename and original)
      let sessionsChanged = false;
      for (const s of this.sessions) {
        const prevLen = s.imageKeys.length;
        const hadKey = s.imageKeys.includes(imageKey) || (removedImage && s.imageKeys.includes(removedImage.filename)) || (removedImage && s.imageKeys.includes(removedImage.original));
        s.imageKeys = s.imageKeys.filter(k => k !== imageKey && (!removedImage || (k !== removedImage.filename && k !== removedImage.original)));
        //If the session's imageKeys array changes, the sessionsChanged flag is set to true.
        if (s.imageKeys.length !== prevLen) {
          sessionsChanged = true;
          // Update counter for this session
          this.sessionImageCounters.set(s.id, s.imageKeys.length);
        }
        // subtract removed boxes from session total if applicable
        if (hadKey && removedBoxes > 0) {
          s.totalBoundingBoxes = Math.max(0, (s.totalBoundingBoxes || 0) - removedBoxes);
        }
      }
      //If any session was modified, the updated sessions array is saved to persistent storage.
      if (sessionsChanged) await this.persistSessions();
      console.log(`🗑️ Removed image: ${removedImage?.filename || imageKey}. Remaining images: ${this.images.length}`);
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

  /** Return a StoredImage entry by its filename (primary key) */
  getEntryForImage(imageKey: string): StoredImage | undefined {
    return this.images.find(i => i.filename === imageKey);
  }

  /** Helper method to get stable image key - always returns filename */
  getImageKey(image: StoredImage): string {
    return image.filename || '';
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
      
      // Remove from Firestore 'sessionsImages' collection
      try {
        this.deleteSessionFromFirestore(session.id).catch(e => 
          console.warn('[ImageStorageService] Failed to delete session from Firestore', e)
        );
      } catch (e) {
        console.warn('[ImageStorageService] Failed to initiate session deletion from Firestore', e);
      }
      
      return true;
    }
    return false;
  }

  // ==================== Firestore Helper Methods ====================

  /**
   * Save a single StoredImage to Firestore 'images' collection.
   * Uses timestamp as document ID to ensure uniqueness.
   */
  private async saveImageToFirestore(image: StoredImage): Promise<void> {
    try {
      const currentUid = await this.waitForAuthUserId();
      console.log('[ImageStorageService] currentUserId for saveImageToFirestore', currentUid);
      if (!currentUid) {
        console.warn('[ImageStorageService] No authenticated user; skipping Firestore image write');
        return;
      }
      // CRITICAL: Always set userId to currentUid (never null)
      image.userId = currentUid;
      const imagesCollection = collection(this.firestore, this.FIRESTORE_IMAGES_COLLECTION);
      // Use timestamp + random suffix as doc ID to avoid collisions
      const docId = `${image.timestamp}_${Math.random().toString(36).substr(2, 9)}`;
      const docRef = doc(imagesCollection, docId);
      
      // Prepare data (exclude Base64 'original' and 'withBoxes' if too large for Firestore doc limit)
      const firestoreData: any = {
        timestamp: image.timestamp,
        filename: image.filename,
        userId: currentUid,
        sessionId: image.sessionId || null,
        hasPrediction: image.hasPrediction || false,
        statusMessage: image.statusMessage || '',
        detectionMessage: image.detectionMessage || '',
        prediction: image.prediction || null,
        boxes: image.boxes || [],
        // Note: Omitting 'original' and 'withBoxes' Base64 strings to avoid Firestore doc size limits
      };
      
      await setDoc(docRef, firestoreData);
      console.log(`✅ Image saved to Firestore: ${docId}`);
    } catch (error) {
      console.error('[ImageStorageService] Error saving image to Firestore:', error);
      throw error;
    }
  }

  /**
   * Save all sessions to Firestore 'sessionsImages' collection.
   * Each session is stored as a separate document with session.id as doc ID.
   */
  private async saveSessionsToFirestore(sessions: ImageSession[]): Promise<void> {
    try {
      const currentUid = await this.waitForAuthUserId();
      console.log('[ImageStorageService] currentUserId for saveSessionsToFirestore', currentUid);
      if (!currentUid) {
        console.warn('[ImageStorageService] No authenticated user; skipping Firestore sessions write');
        return;
      }
      const sessionsCollection = collection(this.firestore, this.FIRESTORE_SESSIONS_COLLECTION);
      const batch = writeBatch(this.firestore);
      
      for (const session of sessions) {
        // CRITICAL: Always set userId to currentUid (never null)
        session.userId = currentUid;
        const docRef = doc(sessionsCollection, session.id);
        const firestoreData: any = {
          id: session.id,
          name: session.name,
          imageKeys: session.imageKeys || [],
          created: session.created,
          totalBoundingBoxes: session.totalBoundingBoxes || 0,
          userId: currentUid,
        };
        batch.set(docRef, firestoreData);
      }
      
      await batch.commit();
      console.log(`✅ ${sessions.length} session(s) saved to Firestore`);
    } catch (error) {
      console.error('[ImageStorageService] Error saving sessions to Firestore:', error);
      throw error;
    }
  }

  /**
   * Delete a StoredImage from Firestore 'images' collection.
   * Queries by timestamp and filename to find matching document(s).
   */
  private async deleteImageFromFirestore(image: StoredImage): Promise<void> {
    try {
      const imagesCollection = collection(this.firestore, this.FIRESTORE_IMAGES_COLLECTION);
      const q = query(
        imagesCollection,
        where('timestamp', '==', image.timestamp),
        where('filename', '==', image.filename)
      );
      
      const querySnapshot = await getDocs(q);
      const batch = writeBatch(this.firestore);
      
      querySnapshot.forEach((docSnapshot) => {
        batch.delete(docSnapshot.ref);
      });
      
      await batch.commit();
      console.log(`✅ Image deleted from Firestore: ${image.filename}`);
    } catch (error) {
      console.error('[ImageStorageService] Error deleting image from Firestore:', error);
      throw error;
    }
  }

  /**
   * Delete a session from Firestore 'sessionsImages' collection.
   */
  private async deleteSessionFromFirestore(sessionId: string): Promise<void> {
    try {
      const sessionsCollection = collection(this.firestore, this.FIRESTORE_SESSIONS_COLLECTION);
      const docRef = doc(sessionsCollection, sessionId);
      await deleteDoc(docRef);
      console.log(`✅ Session deleted from Firestore: ${sessionId}`);
    } catch (error) {
      console.error('[ImageStorageService] Error deleting session from Firestore:', error);
      throw error;
    }
  }
  
}

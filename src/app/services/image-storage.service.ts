import { Injectable } from '@angular/core';
import { Storage } from '@ionic/storage-angular';
import { BehaviorSubject, Observable } from 'rxjs';
import { Auth } from '@angular/fire/auth';
import { onAuthStateChanged } from 'firebase/auth';
import { Firestore, collection, doc, setDoc, deleteDoc, getDocs, query, where, writeBatch } from '@angular/fire/firestore';
import { S3Client, PutObjectCommand, ListObjectsV2Command, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'; // NEW IMPORT

export interface CrackPrediction {
  id: number;

  box: {
    x: number;
    y: number;
    w: number;
    h: number;
  };

  type?: string;
  shape?: string;
  severity?: string;

  confidence?: number;
}

//image object in the session
export interface StoredImage {
  original: string; // Base64 image
  withBoxes?: string;
  boxes?: any[];
  croppedCracks?: {image: string; box: any; type: string; shape: string; severity: string;}[];
  faceDetected?: boolean;
  faceData?: any[];
  timestamp: string;
  filename: string;
  prediction?: { type: string; shape: string; severity: string; boxes?: any[] };
  multiPredictions?: CrackPrediction[];
  correctedPrediction?: { type: string; shape: string; severity: string; boxes?: any[] };
  // New optional helpers for status/testing
  hasPrediction?: boolean;
  statusMessage?: string;
  detectionMessage?: string;
  sessionId?: string; // optional link to a session
  userId?: string; // optional link to a user (if multi-user support is added)
  engineerCheckedSession?: boolean;
  fileImageName?: string; // optional original filename if available
  storagePath?: string; // Cloud Storage object path for original image
  storageUrl?: string; // Cloud Storage download URL for original image
  withBoxesStoragePath?: string; // Cloud Storage object path for withBoxes image
  withBoxesStorageUrl?: string; // Cloud Storage download URL for withBoxes image
  // New explicit S3 key fields with userID:sessionId prefix (for clarity in Firestore)
  originalS3Key?: string; // Full S3 key for original (e.g., "userID:abc123sessionId:xyz789img1crack1041120261109original.jpg")
  originalS3Url?: string; // HTTPS URL for original image
  withBoxesS3Key?: string; // Full S3 key for withBoxes (e.g., "userID:abc123sessionId:xyz789img1crack1041120261109withBoxes.jpg")
  withBoxesS3Url?: string; // HTTPS URL for withBoxes image
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
  // Optional freeform notes attached to the session
  notes?: string;
  engineerCheckedSession?: boolean;
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
  private readonly FIRESTORE_CORRECT_IMAGES_COLLECTION = 'correctImagesByEngineer';
  private readonly FIRESTORE_SESSIONS_COLLECTION = 'sessionsImages';
  private readonly FIRESTORE_DOC_MAX_BYTES = 900_000;
  private bucketName = 'my-angular-test-bucket-12345';
  private region = 'ap-southeast-2';
  private identityPoolId = 'ap-southeast-2:e70f96d9-6860-4f80-9bf8-082d2661b665';
  // Counter map to track image number per session
  private sessionImageCounters: Map<string, number> = new Map();
  // Separate counter map for original uploads so cropped variants can reuse the same img index.
  private sessionOriginalImageCounters: Map<string, number> = new Map();

  newSessionIdForFileShare = '';

  private s3Client: S3Client;

  constructor(private storage: Storage, private firestore: Firestore, private auth: Auth) {
    this.init();
    this.s3Client = new S3Client({
      region: this.region,
      credentials: fromCognitoIdentityPool({
        clientConfig: { region: this.region },
        identityPoolId: this.identityPoolId,
      }),
    });
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

  // ==================== File Upload Methods ====================

  /** Read a file as ArrayBuffer */
  private readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  /** Upload a file to S3 and return the URL */
  async uploadFile(file: File): Promise<string> {
    const fileName = file.name || `upload-${Date.now()}`;

    try {
      const fileBuffer = await this.readAsArrayBuffer(file);
      const uint8Array = new Uint8Array(fileBuffer);
      const params = {
        Bucket: this.bucketName,
        Key: fileName,
        Body: uint8Array,
        ContentType: file.type
      };

      const command = new PutObjectCommand(params);
      await this.s3Client.send(command);

      const finalUrl = `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${fileName}`;

      // SUCCESS LOG
      console.log('✅ AWS S3: Upload Successful!');
      console.log('🔗 File URL:', finalUrl);

      return finalUrl;
    } catch (error: any) {
      console.error('❌ AWS S3: Upload Failed', error);
      throw error;
    }
  }

  /** Handle file selection from input event */
  onFileSelected(event: any): File | null {
    const fileList: FileList = event.target.files;
    if (fileList && fileList.length > 0) {
      return fileList[0];
    }
    return null;
  }

  /** Main upload method that handles file upload and storage */
  async upload(file: File, sessionId?: string): Promise<string | null> {
    if (!file) {
      console.warn('⚠️ No file provided for upload');
      return null;
    }

    try {
      const uploadedFileUrl = await this.uploadFile(file);
      console.log('🚀 Upload complete! URL:', uploadedFileUrl);
      return uploadedFileUrl;
    } catch (error) {
      console.error('🚀 Upload failed:', error);
      return null;
    }
  }

  /** Upload original image to S3 with session-scoped filename */
  async uploadSessionImageOriginal(dataUrl: string, sessionId: string, originalFilename: string, imgIndex?: number): Promise<{ url: string; s3Key: string } | null> {
    try {
      // Generate S3 filename using session info
      const s3Filename = this.generateSessionFilename({
        sessionId,
        filename: originalFilename,
        designatedPart: 'original',
        imageType: 'original',
        imgIndex,
        timestamp: new Date().toISOString()
      });

      // Convert data URL to Uint8Array
      const uint8Array = this.dataUrlToUint8Array(dataUrl);

      // Upload to S3
      const params = {
        Bucket: this.bucketName,
        Key: s3Filename,
        Body: uint8Array,
        ContentType: 'image/jpeg'
      };

      console.log('[ImageStorageService] Attempting to upload original image to S3:', s3Filename);
      const command = new PutObjectCommand(params);
      await this.s3Client.send(command);

      const finalUrl = `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${s3Filename}`;

      console.log('✅ Original image uploaded to S3 with key:', s3Filename);
      console.log('🔗 Original image URL:', finalUrl);

      return { url: finalUrl, s3Key: s3Filename };
    } catch (error: any) {
      console.error('❌ Failed to upload original image to S3:', error?.message || error);
      console.warn('[ImageStorageService] S3 upload failed (CORS or network issue). Image will be stored locally.');
      console.warn('[ImageStorageService] To fix S3 uploads, ensure CORS is configured on the S3 bucket for origin: http://localhost:8100');
      // Return null to indicate S3 upload failure - app should handle local storage fallback
      return null;
    }
  }

  /** Upload withBoxes image to S3 with session-scoped filename */
  async uploadSessionImageWithBoxes(dataUrl: string, sessionId: string, originalFilename: string, imgIndex?: number): Promise<{ url: string; s3Key: string } | null> {
    try {
      // Generate S3 filename using session info
      const s3Filename = this.generateSessionFilename({
        sessionId,
        filename: originalFilename,
        designatedPart: 'original',
        imageType: 'withBoxes',
        imgIndex,
        timestamp: new Date().toISOString()
      });

      // Convert data URL to Uint8Array
      const uint8Array = this.dataUrlToUint8Array(dataUrl);

      // Upload to S3
      const params = {
        Bucket: this.bucketName,
        Key: s3Filename,
        Body: uint8Array,
        ContentType: 'image/jpeg'
      };

      console.log('[ImageStorageService] Attempting to upload withBoxes image to S3:', s3Filename);
      const command = new PutObjectCommand(params);
      await this.s3Client.send(command);

      const finalUrl = `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${s3Filename}`;

      console.log('✅ WithBoxes image uploaded to S3 with key:', s3Filename);
      console.log('🔗 WithBoxes image URL:', finalUrl);

      return { url: finalUrl, s3Key: s3Filename };
    } catch (error: any) {
      console.error('❌ Failed to upload withBoxes image to S3:', error?.message || error);
      console.warn('[ImageStorageService] S3 upload failed (CORS or network issue). Image will be stored locally.');
      console.warn('[ImageStorageService] To fix S3 uploads, ensure CORS is configured on the S3 bucket for origin: http://localhost:8100');
      // Return null to indicate S3 upload failure - app should handle local storage fallback
      return null;
    }
  }

  /** Helper: Convert data URL to Uint8Array */
  private dataUrlToUint8Array(dataUrl: string): Uint8Array {
    if (!dataUrl || typeof dataUrl !== 'string') {
      throw new Error('Invalid image payload: expected a base64 data URL string');
    }

    const trimmed = dataUrl.trim();
    let base64 = '';

    if (trimmed.startsWith('data:')) {
      const commaIndex = trimmed.indexOf(',');
      if (commaIndex === -1) {
        throw new Error('Invalid data URL format: missing comma separator');
      }
      base64 = trimmed.slice(commaIndex + 1);
    } else {
      // Backward compatibility: allow raw base64 payloads without the data:* prefix.
      base64 = trimmed;
    }

    // Normalize URL-safe and whitespace-affected base64 before decode.
    base64 = base64.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');

    const padLength = base64.length % 4;
    if (padLength > 0) {
      base64 = base64.padEnd(base64.length + (4 - padLength), '=');
    }

    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
      throw new Error('Invalid base64 payload: contains unsupported characters');
    }

    let bstr = '';
    try {
      bstr = atob(base64);
    } catch (e: any) {
      throw new Error(`Invalid base64 payload: ${e?.message || 'decode failed'}`);
    }

    const n = bstr.length;
    const u8arr = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      u8arr[i] = bstr.charCodeAt(i);
    }
    return u8arr;
  }

  /** 
   * Log and confirm the complete S3/Firestore integration workflow 
   * @param sessionId Session ID to verify
   * @param imageFilenames Optional array of filenames to verify
   */
  async logSaveWorkflowStatus(sessionId: string, imageFilenames?: string[]): Promise<void> {
    try {
      const session = this.getSession(sessionId);
      if (!session) {
        console.warn('[ImageStorageService] Session not found:', sessionId);
        return;
      }

      const workflowLog: any = {
        timestamp: new Date().toISOString(),
        session: {
          id: session.id,
          name: session.name,
          userId: session.userId,
          imageCount: session.imageKeys?.length || 0
        },
        s3Uploads: [],
        firestoreStatus: 'Pending verification'
      };

      // Collect image details from session
      for (const key of session.imageKeys || []) {
        const img = this.images.find(i => i.filename === key || i.original === key);
        if (img) {
          const imageInfo: any = {
            filename: img.filename,
            hasOriginal: !!img.original,
            hasWithBoxes: !!img.withBoxes,
            s3References: {
              originalS3Key: img.storagePath || '(not uploaded)',
              originalS3Url: img.storageUrl ? '✅ Available' : '❌ Missing',
              withBoxesS3Key: img.withBoxesStoragePath || '(not uploaded)',
              withBoxesS3Url: img.withBoxesStorageUrl ? '✅ Available' : '❌ Missing'
            },
            prediction: img.prediction || null,
            statusMessage: img.statusMessage || ''
          };
          workflowLog.s3Uploads.push(imageInfo);
        }
      }

      // Log workflow status
      console.group('[ImageStorageService] ✅ S3/Firestore Integration Workflow Status');
      console.log('📋 Workflow Summary:', workflowLog);
      console.table(workflowLog.s3Uploads);
      console.groupEnd();

      // Log individual S3 references
      console.group('[ImageStorageService] 📁 S3 References Details');
      workflowLog.s3Uploads.forEach((img: any) => {
        console.log(`\n${img.filename}:`);
        console.log('  Original S3:', {
          key: img.s3References.originalS3Key,
          url: img.s3References.originalS3Url
        });
        console.log('  WithBoxes S3:', {
          key: img.s3References.withBoxesS3Key,
          url: img.s3References.withBoxesS3Url
        });
      });
      console.groupEnd();

      // Confirm Firestore will receive S3 references
      console.log('[ImageStorageService] ✅ Firestore Save Process:');
      console.log('  - S3 references will be stored in Firestore documents');
      console.log('  - Original image S3 key:', workflowLog.s3Uploads[0]?.s3References.originalS3Key);
      console.log('  - WithBoxes S3 key:', workflowLog.s3Uploads[0]?.s3References.withBoxesS3Key);
    } catch (error) {
      console.error('[ImageStorageService] Error logging workflow status:', error);
    }
  }

  /**
   * Fetch a single S3 object by key and convert to base64 data URL
   * @param s3Key The S3 object key to fetch
   * @returns Promise<string> Base64 data URL or null on failure
   */
  async fetchS3ObjectAsDataUrl(s3Key: string): Promise<string | null> {
    try {
      if (!s3Key) {
        console.warn('[ImageStorageService] fetchS3ObjectAsDataUrl: No S3 key provided');
        return null;
      }

      console.log(`[ImageStorageService] Fetching S3 object: ${s3Key}`);
      const getCommand = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key
      });

      const response = await this.s3Client.send(getCommand);
      
      const body = response.Body as any;

      if (!body) {
        console.warn('[ImageStorageService] Empty S3 response body for key:', s3Key);
        return null;
      }

      const bytes = await this.readS3ResponseBody(body);
      if (!bytes || bytes.length === 0) {
        console.warn('[ImageStorageService] No bytes returned for S3 object:', s3Key);
        return null;
      }

      const base64 = this.uint8ArrayToBase64(bytes);
      return `data:image/jpeg;base64,${base64}`;
    } catch (error) {
      console.error(`[ImageStorageService] Error fetching S3 object ${s3Key}:`, error);
      return null;
    }
  }

  private async readS3ResponseBody(body: any): Promise<Uint8Array | null> {
    if (body instanceof Uint8Array) {
      return body;
    }

    if (typeof body.transformToByteArray === 'function') {
      const transformed = await body.transformToByteArray();
      return transformed instanceof Uint8Array ? transformed : new Uint8Array(transformed);
    }

    if (typeof body.arrayBuffer === 'function') {
      const buffer = await body.arrayBuffer();
      return new Uint8Array(buffer);
    }

    if (typeof body.getReader === 'function') {
      const readableStream = await new Response(body as ReadableStream).arrayBuffer();
      return new Uint8Array(readableStream);
    }

    if (typeof body.pipe === 'function') {
      return await new Promise<Uint8Array | null>((resolve, reject) => {
        const chunks: Uint8Array[] = [];
        body.on('data', (chunk: Uint8Array | ArrayBuffer | Buffer) => {
          chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer));
        });
        body.on('end', () => {
          if (typeof Buffer !== 'undefined') {
            resolve(new Uint8Array(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))));
            return;
          }

          const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
          const merged = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
          }
          resolve(merged);
        });
        body.on('error', reject);
      });
    }

    return null;
  }

  private uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunkSize = 0x8000;

    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
  }

  /**
   * Fetch session images from Firestore and S3, with progress tracking
   * @param sessionId The session ID to fetch
   * @param userId The user ID for query filtering
   * @param onProgress Optional callback for progress updates: (current: number, total: number) => void
   * @returns Promise<void> Updates this.images with fetched S3 data
   */
  async fetchSessionImagesFromS3(
    sessionId: string,
    userId: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<void> {
    try {
      if (!sessionId || !userId) {
        console.warn('[ImageStorageService] fetchSessionImagesFromS3: sessionId or userId missing', {
          sessionId,
          userId
        });
        return;
      }

      console.log('[ImageStorageService] Starting S3 fetch for session:', {
        sessionId,
        userId
      });

      // Query Firestore for all images in this session
      const imagesCollection = collection(this.firestore, this.FIRESTORE_IMAGES_COLLECTION);
      const imageQuery = query(
        imagesCollection,
        where('sessionId', '==', sessionId),
        where('userId', '==', userId)
      );

      const querySnapshot = await getDocs(imageQuery);
      const firestoreImages = querySnapshot.docs.map(doc => ({
        filename: doc.id,
        ...doc.data() as any
      }));

      if (firestoreImages.length === 0) {
        console.warn('[ImageStorageService] No images found in Firestore for session:', sessionId);
        return;
      }

      console.log(`[ImageStorageService] Found ${firestoreImages.length} images in Firestore for session ${sessionId}`);

      // Fetch each image from S3 and update local images array
      let fetchedCount = 0;
      for (const firestoreImage of firestoreImages) {
        try {
          // Find or create the local StoredImage object
          let localImage = this.images.find(i => i.filename === firestoreImage.filename);
          if (!localImage) {
            localImage = {
              original: '',
              withBoxes: '',
              boxes: firestoreImage.boxes || [],
              faceDetected: firestoreImage.faceDetected || false,
              faceData: firestoreImage.faceData || [],
              timestamp: firestoreImage.timestamp || new Date().toISOString(),
              filename: firestoreImage.filename,
              prediction: firestoreImage.prediction || null,
              multiPredictions: firestoreImage.multiPredictions || [],
              hasPrediction: firestoreImage.hasPrediction || false,
              statusMessage: firestoreImage.statusMessage || '',
              detectionMessage: firestoreImage.detectionMessage || '',
              sessionId: firestoreImage.sessionId,
              userId: firestoreImage.userId,
              fileImageName: firestoreImage.fileImageName,
              storagePath: firestoreImage.storagePath,
              storageUrl: firestoreImage.storageUrl,
              withBoxesStoragePath: firestoreImage.withBoxesStoragePath,
              withBoxesStorageUrl: firestoreImage.withBoxesStorageUrl,
              croppedCracks: firestoreImage.croppedCracks || [],
              // ✅ FIX: Also retrieve the explicit S3 key fields that were saved to Firestore
              originalS3Key: firestoreImage.originalS3Key || firestoreImage.storagePath || null,
              originalS3Url: firestoreImage.originalS3Url || firestoreImage.storageUrl || null,
              withBoxesS3Key: firestoreImage.withBoxesS3Key || firestoreImage.withBoxesStoragePath || null,
              withBoxesS3Url: firestoreImage.withBoxesS3Url || firestoreImage.withBoxesStorageUrl || null
            };
            this.images.push(localImage);
          } else {
            // ✅ FIX: If image exists locally, also update the S3 key fields if they're missing
            if (!localImage.originalS3Key && firestoreImage.originalS3Key) {
              localImage.originalS3Key = firestoreImage.originalS3Key;
            }
            if (!localImage.originalS3Url && firestoreImage.originalS3Url) {
              localImage.originalS3Url = firestoreImage.originalS3Url;
            }
            if (!localImage.withBoxesS3Key && firestoreImage.withBoxesS3Key) {
              localImage.withBoxesS3Key = firestoreImage.withBoxesS3Key;
            }
            if (!localImage.withBoxesS3Url && firestoreImage.withBoxesS3Url) {
              localImage.withBoxesS3Url = firestoreImage.withBoxesS3Url;
            }
            if (!localImage.croppedCracks && firestoreImage.croppedCracks) {
              localImage.croppedCracks = firestoreImage.croppedCracks;
            }
            if (!localImage.multiPredictions && firestoreImage.multiPredictions) {
              localImage.multiPredictions = firestoreImage.multiPredictions;
            }
          }

          // Fetch original image from S3 if storagePath is available
          if (firestoreImage.storagePath && !localImage.original) {
            console.log(`[ImageStorageService] Fetching original image from S3: ${firestoreImage.storagePath}`);
            const originalDataUrl = await this.fetchS3ObjectAsDataUrl(firestoreImage.storagePath);
            if (originalDataUrl) {
              localImage.original = originalDataUrl;
              console.log(`✅ Original image fetched for ${firestoreImage.filename}`);
            }
          }

          // Fetch withBoxes image from S3 if withBoxesStoragePath is available
          if (firestoreImage.withBoxesStoragePath && !localImage.withBoxes) {
            console.log(`[ImageStorageService] Fetching withBoxes image from S3: ${firestoreImage.withBoxesStoragePath}`);
            const withBoxesDataUrl = await this.fetchS3ObjectAsDataUrl(firestoreImage.withBoxesStoragePath);
            if (withBoxesDataUrl) {
              localImage.withBoxes = withBoxesDataUrl;
              console.log(`✅ WithBoxes image fetched for ${firestoreImage.filename}`);
            }
          }

          fetchedCount++;
          if (onProgress) {
            onProgress(fetchedCount, firestoreImages.length);
          }
        } catch (error) {
          console.error(`[ImageStorageService] Error fetching image data for ${firestoreImage.filename}:`, error);
          fetchedCount++;
          if (onProgress) {
            onProgress(fetchedCount, firestoreImages.length);
          }
        }
      }

      // Persist updated images to local storage
      await this.persistSessions();
      console.log(`✅ All ${fetchedCount} images fetched from S3 for session ${sessionId}`);
    } catch (error) {
      console.error('[ImageStorageService] Error in fetchSessionImagesFromS3:', error);
      throw error;
    }
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
    this.sessionOriginalImageCounters.clear();
    // Count images per session from existing data
    this.sessions.forEach(session => {
      const count = session.imageKeys ? session.imageKeys.length : 0;
      this.sessionImageCounters.set(session.id, count);
      this.sessionOriginalImageCounters.set(session.id, this.getSessionOriginalImageCount(session.id));
    });
  }

  private isOriginalSessionImageKey(imageKey: string): boolean {
    return /img\d+original/i.test(imageKey || '');
  }

  private getSessionOriginalImageCount(sessionId?: string): number {
    if (!sessionId) {
      return this.images.filter(image => this.isOriginalSessionImageKey(image.filename)).length;
    }

    const session = this.sessions.find(s => s.id === sessionId);
    if (!session || !Array.isArray(session.imageKeys)) {
      return 0;
    }

    let count = 0;
    for (const key of session.imageKeys) {
      const image = this.images.find(i => i.filename === key || i.original === key || (i.withBoxes && i.withBoxes === key));
      if (image && this.isOriginalSessionImageKey(image.filename)) {
        count += 1;
      } else if (this.isOriginalSessionImageKey(key)) {
        count += 1;
      }
    }

    return count;
  }

  /** Get the next image number for original uploads without counting cropped derivatives. */
  getNextOriginalImageNumber(sessionId?: string): number {
    const key = sessionId || 'global';
    const currentCount = this.sessionOriginalImageCounters.get(key) ?? this.getSessionOriginalImageCount(sessionId);
    const nextCount = currentCount + 1;
    this.sessionOriginalImageCounters.set(key, nextCount);
    return nextCount;
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
   * Generate a session-scoped filename with image type.
   * Includes userID and sessionId prefixes to ensure unique filenames per user and session.
   * Format: userID:{userId}sessionId:{sessionId}img{N}[crack{M}][_filename][_type]MMDDYYYYHHMM.jpg
   * @param options Configuration object with sessionId, filename, imageType, hasCrack, and timestamp
   */
  generateSessionFilename(options: { 
    sessionId?: string; 
    filename?: string; 
    originalFilename?: string;
    imageType?: string; 
    hasCrack?: boolean; 
    designatedPart?: 'original' | 'cropped';
    croppedNumber?: number;
    imgIndex?: number;
    timestamp?: string 
  } = {}): string {
    const date = options.timestamp ? new Date(options.timestamp) : new Date();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = String(date.getFullYear());
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    const dateStr = `${month}${day}${year}`;
    const timeStr = `${hours}${minutes}`;

    const sessionId = options.sessionId;
    const imgIndex = typeof options.imgIndex === 'number'
      ? options.imgIndex
      : (sessionId ? (this.getSessionImageCount(sessionId) + 1) : (this.images.length + 1));
    const crackPart = options.hasCrack ? `crack${this.getSessionCrackCount(sessionId) + 1}` : '';

    // Get current userId from auth
    const currentUserId = this.getCurrentUserId() || '';
    
    // Get session object to retrieve sessionId
    const session = sessionId ? this.getSession(sessionId) : undefined;
    
    // Format userID prefix (only if userId is available)
    const userIdPrefix = currentUserId ? `userID:${currentUserId}` : '';
    
    // Format sessionId prefix (using the actual session ID)
    const sessionIdPrefix = session?.id ? `sessionId:${session.id}` : '';

    // Include original filename and image type in the final filename
    const originalFilenameSource = options.originalFilename || options.filename || '';
    const originalFilename = originalFilenameSource ? `_${originalFilenameSource.replace(/\.[^.]+$/, '')}` : '';
    const imageTypeSuffix = options.imageType ? `_${options.imageType}` : '';

    const crackPartStr = options.designatedPart
      ? `${options.designatedPart}${options.designatedPart === 'cropped' ? String(options.croppedNumber ?? '') : ''}`
      : (crackPart ? `_${crackPart}` : '');

    console.log("uderIdPrefix:", userIdPrefix, "sessionIdPrefix:", sessionIdPrefix, "originalFilename:", originalFilename, "imageTypeSuffix:", imageTypeSuffix, "crackPartStr:", crackPartStr);
    
    

    if (originalFilename.startsWith('_userID')) {
      // Preserve preformatted keys while removing the artificial leading underscore.
      const finalFilename = `${originalFilename}${imageTypeSuffix}${dateStr}${timeStr}.jpg`.replace(/^_/, '');

      console.log('[ImageStorageService] Generated filename:', {
        userId: currentUserId,
        sessionId: session?.id,
        filename: finalFilename
      });

      return finalFilename;
    } else {
  // Skip or handle other cases

           // Build final filename with userID and sessionId included
    const finalFilename = `${userIdPrefix}${sessionIdPrefix}img${imgIndex}${crackPartStr}${originalFilename}${imageTypeSuffix}${dateStr}${timeStr}.jpg`;
    

  console.log('[ImageStorageService] Generated filename:', {
      userId: currentUserId,
      sessionId: session?.id,
      filename: finalFilename
    });
    
    return finalFilename;
    }

    
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
      sessionId: session.sessionId,
      notes: (session as any).notes,
      engineerCheckedSession: !!session.engineerCheckedSession
    };

    this.sessions.unshift(normalized);
    this.sessionImageCounters.set(normalized.id, normalized.imageKeys.length);
    this.sessionOriginalImageCounters.set(normalized.id, this.getSessionOriginalImageCount(normalized.id));
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

  /** Persist a single session and its images to Firestore using filename as image doc ID 
   * @param sessionId Session ID to save
   * @param receiverId Optional receiver user ID for sharing
   * @param excludeWithBoxes If true, withBoxes fields (withBoxesS3Key, withBoxesS3Url, etc.) are excluded from Firestore payload
   */
  async saveSessionWithImagesToFirestore(sessionId: string, receiverId?: string, excludeWithBoxes: boolean = false): Promise<void> {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) {
      console.warn('[ImageStorageService] saveSessionWithImagesToFirestore: session not found', sessionId);
      return;
    }

    console.log("session object", session);

    

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
      // CRITICAL: Ensure the payload always has a concrete owner/user value.
      const targetUserId = receiverId || currentUid;
      const createdBy = currentUid;

      console.log("inside saveSessionWithImageTOFirestore, value of receiverId", receiverId, "The targetUserID", targetUserId, "and receiverUserId", );

      session.userId = targetUserId;

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
      console.log("EnginnerCheckSession", session.engineerCheckedSession, "and EngineerCheckedSnapshot", !!session.engineerCheckedSession);
      // Snapshot engineerCheckedSession to avoid race/mutation between iterations
      const engineerCheckedSnapshot = !!session.engineerCheckedSession;
      const sessionRef = doc(sessionsCollection, session.id);
      const sessionWritePayload = {
        id: session.id,
        name: session.name,
        imageKeys: session.imageKeys || [],
        created: session.created,
        totalBoundingBoxes: session.totalBoundingBoxes || 0,
        userId: receiverId || currentUid,
        createdBy,
        ReceivedBy: receiverId || currentUid,
        OriginUserId: currentUid,
        sessionId: this.newSessionIdForFileShare || null,
        notes: session.notes || '',
          engineerCheckedSession: engineerCheckedSnapshot,
        
      };

      const sessionDocumentPath = `${this.FIRESTORE_SESSIONS_COLLECTION}/${session.id}`;
      console.group('[ImageStorageService] Session write preview');
      console.log('Target session document path:', sessionDocumentPath);
      console.log('Session payload:', sessionWritePayload);
      console.log('Image documents target collection:', this.FIRESTORE_IMAGES_COLLECTION);
      console.log('Image document IDs queued:', imagesForSession.map(image => image.filename));
      console.groupEnd();

      batch.set(sessionRef, sessionWritePayload);

      console.log("Batch data ", batch);

      const correctImageWrites: { imageId: string; payload: any }[] = [];

      for (const image of imagesForSession) {
        // CRITICAL: Ensure userId is always concrete and share writes include a creator marker.
        image.userId = receiverId || currentUid;
        const preservedBoxes = Array.isArray(image.boxes) ? [...image.boxes] : [];
        const correctedPredictionSource = image.correctedPrediction || image.prediction || null;
        const predictionPayload = image.prediction
          ? { ...image.prediction, boxes: preservedBoxes }
          : null;
        const correctedPrediction = correctedPredictionSource
          ? { ...correctedPredictionSource, boxes: preservedBoxes }
          : null;
        // NOTE: Commented out base64 storage to save Firestore quota - using S3 references instead
        // const safeOriginal = await this.clampDataUrlToBytes(image.original, this.FIRESTORE_DOC_MAX_BYTES);
        // const safeWithBoxes = await this.clampDataUrlToBytes(image.withBoxes, this.FIRESTORE_DOC_MAX_BYTES);
        const imageRef = doc(imagesCollection, image.filename);
        const imageWritePayload: any = {
          timestamp: image.timestamp,
          filename: image.filename,
          userId: receiverId || currentUid,
          createdBy,
          ReceivedBy: receiverId || currentUid,
          OriginUserId: currentUid,
          sessionId: session.id,
          // NOTE: Commented out - base64 data stored in S3 instead
          // original: safeOriginal,
          // withBoxes: safeWithBoxes,
          hasPrediction: image.hasPrediction || false,
          statusMessage: image.statusMessage || '',
          detectionMessage: image.detectionMessage || '',
          prediction: predictionPayload,
          correctedPrediction,
          engineerCheckedSession: !!session.engineerCheckedSession,
          boxes: preservedBoxes,
          // S3 references for original image (full generated filename with userID:sessionId prefix)
          originalS3Key: image.storagePath || null,   // e.g., "userID:abc123sessionId:xyz789img1crack1041120261109original.jpg"
          originalS3Url: image.storageUrl || null,    // HTTPS URL to original image
          croppedCracks: image.croppedCracks || [],
          multiPredictions: image.multiPredictions || [],
          // Backward compatibility
          storagePath: image.storagePath || null,
          storageUrl: image.storageUrl || null
        };

        console.group('[ImageStorageService] 🖼️ Session Image Object Being Saved');
        console.log('Image filename:', image.filename);
        console.log('Stored image object:', image);
        console.log('Firestore image payload:', imageWritePayload);
        console.table({
          filename: image.filename || '(unnamed)',
          boxCount: Array.isArray(image.boxes) ? image.boxes.length : 0,
          predictionBoxCount: Array.isArray(image.prediction?.boxes) ? image.prediction.boxes.length : 0,
          correctedPredictionBoxCount: Array.isArray(image.correctedPrediction?.boxes) ? image.correctedPrediction.boxes.length : 0,
          hasPrediction: !!image.prediction,
          hasCorrectedPrediction: !!image.correctedPrediction,
          hasS3Original: !!image.originalS3Key,
          hasS3WithBoxes: !!image.withBoxesS3Key
        });
        console.groupEnd();

        // Conditionally exclude withBoxes fields if requested (e.g., for offline scenarios)
        if (!excludeWithBoxes) {
          // S3 references for withBoxes image (full generated filename with userID:sessionId prefix)
          imageWritePayload.withBoxesS3Key = image.withBoxesStoragePath || null;   // e.g., "userID:abc123sessionId:xyz789img1crack1041120261109withBoxes.jpg"
          imageWritePayload.withBoxesS3Url = image.withBoxesStorageUrl || null;    // HTTPS URL to withBoxes image
          // Backward compatibility
          imageWritePayload.withBoxesStoragePath = image.withBoxesStoragePath || null;
          imageWritePayload.withBoxesStorageUrl = image.withBoxesStorageUrl || null;
        }

        batch.set(imageRef, imageWritePayload);

        if (engineerCheckedSnapshot) {
          correctImageWrites.push({
            imageId: image.filename,
            payload: {
              ...imageWritePayload,
              correctedPrediction
            }
          });
        }
      }

      await batch.commit();

      // Optional mirror-write for engineer-corrected images.
      // Kept out of the primary batch so a denied optional collection does not fail core saves.
      if (correctImageWrites.length > 0) {
        try {
          const correctImagesCollection = collection(this.firestore, this.FIRESTORE_CORRECT_IMAGES_COLLECTION);
          const correctBatch = writeBatch(this.firestore);
          for (const item of correctImageWrites) {
            const correctImageRef = doc(correctImagesCollection, item.imageId);
            correctBatch.set(correctImageRef, item.payload);
          }
          await correctBatch.commit();
        } catch (correctWriteError) {
          console.warn('[ImageStorageService] Optional engineer mirror write skipped (permissions or rule mismatch). Core save already succeeded.', correctWriteError);
        }
      }

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
        multiPredictions: image.multiPredictions || [],
        correctedPrediction: image.correctedPrediction || null,
        engineerCheckedSession: !!image.engineerCheckedSession,
        boxes: image.boxes || [],
        croppedCracks: image.croppedCracks || [],
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
        notes: session.notes || '',
        engineerCheckedSession: !!session.engineerCheckedSession,
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

    // Preserve any existing non-empty in-memory image payloads so a partial
    // update cannot wipe out original/withBoxes data that downstream pages need.
    const existing = this.images.find(i => i.filename === imageKey);
    if (existing) {
      if ((!entry.original || entry.original.trim().length === 0) && existing.original && existing.original.trim().length > 0) {
        entry.original = existing.original;
      }

      if ((!entry.withBoxes || entry.withBoxes.trim().length === 0) && existing.withBoxes && existing.withBoxes.trim().length > 0) {
        entry.withBoxes = existing.withBoxes;
      }

      if ((!entry.storagePath || entry.storagePath.trim().length === 0) && existing.storagePath) {
        entry.storagePath = existing.storagePath;
      }
      if ((!entry.storageUrl || entry.storageUrl.trim().length === 0) && existing.storageUrl) {
        entry.storageUrl = existing.storageUrl;
      }
      if ((!entry.withBoxesStoragePath || entry.withBoxesStoragePath.trim().length === 0) && existing.withBoxesStoragePath) {
        entry.withBoxesStoragePath = existing.withBoxesStoragePath;
      }
      if ((!entry.withBoxesStorageUrl || entry.withBoxesStorageUrl.trim().length === 0) && existing.withBoxesStorageUrl) {
        entry.withBoxesStorageUrl = existing.withBoxesStorageUrl;
      }
      if ((!entry.originalS3Key || entry.originalS3Key.trim().length === 0) && existing.originalS3Key) {
        entry.originalS3Key = existing.originalS3Key;
      }
      if ((!entry.originalS3Url || entry.originalS3Url.trim().length === 0) && existing.originalS3Url) {
        entry.originalS3Url = existing.originalS3Url;
      }
      if ((!entry.withBoxesS3Key || entry.withBoxesS3Key.trim().length === 0) && existing.withBoxesS3Key) {
        entry.withBoxesS3Key = existing.withBoxesS3Key;
      }
      if ((!entry.withBoxesS3Url || entry.withBoxesS3Url.trim().length === 0) && existing.withBoxesS3Url) {
        entry.withBoxesS3Url = existing.withBoxesS3Url;
      }
    }

    // If boxed data is still missing but we have an S3 reference, keep the
    // reference so callers can rehydrate later instead of losing the key.
    if ((!entry.withBoxes || entry.withBoxes.trim().length === 0) && !entry.withBoxesS3Key && entry.withBoxesStoragePath) {
      entry.withBoxesS3Key = entry.withBoxesStoragePath;
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
  /** Generate a new session ID using the service's standard format. */
  generateSessionId(): string {
    return `s-${Date.now()}`;
  }

  setGenerateSessionId() {
    this.newSessionIdForFileShare = `s-${Date.now()}`;
  }

  createSession(name: string, imageKeys: string[] = [], userId?: string, notes?: string): ImageSession {
    // compute total bounding boxes for provided keys
    let totalBoxes = 0;
    for (const k of imageKeys) {
      const img = this.images.find(i => i.filename === k || i.original === k || (i.withBoxes && i.withBoxes === k));
      //If an image is found and it has a boxes property (an array), 
      //the length of the boxes array is added to totalBoxes.
      if (img && Array.isArray((img as any).boxes)) totalBoxes += (img as any).boxes.length;
    }
    const sessionId = this.generateSessionId();
    const s: ImageSession = { 
      id: sessionId, 
      name, 
      imageKeys: [...imageKeys], 
      created: new Date().toISOString(), 
      totalBoundingBoxes: totalBoxes,
      userId: userId,
      sessionId: sessionId,
      notes: notes,
      engineerCheckedSession: false
    };
    //The new session is added to the beginning of the sessions array using unshift.
    this.sessions.unshift(s);
    // Initialize counter for this new session
    this.sessionImageCounters.set(s.id, imageKeys.length);
    // persist sessions
    this.persistSessions();
    return s;
  }

  /** Persist a session snapshot and its related images to browser storage. */
  async saveSessionSnapshotToBrowserStorage(sessionId: string, storageTarget: 'local' | 'session' = 'local'): Promise<boolean> {
    const session = this.getSession(sessionId);
    if (!session) {
      console.warn('[ImageStorageService] saveSessionSnapshotToBrowserStorage: session not found', sessionId);
      return false;
    }

    const images = (session.imageKeys || [])
      .map(key => this.images.find(image => image.filename === key || image.original === key || (image.withBoxes && image.withBoxes === key)))
      .filter((image): image is StoredImage => !!image)
      .map(image => ({
        ...image,
        original: image.original,
        withBoxes: image.withBoxes,
        boxes: Array.isArray(image.boxes) ? [...image.boxes] : image.boxes,
        prediction: image.prediction ? { ...image.prediction, boxes: Array.isArray(image.prediction.boxes) ? [...image.prediction.boxes] : image.prediction.boxes } : image.prediction,
        correctedPrediction: image.correctedPrediction ? { ...image.correctedPrediction, boxes: Array.isArray(image.correctedPrediction.boxes) ? [...image.correctedPrediction.boxes] : image.correctedPrediction.boxes } : image.correctedPrediction
      }));

    const payload = {
      session: {
        ...session,
        imageKeys: [...(session.imageKeys || [])]
      },
      images,
      savedAt: new Date().toISOString()
    };

    const storageKey = `image-session-snapshot:${sessionId}`;
    const targets: Array<globalThis.Storage> = [];

    if (typeof window !== 'undefined') {
      if (storageTarget === 'local') {
        targets.push(window.localStorage, window.sessionStorage);
      } else {
        targets.push(window.sessionStorage, window.localStorage);
      }
    }

    for (const target of targets) {
      try {
        target.setItem(storageKey, JSON.stringify(payload));
        await this.persistSessions();
        return true;
      } catch (e) {
        console.warn('[ImageStorageService] Failed to save session snapshot to browser storage', e);
      }
    }

    await this.persistSessions();
    return false;
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

  /** Update a session's freeform notes and persist changes */
  updateSessionNotes(sessionId: string, notes: string): boolean {
    const s = this.sessions.find(x => x.id === sessionId);
    if (!s) return false;
    s.notes = notes;
    this.persistSessions();
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
    return this.images.find(i =>
      i.filename === imageKey ||
      i.original === imageKey ||
      (i.withBoxes && i.withBoxes === imageKey) ||
      i.storagePath === imageKey ||
      i.originalS3Key === imageKey ||
      i.withBoxesS3Key === imageKey
    );
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

  // ==================== S3 Deletion Methods ====================

  /**
   * Delete a single S3 object by key
   * @param s3Key The S3 object key to delete
   * @returns Promise<boolean> True if deletion succeeded
   */
  async deleteS3Object(s3Key: string): Promise<boolean> {
    try {
      if (!s3Key || s3Key.trim() === '') {
        console.warn('[ImageStorageService.deleteS3Object] Empty S3 key provided');
        return false;
      }

      await this.s3Client.send(new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
      }));

      console.log(`✅ S3 object deleted: ${s3Key}`);
      return true;
    } catch (error) {
      console.error('[ImageStorageService.deleteS3Object] Error deleting S3 object:', error);
      return false;
    }
  }

  /**
   * Delete multiple S3 objects by array of keys
   * @param s3Keys Array of S3 object keys to delete
   * @param onProgress Optional callback for progress updates: (current: number, total: number) => void
   * @returns Promise with deletion results
   */
  async deleteMultipleS3Objects(
    s3Keys: string[],
    onProgress?: (current: number, total: number) => void
  ): Promise<{ successful: number; failed: number }> {
    const results = { successful: 0, failed: 0 };

    for (let i = 0; i < s3Keys.length; i++) {
      const key = s3Keys[i];
      const deleted = await this.deleteS3Object(key);
      if (deleted) {
        results.successful++;
      } else {
        results.failed++;
      }
      
      // Call progress callback if provided
      if (onProgress) {
        onProgress(i + 1, s3Keys.length);
      }
    }

    console.log(`[ImageStorageService.deleteMultipleS3Objects] Deleted ${results.successful}/${s3Keys.length} S3 objects`);
    return results;
  }

  /**
   * Delete a session and all its related resources (Firestore session, images, and S3 objects)
   * @param sessionId The session ID to delete
   * @param onProgress Optional callback for progress updates: (stage: string, current: number, total: number) => void
   * @returns Promise<boolean> True if deletion succeeded
   */
  async deleteSessionAndResources(
    sessionId: string,
    onProgress?: (stage: string, current: number, total: number) => void
  ): Promise<boolean> {
    try {
      if (!sessionId || sessionId.trim() === '') {
        console.error('[ImageStorageService.deleteSessionAndResources] Invalid session ID');
        return false;
      }

      // Stage 1: Find all images in the session locally
      console.log(`[ImageStorageService] Starting deletion for session: ${sessionId}`);
      const session = this.sessions.find(s => s.id === sessionId);
      if (!session) {
        console.warn('[ImageStorageService] Session not found locally:', sessionId);
        return false;
      }

      const imageKeysToDelete = [...(session.imageKeys || [])];
      console.log(`[ImageStorageService] Found ${imageKeysToDelete.length} images in session`);

      // Stage 2: Collect S3 keys from all images in the session
      if (onProgress) onProgress('Collecting S3 keys...', 0, imageKeysToDelete.length);
      const s3KeysToDelete: string[] = [];
      
      for (let i = 0; i < imageKeysToDelete.length; i++) {
        const imageKey = imageKeysToDelete[i];
        const image = this.images.find(img => img.filename === imageKey);
        
        if (image) {
          if (image.originalS3Key) s3KeysToDelete.push(image.originalS3Key);
          if (image.withBoxesS3Key) s3KeysToDelete.push(image.withBoxesS3Key);
        }
        
        if (onProgress) onProgress('Collecting S3 keys...', i + 1, imageKeysToDelete.length);
      }

      console.log(`[ImageStorageService] Collected ${s3KeysToDelete.length} S3 keys to delete`);

      // Stage 3: Delete S3 objects
      if (s3KeysToDelete.length > 0) {
        if (onProgress) onProgress('Deleting S3 objects...', 0, s3KeysToDelete.length);
        
        for (let i = 0; i < s3KeysToDelete.length; i++) {
          await this.deleteS3Object(s3KeysToDelete[i]);
          if (onProgress) onProgress('Deleting S3 objects...', i + 1, s3KeysToDelete.length);
        }
      }

      // Stage 4: Delete images from local storage and Firestore
      if (onProgress) onProgress('Deleting images from storage...', 0, imageKeysToDelete.length);
      
      for (let i = 0; i < imageKeysToDelete.length; i++) {
        const imageKey = imageKeysToDelete[i];
        
        // Delete from local storage
        const imageIndex = this.images.findIndex(img => img.filename === imageKey);
        if (imageIndex >= 0) {
          const removedImage = this.images[imageIndex];
          this.images.splice(imageIndex, 1);
          
          // Delete from Firestore
          try {
            await this.deleteImageFromFirestore(removedImage);
          } catch (e) {
            console.warn('[ImageStorageService] Failed to delete image from Firestore:', e);
          }
        }
        
        if (onProgress) onProgress('Deleting images from storage...', i + 1, imageKeysToDelete.length);
      }

      // Stage 5: Delete session from local storage
      if (onProgress) onProgress('Deleting session...', 0, 1);
      this.removeSession(sessionId);
      if (onProgress) onProgress('Deleting session...', 1, 1);

      // Stage 6: Delete session from Firestore
      if (onProgress) onProgress('Finalizing...', 0, 1);
      await this.deleteSessionFromFirestore(sessionId);
      
      // Reset session counter
      this.resetSessionCounter(sessionId);

      // Persist changes to local storage
      await this._storage?.set(this.STORAGE_KEY, this.images);
      await this.persistSessions();

      if (onProgress) onProgress('Finalizing...', 1, 1);
      console.log(`✅ Session and all resources deleted successfully: ${sessionId}`);
      return true;
    } catch (error) {
      console.error('[ImageStorageService.deleteSessionAndResources] Error:', error);
      throw error;
    }
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
   * Create and post a sample image document to Firestore 'images' collection.
   * This is useful for manual verification of the collection write path.
   */
  async postSampleImageToFirestore(
    sample?: Partial<StoredImage>,
    recipientUserId?: string
  ): Promise<string | null> {
    try {
      const currentUid = await this.waitForAuthUserId();
      console.log('[ImageStorageService] currentUserId for postSampleImageToFirestore', currentUid);
      const effectiveUserId = recipientUserId || currentUid;

      if (!effectiveUserId) {
        console.warn('[ImageStorageService] No authenticated user; skipping sample Firestore image write');
        return null;
      }

      const timestamp = sample?.timestamp || new Date().toISOString();
      const docIdPrefix = recipientUserId ? 'copied' : 'sample';
      const docId = `${docIdPrefix}_${timestamp}_${Math.random().toString(36).substr(2, 9)}`;
      const now = new Date();
      const currentDateText = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const currentTimeText = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;
      const imagesCollection = collection(this.firestore, this.FIRESTORE_IMAGES_COLLECTION);
      const docRef = doc(imagesCollection, docId);
      console.log("Step 1, docID", docId, "and effectiveUserId", effectiveUserId, "and collection", imagesCollection, "docRef", docRef);

      const sampleImage: StoredImage = {
        original: sample?.original || '',
        withBoxes: sample?.withBoxes,
        boxes: sample?.boxes || [],
        faceDetected: sample?.faceDetected || false,
        faceData: sample?.faceData || [],
        timestamp,
        filename: sample?.filename || `sample-image-${timestamp}.jpg`,
        prediction: sample?.prediction || { type: 'sample', shape: 'unknown', severity: 'test' },
        hasPrediction: sample?.hasPrediction ?? true,
        statusMessage: sample?.statusMessage || 'Sample image document created for Firestore testing',
        detectionMessage: sample?.detectionMessage || 'Sample detection payload',
        sessionId: sample?.sessionId || null || 'sample-session',
        userId: effectiveUserId,
        fileImageName: `currentData:${currentDateText}TimeTaken:${currentTimeText}`,
        storagePath: sample?.storagePath || null || 'sample-session',
        storageUrl: sample?.storageUrl || null || 'sample-session',
        withBoxesStoragePath: sample?.withBoxesStoragePath || null || 'sample-session',
        withBoxesStorageUrl: sample?.withBoxesStorageUrl || null || 'sample-session',
        originalS3Key: sample?.originalS3Key || null || 'sample-session',
        originalS3Url: sample?.originalS3Url || null || 'sample-session',
        withBoxesS3Key: sample?.withBoxesS3Key || null || 'sample-session',
        withBoxesS3Url: sample?.withBoxesS3Url || null || 'sample-session',
      };

      console.log("Step 2, sampleImage", sampleImage);

      const firestoreData: any = {
        timestamp: sampleImage.timestamp,
        filename: sampleImage.filename,
        userId: effectiveUserId,
        createdBy: currentUid || effectiveUserId,
        sessionId: sampleImage.sessionId || null,
        hasPrediction: sampleImage.hasPrediction || false,
        statusMessage: sampleImage.statusMessage || '',
        detectionMessage: sampleImage.detectionMessage || '',
        prediction: sampleImage.prediction || null,
        boxes: sampleImage.boxes || [],
        originalS3Key: sampleImage.originalS3Key || null,
        originalS3Url: sampleImage.originalS3Url || null,
        storagePath: sampleImage.storagePath || null,
        storageUrl: sampleImage.storageUrl || null,
        withBoxesS3Key: sampleImage.withBoxesS3Key || null,
        withBoxesS3Url: sampleImage.withBoxesS3Url || null,
        withBoxesStoragePath: sampleImage.withBoxesStoragePath || null,
        withBoxesStorageUrl: sampleImage.withBoxesStorageUrl || null,
      };

      console.log('[ImageStorageService] Sample object to upload (images collection):', {
        docId,
        recipientUserId: effectiveUserId,
        ...firestoreData
      });

      console.log('[ImageStorageService][Auth Debug] request uid vs payload', { requestUid: currentUid, payloadUserId: firestoreData.userId, payloadCreatedBy: firestoreData.createdBy });
      await setDoc(docRef, firestoreData);
      console.log('[ImageStorageService] Sample upload succeeded for images collection');
      console.log(`✅ Sample image saved to Firestore: ${docId}`);
      return docId;
    } catch (error) {
      console.error('[ImageStorageService] Error posting sample image to Firestore:', error);
      throw error;
    }
  }

  /**
   * Version 2 of the sample image Firestore writer.
   * Accepts an imgObj plus recipientUserId and writes to the images collection.
   */
  async postSampleImageToFirestoreVersion2(
    imgObj?: Partial<StoredImage>,
    recipientUserId?: string
  ): Promise<string | null> {
    try {
      const currentUid = await this.waitForAuthUserId();
      console.log('[ImageStorageService] currentUserId for postSampleImageToFirestoreVersion2', currentUid);
      // const effectiveUserId = recipientUserId || currentUid;
      const effectiveUserId = recipientUserId;

      if (!effectiveUserId) {
        console.warn('[ImageStorageService] No authenticated user; skipping sample Firestore image write (Version2)');
        return null;
      }

      const timestamp = this.resolveFirestoreTimestamp(imgObj?.timestamp);
      const docIdPrefix = recipientUserId ? 'copied-v2' : 'sample-v2';
      // const docId = `${docIdPrefix}_${timestamp}_${Math.random().toString(36).substr(2, 9)}`;
      const docId = imgObj?.filename ? imgObj.filename.replace(/\.[^/.]+$/, '') : `${docIdPrefix}_${timestamp}_${Math.random().toString(36).substr(2, 9)}`; // Use filename without extension as doc ID if available, otherwise use generated docId
      const imagesCollection = collection(this.firestore, this.FIRESTORE_IMAGES_COLLECTION);
      const docRef = doc(imagesCollection, docId);


      
     

      const sampleImage: StoredImage = {
        original: imgObj?.originalS3Key || '',
        withBoxes: imgObj?.withBoxesS3Key,
        boxes: imgObj?.boxes || [],
        faceDetected: imgObj?.faceDetected || false,
        faceData: imgObj?.faceData || [],
        timestamp,
        filename: imgObj?.filename || `sample-image-${timestamp}.jpg`,
        prediction: imgObj?.prediction || { type: 'sample', shape: 'unknown', severity: 'test' },
        hasPrediction: imgObj?.hasPrediction ?? true,
        statusMessage: imgObj?.statusMessage || 'Sample image document created for Firestore testing',
        detectionMessage: imgObj?.detectionMessage || 'Sample detection payload',
        sessionId: this.newSessionIdForFileShare,
        userId: effectiveUserId,
        fileImageName: imgObj?.fileImageName || 'sample-image.jpg',
        storagePath: imgObj?.storagePath || null || 'sample-session',
        storageUrl: imgObj?.storageUrl || null || 'sample-session',
        withBoxesStoragePath: imgObj?.withBoxesStoragePath || null || 'sample-session',
        withBoxesStorageUrl: imgObj?.withBoxesStorageUrl || null || 'sample-session',
        originalS3Key: imgObj?.originalS3Key || null || 'sample-session',
        originalS3Url: imgObj?.originalS3Url || null || 'sample-session',
        withBoxesS3Key: imgObj?.withBoxesS3Key || null || 'sample-session',
        withBoxesS3Url: imgObj?.withBoxesS3Url || null || 'sample-session',
      };

     

      const firestoreData: any = {
        timestamp: sampleImage.timestamp,
        filename: sampleImage.filename,
        userId: effectiveUserId,
        original: sampleImage.originalS3Key,
        withBoxes: sampleImage.withBoxesS3Key,
        sessionId: this.newSessionIdForFileShare,
        hasPrediction: sampleImage.hasPrediction || false,
        statusMessage: sampleImage.statusMessage || '',
        detectionMessage: sampleImage.detectionMessage || '',
        prediction: sampleImage.prediction || null,
        boxes: sampleImage.boxes || [],
        originalS3Key: sampleImage.originalS3Key || null,
        originalS3Url: sampleImage.originalS3Url || null,
        storagePath: sampleImage.storagePath || null,
        storageUrl: sampleImage.storageUrl || null,
        withBoxesS3Key: sampleImage.withBoxesS3Key || null,
        withBoxesS3Url: sampleImage.withBoxesS3Url || null,
        withBoxesStoragePath: sampleImage.withBoxesStoragePath || null,
        withBoxesStorageUrl: sampleImage.withBoxesStorageUrl || null,
      };

      console.log('Old [ImageStorageService] Sample object to upload (images collection) Version2:', {
        docId,
        recipientUserId: effectiveUserId,
        ...firestoreData
      });

      console.log('New [ImageStorageService] Sample object to upload (images collection) Version2:', {
        docId,
        recipientUserId: effectiveUserId,
        ...sampleImage,
        createdBy: currentUid || effectiveUserId
      });

      console.log('[ImageStorageService][Auth Debug] request uid vs payload', { requestUid: currentUid, payloadUserId: effectiveUserId, payloadCreatedBy: currentUid || effectiveUserId });
      await setDoc(docRef, { ...sampleImage, createdBy: currentUid || effectiveUserId });
      console.log('[ImageStorageService] Sample upload succeeded for images collection Version2');
      console.log(`✅ Sample image saved to Firestore (Version2): ${docId}`);
      return docId;
    } catch (error) {
      console.error('[ImageStorageService] Error posting sample image to Firestore Version2:', error);
      throw error;
    }
  }

  // async postSampleImageToFirestoreVersion2(
  //   imgObj?: Partial<StoredImage>,
  //   recipientUserId?: string
  // ): Promise<string | null> {
  //   try {
  //     const currentUid = await this.waitForAuthUserId();
  //     console.log('[ImageStorageService] currentUserId for postSampleImageToFirestoreVersion2', currentUid);
  //     const effectiveUserId = recipientUserId || currentUid;

  //     if (!effectiveUserId) {
  //       console.warn('[ImageStorageService] No authenticated user; skipping sample Firestore image write (Version2)');
  //       return null;
  //     }

  //     const timestamp = this.resolveFirestoreTimestamp(imgObj?.timestamp);
  //     const docIdPrefix = recipientUserId ? 'copied-v2' : 'sample-v2';
  //     // const docId = `${docIdPrefix}_${timestamp}_${Math.random().toString(36).substr(2, 9)}`;
  //     const docId = imgObj?.filename ? imgObj.filename.replace(/\.[^/.]+$/, '') : `${docIdPrefix}_${timestamp}_${Math.random().toString(36).substr(2, 9)}`; // Use filename without extension as doc ID if available, otherwise use generated docId
  //     const imagesCollection = collection(this.firestore, this.FIRESTORE_IMAGES_COLLECTION);
  //     const docRef = doc(imagesCollection, docId);


  //     // const sampleImage: StoredImage = {
  //     //   original: imgObj?.original || '',
  //     //   withBoxes: imgObj?.withBoxes,
  //     //   boxes: imgObj?.boxes || [],
  //     //   faceDetected: imgObj?.faceDetected || false,
  //     //   faceData: imgObj?.faceData || [],
  //     //   timestamp,
  //     //   filename: imgObj?.filename || `sample-image-${timestamp}.jpg`,
  //     //   prediction: imgObj?.prediction || { type: 'sample', shape: 'unknown', severity: 'test' },
  //     //   hasPrediction: imgObj?.hasPrediction ?? true,
  //     //   statusMessage: imgObj?.statusMessage || 'Sample image document created for Firestore testing',
  //     //   detectionMessage: imgObj?.detectionMessage || 'Sample detection payload',
  //     //   sessionId: imgObj?.sessionId || null || 'sample-session',
  //     //   userId: effectiveUserId,
  //     //   fileImageName: imgObj?.fileImageName || 'sample-image.jpg',
  //     //   storagePath: imgObj?.storagePath || null || 'sample-session',
  //     //   storageUrl: imgObj?.storageUrl || null || 'sample-session',
  //     //   withBoxesStoragePath: imgObj?.withBoxesStoragePath || null || 'sample-session',
  //     //   withBoxesStorageUrl: imgObj?.withBoxesStorageUrl || null || 'sample-session',
  //     //   originalS3Key: imgObj?.originalS3Key || null || 'sample-session',
  //     //   originalS3Url: imgObj?.originalS3Url || null || 'sample-session',
  //     //   withBoxesS3Key: imgObj?.withBoxesS3Key || null || 'sample-session',
  //     //   withBoxesS3Url: imgObj?.withBoxesS3Url || null || 'sample-session',
  //     // };

     

  //     const sampleImage: StoredImage = {
  //       original: imgObj?.original || '',
  //       withBoxes: imgObj?.withBoxes,
  //       boxes: imgObj?.boxes || [],
  //       faceDetected: imgObj?.faceDetected || false,
  //       faceData: imgObj?.faceData || [],
  //       timestamp,
  //       filename: imgObj?.filename || `sample-image-${timestamp}.jpg`,
  //       prediction: imgObj?.prediction || { type: 'sample', shape: 'unknown', severity: 'test' },
  //       hasPrediction: imgObj?.hasPrediction ?? true,
  //       statusMessage: imgObj?.statusMessage || 'Sample image document created for Firestore testing',
  //       detectionMessage: imgObj?.detectionMessage || 'Sample detection payload',
  //       sessionId: imgObj?.sessionId || null || 'sample-session',
  //       userId: effectiveUserId,
  //       fileImageName: imgObj?.fileImageName || 'sample-image.jpg',
  //       storagePath: imgObj?.storagePath || null || 'sample-session',
  //       storageUrl: imgObj?.storageUrl || null || 'sample-session',
  //       withBoxesStoragePath: imgObj?.withBoxesStoragePath || null || 'sample-session',
  //       withBoxesStorageUrl: imgObj?.withBoxesStorageUrl || null || 'sample-session',
  //       originalS3Key: imgObj?.originalS3Key || null || 'sample-session',
  //       originalS3Url: imgObj?.originalS3Url || null || 'sample-session',
  //       withBoxesS3Key: imgObj?.withBoxesS3Key || null || 'sample-session',
  //       withBoxesS3Url: imgObj?.withBoxesS3Url || null || 'sample-session',
  //     };

  //     //   const firestoreData: any = {
  //     //   timestamp: sampleImage.timestamp,
  //     //   filename: sampleImage.filename,
  //     //   userId: effectiveUserId,
  //     //   sessionId: sampleImage.sessionId || null,
  //     //   hasPrediction: sampleImage.hasPrediction || false,
  //     //   statusMessage: sampleImage.statusMessage || '',
  //     //   detectionMessage: sampleImage.detectionMessage || '',
  //     //   prediction: sampleImage.prediction || null,
  //     //   boxes: sampleImage.boxes || [],
  //     //   originalS3Key: sampleImage.originalS3Key || null,
  //     //   originalS3Url: sampleImage.originalS3Url || null,
  //     //   storagePath: sampleImage.storagePath || null,
  //     //   storageUrl: sampleImage.storageUrl || null,
  //     //   withBoxesS3Key: sampleImage.withBoxesS3Key || null,
  //     //   withBoxesS3Url: sampleImage.withBoxesS3Url || null,
  //     //   withBoxesStoragePath: sampleImage.withBoxesStoragePath || null,
  //     //   withBoxesStorageUrl: sampleImage.withBoxesStorageUrl || null,
  //     // };

  //     const firestoreData: any = {
  //       timestamp: sampleImage.timestamp,
  //       filename: sampleImage.filename,
  //       userId: effectiveUserId,
  //       sessionId: sampleImage.sessionId || null,
  //       hasPrediction: sampleImage.hasPrediction || false,
  //       statusMessage: sampleImage.statusMessage || '',
  //       detectionMessage: sampleImage.detectionMessage || '',
  //       prediction: sampleImage.prediction || null,
  //       boxes: sampleImage.boxes || [],
  //       originalS3Key: sampleImage.originalS3Key || null,
  //       originalS3Url: sampleImage.originalS3Url || null,
  //       storagePath: sampleImage.storagePath || null,
  //       storageUrl: sampleImage.storageUrl || null,
  //       withBoxesS3Key: sampleImage.withBoxesS3Key || null,
  //       withBoxesS3Url: sampleImage.withBoxesS3Url || null,
  //       withBoxesStoragePath: sampleImage.withBoxesStoragePath || null,
  //       withBoxesStorageUrl: sampleImage.withBoxesStorageUrl || null,
  //     };

  //     console.log('[ImageStorageService] Sample object to upload (images collection) Version2:', {
  //       docId,
  //       recipientUserId: effectiveUserId,
  //       ...firestoreData
  //     });

  //     await setDoc(docRef, firestoreData);
  //     console.log('[ImageStorageService] Sample upload succeeded for images collection Version2');
  //     console.log(`✅ Sample image saved to Firestore (Version2): ${docId}`);
  //     return docId;
  //   } catch (error) {
  //     console.error('[ImageStorageService] Error posting sample image to Firestore Version2:', error);
  //     throw error;
  //   }
  // }

  /**
   * Normalize a Firestore timestamp value, falling back to now when no sample value is provided.
   */
  private resolveFirestoreTimestamp(sampleTimestamp?: string): string {
    if (typeof sampleTimestamp === 'string' && sampleTimestamp.trim().length > 0) {
      return sampleTimestamp;
    }

    return new Date().toISOString();
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

  /**
   * Transform an image filename to use a new userId
   * Format: userID:oldUserIdpart...sessionId:sessionIdpart...
   * Replace the old userId with new userId while preserving the rest
   * @param originalKey Original image key/filename
   * @param newUserId New user ID to use
   * @returns Transformed filename with new userId
   */
  transformImageFilenameUserId(originalKey: string, newUserId: string): string {
    // Format: userID:abc123sessionId:xyz789img1crack1041120261109original.jpg
    // Extract parts and rebuild with new userId
    const userIdMatch = originalKey.match(/userID:([^:]+)/);
    const sessionIdMatch = originalKey.match(/sessionId:([^i]+)/);
    
    if (!sessionIdMatch) {
      // If format is not recognized, just add userId prefix
      return `userID:${newUserId}${originalKey}`;
    }

    const sessionId = sessionIdMatch[1];
    const afterSessionId = originalKey.substring(originalKey.indexOf(sessionId) + sessionId.length);
    
    return `userID:${newUserId}sessionId:${sessionId}${afterSessionId}`;
  }

  /**
   * Copy a session with transformed filenames for a new user
   * This creates a new session from an existing one, transforming image filenames and userId
   * @param originalSession Original session to copy
   * @param newUserId New user ID for the copy
   * @param onProgress Optional progress callback
   * @returns Promise<ImageSession> The new copied session
   */
  async copySessionForUser(
    originalSession: any,
    newUserId: string,
    onProgress?: (current: number, total: number, status: string) => void
  ): Promise<ImageSession> {
    try {
      const updateProgress = (current: number, total: number, status: string) => {
        if (onProgress) {
          onProgress(Math.min(current, total), total, status);
        }
      };

      updateProgress(5, 100, 'Initializing session copy...');

      // Step 1: Create NEW session with unique ID
      const newSessionId = this.generateSessionId();
      console.log('[ImageStorageService] Original session ID:', originalSession.id);
      console.log('[ImageStorageService] New copied session ID:', newSessionId);

      const newSession: ImageSession = {
        id: newSessionId,
        name: originalSession.name,
        imageKeys: [],
        created: new Date().toISOString(),
        totalBoundingBoxes: originalSession.totalBoundingBoxes || 0,
        userId: newUserId,
        sessionId: newSessionId
      };

      updateProgress(15, 100, 'Fetching images from S3...');

      // Step 2: Fetch and transform images
      const transformedImages: StoredImage[] = [];
      const sessionImageKeys = originalSession.imageKeys || [];
      const totalImages = sessionImageKeys.length;

      for (let i = 0; i < totalImages; i++) {
        const imageKey = sessionImageKeys[i];
        const originalImage = this.selectImageByKey(imageKey);

        if (!originalImage) {
          console.warn('[ImageStorageService] Original image not found:', imageKey);
          continue;
        }

        updateProgress(
          15 + ((i) / totalImages) * 40,
          100,
          `Fetching image ${i + 1}/${totalImages} from S3...`
        );

        // Fetch from S3 if URLs exist
        let originalDataUrl = originalImage.original;
        let withBoxesDataUrl = originalImage.withBoxes;

        if (originalImage.originalS3Key) {
          try {
            const fetchedOriginal = await this.fetchS3ObjectAsDataUrl(originalImage.originalS3Key);
            if (fetchedOriginal) originalDataUrl = fetchedOriginal;
          } catch (e) {
            console.warn('[ImageStorageService] Failed to fetch original from S3:', e);
          }
        }

        if (originalImage.withBoxesS3Key) {
          try {
            const fetchedWithBoxes = await this.fetchS3ObjectAsDataUrl(originalImage.withBoxesS3Key);
            if (fetchedWithBoxes) withBoxesDataUrl = fetchedWithBoxes;
          } catch (e) {
            console.warn('[ImageStorageService] Failed to fetch withBoxes from S3:', e);
          }
        }

        // Transform filename to use new userId
        const newFilename = this.transformImageFilenameUserId(imageKey, newUserId);

        const transformedImage: StoredImage = {
          ...originalImage,
          original: originalDataUrl,
          withBoxes: withBoxesDataUrl,
          filename: newFilename,
          userId: newUserId,
          sessionId: newSession.id
        };

        transformedImages.push(transformedImage);
        console.log('[ImageStorageService] Transformed image:', newFilename);
      }

      // Update session imageKeys with new filenames
      newSession.imageKeys = transformedImages.map(img => img.filename);

      updateProgress(60, 100, 'Storing images locally...');

      // Step 3: Store transformed images
      for (let i = 0; i < transformedImages.length; i++) {
        const image = transformedImages[i];
        this.setEntryForImage(image.filename, image);
        await this.saveImageToUser(newUserId, image);
        updateProgress(60 + ((i + 1) / transformedImages.length) * 25, 100, `Storing image ${i + 1}/${transformedImages.length}...`);
      }

      updateProgress(85, 100, 'Saving session...');

      // Step 4: Save session to user
      await this.saveSessionToUser(newUserId, newSession);

      updateProgress(100, 100, 'Session copy completed!');

      console.log('[ImageStorageService] ====== SESSION COPY COMPLETED ======');
      console.log('[ImageStorageService] ORIGINAL SESSION (unchanged):');
      console.log(`  - ID: ${originalSession.id}`);
      console.log(`  - User: ${originalSession.userId}`);
      console.log(`  - Name: ${originalSession.name}`);
      console.log(`  - Images: ${originalSession.imageKeys?.length || 0}`);
      console.log('[ImageStorageService] NEW COPIED SESSION (current user):');
      console.log(`  - ID: ${newSession.id}`);
      console.log(`  - User: ${newUserId}`);
      console.log(`  - Name: ${newSession.name}`);
      console.log(`  - Images: ${transformedImages.length}`);
      console.log('[ImageStorageService] ====== END SESSION COPY ======');

      return newSession;
    } catch (error) {
      console.error('[ImageStorageService] Error during session copy:', error);
      throw error;
    }
  }

    // NEW METHOD: Tells S3 to duplicate a file directly inside the cloud
  async copyFile(sourceKey: string, newKey: string): Promise<{ success: boolean; key: string }> {
  try {
    const command = new CopyObjectCommand({
      Bucket: this.bucketName,
      CopySource: encodeURI(`${this.bucketName}/${sourceKey}`),
      Key: newKey,
    });

    const response = await this.s3Client.send(command);

    // Check if the response from AWS includes the CopyObjectResult
    if (response.$metadata.httpStatusCode === 200) {
      console.log(`✅ AWS S3: Successfully copied ${sourceKey} to ${newKey}`);
      return { success: true, key: newKey };
    } else {
      throw new Error('S3 returned a non-200 status code');
    }
  } catch (error) {
    console.error('❌ AWS S3: Copy Failed', error);
    throw error;
  }
}

async verifyImageExists(key: string): Promise<void> {
  try {
    // We only need HeadObject to check if the file exists
    const command = new HeadObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    // Send the request to AWS
    await this.s3Client.send(command);

    // If the line above doesn't throw an error, the image was found!
    console.log(`%c ✅ Successfully found image from key: ${key}`, 'color: #28a745; font-weight: bold;');
    
    // As per your request, we do not return a value here.
  } catch (error: any) {
    // If S3 returns a 404, it means the key doesn't exist
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      console.warn(`%c ❌ Image not found: The key "${key}" does not exist in the bucket.`, 'color: #dc3545;');
    } else {
      console.error('❌ An error occurred while contacting S3:', error.message);
    }
    
    // We do not return a value even on failure.
  }
}

  // /**
  //  * Get entry for an image by key (helper method for external use)
  //  */
  // getEntryForImage(imageKey: string): StoredImage | undefined {
  //   return this.selectImageByKey(imageKey);
  // }

   /**
   * Fetches metadata and a secure URL for a specific S3 Key
   */
  async fetchSpecificImage(key: string) {
    try {
      // 1. Get the Metadata (Size, Content Type, Dates)
      const headCommand = new HeadObjectCommand({ Bucket: this.bucketName, Key: key });
      const metadata = await this.s3Client.send(headCommand);

      // 2. Get the Secure Display URL
      const getCommand = new GetObjectCommand({ Bucket: this.bucketName, Key: key });
      const url = await getSignedUrl(this.s3Client, getCommand, { expiresIn: 3600 });

      // Print success to console as requested!
      console.log(`✅ Success! Found image: ${key}`);

      return {
        url: url,
        details: {
          key: key,
          contentType: metadata.ContentType,
          sizeBytes: metadata.ContentLength,
          lastModified: metadata.LastModified
        }
      };
    } catch (error) {
      console.error(`❌ Could not find image with key: ${key}`, error);
      throw error;
    }
  }

async checkIfFileExists(key: string): Promise<boolean> {
  try {
    const command = new HeadObjectCommand({
      Bucket: 'my-angular-test-bucket-12345',
      Key: key
    });

    console.log(`🌐 S3 Service: Checking existence of ${key}...`);
    await this.s3Client.send(command);
    return true; // File exists
  } catch (error: any) {
    // If S3 returns 404, it throws a 'NotFound' error
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    // If it's a 403 or other error, rethrow it so app.ts can handle it
    throw error;
  }
}

// async getMetadata(key: string): Promise<any> {
//   console.log(`🌐 S3 Service [START]: Fetching metadata for key: ${key}`);

//   try {
//     const command = new HeadObjectCommand({
//       Bucket: 'my-angular-test-bucket-12345',
//       Key: key
//     });

//     // Send the command to AWS
//     const response = await this.s3Client.send(command);
    
//     console.log(`🌐 S3 Service [SUCCESS]: Metadata retrieved for ${key}`);
    
//     // This response contains: ContentType, ContentLength, LastModified, etc.
//     return response;

//   } catch (error: any) {
//     console.error(`🌐 S3 Service [ERROR]: Could not get metadata for ${key}`, error);
    
//     // Propagate the error so the UI can catch it (e.g., for 404 or 403 errors)
//     throw error;
//   }
// }

async getMetadata(key: string): Promise<any> {
  console.log(`🌐 Service [START]: Fetching metadata natively for key: ${key}`);

  const bucketBaseUrl = 'https://my-angular-test-bucket-12345.s3.ap-southeast-2.amazonaws.com/';
  // Use a cache-buster so the browser doesn't use the old failed CORS request
  const url = `${bucketBaseUrl}${key}?t=${new Date().getTime()}`;

  try {
    // 1. Native Fetch instead of HeadObjectCommand
    const response = await fetch(url, {
      method: 'HEAD',
      mode: 'cors'
    });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status} - ${response.statusText}`);
    }

    console.log(`🌐 Service [SUCCESS]: Native metadata retrieved for ${key}`);

    // 2. Read the standard HTTP headers
    // Note: To read these, your S3 CORS ExposeHeaders MUST include them
    return {
      ContentType: response.headers.get('content-type'),
      ContentLength: response.headers.get('content-length'),
      LastModified: response.headers.get('last-modified')
    };

  } catch (error: any) {
    console.error(`🌐 Service [ERROR]: Native fetch failed for ${key}`, error);
    throw error; // Let the UI handle the alert
  }
}
  
}

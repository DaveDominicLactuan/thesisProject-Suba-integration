import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { NavController, Platform } from '@ionic/angular';
import { Auth3Service } from '../services/auth3.service';
import { ImageStorageService } from '../services/image-storage.service';
import { App } from '@capacitor/app';
import { jsPDF } from 'jspdf';

@Component({
  selector: 'app-session-page',
  templateUrl: './session-page.page.html',
  styleUrls: ['./session-page.page.scss'],
  standalone: false
})
export class SessionPagePage implements OnInit, OnDestroy {
  userName: string | null = null;
  firstName: string | null = null;
  lastName: string | null = null;
  email: string | null = null;
  engineeringID: string | null = null;
  userID: string | null = null; // Firebase UID - used to filter sessions by user
  sessions: any[] = [];
  lastSessionDisplayName: string | null = null;
  private backButtonSub: any; // hardware back handler
  isLoggedIn: boolean = false;
  userRole: string | null = null;
  isSidebarOpen: boolean = false;
  isSortOverlayOpen: boolean = false;
  currentSort: string = 'time-newest'; // default sorting
  syncStatusText: string = 'Not synced';
  syncStatusState: 'idle' | 'syncing' | 'completed' | 'error' = 'idle';
  
  // --- Session Confirmation Dialog State ---
  isSessionConfirmDialogOpen: boolean = false;
  selectedSessionForConfirm: any = null;

  // --- Session Loading/Progress Dialog State ---
  isSessionLoadingDialogOpen: boolean = false;
  selectedSessionForLoading: any = null;
  sessionLoadingProgress: number = 0;
  sessionLoadingStatusText: string = 'Preparing session...';
  sessionLoadingImageCount: { current: number; total: number } = { current: 0, total: 0 };

  // --- Session Delete Confirmation Dialog State ---
  isSessionDeleteConfirmDialogOpen: boolean = false;
  selectedSessionForDelete: any = null;

  // --- Session Delete Progress Dialog State ---
  isSessionDeleteProgressDialogOpen: boolean = false;
  selectedSessionForDeleteProgress: any = null;
  sessionDeleteProgress: number = 0;
  sessionDeleteStatusText: string = 'Preparing deletion...';
  sessionDeleteStageCount: { current: number; total: number } = { current: 0, total: 0 };

  // --- Session ID Tracking for Local Storage ---
  private readonly MAX_SESSION_IDS = 5;
  private sessionIdTrackingKey = 'sessionIdTracking';
  private sessionIdListKey = 'storedSessionIds';

  /** Inject auth, router, and image storage services for navigation and data. */
  constructor(private formBuilder: FormBuilder, private router: Router, private authService: AuthService, private navCtrl: NavController, private auth3: Auth3Service, private imageStorage: ImageStorageService, private platform: Platform) {

  }

ngOnInit(): void {
  
  //initializes the data needed for the page such as user data, profile and session
  this.initialize();
}

/** Perform async initialization tasks (profile + sessions). */
private async initialize(): Promise<void> {
  console.log('[SessionPage.initialize] ===== PAGE INIT START =====');
  try {
    const storedProfile = this.readStoredUserProfile();
    if (storedProfile) {
      this.userID = storedProfile.userID || null;
      this.firstName = storedProfile.firstName || null;
      this.lastName = storedProfile.lastName || null;
      this.userName = storedProfile.username || null;
      this.userRole = storedProfile.userRole || 'user';
      this.email = storedProfile.email || null;
      this.engineeringID = storedProfile.engineeringID || null;
      console.log('[SessionPage.initialize] Loaded user profile from storage');
    }

    this.userID = this.userID || this.getStoredUserId() || this.auth3.getCurrentUser()?.uid || null;
    this.isLoggedIn = !!this.userID;

    // Step 2: Load sessions immediately from local storage for quick UI display
    // Don't wait for Firestore — display what we have locally first
    console.log('[SessionPage.initialize] Loading sessions from local storage (non-blocking)...');
    await this.loadSessions().catch(e => console.warn('[SessionPage.initialize] loadSessions failed:', e));

    // Step 3: Start background sync for Firestore data without blocking UI
    const resolvedUserId = this.userID || this.auth3.getCurrentUser()?.uid || '';
    if (resolvedUserId) {
      this.startUserSyncInBackground(resolvedUserId);
    }
  } catch (error) {
    console.error('[SessionPage.initialize] Fatal initialization error:', error);
  }
}

private readStoredUserProfile(): any | null {
  try {
    const cached = localStorage.getItem('userData');
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (e) {
    console.warn('[SessionPage.readStoredUserProfile] Failed to load cache:', e);
  }
  return null;
}

/**
 * Start background sync of user data from Firestore without blocking UI.
 * Runs continuously to keep local data in sync.
 */
private startUserSyncInBackground(userId: string): void {
  if (!userId) return;
  
  console.log('[SessionPage.startUserSyncInBackground] Starting background sync for user:', userId);
  
  // Run sync without awaiting — don't block the page
  this.syncUserDataFromFirestore(userId)
    .then(() => {
      console.log('[SessionPage.startUserSyncInBackground] Background sync completed');
      // Reload sessions to reflect any changes from Firestore
      return this.loadSessions();
    })
    .catch(error => {
      console.warn('[SessionPage.startUserSyncInBackground] Background sync failed:', error);
    });
}

  // Called by Ionic when page becomes active — refresh and loads sessions/counts/
  /** Ionic hook: refresh sessions each time page becomes active. */
  ionViewWillEnter() {
    // Ensure any existing back button handlers are cleared before entering
    this.removeBackButtonHandler();
    
    // Refresh sessions and sync status
    this.loadSessions().catch(e => console.warn('[SessionPage.ionViewWillEnter] loadSessions failed:', e));
    
    const uid = this.userID || this.auth3.getCurrentUser()?.uid || '';
    if (uid) {
      this.loadPersistedSyncStatus(uid);
      // Optionally refresh Firestore sync on page re-entry
      this.startUserSyncInBackground(uid);
    }
  }

  private getSyncStatusStorageKey(userId: string): string {
    return `user_sync_status_${userId}`;
  }

  private getSyncBootstrapDoneKey(userId: string): string {
    return `user_sync_bootstrap_done_${userId}`;
  }

  private clearSyncStateForUser(userId: string): void {
    if (!userId) return;
    try { localStorage.removeItem(this.getSyncStatusStorageKey(userId)); } catch {}
    try { sessionStorage.removeItem(this.getSyncBootstrapDoneKey(userId)); } catch {}
  }

  private loadPersistedSyncStatus(userId: string): void {
    if (!userId) return;
    try {
      const raw = localStorage.getItem(this.getSyncStatusStorageKey(userId));
      if (!raw) return;
      const parsed = JSON.parse(raw);
      this.syncStatusState = parsed?.state || 'idle';
      this.syncStatusText = parsed?.text || 'Not synced';
    } catch {
      this.syncStatusState = 'idle';
      this.syncStatusText = 'Not synced';
    }
  }

  /** Register hardware back handler only while this view is active, 
   * allowing for hardware back button navigation */
  ionViewDidEnter() {
    // Double-check removal of any lingering handlers before registering new one
    this.removeBackButtonHandler();
    this.registerBackButtonHandler();
  }

  /** Remove hardware back handler when navigating away so other pages work normally, 
   * so as to keep logic for exiting the app inside home-page and not affect other pages*/
  ionViewWillLeave() {
    this.removeBackButtonHandler();
  }

  /** Load sessions from Firestore first (to get all user sessions), then local storage. Compute image counts and filter by current user's ID. */
  async loadSessions(): Promise<void> {
    try {
      // ========== USER ID RESOLUTION ==========
      // Get current user ID from Firebase auth, localStorage, or sessionStorage
      let currentUserID = this.userID;
      if (!currentUserID) {
        // Try to get from localStorage
        try {
          const userData = localStorage.getItem('userData');
          if (userData) {
            const parsed = JSON.parse(userData);
            currentUserID = parsed.userID || null;
          }
        } catch {}
      }
      if (!currentUserID) {
        // Try to get from sessionStorage
        try {
          const sessionProfile = sessionStorage.getItem('userProfile');
          if (sessionProfile) {
            const parsed = JSON.parse(sessionProfile);
            currentUserID = parsed.userID || null;
          }
        } catch {}
      }
      if (!currentUserID) {
        // Try to get from authenticated Firebase user
        try {
          currentUserID = this.auth3.getCurrentUser()?.uid || null;
        } catch {}
      }

      console.log('[SessionPage.loadSessions] Current user ID:', currentUserID);

      // ========== FETCH FROM FIRESTORE ==========
      // Fetch sessions from Firestore first to ensure we get all sessions (like chat-page does)
      let sessionsRaw: any[] = [];
      if (currentUserID) {
        try {
          console.log('[SessionPage.loadSessions] Fetching sessions from Firestore for user:', currentUserID);
          const firebaseSessions = await this.auth3.getUserSessions(currentUserID);
          sessionsRaw = Array.isArray(firebaseSessions) ? firebaseSessions : [];
          console.log('[SessionPage.loadSessions] Fetched', sessionsRaw.length, 'sessions from Firestore');

          // Sync Firestore sessions to local storage for offline support
          for (const fsSession of sessionsRaw) {
            const session = {
              id: fsSession.id || fsSession.sessionId || `s-${Date.now()}`,
              name: fsSession.name || 'Untitled Session',
              imageKeys: Array.isArray(fsSession.imageKeys) ? fsSession.imageKeys : [],
              created: fsSession.created || new Date().toISOString(),
              userId: currentUserID
            };
            try {
              this.imageStorage.addSessionIfNotExists(session as any);
            } catch (e) {
              console.warn('[SessionPage.loadSessions] Failed to add session to local storage:', session.id, e);
            }
          }
        } catch (error) {
          console.warn('[SessionPage.loadSessions] Failed to fetch sessions from Firestore, falling back to local storage:', error);
          // Fallback to local storage if Firestore fetch fails
          const s = (this.imageStorage.getSessions && typeof this.imageStorage.getSessions === 'function') ? this.imageStorage.getSessions() : [];
          sessionsRaw = Array.isArray(s) ? s.slice() : [];
        }
      } else {
        // No user ID available, use local storage only
        const s = (this.imageStorage.getSessions && typeof this.imageStorage.getSessions === 'function') ? this.imageStorage.getSessions() : [];
        sessionsRaw = Array.isArray(s) ? s.slice() : [];
      }

      // Filter sessions to only include those belonging to the current user
      // Sessions without userId are legacy sessions (show them for backward compatibility)
      // Sessions with userId must match the current user's ID
      const filteredSessions = sessionsRaw.filter((sess: any) => {
        // If session has no userId, include it (backward compatibility with old sessions)
        if (!sess.userId) {
          console.log('[SessionPage.loadSessions] Including legacy session (no userId):', sess.id);
          return true;
        }
        // If session has userId, only include if it matches current user
        const isOwnSession = sess.userId === currentUserID;
        if (!isOwnSession) {
          console.log('[SessionPage.loadSessions] Excluding session from different user:', sess.id, 'session userId:', sess.userId, 'current user:', currentUserID);
        }
        return isOwnSession;
      });

      // compute image counts by comparing session imageKeys with stored images with 
      // geAllImages or getImages if fails into a arrayt allImages from the imageStorage not in sessions
      let allImages: any[] = [];
      try {
        // Prefer async or sync `getAllImages` when available
        if (typeof (this.imageStorage as any).getAllImages === 'function') {
          const res = (this.imageStorage as any).getAllImages();
          allImages = (res && typeof (res as Promise<any>).then === 'function') ? await res : res;
        } else if (typeof (this.imageStorage as any).getImages === 'function') {
          const res = (this.imageStorage as any).getImages();
          allImages = (res && typeof (res as Promise<any>).then === 'function') ? await res : res;
        } else {
          allImages = [];
        }
        // if it failed and returned a non array, or null or something else replace it with an empty array
        if (!Array.isArray(allImages)) allImages = [];
      } catch (e) {
        // fallback to synchronous call if async attempt failed
        try { allImages = (this.imageStorage as any).getImages ? (this.imageStorage as any).getImages() : []; } catch (ee) { allImages = []; }
        if (!Array.isArray(allImages)) allImages = [];
      }

      // counts how many imageKeys or images in the filtered sessions are present in allImages
      this.sessions = filteredSessions.map((sess: any) => {
        const keys = Array.isArray(sess.imageKeys) ? sess.imageKeys : [];
        const imageCount = keys.reduce((acc: number, k: string) => acc + (allImages.findIndex(ai => ai.filename === k) !== -1 ? 1 : 0), 0);
        return { ...sess, imageCount };
      });
      console.log('[SessionPage.loadSessions] Displaying', this.sessions.length, 'sessions for user', currentUserID);
      // if Image Storage Service recorded a last created session or last used/created session,
      //  show its name at top of the summary list
      try {
        const lastName = (this.imageStorage as any).getLastCreatedSessionName ? (this.imageStorage as any).getLastCreatedSessionName() : null;
        if (lastName && lastName.length > 0) {
          this.lastSessionDisplayName = lastName;
        } else if (this.sessions && this.sessions.length > 0) {
          // placeholder: Session N where N is number of sessions
          this.lastSessionDisplayName = `Session ${this.sessions.length}`;
        } else {
          this.lastSessionDisplayName = null;
        }
      } catch (e) {
        this.lastSessionDisplayName = null;
      }
    } catch (e) {
      console.warn('Failed to load sessions', e);
      this.sessions = [];
    }
  }

  /**
   * Sync user's sessions and images from Firestore to local ImageStorageService.
   * Runs in background and deduplicates local writes.
   */
  private async syncUserDataFromFirestore(userId: string): Promise<void> {
    if (!userId) {
      console.warn('[SessionPage.syncUserDataFromFirestore] No userId provided, skipping sync');
      return;
    }

    try {
      console.log('[SessionPage.syncUserDataFromFirestore] ====== STARTING SYNC ======');
      console.log('[SessionPage.syncUserDataFromFirestore] Starting sync for userId:', userId);

      // Fetch user sessions from Firestore
      const firebaseSessions = await this.auth3.getUserSessions(userId);
      console.log('[SessionPage.syncUserDataFromFirestore] Fetched', firebaseSessions.length, 'sessions from Firestore');

      // Fetch user images from Firestore
      const firestoreImages = await this.auth3.getUserImages(userId);
      console.log('[SessionPage.syncUserDataFromFirestore] Fetched', firestoreImages.length, 'images from Firestore');

      let sessionsAdded = 0;
      let imagesAdded = 0;

      // Build local copies without verbose per-item logging to keep sync fast.
      console.log('[SessionPage.syncUserDataFromFirestore] Building local session/image copies...');

      for (let sessionIdx = 0; sessionIdx < firebaseSessions.length; sessionIdx++) {
        const fsSession = firebaseSessions[sessionIdx];

        // STEP 1.1: Create a deep copy of the session object
        const sessionCopy = {
          id: fsSession.id || fsSession.sessionId || `s-${Date.now()}`,
          name: fsSession.name || 'Untitled Session',
          imageKeys: Array.isArray(fsSession.imageKeys) ? [...fsSession.imageKeys] : [],
          created: fsSession.created || new Date().toISOString(),
          userId: userId,
          totalBoundingBoxes: fsSession.totalBoundingBoxes || 0,
          sessionId: fsSession.sessionId || fsSession.id
        };

        // ====== STEP 1.2: MAKE COPIES OF SESSION IMAGE OBJECTS ======

        const sessionImageCopies: any[] = [];
        const imageKeysToProcess = sessionCopy.imageKeys || [];

        for (let imgKeyIdx = 0; imgKeyIdx < imageKeysToProcess.length; imgKeyIdx++) {
          const imageKey = imageKeysToProcess[imgKeyIdx];

          // Find the corresponding Firestore image
          const fsImage = firestoreImages.find((img: any) => img.filename === imageKey || img.id === imageKey);

          if (!fsImage) {
            continue;
          }

          // Create a deep copy of the image object
          const imageCopy = {
            original: fsImage.original || '',
            withBoxes: fsImage.withBoxes || fsImage.original || '',
            boxes: Array.isArray(fsImage.boxes) ? [...fsImage.boxes] : [],
            faceDetected: !!fsImage.faceDetected,
            faceData: Array.isArray(fsImage.faceData) ? [...fsImage.faceData] : [],
            timestamp: fsImage.timestamp || new Date().toISOString(),
            detectionMessage: fsImage.detectionMessage || '',
            filename: fsImage.filename || fsImage.id || '',
            statusMessage: fsImage.statusMessage || '',
            hasPrediction: !!fsImage.hasPrediction,
            prediction: fsImage.prediction ? { ...fsImage.prediction } : undefined,
            userId: userId,
            sessionId: fsImage.sessionId || sessionCopy.id,
            originalS3Key: fsImage.originalS3Key || '',
            originalS3Url: fsImage.originalS3Url || '',
            withBoxesS3Key: fsImage.withBoxesS3Key || '',
            withBoxesS3Url: fsImage.withBoxesS3Url || '',
            withBoxesStoragePath: fsImage.withBoxesStoragePath || '',
            withBoxesStorageUrl: fsImage.withBoxesStorageUrl || '',
            storagePath: fsImage.storagePath || '',
            storageUrl: fsImage.storageUrl || ''
          };

          sessionImageCopies.push(imageCopy);
        }

        // ====== STEP 2: REPLACE USER ID IN SESSION AND IMAGE OBJECTS ======

        // Update imageKeys with new userId prefix if needed
        const updatedImageKeys: string[] = [];
        for (let i = 0; i < sessionCopy.imageKeys.length; i++) {
          const oldKey = sessionCopy.imageKeys[i];
          updatedImageKeys.push(oldKey);
        }
        sessionCopy.imageKeys = updatedImageKeys;

        // Update all image copies with new userId
        for (let i = 0; i < sessionImageCopies.length; i++) {
          const imageCopy = sessionImageCopies[i];
          imageCopy.userId = sessionCopy.userId;
        }

        console.log(`[SessionPage.syncUserDataFromFirestore] Prepared session ${sessionCopy.id} with ${sessionImageCopies.length} image(s)`);

        // Add session to storage
        const added = this.imageStorage.addSessionIfNotExists(sessionCopy as any);
        if (added) {
          sessionsAdded += 1;
        }

        // Add all images to storage
        for (const imageCopy of sessionImageCopies) {
          const imageAdded = await this.imageStorage.addImageIfNotExists(imageCopy as any, imageCopy.sessionId);
          if (imageAdded) {
            imagesAdded += 1;
          }
        }
      }

      console.log('[SessionPage.syncUserDataFromFirestore] ====== SYNC COMPLETED SUCCESSFULLY ======');
      console.log('[SessionPage.syncUserDataFromFirestore] Sync completed successfully', {
        sessionsFetched: firebaseSessions.length,
        sessionsAdded,
        imagesFetched: firestoreImages.length,
        imagesAdded
      });
    } catch (error) {
      console.error('[SessionPage.syncUserDataFromFirestore] ====== ERROR DURING SYNC ======');
      console.error('[SessionPage.syncUserDataFromFirestore] ERROR during sync:', error);
      throw error;
    }
  }

  // Additional methods can be added here
  
  /** Navigate to enhanced camera page with sessions support. */
  goToCameraPage2() {
    this.router.navigate(['/camera-page2']);
    console.log('camera page');
  }

  /** Navigate to enhanced camera page with sessions support. */
  goToHomePage() {
    this.router.navigate(['/home-page2']);
    console.log('camera page');
  }

  /** Navigate to custom camera test page. */
  goTestCameraPage() {
    this.router.navigate(['/custom-camera-test']);
    console.log('custom camera');
  }

  /** Navigate to PDF test page. */
  gopdfPage() {
    this.router.navigate(['/pdf-page-test']);
    console.log('pdf page');
  }

  /** Navigate to camera page 2 (alt entry). */
  gopdfPage2() {
    this.router.navigate(['/camera-page2']);
    console.log('pdf 2 page');
  }

  /** Navigate to sessions list page. */
  goSessionPage() {
    // this.router.navigate(['/session-page']);
    console.log('pdf 2 page');
  }

  /** Navigate to profile page. */
  goToProfilePage() {
    this.router.navigate(['/profile-page']);
    console.log('Navigating to profile page');
  }

  /** Shared logout flow used by overlay button and menu item. */
  async logout(closeOverlay: boolean = false) {
    console.log('[SessionPage.logout] Logout initiated');
    
    // Close sidebar immediately to provide user feedback
    this.isSidebarOpen = false;
    
    // Get current user ID before we start clearing
    const currentUserId = this.userID || this.auth3.getCurrentUser()?.uid || '';
    
    // Clear all user-related data
    try {
      await this.clearAllUserData(currentUserId);
    } catch (error) {
      console.error('[SessionPage.logout] Error during data cleanup:', error);
    }

    // Clear sync state for user
    if (currentUserId) {
      this.clearSyncStateForUser(currentUserId);
    }
    
    this.syncStatusState = 'idle';
    this.syncStatusText = 'Not synced';
    
    try {
      await this.auth3.logout();
    } catch {}
    
    this.isLoggedIn = false;
    if (closeOverlay) {
      this.removeTestOverlay();
    }
    // Navigate to landing page replacing history so next back exits
    try {
      this.router.navigateByUrl('/landing-page', { replaceUrl: true });
    } catch {
      this.router.navigate(['/landing-page']);
    }
  }

  /**
   * Centralized function to clear ALL user-related data from local and session storage.
   * Called on logout to ensure no user data persists for the next login.
   */
  private async clearAllUserData(userId: string): Promise<void> {
    console.log('[SessionPage.clearAllUserData] Beginning complete user data cleanup', { userId });

    // Clear localStorage keys
    const localStorageKeys = [
      'isLoggedIn',
      'userData',
      'userProfile',
      'currentSessionId',
      'currentUserId'
    ];

    for (const key of localStorageKeys) {
      try {
        localStorage.removeItem(key);
      } catch (e) {
        console.warn(`[SessionPage.clearAllUserData] Failed to remove localStorage key: ${key}`, e);
      }
    }

    // Clear sessionStorage keys
    const sessionStorageKeys = [
      'userProfile',
      'isLoggedInSession'
    ];

    for (const key of sessionStorageKeys) {
      try {
        sessionStorage.removeItem(key);
      } catch (e) {
        console.warn(`[SessionPage.clearAllUserData] Failed to remove sessionStorage key: ${key}`, e);
      }
    }

    // Clear user-specific storage keys (dynamic keys based on userId)
    if (userId) {
      const userSpecificKeys = [
        `user_sync_status_${userId}`,
        `user_sync_bootstrap_done_${userId}`
      ];

      for (const key of userSpecificKeys) {
        try {
          localStorage.removeItem(key);
          sessionStorage.removeItem(key);
        } catch (e) {
          console.warn(`[SessionPage.clearAllUserData] Failed to remove user-specific key: ${key}`, e);
        }
      }
    }

    // Clear sessions and images from ImageStorageService
    try {
      if (this.imageStorage && typeof this.imageStorage.clear === 'function') {
        await this.imageStorage.clear();
        console.log('[SessionPage.clearAllUserData] Cleared all images from storage');
      }
    } catch (e) {
      console.warn('[SessionPage.clearAllUserData] Failed to clear images', e);
    }

    // Clear sessions from Ionic Storage
    try {
      if ((this.imageStorage as any)._storage) {
        await (this.imageStorage as any)._storage?.remove('stored_image_sessions');
        console.log('[SessionPage.clearAllUserData] Cleared all sessions from storage');
      }
    } catch (e) {
      console.warn('[SessionPage.clearAllUserData] Failed to clear sessions', e);
    }

    console.log('[SessionPage.clearAllUserData] Complete user data cleanup finished');
  }

  /**
   * Open the Feedback page pre-selecting a session. Select its first image in
   * ImageStorageService so detail UIs can initialize accordingly.
  * Before navigating, prepare the selected session in local storage.
   */
  // Show confirmation dialog when session is clicked
  onSessionItemClick(session: any, event?: Event): void {
    if (event) event.stopPropagation();
    console.log('[SessionPage] Session click detected. Starting load process for session:', session.id);
    this.loadAndNavigateToSession(session);
  }

  // Close loading dialog without action
  closeSessionLoadingDialog(): void {
    this.isSessionLoadingDialogOpen = false;
    this.selectedSessionForLoading = null;
    this.sessionLoadingProgress = 0;
    this.sessionLoadingStatusText = 'Preparing session...';
    this.sessionLoadingImageCount = { current: 0, total: 0 };
  }

  // Prepare the selected session and navigate to feedback page
  private async loadAndNavigateToSession(session: any): Promise<void> {
    try {
      this.selectedSessionForLoading = session;
      this.isSessionLoadingDialogOpen = true;
      this.sessionLoadingProgress = 0;
      this.sessionLoadingStatusText = 'Preparing session...';
      this.sessionLoadingImageCount = { current: 0, total: 0 };

      // Ensure session images are fetched from Firestore/S3 before navigation
      // so FeedbackPage has hydrated entries to display.
      const sessionId = session?.id || '';
      const uid = this.userID || this.auth3.getCurrentUser()?.uid || session?.userId || '';
      if (sessionId && uid && typeof (this.imageStorage as any).fetchSessionImagesFromS3 === 'function') {
        this.sessionLoadingStatusText = 'Fetching session images from S3...';
        this.sessionLoadingImageCount = { current: 0, total: Math.max(session?.imageKeys?.length || 0, 1) };
        try {
          await (this.imageStorage as any).fetchSessionImagesFromS3(
            sessionId,
            uid,
            (current: number, total: number) => {
              this.sessionLoadingImageCount = { current, total };
              this.sessionLoadingProgress = total > 0 ? Math.round((current / total) * 100) : 0;
              this.sessionLoadingStatusText = `Loading session images... ${current}/${total}`;
            }
          );
        } catch (fetchErr) {
          console.warn('[SessionPage] fetchSessionImagesFromS3 failed before navigation; continuing', fetchErr);
        }
      }

      // Select the first image for feedback-page
      if (session && session.imageKeys && session.imageKeys.length > 0) {
        const key = session.imageKeys[0];
        if (this.imageStorage && typeof this.imageStorage.selectImageByOriginal === 'function') {
          this.imageStorage.selectImageByOriginal(key);
        }
      }

      if (session?.id) {
        this.trackSessionIdForLocalStorage(session.id);
      }

      // Close dialog and navigate
      this.closeSessionLoadingDialog();

      // Remove HomePage back handler before navigating
      try { this.removeBackButtonHandler(); } catch (e) { /* ignore */ }

      // Build params and navigate
      const params: any = {};
      if (session && session.id) params.sessionId = session.id;
      this.router.navigate(['/feedback-page'], { queryParams: params });
    } catch (e) {
      console.error('[SessionPage] loadAndNavigateToSession failed:', e);
      this.closeSessionLoadingDialog();
      // Try navigation anyway as fallback
      this.router.navigate(['/feedback-page']);
    }
  }

  // Track sessionId for local storage management (keep at least 5 unique sessionIds)
  private trackSessionIdForLocalStorage(sessionId: string): void {
    try {
      let storedSessions: { sessionId: string; timestamp: number }[] = [];
      
      // Load existing session tracking
      const storedStr = localStorage.getItem(this.sessionIdListKey);
      if (storedStr) {
        try {
          storedSessions = JSON.parse(storedStr);
        } catch (e) {
          storedSessions = [];
        }
      }

      // Check if this sessionId already exists
      const exists = storedSessions.some(s => s.sessionId === sessionId);
      if (!exists) {
        // Add new sessionId with timestamp
        storedSessions.push({
          sessionId,
          timestamp: Date.now()
        });
        console.log(`[SessionPage] Added new sessionId: ${sessionId}`);

        // If we exceed max, delete the oldest
        if (storedSessions.length > this.MAX_SESSION_IDS) {
          // Sort by timestamp and remove oldest
          storedSessions.sort((a, b) => a.timestamp - b.timestamp);
          const removedSession = storedSessions.shift();
          console.log(`[SessionPage] Removing oldest sessionId: ${removedSession?.sessionId}`);

          // Delete associated images from local storage
          if (removedSession) {
            this.deleteSessionImagesFromLocalStorage(removedSession.sessionId);
          }
        }

        // Save updated list
        localStorage.setItem(this.sessionIdListKey, JSON.stringify(storedSessions));
      } else {
        console.log(`[SessionPage] SessionId already tracked: ${sessionId}`);
      }
    } catch (e) {
      console.warn('[SessionPage] Error tracking sessionId:', e);
    }
  }

  // Delete all images belonging to a specific sessionId from local storage
  private deleteSessionImagesFromLocalStorage(sessionId: string): void {
    try {
      // Get all images from ImageStorageService
      const svc: any = this.imageStorage as any;
      
      if (typeof svc.removeSessionById === 'function') {
        // If service has a removal method, use it
        (svc as any).removeSessionById(sessionId);
        console.log(`[SessionPage] Removed session images for sessionId: ${sessionId}`);
      } else {
        console.warn(`[SessionPage] ImageStorageService doesn't have removeSessionById method`);
      }
    } catch (e) {
      console.warn('[SessionPage] Error deleting session images from local storage:', e);
    }
  }

  // Confirm session action: kept for backward compatibility (legacy method)
  async confirmSessionAction(session: any): Promise<void> {
    console.log('[SessionPage] Session confirmed via legacy method');
    this.closeSessionConfirmDialog();
    // Continue with new flow
    await this.loadAndNavigateToSession(session);
  }

  // Close confirmation dialog without action
  closeSessionConfirmDialog(): void {
    this.isSessionConfirmDialogOpen = false;
    this.selectedSessionForConfirm = null;
  }

  // Debug method: print session object and related images from Firestore/local storage
  private async debugPrintSessionData(session: any): Promise<void> {
    try {
      console.log('========== SESSION DEBUG INFO ==========');
      console.log('Session Object:', JSON.parse(JSON.stringify(session)));
      
      if (session && session.id) {
        console.log('\n--- Session Images ---');
        console.log('Session ID:', session.id);
        console.log('Image Keys Count:', session.imageKeys?.length || 0);
        console.log('Image Keys:', session.imageKeys);

        // Get all stored images
        let allImages: any[] = [];
        try {
          if (typeof (this.imageStorage as any).getAllImages === 'function') {
            const res = (this.imageStorage as any).getAllImages();
            allImages = (res && typeof (res as Promise<any>).then === 'function') ? await res : res;
          } else if (typeof (this.imageStorage as any).getImages === 'function') {
            const res = (this.imageStorage as any).getImages();
            allImages = (res && typeof (res as Promise<any>).then === 'function') ? await res : res;
          }
          if (!Array.isArray(allImages)) allImages = [];
        } catch (e) {
          console.warn('[SessionPage] Failed to get all images:', e);
          allImages = [];
        }

        console.log('\n--- All Stored Images ---');
        console.log('Total Stored Images:', allImages.length);
        allImages.forEach((img: any, idx: number) => {
          console.log(`Image ${idx + 1}:`, {
            filename: img.filename,
            timestamp: img.timestamp,
            hasPrediction: !!img.prediction,
            hasOriginal: !!img.original,
            hasWithBoxes: !!img.withBoxes,
            sessionId: img.sessionId
          });
        });

        // Print images for this specific session
        const sessionImages = allImages.filter((img: any) => 
          session.imageKeys?.includes(img.filename) || 
          session.imageKeys?.includes(img.original)
        );
        console.log(`\n--- Images in this Session (${sessionImages.length} total) ---`);
        sessionImages.forEach((img: any, idx: number) => {
          console.log(`Session Image ${idx + 1}:`, {
            filename: img.filename,
            prediction: img.prediction,
            statusMessage: img.statusMessage
          });
        });
      }
      console.log('========== END DEBUG INFO ==========\n');
    } catch (e) {
      console.error('[SessionPage] Error during debug print:', e);
    }
  }

  async goToSession(session: any) {
    await this.loadAndNavigateToSession(session);
  }

  /** Delete a session and refresh list */
  /** Delete a session via ImageStorageService and refresh list. */
  async deleteSession(session: any, ev?: Event) {
    // Step 1: Stop event propagation if an event is provided
    try {
      if (ev) ev.stopPropagation();

      // Step 2: Validate the session object and its ID
      if (!session || !session.id) {
        console.warn('[SessionPage.deleteSession] Invalid session object');
        return;
      }

      // Step 3: Show confirmation dialog
      this.selectedSessionForDelete = session;
      this.isSessionDeleteConfirmDialogOpen = true;
    } catch (e) {
      // Step 6: Handle any errors that occur during the process
      console.warn('[SessionPage.deleteSession] Error showing confirmation dialog:', e);
    }
  }

  // Close delete confirmation dialog
  closeSessionDeleteConfirmDialog(): void {
    this.isSessionDeleteConfirmDialogOpen = false;
    this.selectedSessionForDelete = null;
  }

  // Confirm deletion and start the deletion process
  async confirmSessionDeletion(session: any): Promise<void> {
    try {
      if (!session || !session.id) return;

      // Close confirmation dialog
      this.closeSessionDeleteConfirmDialog();

      // Show progress dialog
      this.selectedSessionForDeleteProgress = session;
      this.isSessionDeleteProgressDialogOpen = true;
      this.sessionDeleteProgress = 0;
      this.sessionDeleteStatusText = 'Preparing deletion...';
      this.sessionDeleteStageCount = { current: 0, total: 0 };

      // Delete session and all related resources
      const success = await this.imageStorage.deleteSessionAndResources(
        session.id,
        (stage: string, current: number, total: number) => {
          // Update progress dialog
          this.sessionDeleteStatusText = stage;
          this.sessionDeleteStageCount = { current, total };
          this.sessionDeleteProgress = Math.round((current / total) * 100);
        }
      );

      if (success) {
        // Delay before closing to show completion
        await new Promise(resolve => setTimeout(resolve, 500));
        this.closeSessionDeleteProgressDialog();
        
        // Also delete from local storage
        this.deleteSessionImagesFromLocalStorage(session.id);
        
        // Refresh the sessions list
        await this.loadSessions();

        // Show success message
        console.log(`[SessionPage] Session "${session.name}" deleted successfully`);
      } else {
        this.sessionDeleteStatusText = 'Deletion failed';
        await new Promise(resolve => setTimeout(resolve, 1500));
        this.closeSessionDeleteProgressDialog();
      }
    } catch (e) {
      console.error('[SessionPage.confirmSessionDeletion] Error during deletion:', e);
      this.sessionDeleteStatusText = 'Error during deletion';
      await new Promise(resolve => setTimeout(resolve, 1500));
      this.closeSessionDeleteProgressDialog();
    }
  }

  // Close delete progress dialog
  closeSessionDeleteProgressDialog(): void {
    this.isSessionDeleteProgressDialogOpen = false;
    this.selectedSessionForDeleteProgress = null;
    this.sessionDeleteProgress = 0;
    this.sessionDeleteStatusText = 'Preparing deletion...';
    this.sessionDeleteStageCount = { current: 0, total: 0 };
  }


  /** Navigate to image upload page. */
  goToUploadImage() {
    this.router.navigate(['/upload-image-page']);
    console.log('pdf 3 page');
  }



  /**
   * Clear all stored images after a confirmation prompt.
   */
  /**
   * Confirm and clear all stored images via ImageStorageService.
   * Shows a success/failure toast via alert.
   */
  async clearImageStorage() {
    const ok = confirm('Clear all stored images? This cannot be undone.');
    if (!ok) return;
    try {
      // ImageStorageService in this workspace exposes `clearImages()`; use that if present.
      if (typeof (this.imageStorage as any).clearImages === 'function') {
        await (this.imageStorage as any).clearImages();
      } else if (typeof (this.imageStorage as any).clear === 'function') {
        // fallback for implementations that use `clear()`
        await (this.imageStorage as any).clear();
      }
      console.log('All stored images cleared');
      alert('All stored images cleared');
    } catch (err) {
      console.error('Failed to clear image storage', err);
      alert('Failed to clear image storage. See console for details.');
    }
  }

  /**
   * Append a simple overlay/modal to the page with a button that sends a notification.
   * The overlay is self-cleaning after the button is pressed or the backdrop is clicked.
   */
  /**
   * Simple in-app overlay to test notifications and storage/session helpers.
   */

  //show a overlay to show user profile and logout buttons
  showTestOverlay() {
    // Prevent multiple overlays
    if (document.getElementById('test-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'test-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.background = 'rgba(0,0,0,0.45)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '9999';

    const box = document.createElement('div');
    box.style.background = '#fff';
    box.style.padding = '20px';
    box.style.borderRadius = '8px';
    box.style.minWidth = '260px';
    box.style.boxShadow = '0 4px 20px rgba(0,0,0,0.3)';
    box.style.textAlign = 'center';

    const msg = document.createElement('div');
    const fullName = (this.firstName && this.lastName) ? `${this.firstName} ${this.lastName}` : (this.userName || 'N/A');
    
    // Create a more organized user info display
    msg.innerHTML = `
      <div style="font-weight:600;margin-bottom:12px;font-size:18px;color:#333;">User Profile</div>
      <div style="background:#f5f5f5;padding:12px;border-radius:6px;text-align:left;">
        <div style="margin-bottom:8px;">
          <span style="font-weight:600;color:#555;">Name:</span> 
          <span style="color:#333;">${fullName || 'N/A'}</span>
        </div>
        ${this.firstName ? `<div style="margin-bottom:8px;">
          <span style="font-weight:600;color:#555;">First Name:</span> 
          <span style="color:#333;">${this.firstName}</span>
        </div>` : ''}
        ${this.lastName ? `<div style="margin-bottom:8px;">
          <span style="font-weight:600;color:#555;">Last Name:</span> 
          <span style="color:#333;">${this.lastName}</span>
        </div>` : ''}
        <div style="margin-bottom:8px;">
          <span style="font-weight:600;color:#555;">Role:</span> 
          <span style="color:#333;text-transform:capitalize;">${this.userRole || 'N/A'}</span>
        </div>
        <div style="margin-bottom:0;">
          <span style="font-weight:600;color:#555;">Status:</span> 
          <span style="color:#28a745;font-weight:600;">${this.isLoggedIn ? 'Logged In' : 'Logged Out'}</span>
        </div>
      </div>
    `;
    msg.style.marginBottom = '16px';
    msg.style.fontSize = '14px';

    const btn = document.createElement('button');
    btn.innerText = 'Send Notification';
    btn.style.padding = '10px 14px';
    btn.style.border = 'none';
    btn.style.borderRadius = '6px';
    btn.style.background = '#3880ff';
    btn.style.color = '#fff';
    btn.style.cursor = 'pointer';

    const btn2 = document.createElement('button');
    btn2.innerText = 'Delete Image Storage';
    btn2.style.padding = '10px 14px';
    btn2.style.border = 'none';
    btn2.style.borderRadius = '6px';
    btn2.style.background = '#3880ff';
    btn2.style.color = '#fff';
    btn2.style.cursor = 'pointer';

    // Open PDF Viewer with a sample PDF generated via jsPDF
    const openPdfViewerBtn = document.createElement('button');
    openPdfViewerBtn.innerText = 'Open PDF Viewer (Sample)';
    openPdfViewerBtn.style.padding = '10px 14px';
    openPdfViewerBtn.style.border = 'none';
    openPdfViewerBtn.style.borderRadius = '6px';
    openPdfViewerBtn.style.background = '#3880ff';
    openPdfViewerBtn.style.color = '#fff';
    openPdfViewerBtn.style.cursor = 'pointer';

    // Open PDF Preview page with testing interface
    const openPdfPreviewBtn = document.createElement('button');
    openPdfPreviewBtn.innerText = 'PDF Preview & Testing';
    openPdfPreviewBtn.style.padding = '10px 14px';
    openPdfPreviewBtn.style.border = 'none';
    openPdfPreviewBtn.style.borderRadius = '6px';
    openPdfPreviewBtn.style.background = '#6366f1';
    openPdfPreviewBtn.style.color = '#fff';
    openPdfPreviewBtn.style.cursor = 'pointer';

    // Open PDF Generator page (pdf-lib + native opener)
    const openPdfGeneratorBtn = document.createElement('button');
    openPdfGeneratorBtn.innerText = 'PDF Generator (pdf-lib)';
    openPdfGeneratorBtn.style.padding = '10px 14px';
    openPdfGeneratorBtn.style.border = 'none';
    openPdfGeneratorBtn.style.borderRadius = '6px';
    openPdfGeneratorBtn.style.background = '#10b981';
    openPdfGeneratorBtn.style.color = '#fff';
    openPdfGeneratorBtn.style.cursor = 'pointer';

    // PDF Page Test buttons
    const pdfPageBtn = document.createElement('button');
    pdfPageBtn.innerText = 'PDF Page';
    pdfPageBtn.style.padding = '10px 14px';
    pdfPageBtn.style.border = 'none';
    pdfPageBtn.style.borderRadius = '6px';
    pdfPageBtn.style.background = '#8b5cf6';
    pdfPageBtn.style.color = '#fff';
    pdfPageBtn.style.cursor = 'pointer';

    const pdfPageTestBtn = document.createElement('button');
    pdfPageTestBtn.innerText = 'PDF Page Test';
    pdfPageTestBtn.style.padding = '10px 14px';
    pdfPageTestBtn.style.border = 'none';
    pdfPageTestBtn.style.borderRadius = '6px';
    pdfPageTestBtn.style.background = '#f59e0b';
    pdfPageTestBtn.style.color = '#fff';
    pdfPageTestBtn.style.cursor = 'pointer';

    const pdfPageTest02Btn = document.createElement('button');
    pdfPageTest02Btn.innerText = 'PDF Page Test 02';
    pdfPageTest02Btn.style.padding = '10px 14px';
    pdfPageTest02Btn.style.border = 'none';
    pdfPageTest02Btn.style.borderRadius = '6px';
    pdfPageTest02Btn.style.background = '#ec4899';
    pdfPageTest02Btn.style.color = '#fff';
    pdfPageTest02Btn.style.cursor = 'pointer';

    const pdfPageTest03Btn = document.createElement('button');
    pdfPageTest03Btn.innerText = 'PDF Page Test 03';
    pdfPageTest03Btn.style.padding = '10px 14px';
    pdfPageTest03Btn.style.border = 'none';
    pdfPageTest03Btn.style.borderRadius = '6px';
    pdfPageTest03Btn.style.background = '#14b8a6';
    pdfPageTest03Btn.style.color = '#fff';
    pdfPageTest03Btn.style.cursor = 'pointer';

    // Logout button (acts as Log Out via showTestOverlay)
    const logoutBtn = document.createElement('button');
    logoutBtn.innerText = 'Log Out';
    logoutBtn.style.padding = '10px 14px';
    logoutBtn.style.border = 'none';
    logoutBtn.style.borderRadius = '6px';
    logoutBtn.style.background = '#eb445a';
    logoutBtn.style.color = '#fff';
    logoutBtn.style.cursor = 'pointer';

    // Close button
    const close = document.createElement('button');
    close.innerText = 'Close';
    close.style.marginLeft = '10px';
    close.style.padding = '10px 12px';
    close.style.border = 'none';
    close.style.borderRadius = '6px';
    close.style.background = '#aaa';
    close.style.color = '#fff';
    close.style.cursor = 'pointer';

    btn.addEventListener('click', () => {
      // simple notification: alert (could be replaced with Ionic Toast/Notification)
      alert('Hello it worked');
      cleanupOverlay();
    });

    // Delete storage button
    btn2.addEventListener('click', () => {
      this.clearImageStorage();
      cleanupOverlay();
    });

    // Open viewer with a generated sample PDF
    openPdfViewerBtn.addEventListener('click', () => {
      try {
        const doc = new jsPDF();
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(16);
        doc.text('Hello from PdfViewerPage! ✅', 20, 30);
        doc.text('This is a sample PDF generated with jsPDF.', 20, 45);
        // Use data URL (base64) to pass via route
        const dataUri = doc.output('datauristring');
        // Navigate to the viewer with the generated source
        this.router.navigate(['/pdf-viewer-page'], { queryParams: { src: dataUri } });
        cleanupOverlay();
      } catch (e) {
        console.warn('Failed to generate sample PDF', e);
        alert('Failed to generate sample PDF.');
      }
    });

    // Open PDF Preview page with testing interface
    openPdfPreviewBtn.addEventListener('click', () => {
      this.router.navigate(['/pdf-preview-page']);
      cleanupOverlay();
    });

    // Open PDF Generator page with pdf-lib
    openPdfGeneratorBtn.addEventListener('click', () => {
      this.router.navigate(['/pdf-generator-page']);
      cleanupOverlay();
    });

    // PDF Page Test navigation handlers
    pdfPageBtn.addEventListener('click', () => {
      this.router.navigate(['/pdf-page']);
      cleanupOverlay();
    });

    pdfPageTestBtn.addEventListener('click', () => {
      this.router.navigate(['/pdf-page-test']);
      cleanupOverlay();
    });

    pdfPageTest02Btn.addEventListener('click', () => {
      this.router.navigate(['/pdf-page-test02']);
      cleanupOverlay();
    });

    pdfPageTest03Btn.addEventListener('click', () => {
      this.router.navigate(['/pdf-page-test03']);
      cleanupOverlay();
    });

    // Logout flow
    logoutBtn.addEventListener('click', async () => {
      await this.logout(true);
    });

    // Test create session button: create a session populated with stored images and refresh list
    const createSessionBtn = document.createElement('button');
    createSessionBtn.innerText = 'Create Test Session';
    createSessionBtn.style.padding = '10px 14px';
    createSessionBtn.style.border = 'none';
    createSessionBtn.style.borderRadius = '6px';
    createSessionBtn.style.background = '#28a745';
    createSessionBtn.style.color = '#fff';
    createSessionBtn.style.cursor = 'pointer';
    createSessionBtn.addEventListener('click', async () => {
      try {
        if (this.imageStorage && typeof (this.imageStorage as any).createTestSession === 'function') {
          const s = (this.imageStorage as any).createTestSession('Test Session', true, 6);
          // refresh local session view
          try { await this.loadSessions(); } catch (e) {}
          alert('Test session created: ' + s.id);
        } else {
          // Fallback: older ImageStorageService implementations may not provide
          // createTestSession. Use available APIs to create a session from stored
          // images (up to 6) so the UI button still works.
          try {
            let stored: any[] = [];
            if (typeof (this.imageStorage as any).getAllImages === 'function') {
              stored = await (this.imageStorage as any).getAllImages();
            } else if (typeof (this.imageStorage as any).getImages === 'function') {
              stored = (this.imageStorage as any).getImages();
            } else {
              stored = [];
            }
            const keys = Array.isArray(stored) ? stored.slice(0, 6).map((item: any) => item.original) : [];
            const s = (typeof this.imageStorage.createSession === 'function') ? this.imageStorage.createSession('Test Session', keys) : null;
            try { await this.loadSessions(); } catch (e) {}
            alert(s ? ('Test session created: ' + (s as any).id) : 'Test session created (fallback)');
          } catch (e) {
            console.warn('fallback createTestSession failed', e);
            alert('createTestSession not available on ImageStorageService');
          }
        }
      } catch (err) {
        console.warn('createTestSession failed', err);
        alert('Failed to create test session. See console.');
      }
    });

    close.addEventListener('click', () => {
      cleanupOverlay();
    });

    // clicking backdrop closes overlay
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) {
        cleanupOverlay();
      }
    });

    box.appendChild(msg);
    
    // Main buttons container (3 buttons in a column)
    const mainBtnsContainer = document.createElement('div');
    mainBtnsContainer.style.display = 'flex';
    mainBtnsContainer.style.flexDirection = 'column';
    mainBtnsContainer.style.gap = '10px';
    mainBtnsContainer.style.marginBottom = '16px';
    
    // Style buttons to be full width
    btn.style.width = '100%';
    btn2.style.width = '100%';
    createSessionBtn.style.width = '100%';
    openPdfViewerBtn.style.width = '100%';
    openPdfPreviewBtn.style.width = '100%';
    openPdfGeneratorBtn.style.width = '100%';
    pdfPageBtn.style.width = '100%';
    pdfPageTestBtn.style.width = '100%';
    pdfPageTest02Btn.style.width = '100%';
    pdfPageTest03Btn.style.width = '100%';
    
    // mainBtnsContainer.appendChild(btn);
    // mainBtnsContainer.appendChild(btn2);
    // mainBtnsContainer.appendChild(createSessionBtn);
    // mainBtnsContainer.appendChild(openPdfViewerBtn);
    // mainBtnsContainer.appendChild(openPdfPreviewBtn);
    // mainBtnsContainer.appendChild(openPdfGeneratorBtn);
    // mainBtnsContainer.appendChild(pdfPageBtn);
    // mainBtnsContainer.appendChild(pdfPageTestBtn);
    // mainBtnsContainer.appendChild(pdfPageTest02Btn);
    // mainBtnsContainer.appendChild(pdfPageTest03Btn);
    box.appendChild(mainBtnsContainer);
    
    // Bottom row with logout and close buttons
    const bottomRow = document.createElement('div');
    bottomRow.style.display = 'flex';
    bottomRow.style.gap = '10px';
    bottomRow.style.marginTop = '8px';
    bottomRow.style.paddingTop = '12px';
    bottomRow.style.borderTop = '1px solid #ddd';
    
    logoutBtn.style.flex = '1';
    close.style.flex = '1';
    close.style.marginLeft = '0';
    
    bottomRow.appendChild(logoutBtn);
    bottomRow.appendChild(close);
    box.appendChild(bottomRow);
    
    overlay.appendChild(box);

    // local cleanup helper removes overlay element
    const cleanupOverlay = () => {
      this.removeTestOverlay();
    };

    document.body.appendChild(overlay);
    // No local back subscription: page-level handler will close the overlay when present
  }

  /** Register back button handler for closing overlays and navigating back. */
  private registerBackButtonHandler() {
    try {
      this.removeBackButtonHandler();
      // priority 10: high enough to intercept overlay/back behavior on this page
      this.backButtonSub = this.platform.backButton.subscribeWithPriority(10, () => {
        try {
          // Check for test overlay first
          const overlay = document.getElementById('test-overlay');
          if (overlay) {
            try { this.removeTestOverlay(); } catch (e) {}
            return;
          }
          
          // Check for sort overlay
          if (this.isSortOverlayOpen) {
            this.closeSortOverlay();
            return;
          }
          
          // Check for sidebar
          if (this.isSidebarOpen) {
            this.closeSidebar();
            return;
          }
          
          // No overlays open - navigate back to previous page
          this.navCtrl.back();
        } catch (e) {
          console.warn('[SessionPage] back button handler error', e);
        }
      });
    } catch (e) {
      console.warn('[SessionPage] registerBackButtonHandler failed', e);
    }
  }

  /** Remove the test overlay from DOM if present. */
  private removeTestOverlay() {
    try {
      const el = document.getElementById('test-overlay');
      if (el && el.parentElement) el.parentElement.removeChild(el);
    } catch {}
  }

  /** Remove the session page back handler so other pages can handle back navigation normally. */
  private removeBackButtonHandler() {
    try {
      if (this.backButtonSub && typeof this.backButtonSub.remove === 'function') {
        this.backButtonSub.remove();
      } else if (this.backButtonSub && typeof this.backButtonSub.unsubscribe === 'function') {
        this.backButtonSub.unsubscribe();
      }
    } catch {}
    this.backButtonSub = null;
  }


  ngOnDestroy(): void {
    this.removeBackButtonHandler();
  }
  
  openMenu(menuId: string) {
    this.isSidebarOpen = !this.isSidebarOpen;
  }

  closeSidebar() {
    this.isSidebarOpen = false;
  }

  /** Show the sort overlay */
  showSortOverlay() {
    this.isSortOverlayOpen = true;
  }

  /** Close the sort overlay */
  closeSortOverlay() {
    this.isSortOverlayOpen = false;
  }

  /** Sort sessions based on selected criteria */
  sortSessions(sortType: string) {
    this.currentSort = sortType;
    
    switch (sortType) {
      case 'time-newest':
        this.sessions.sort((a, b) => {
          const dateA = new Date(a.created).getTime();
          const dateB = new Date(b.created).getTime();
          return dateB - dateA; // newest first
        });
        break;
      
      case 'time-oldest':
        this.sessions.sort((a, b) => {
          const dateA = new Date(a.created).getTime();
          const dateB = new Date(b.created).getTime();
          return dateA - dateB; // oldest first
        });
        break;
      
      case 'images-most':
        this.sessions.sort((a, b) => {
          const countA = a.imageKeys?.length || 0;
          const countB = b.imageKeys?.length || 0;
          return countB - countA; // most images first
        });
        break;
      
      case 'images-least':
        this.sessions.sort((a, b) => {
          const countA = a.imageKeys?.length || 0;
          const countB = b.imageKeys?.length || 0;
          return countA - countB; // least images first
        });
        break;
    }
    
    // Close overlay after sorting
    this.closeSortOverlay();
  }

  /**
   * Get the userId stored in localStorage.
   */
  private getStoredUserId(): string | null {
    try {
      return localStorage.getItem('currentUserId');
    } catch (error) {
      console.error('[SessionPage.getStoredUserId] Failed to retrieve stored userId:', error);
      return null;
    }
  }

  /**
   * Print current user ID and stored user ID to console for debugging.
   */
  printUserIdStatus(): void {
    const storedUserId = this.getStoredUserId();
    const currentUserId = this.auth3.getCurrentUser()?.uid || this.userID || null;

    console.log('[SessionPage.printUserIdStatus] User ID Status:', {
      storedUserId: storedUserId || 'Not stored',
      currentUserId: currentUserId || 'Not available',
      match: storedUserId === currentUserId
    });

    // Also print to alert for immediate visibility
    alert(`User ID Status:\n\nStored: ${storedUserId || 'Not stored'}\nCurrent: ${currentUserId || 'Not available'}\n\nMatch: ${storedUserId === currentUserId ? 'Yes ✓' : 'No ✗'}`);
  }

  /**
   * Print all session objects currently displayed in the sessions list to console.
   */
  printSessionsList(): void {
    console.log('[SessionPage.printSessionsList] Total sessions:', this.sessions.length);
    
    if (!this.sessions || this.sessions.length === 0) {
      console.log('[SessionPage.printSessionsList] No sessions to display');
      alert('No sessions to display');
      return;
    }

    console.log('[SessionPage.printSessionsList] Full sessions array:', this.sessions);
    
    // Print each session with details
    this.sessions.forEach((session, index) => {
      console.log(`[SessionPage.printSessionsList] Session ${index}:`, {
        id: session.id,
        name: session.name,
        created: session.created,
        imageCount: session.imageKeys?.length || 0,
        imageKeys: session.imageKeys || [],
        userId: session.userId
      });
    });

    // Also create a summary alert
    const summary = this.sessions.map((s, i) => 
      `Session ${i + 1}: ${s.name || 'Untitled'} (${s.imageKeys?.length || 0} images)`
    ).join('\n');
    
    alert(`Sessions List (${this.sessions.length} total):\n\n${summary}`);
  }

  /**
   * Check if there are any sessions for the current user.
   */
  hasUserSessions(): boolean {
    if (!this.sessions || this.sessions.length === 0) {
      return false;
    }
    return this.sessions.some(session => session.userId === this.userID);
  }

  /** Navigate to sessions list page. */
  gochatPage() {
    this.removeBackButtonHandler();
    this.router.navigate(['/chat-page']);
    console.log('chat page');
  }

   /** Navigate to chat page and open the 'people' tab. */
  gochatPagePeople() {
    this.removeBackButtonHandler();
    this.router.navigate(['/chat-page'], { state: { activeTab: 'people' } });
    console.log('chat page (people)');
  }

  /** Navigate to chat page and open the 'location' tab. */
  gochatPageLocation() {
    this.removeBackButtonHandler();
    this.router.navigate(['/chat-page'], { state: { activeTab: 'location' } });
    console.log('chat page (location)');
  }

   /** Navigate to chat page and open the 'location' tab. */
  goMarkerPage() {
    this.removeBackButtonHandler();
    this.router.navigate(['/office-map-marker-page']);
    console.log('chat page (location)');
  }
  
}

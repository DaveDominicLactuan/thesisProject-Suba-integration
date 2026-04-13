import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { NavController, Platform } from '@ionic/angular';
import { User } from 'firebase/auth';
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

  /** Inject auth, router, and image storage services for navigation and data. */
  constructor(private formBuilder: FormBuilder, private router: Router, private authService: AuthService, private navCtrl: NavController, private auth3: Auth3Service, private imageStorage: ImageStorageService, private platform: Platform) {

  }

ngOnInit(): void {
  
  //initializes the data needed for the page such as user data, profile and session
  this.initialize();
}

/** Perform async initialization tasks (profile + sessions). */
private async initialize(): Promise<void> {
  try {
    // Ensure Firebase auth state is ready before fetching profile
    // wait for up to 8 seconds for auth from firebase and current user profile from firestore
    if (!this.auth3.getCurrentUser()) {
      console.log('[HomePage2] waiting for auth state…');
      await this.waitForUserAuth(8000);
    }
   // stores current user profile data in profile variables 
    const profile = await this.auth3.getUserProfile();
    // Get userID from authenticated user (Firebase UID from auth.currentUser)
    const currentUser = this.auth3.getCurrentUser();
    this.userID = currentUser?.uid || profile['userID'] || null;
    this.firstName = profile['firstName'];
    this.lastName = profile['lastName'];
    this.engineeringID = profile['engineeringID'] || '';
    this.email = profile['email'] || '';
    // Read role from Firestore profile (authoritative source)
    this.userRole = profile['role'] || (this.engineeringID ? 'engineer' : 'user');
    //gets username from firatName and lastName
    this.userName = (this.firstName && this.lastName) ? `${this.firstName} ${this.lastName}` : (this.email || null);
    //prints the current user profile to console
    console.log('[SessionPage] user profile loaded', {
      userID: this.userID,
      firstName: this.firstName,
      lastName: this.lastName,
      email: this.email,
      engineeringID: this.engineeringID,
      userRole: this.userRole,
      userName: this.userName
    });

    // Read shared sync status produced by HomePage2 background sync
    const resolvedUserId = this.userID || this.auth3.getCurrentUser()?.uid || '';
    this.userID = resolvedUserId || this.userID;
    this.loadPersistedSyncStatus(resolvedUserId);
    console.log('[SessionPage.initialize] Loaded sync status for user:', resolvedUserId || 'none');

    // Persist/refresh local user data for downstream use, and for long term offline use
    try {
      localStorage.setItem('userData', JSON.stringify({
        userID: this.userID || '',
        username: this.userName || '',
        userRole: this.userRole || 'user',
        firstName: this.firstName || '',
        lastName: this.lastName || '',
        engineeringID: this.engineeringID || '',
        email: this.email || ''
      }));
      localStorage.setItem('isLoggedIn', 'true');
    } catch {}
     // Also persist user profile in sessionStorage for current session, short lived and cleared when closed
     try {
       sessionStorage.setItem('userProfile', JSON.stringify({
         userID: this.userID || '',
         username: this.userName || '',
         userRole: this.userRole || 'user',
         firstName: this.firstName || '',
         lastName: this.lastName || '',
         engineeringID: this.engineeringID || '',
         email: this.email || ''
       }));
       sessionStorage.setItem('isLoggedInSession', 'true');
     } catch {}
  } catch (error) {
    console.error(error);
    // Fallback: try to load previously saved user data
    try {
      const cached = localStorage.getItem('userData');
      if (cached) {
        const data = JSON.parse(cached);
        this.userID = data.userID || null;
        this.firstName = data.firstName || null;
        this.lastName = data.lastName || null;
        this.userName = data.username || null;
        this.userRole = data.userRole || 'user';
        this.email = data.email || null;
        this.engineeringID = data.engineeringID || null;
        console.log('[SessionPage] loaded user profile from cache', data);
      }
    } catch {}
  }
}

  // Wait for Firebase auth to emit a user or timeout
  private waitForUserAuth(timeoutMs: number = 8000): Promise<User | null> {
    //A new Promise is created to handle the asynchronous waiting process.
    //The settled flag ensures that the promise is resolved only once, 
    //even if multiple events occur (e.g., user detected and timeout).
    return new Promise((resolve) => {
      let settled = false as boolean;
      //This helper function resolves the promise with the provided user 
      // u) only if the promise has not already been resolved (settled is false).
      const maybeResolve = (u: User | null) => {
        if (!settled) { settled = true; resolve(u); }
      };
      //The onAuthChange method from auth3 is used to listen for changes 
      // in the authentication state. user (u) is detected, the promise 
      // is resolved with the user, and the listener (unsub) is unsubscribed to 
      // prevent further calls.
      let unsub: any = null;
      try {
        unsub = this.auth3.onAuthChange((u) => {
          if (u) {
            try { if (unsub) unsub(); } catch {}
            maybeResolve(u);
          }
        });
      } catch {}
      //A setTimeout is used to enforce the maximum wait time (timeoutMs). 
      //If the timeout is reached, the listener is unsubscribed, and the promise 
      // is resolved with the current user (if available) or null.
      setTimeout(() => {
        try { if (unsub) unsub(); } catch {}
        maybeResolve(this.auth3.getCurrentUser() || null);
      }, timeoutMs);
    });
  }

  // Called by Ionic when page becomes active — refresh and loads sessions/counts/
  /** Ionic hook: refresh sessions each time page becomes active. */
  ionViewWillEnter() {
    // Ensure any existing back button handlers are cleared before entering
    this.removeBackButtonHandler();
    this.loadSessions();
    const uid = this.userID || this.auth3.getCurrentUser()?.uid || '';
    if (uid) this.loadPersistedSyncStatus(uid);
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
  async loadSessions() {
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
      console.log('[SessionPage.syncUserDataFromFirestore] Starting sync for userId:', userId);

      // Fetch user sessions from Firestore
      const firebaseSessions = await this.auth3.getUserSessions(userId);
      console.log('[SessionPage.syncUserDataFromFirestore] Fetched', firebaseSessions.length, 'sessions from Firestore');

      // Fetch user images from Firestore
      const firestoreImages = await this.auth3.getUserImages(userId);
      console.log('[SessionPage.syncUserDataFromFirestore] Fetched', firestoreImages.length, 'images from Firestore');

      let sessionsAdded = 0;
      let imagesAdded = 0;

      for (const fsSession of firebaseSessions) {
        const session = {
          id: fsSession.id || fsSession.sessionId || `s-${Date.now()}`,
          name: fsSession.name || 'Untitled Session',
          imageKeys: Array.isArray(fsSession.imageKeys) ? fsSession.imageKeys : [],
          created: fsSession.created || new Date().toISOString(),
          userId: userId
        };

        const added = this.imageStorage.addSessionIfNotExists(session as any);
        if (added) {
          sessionsAdded += 1;
          console.log('[SessionPage.syncUserDataFromFirestore] Added session to local storage:', session.id);
        }
      }

      for (const fsImage of firestoreImages) {
        const storedImage = {
          original: fsImage.original || '',
          withBoxes: fsImage.withBoxes || fsImage.original || '',
          boxes: Array.isArray(fsImage.boxes) ? fsImage.boxes : [],
          faceDetected: !!fsImage.faceDetected,
          faceData: Array.isArray(fsImage.faceData) ? fsImage.faceData : [],
          timestamp: fsImage.timestamp || new Date().toISOString(),
          detectionMessage: fsImage.detectionMessage || '',
          filename: fsImage.filename || fsImage.id || '',
          statusMessage: fsImage.statusMessage || '',
          hasPrediction: !!fsImage.hasPrediction,
          prediction: fsImage.prediction || undefined,
          userId: userId,
          sessionId: fsImage.sessionId || undefined
        };

        const added = await this.imageStorage.addImageIfNotExists(storedImage as any, storedImage.sessionId);
        if (added) {
          imagesAdded += 1;
          console.log('[SessionPage.syncUserDataFromFirestore] Added image to local storage:', storedImage.filename || 'unnamed');
        }
      }

      console.log('[SessionPage.syncUserDataFromFirestore] Sync completed successfully', {
        sessionsFetched: firebaseSessions.length,
        sessionsAdded,
        imagesFetched: firestoreImages.length,
        imagesAdded
      });
    } catch (error) {
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
   * Before navigating, fetch S3 images from the session to ensure they're available.
   */
  // Show confirmation dialog when session is clicked
  onSessionItemClick(session: any, event?: Event): void {
    if (event) event.stopPropagation();
    this.selectedSessionForConfirm = session;
    this.isSessionConfirmDialogOpen = true;
    console.log('[SessionPage] Session click detected. Debug info:');
    this.debugPrintSessionData(session);
  }

  // Close confirmation dialog without action
  closeSessionConfirmDialog(): void {
    this.isSessionConfirmDialogOpen = false;
    this.selectedSessionForConfirm = null;
  }

  // Confirm session action: print debug and then navigate
  async confirmSessionAction(session: any): Promise<void> {
    console.log('[SessionPage] Session confirmed. Printing full debug info:');
    await this.debugPrintSessionData(session);
    this.closeSessionConfirmDialog();
    // Now proceed with navigation
    await this.goToSession(session);
  }

  // Debug method: print session object and related images from Firestore/S3
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
            s3Keys: {
              originalS3Key: img.originalS3Key,
              withBoxesS3Key: img.withBoxesS3Key
            },
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
            statusMessage: img.statusMessage,
            s3URLs: {
              original: img.originalS3Url,
              withBoxes: img.withBoxesS3Url
            }
          });
        });
      }
      console.log('========== END DEBUG INFO ==========\n');
    } catch (e) {
      console.error('[SessionPage] Error during debug print:', e);
    }
  }

  async goToSession(session: any) {
    // pick the first image in session and prepare the destination(feedback-page) to load it and 
    // display that first image when the session is selected
    try {
      if (session && session.imageKeys && session.imageKeys.length > 0) {
        const key = session.imageKeys[0];
        if (this.imageStorage && typeof this.imageStorage.selectImageByOriginal === 'function') {
          this.imageStorage.selectImageByOriginal(key);
        }
      }
    } catch (e) { console.warn('goToSession warning', e); }
    
    try {
      // Ensure HomePage back handler is removed before navigating 
      // to feedback-page to keep the logic and behavior of back button is kept inside the home-page
      try { this.removeBackButtonHandler(); } catch (e) { /* ignore */ }

      // Create and show loading spinner for S3 fetch
      const spinnerContainer = document.createElement('div');
      spinnerContainer.id = 'session-fetch-spinner';
      spinnerContainer.style.position = 'fixed';
      spinnerContainer.style.top = '50%';
      spinnerContainer.style.left = '50%';
      spinnerContainer.style.transform = 'translate(-50%, -50%)';
      spinnerContainer.style.zIndex = '10000';
      spinnerContainer.style.textAlign = 'center';
      spinnerContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
      spinnerContainer.style.width = '100%';
      spinnerContainer.style.height = '100%';
      spinnerContainer.style.display = 'flex';
      spinnerContainer.style.justifyContent = 'center';
      spinnerContainer.style.alignItems = 'center';

      const spinner = document.createElement('div');
      spinner.style.border = '4px solid rgba(255, 81, 47, 0.3)';
      spinner.style.borderTop = '4px solid #ff512f';
      spinner.style.borderRadius = '50%';
      spinner.style.width = '40px';
      spinner.style.height = '40px';
      spinner.style.animation = 'spin 1s linear infinite';
      spinner.style.margin = '0 auto 10px';

      // Add CSS animation for spinner if not already present
      if (!document.getElementById('session-spinner-animation')) {
        const style = document.createElement('style');
        style.id = 'session-spinner-animation';
        style.innerHTML = `
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `;
        document.head.appendChild(style);
      }

      const spinnerBox = document.createElement('div');
      spinnerBox.style.backgroundColor = 'white';
      spinnerBox.style.padding = '30px';
      spinnerBox.style.borderRadius = '10px';
      spinnerBox.style.boxShadow = '0 4px 15px rgba(0, 0, 0, 0.2)';
      spinnerBox.style.minWidth = '320px';

      const spinnerText = document.createElement('div');
      spinnerText.innerText = 'Loading session images from S3...';
      spinnerText.style.color = '#333';
      spinnerText.style.marginTop = '10px';
      spinnerText.style.fontSize = '14px';
      spinnerText.style.maxWidth = '300px';
      spinnerText.style.wordWrap = 'break-word';

      // Create progress bar container
      const progressBarContainer = document.createElement('div');
      progressBarContainer.style.marginTop = '20px';
      progressBarContainer.style.width = '100%';
      progressBarContainer.style.maxWidth = '280px';
      progressBarContainer.style.margin = '20px auto 0';

      // Progress bar background (empty)
      const progressBarBackground = document.createElement('div');
      progressBarBackground.style.width = '100%';
      progressBarBackground.style.height = '8px';
      progressBarBackground.style.backgroundColor = '#e0e0e0';
      progressBarBackground.style.borderRadius = '4px';
      progressBarBackground.style.overflow = 'hidden';
      progressBarBackground.style.border = '1px solid #ccc';

      // Progress bar fill (animated)
      const progressBarFill = document.createElement('div');
      progressBarFill.style.height = '100%';
      progressBarFill.style.width = '0%';
      progressBarFill.style.backgroundColor = '#ff512f';
      progressBarFill.style.borderRadius = '4px';
      progressBarFill.style.transition = 'width 0.3s ease';

      progressBarBackground.appendChild(progressBarFill);

      // Progress percentage text
      const progressText = document.createElement('div');
      progressText.innerText = '0%';
      progressText.style.fontSize = '12px';
      progressText.style.color = '#666';
      progressText.style.marginTop = '8px';
      progressText.style.textAlign = 'center';

      progressBarContainer.appendChild(progressBarBackground);
      progressBarContainer.appendChild(progressText);

      spinnerBox.appendChild(spinner);
      spinnerBox.appendChild(spinnerText);
      spinnerBox.appendChild(progressBarContainer);
      spinnerContainer.appendChild(spinnerBox);
      document.body.appendChild(spinnerContainer);

      // Fetch S3 images with progress tracking
      const svc: any = this.imageStorage as any;
      const sessionId = session?.id || null;
      const userId = this.userID || null;

      if (sessionId && userId && typeof svc.fetchSessionImagesFromS3 === 'function') {
        try {
          console.log('[SessionPage] Starting S3 fetch for session:', { sessionId, userId });
          
          // Fetch images with progress callback to update spinner text and progress bar
          await svc.fetchSessionImagesFromS3(
            sessionId,
            userId,
            (current: number, total: number) => {
              const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
              progressBarFill.style.width = `${percentage}%`;
              progressText.innerText = `${percentage}% (${current}/${total} images)`;
              spinnerText.innerText = `Loading images from S3...\n(${current}/${total} images)`;
              console.log(`[SessionPage] S3 fetch progress: ${current}/${total} (${percentage}%)`);
            }
          );

          spinnerText.innerText = '✅ Session images loaded!';
          progressBarFill.style.width = '100%';
          progressText.innerText = '100%';
          console.log('[SessionPage] ✅ S3 images fetched successfully for session:', sessionId);

          // Brief delay to show success message before navigating
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          spinnerText.innerText = '⚠️ Images may not be fully loaded, but continuing...';
          console.warn('[SessionPage] Warning during S3 fetch:', error);
          // Continue anyway - some images may be available locally
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } else {
        console.warn('[SessionPage] Cannot fetch S3 images - missing sessionId, userId, or fetchSessionImagesFromS3 method', {
          sessionId,
          userId,
          hasMethod: typeof svc.fetchSessionImagesFromS3 === 'function'
        });
        spinnerText.innerText = 'Preparing session...';
        progressBarFill.style.width = '50%';
        progressText.innerText = '50%';
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Remove spinner and navigate
      try { spinnerContainer.remove(); } catch (e) { /* ignore */ }

      // Build the parameters for the current session to be selected and displayed 
      // in feedback-page with the session.id
      const params: any = {};
      if (session && session.id) params.sessionId = session.id;
      // Navigate to feedback page and include sessionId so feedback page can load the session
      this.router.navigate(['/feedback-page'], { queryParams: params });
    } catch (e) {
      console.error('[SessionPage] Navigation to feedback page failed:', e);
      // Clean up spinner if it exists
      try {
        const spinner = document.getElementById('session-fetch-spinner');
        if (spinner) spinner.remove();
      } catch (err) { /* ignore */ }
      
      // Fallback to navigation without S3 fetch
      this.router.navigate(['/feedback-page']);
    }
  }

  /** Delete a session and refresh list */
  /** Delete a session via ImageStorageService and refresh list. */
  async deleteSession(session: any, ev?: Event) {
    // Step 1: Stop event propagation if an event is provided
    try {
      if (ev) ev.stopPropagation();

      // Step 2: Validate the session object and its ID
      if (!session || !session.id) return;

      // Step 3: Confirm deletion with the user
      if (typeof (this.imageStorage as any).removeSession === 'function') {
        const ok = confirm('Delete session "' + (session.name || session.id) + '"? This cannot be undone.');
        if (!ok) return;

        // Step 4: Remove the session using ImageStorageService
        (this.imageStorage as any).removeSession(session.id);

        // Step 5: Refresh the session list
        await this.loadSessions();
      }
    } catch (e) {
      // Step 6: Handle any errors that occur during the process
      console.warn('deleteSession failed', e);
    }
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
}

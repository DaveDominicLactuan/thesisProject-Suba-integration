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
import * as L from 'leaflet';
import { Firestore, collection, getDocs } from '@angular/fire/firestore';
import { UserPrefetchCacheService } from '../services/user-prefetch-cache.service';

interface OfficeLocationMarkerData {
  id: string;
  latitude: number;
  longitude: number;
  payload: Record<string, unknown>;
}

@Component({
  selector: 'app-home-page2',
  templateUrl: './home-page2.page.html',
  styleUrls: ['./home-page2.page.scss'],
  standalone: false
})
export class HomePage2Page implements OnInit, OnDestroy {
  private static userSyncTasks: Map<string, Promise<void>> = new Map();
  currentLocation: {
    latitude: number;
    longitude: number;
    accuracy: number;
    timestamp: string;
  } | null = null;
  locationStatusText: string = 'No location captured';
  locationErrorText: string = '';
  userName: string | null = null;
  firstName: string | null = null;
  lastName: string | null = null;
  email: string | null = null;
  engineeringID: string | null = null;
  userID: string | null = null;
  sessions: any[] = [];
  lastSessionDisplayName: string | null = null;
  private backButtonSub: any; // hardware back handler
  isLoggedIn: boolean = false;
  userRole: string | null = null;
  isSidebarOpen: boolean = false;
  syncStatusText: string = 'Not synced';
  cacheWarmStatusText: string = 'Not synced';
  syncStatusState: 'idle' | 'syncing' | 'completed' | 'error' = 'idle';
  private officeLocationMarkerData: OfficeLocationMarkerData[] = [];

  /** Inject auth, router, and image storage services for navigation and data. */
  constructor(private formBuilder: FormBuilder, private router: Router, private authService: AuthService, private navCtrl: NavController, private auth3: Auth3Service, private imageStorage: ImageStorageService, private platform: Platform, private firestore: Firestore, private userPrefetchCache: UserPrefetchCacheService) {

  }

ngOnInit(): void {
  console.log('[HomePage2.ngOnInit] ===== PAGE INIT START (ngOnInit called) =====');
  console.log('[HomePage2.ngOnInit] Auth currentUser on ngOnInit:', this.auth3.getCurrentUser()?.uid || 'null');
  
  //initializes the data needed for the page such as user data, profile and session
  this.initialize();
}

/** Perform async initialization tasks (profile + sessions). */
private async initialize(): Promise<void> {
  try {
    console.log('[HomePage2.initialize] ===== INITIALIZE START =====');
    console.log('[HomePage2.initialize] Auth currentUser at initialize start:', this.auth3.getCurrentUser()?.uid || 'null');

    const cachedUid = this.resolveCachedUid();
    if (cachedUid) {
      this.refreshCacheWarmStatus(cachedUid);

      const cachedProfile = this.userPrefetchCache.getCachedUserProfile(cachedUid);
      if (cachedProfile) {
        this.firstName = cachedProfile.firstName || this.firstName;
        this.lastName = cachedProfile.lastName || this.lastName;
        this.email = cachedProfile.email || this.email;
        this.userID = cachedProfile.userID || cachedProfile.uid || this.userID;
      }
      await this.hydrateLocalImageStorageFromCache(cachedUid);
      this.userPrefetchCache.warmUserDataInBackground(cachedUid, 'home-page2-initialize').finally(() => {
        this.refreshCacheWarmStatus(cachedUid);
      });
    }
    
    // Ensure Firebase auth state is ready before fetching profile
    // wait for up to 8 seconds for auth from firebase and current user profile from firestore
    if (!this.auth3.getCurrentUser()) {
      console.log('[HomePage2.initialize] getCurrentUser() is null, calling waitForAuthUser(15000)...');
      const waitResult = await this.auth3.waitForAuthUser(15000);
      console.log('[HomePage2.initialize] waitForAuthUser completed. Result:', waitResult?.uid || 'null');
    } else {
      console.log('[HomePage2.initialize] getCurrentUser() already available:', this.auth3.getCurrentUser()?.uid);
    }
    
    console.log('[HomePage2.initialize] Auth currentUser before getUserProfile:', this.auth3.getCurrentUser()?.uid || 'null');
    console.log('[HomePage2.initialize] About to call getUserProfile()...');
    
   // stores current user profile data in profile variables 
    const profile = await this.auth3.getUserProfile();
    console.log('[HomePage2.initialize] getUserProfile succeeded. Profile:', profile);
    
    this.firstName = profile['firstName'];
    this.lastName = profile['lastName'];
    this.engineeringID = profile['engineeringID'] || '';
    this.email = profile['email'] || '';
    this.userID = profile['userID'] || '';
    // Read role from Firestore profile (authoritative source)
    this.userRole = profile['role'] || (this.engineeringID ? 'engineer' : 'user');
    //gets username from firatName and lastName
    this.userName = (this.firstName && this.lastName) ? `${this.firstName} ${this.lastName}` : (this.email || null);
    //prints the current user profile to console
    console.log('[HomePage2.initialize] user profile loaded', {
      firstName: this.firstName,
      lastName: this.lastName,
      email: this.email,
      engineeringID: this.engineeringID,
      userID: this.userID,
      userRole: this.userRole,
      userName: this.userName
    });

    // ✅ Start background sync user's sessions/images from Firestore to local storage
    const resolvedUserId = this.userID || this.auth3.getCurrentUser()?.uid || '';
    this.userID = resolvedUserId || this.userID;
    this.loadPersistedSyncStatus(resolvedUserId);
    this.loadPersistedLocation(resolvedUserId);
    if (resolvedUserId) {
      this.refreshCacheWarmStatus(resolvedUserId);
      this.userPrefetchCache.warmUserDataInBackground(resolvedUserId, 'home-page2-profile-ready').finally(() => {
        this.refreshCacheWarmStatus(resolvedUserId);
      });
    }
    
    // Fetch office location markers early in app flow for offline fallback
    try {
      await this.fetchOfficeLocationMarkerData();
    } catch (err) {
      console.error('[HomePage2.initialize] Failed to fetch office location markers:', err);
    }
    
    console.log('[HomePage2.initialize] Starting initial background sync check for user:', resolvedUserId || 'none');
    this.startUserSyncInBackground(resolvedUserId, true);

    console.log('[HomePage2.initialize] ===== INITIALIZE END (success) =====');
    // Persist/refresh local user data for downstream use, and for long term offline use
    try {
      localStorage.setItem('userData', JSON.stringify({
        username: this.userName || '',
        userRole: this.userRole || 'user',
        firstName: this.firstName || '',
        lastName: this.lastName || '',
        engineeringID: this.engineeringID || '',
        email: this.email || '',
        userID: this.userID || ''
      }));
      localStorage.setItem('isLoggedIn', 'true');
    } catch {}
     // Also persist user profile in sessionStorage for current session, short lived and cleared when closed
     try {
       sessionStorage.setItem('userProfile', JSON.stringify({
         username: this.userName || '',
         userRole: this.userRole || 'user',
         firstName: this.firstName || '',
         lastName: this.lastName || '',
         engineeringID: this.engineeringID || '',
         email: this.email || '',
         userID: this.userID || ''
       }));
       sessionStorage.setItem('isLoggedInSession', 'true');
     } catch {}
  } catch (error) {
    console.error('[HomePage2.initialize] ERROR in initialize:', error);
    console.error('[HomePage2.initialize] Error type:', error instanceof Error ? error.message : 'unknown');
    console.error('[HomePage2.initialize] Full error object:', JSON.stringify(error, null, 2));
    console.log('[HomePage2.initialize] Auth currentUser during error:', this.auth3.getCurrentUser()?.uid || 'null');
    
    // Fallback: try to load previously saved user data
    try {
      const cached = localStorage.getItem('userData');
      if (cached) {
        const data = JSON.parse(cached);
        this.firstName = data.firstName || null;
        this.lastName = data.lastName || null;
        this.userName = data.username || null;
        this.userRole = data.userRole || 'user';
        this.email = data.email || null;
        this.engineeringID = data.engineeringID || null;
        this.userID = data.userID || null;
        console.log('[HomePage2.initialize] loaded user profile from cache', data);
      }
    } catch {}
    console.log('[HomePage2.initialize] ===== INITIALIZE END (with error) =====');
  }
}

  private resolveCachedUid(): string {
    const currentUid = this.auth3.getCurrentUser()?.uid || this.userID || '';
    if (currentUid) return currentUid;

    try {
      const userDataRaw = localStorage.getItem('userData');
      if (!userDataRaw) return '';
      const userData = JSON.parse(userDataRaw);
      return userData?.userID || '';
    } catch {
      return '';
    }
  }

  private refreshCacheWarmStatus(userId: string): void {
    if (!userId) {
      this.cacheWarmStatusText = 'Not synced';
      return;
    }

    this.cacheWarmStatusText = this.userPrefetchCache.getLastWarmLabel(userId);
  }

  private async hydrateLocalImageStorageFromCache(userId: string): Promise<void> {
    if (!userId) return;

    try {
      const cachedSessions = this.userPrefetchCache.getCachedSessions(userId);
      for (const session of cachedSessions) {
        try {
          this.imageStorage.addSessionIfNotExists({
            id: session.id,
            name: session.name || 'Untitled Session',
            imageKeys: Array.isArray(session.imageKeys) ? session.imageKeys : [],
            created: session.created || new Date().toISOString(),
            userId
          });
        } catch {}
      }

      const cachedImages = this.userPrefetchCache.getCachedImages(userId);
      for (const image of cachedImages) {
        try {
          await this.imageStorage.addImageIfNotExists({
            original: image.original || '',
            withBoxes: image.withBoxes || image.original || '',
            boxes: Array.isArray(image.boxes) ? image.boxes : [],
            faceDetected: !!image.faceDetected,
            faceData: Array.isArray(image.faceData) ? image.faceData : [],
            timestamp: image.timestamp || new Date().toISOString(),
            filename: image.filename || image.id || '',
            prediction: image.prediction,
            hasPrediction: !!image.hasPrediction,
            statusMessage: image.statusMessage || '',
            detectionMessage: image.detectionMessage || '',
            userId,
            sessionId: image.sessionId || undefined
          } as any, image.sessionId || undefined);
        } catch {}
      }
    } catch (error) {
      console.warn('[HomePage2] Failed to hydrate ImageStorageService from prefetched cache', error);
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
    this.loadSessions();
    const uid = this.userID || this.auth3.getCurrentUser()?.uid || '';
    if (uid) {
      this.loadPersistedSyncStatus(uid);
      this.loadPersistedLocation(uid);
    }
    // Refresh office location markers from Firestore on page entry
    this.fetchOfficeLocationMarkerData().catch((err) => {
      console.error('[HomePage2.ionViewWillEnter] Failed to refresh markers:', err);
    });
    this.requestLocationAccessOnEnter();
  }

  private getLocationStorageKey(userId: string): string {
    return `user_sidebar_location_${userId}`;
  }

  private loadPersistedLocation(userId: string): void {
    if (!userId) return;
    try {
      const raw = localStorage.getItem(this.getLocationStorageKey(userId));
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed.latitude === 'number' &&
        typeof parsed.longitude === 'number' &&
        typeof parsed.accuracy === 'number' &&
        typeof parsed.timestamp === 'string'
      ) {
        this.currentLocation = {
          latitude: parsed.latitude,
          longitude: parsed.longitude,
          accuracy: parsed.accuracy,
          timestamp: parsed.timestamp
        };
        this.locationStatusText = `Updated: ${new Date(parsed.timestamp).toLocaleString()}`;
        this.locationErrorText = '';
      }
    } catch {
      this.currentLocation = null;
      this.locationStatusText = 'No location captured';
      this.locationErrorText = '';
    }
  }

  private persistCurrentLocation(userId: string): void {
    if (!userId || !this.currentLocation) return;
    try {
      localStorage.setItem(this.getLocationStorageKey(userId), JSON.stringify(this.currentLocation));
    } catch {}
  }

  private clearPersistedLocation(userId: string): void {
    if (!userId) return;
    try { localStorage.removeItem(this.getLocationStorageKey(userId)); } catch {}
  }

  async requestLocationPermissionFromMenu(): Promise<void> {
    try {
      if (!('geolocation' in navigator)) {
        this.locationStatusText = 'Location unavailable';
        this.locationErrorText = 'Geolocation is not supported on this device/browser.';
        return;
      }

      this.locationStatusText = 'Requesting location permission...';
      this.locationErrorText = '';

      await this.requestLocationAccessOnEnter();

      if (this.currentLocation) {
        this.locationStatusText = `Updated: ${new Date(this.currentLocation.timestamp).toLocaleString()}`;
      } else if (!this.locationErrorText) {
        this.locationStatusText = 'Location permission requested';
      }
    } catch (error) {
      const geoError = error as GeolocationPositionError;
      this.locationStatusText = 'Location unavailable';
      this.locationErrorText = geoError?.message || 'Unable to request location permission.';
      console.warn('[HomePage2.requestLocationPermissionFromMenu] Permission request failed:', error);
    }
  }

  async getAndStoreCurrentLocation(): Promise<void> {
    try {
      if (!('geolocation' in navigator)) {
        this.locationErrorText = 'Geolocation is not supported on this device/browser.';
        this.locationStatusText = 'Location unavailable';
        return;
      }

      this.locationStatusText = 'Getting current location...';
      this.locationErrorText = '';

      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos),
          (err) => reject(err),
          {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0
          }
        );
      });

      this.currentLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: new Date(position.timestamp).toISOString()
      };

      this.locationStatusText = `Updated: ${new Date(position.timestamp).toLocaleString()}`;
      const uid = this.userID || this.auth3.getCurrentUser()?.uid || '';
      this.persistCurrentLocation(uid);

      console.log('[HomePage2.getAndStoreCurrentLocation] Location saved to sidebar state:', this.currentLocation);
    } catch (error) {
      const geoError = error as GeolocationPositionError;
      this.locationErrorText = geoError?.message || 'Unknown geolocation error';
      this.locationStatusText = 'Location unavailable';
      console.error('[HomePage2.getAndStoreCurrentLocation] Failed to get location:', {
        code: geoError?.code,
        message: geoError?.message || 'Unknown geolocation error'
      });
    }
  }

  async showLocationOverlay(): Promise<void> {
    if (document.getElementById('location-overlay')) return;

    if (!this.currentLocation) {
      await this.getAndStoreCurrentLocation();
    }

    const overlay = document.createElement('div');
    overlay.id = 'location-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.background = 'rgba(0,0,0,0.45)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '10000';

    const box = document.createElement('div');
    box.style.background = '#fff';
    box.style.padding = '18px';
    box.style.borderRadius = '8px';
    box.style.minWidth = '260px';
    box.style.maxWidth = '90%';
    box.style.boxShadow = '0 4px 20px rgba(0,0,0,0.25)';

    const title = document.createElement('div');
    title.innerText = 'Current Device Location';
    title.style.fontWeight = '600';
    title.style.fontSize = '16px';
    title.style.marginBottom = '10px';

    const details = document.createElement('div');
    details.style.fontSize = '14px';
    details.style.lineHeight = '1.55';
    details.style.color = '#333';

    if (this.currentLocation) {
      details.innerHTML = `
        <div><strong>Status:</strong> ${this.locationStatusText}</div>
        <div><strong>Latitude:</strong> ${this.currentLocation.latitude.toFixed(6)}</div>
        <div><strong>Longitude:</strong> ${this.currentLocation.longitude.toFixed(6)}</div>
        <div><strong>Accuracy:</strong> ${Math.round(this.currentLocation.accuracy)} m</div>
        <div><strong>Timestamp:</strong> ${new Date(this.currentLocation.timestamp).toLocaleString()}</div>
      `;
    } else {
      details.innerHTML = `
        <div><strong>Status:</strong> ${this.locationStatusText}</div>
        <div><strong>Error:</strong> ${this.locationErrorText || 'Unable to retrieve location.'}</div>
      `;
    }

    const closeBtn = document.createElement('button');
    closeBtn.innerText = 'Close';
    closeBtn.style.marginTop = '14px';
    closeBtn.style.padding = '10px 14px';
    closeBtn.style.border = 'none';
    closeBtn.style.borderRadius = '6px';
    closeBtn.style.background = '#6b7280';
    closeBtn.style.color = '#fff';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.width = '100%';

    closeBtn.addEventListener('click', () => this.removeLocationOverlay());
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) this.removeLocationOverlay();
    });

    box.appendChild(title);
    box.appendChild(details);
    box.appendChild(closeBtn);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  private removeLocationOverlay(): void {
    try {
      const el = document.getElementById('location-overlay');
      if (el && el.parentElement) el.parentElement.removeChild(el);
    } catch {}
  }

  /**
   * Ask for geolocation permission when entering the page if not granted yet.
   * Uses Permissions API when available; falls back to requesting directly.
   */
  private async requestLocationAccessOnEnter(): Promise<void> {
    try {
      if (!('geolocation' in navigator)) return;

      const navAny = navigator as Navigator & {
        permissions?: {
          query: (descriptor: PermissionDescriptor) => Promise<PermissionStatus>;
        };
      };

      if (navAny.permissions && typeof navAny.permissions.query === 'function') {
        const status = await navAny.permissions.query({ name: 'geolocation' as PermissionName });

        if (status.state === 'granted') return;
        if (status.state === 'denied') {
          console.warn('[HomePage2.requestLocationAccessOnEnter] Geolocation permission is denied. Enable it from device/browser settings.');
          return;
        }
      }

      await this.promptForLocationAccess();
    } catch (error) {
      // Fallback path (e.g., permissions API unavailable in some WebViews)
      try {
        await this.promptForLocationAccess();
      } catch (innerError) {
        console.warn('[HomePage2.requestLocationAccessOnEnter] Location permission prompt failed:', innerError || error);
      }
    }
  }

  /** Trigger a geolocation request to let the OS/browser show permission prompt. */
  private async promptForLocationAccess(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        () => resolve(),
        (err) => reject(err),
        {
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 60000
        }
      );
    });
  }

  private getSyncStatusStorageKey(userId: string): string {
    return `user_sync_status_${userId}`;
  }

  private getSyncBootstrapDoneKey(userId: string): string {
    return `user_sync_bootstrap_done_${userId}`;
  }

  private hasBootstrapSyncCompleted(userId: string): boolean {
    if (!userId) return false;
    try {
      return sessionStorage.getItem(this.getSyncBootstrapDoneKey(userId)) === 'true';
    } catch {
      return false;
    }
  }

  private markBootstrapSyncCompleted(userId: string): void {
    if (!userId) return;
    try {
      sessionStorage.setItem(this.getSyncBootstrapDoneKey(userId), 'true');
    } catch {}
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

  private setSyncStatus(state: 'idle' | 'syncing' | 'completed' | 'error', text: string, userId?: string): void {
    this.syncStatusState = state;
    this.syncStatusText = text;
    if (!userId) return;
    try {
      localStorage.setItem(this.getSyncStatusStorageKey(userId), JSON.stringify({
        state,
        text,
        updatedAt: new Date().toISOString()
      }));
    } catch {}
  }

  private startUserSyncInBackground(userId: string, onlyIfFirstSync: boolean = false): void {
    if (!userId) {
      this.setSyncStatus('error', 'No user for sync');
      return;
    }

    if (onlyIfFirstSync && this.hasBootstrapSyncCompleted(userId)) {
      this.setSyncStatus('completed', 'Sync complete', userId);
      return;
    }

    const existingTask = HomePage2Page.userSyncTasks.get(userId);
    if (existingTask) {
      this.setSyncStatus('syncing', 'Syncing...', userId);
      existingTask
        .then(async () => {
          this.setSyncStatus('completed', 'Sync complete', userId);
          await this.loadSessions();
        })
        .catch(() => {
          this.setSyncStatus('error', 'Sync failed', userId);
        });
      return;
    }

    this.setSyncStatus('syncing', 'Syncing...', userId);
    const task = this.syncUserDataFromFirestore(userId)
      .then(async () => {
        this.setSyncStatus('completed', 'Sync complete', userId);
        this.markBootstrapSyncCompleted(userId);
        await this.loadSessions();
      })
      .catch((err) => {
        console.error('[HomePage2.startUserSyncInBackground] sync task failed:', err);
        this.setSyncStatus('error', 'Sync failed', userId);
      })
      .finally(() => {
        HomePage2Page.userSyncTasks.delete(userId);
      });

    HomePage2Page.userSyncTasks.set(userId, task);
  }

  /** Register hardware back handler only while this view is active, 
   * allowing for hardware back button navigation */
  ionViewDidEnter() {
    this.registerBackButtonHandler();
  }

  /** Remove hardware back handler when navigating away so other pages work normally, 
   * so as to keep logic for exiting the app inside home-page and not affect other pages*/
  ionViewWillLeave() {
    this.removeBackButtonHandler();
  }

  /** Load sessions from ImageStorageService and compute image counts. */
  async loadSessions() {
    try {
      //Safely read sessions from ImageStorageService, create a copy and stores it.
      const s = (this.imageStorage.getSessions && typeof this.imageStorage.getSessions === 'function') ? this.imageStorage.getSessions() : [];
      const sessionsRaw = Array.isArray(s) ? s.slice() : [];

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

      // counts how many imageKeys or images in the sessions are present in allImages
      this.sessions = sessionsRaw.map((sess: any) => {
        const keys = Array.isArray(sess.imageKeys) ? sess.imageKeys : [];
        // Use filename as the only key for matching
        const imageCount = keys.reduce((acc: number, k: string) => acc + (allImages.findIndex(ai => ai.filename === k) !== -1 ? 1 : 0), 0);
        return { ...sess, imageCount };
      });
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
   * This enables cross-device data access by loading the user's sessions and images
   * from Firestore on page init and populating the local storage.
   */
  private async syncUserDataFromFirestore(userId: string): Promise<void> {
    if (!userId) {
      console.warn('[HomePage2.syncUserDataFromFirestore] No userId provided, skipping sync');
      return;
    }

    try {
      console.log('[HomePage2.syncUserDataFromFirestore] Starting sync for userId:', userId);

      // Fetch user sessions from Firestore
      const firebaseSessions = await this.auth3.getUserSessions(userId);
      console.log('[HomePage2.syncUserDataFromFirestore] Fetched', firebaseSessions.length, 'sessions from Firestore');
      console.log('[HomePage2.syncUserDataFromFirestore] Raw Firestore sessions:', firebaseSessions);
      try {
        console.log('[HomePage2.syncUserDataFromFirestore] Raw Firestore sessions JSON:', JSON.stringify(firebaseSessions, null, 2));
      } catch (jsonErr) {
        console.warn('[HomePage2.syncUserDataFromFirestore] Failed to stringify sessions:', jsonErr);
      }

      // Fetch user images from Firestore
      const firestoreImages = await this.auth3.getUserImages(userId);
      console.log('[HomePage2.syncUserDataFromFirestore] Fetched', firestoreImages.length, 'images from Firestore');
      console.log('[HomePage2.syncUserDataFromFirestore] Raw Firestore images:', firestoreImages);
      try {
        console.log('[HomePage2.syncUserDataFromFirestore] Raw Firestore images JSON:', JSON.stringify(firestoreImages, null, 2));
      } catch (jsonErr) {
        console.warn('[HomePage2.syncUserDataFromFirestore] Failed to stringify images:', jsonErr);
      }

      let sessionsAdded = 0;
      let imagesAdded = 0;

      // Convert Firestore sessions to ImageSession format and add to ImageStorageService
      for (const fsSession of firebaseSessions) {
        const session = {
          id: fsSession.id || fsSession.sessionId || `s-${Date.now()}`,
          name: fsSession.name || 'Untitled Session',
          imageKeys: Array.isArray(fsSession.imageKeys) ? fsSession.imageKeys : [],
          created: fsSession.created || new Date().toISOString(),
          userId: userId
        };
        console.log('[HomePage2.syncUserDataFromFirestore] Mapped session object:', session);

        const added = this.imageStorage.addSessionIfNotExists(session as any);
        if (added) {
          sessionsAdded += 1;
          console.log('[HomePage2.syncUserDataFromFirestore] Added session to local storage:', session.id);
        } else {
          console.log('[HomePage2.syncUserDataFromFirestore] Session already exists locally:', session.id);
        }
      }

      // Convert Firestore images to StoredImage format and add to ImageStorageService
      for (const fsImage of firestoreImages) {
        // Map Firestore image fields to StoredImage interface
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
        console.log('[HomePage2.syncUserDataFromFirestore] Mapped image object:', {
          filename: storedImage.filename,
          originalPreview: storedImage.original ? `${String(storedImage.original).slice(0, 40)}...` : '',
          withBoxesPreview: storedImage.withBoxes ? `${String(storedImage.withBoxes).slice(0, 40)}...` : '',
          boxesCount: Array.isArray(storedImage.boxes) ? storedImage.boxes.length : 0,
          faceDetected: storedImage.faceDetected,
          timestamp: storedImage.timestamp
        });

        // Check/store image in local storage while skipping duplicates
        const added = await this.imageStorage.addImageIfNotExists(storedImage as any, storedImage.sessionId);
        if (added) {
          imagesAdded += 1;
          console.log('[HomePage2.syncUserDataFromFirestore] Added image to local storage:', storedImage.filename || 'unnamed');
        } else {
          console.log('[HomePage2.syncUserDataFromFirestore] Image already exists locally:', storedImage.filename || 'unnamed');
        }
      }

      console.log('[HomePage2.syncUserDataFromFirestore] Sync completed successfully', {
        sessionsFetched: firebaseSessions.length,
        sessionsAdded,
        imagesFetched: firestoreImages.length,
        imagesAdded
      });
    } catch (error) {
      console.error('[HomePage2.syncUserDataFromFirestore] ERROR during sync:', error);
      // Continue gracefully if sync fails - app can still work with local data
      throw error;
    }
  }

  // Additional methods can be added here

  /** Navigate to legacy camera page route. */
  goToHomePage() {
    this.router.navigate(['/home-page2']);
    console.log('camera page');
  }
  
  /** Navigate to enhanced camera page with sessions support. */
  goToCameraPage2() {
    this.router.navigate(['/camera-page2']);
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
    this.router.navigate(['/session-page']);
    console.log('session page');
  }

  /** Navigate to sessions list page. */
  gochatPage() {
    this.removeBackButtonHandler();
    this.router.navigate(['/chat-page']);
    console.log('chat page');
  }

  /** Navigate to profile page. */
  goToProfilePage() {
    this.router.navigate(['/profile-page']);
    console.log('Navigating to profile page');
  }

  /** Shared logout flow used by overlay button and menu item. */
  async logout(closeOverlay: boolean = false) {
    const currentUid = this.userID || this.auth3.getCurrentUser()?.uid || '';
    if (currentUid) {
      this.clearSyncStateForUser(currentUid);
      this.clearPersistedLocation(currentUid);
    }
    this.currentLocation = null;
    this.locationStatusText = 'No location captured';
    this.locationErrorText = '';
    this.syncStatusState = 'idle';
    this.syncStatusText = 'Not synced';
    this.cacheWarmStatusText = 'Not synced';
    try {
      await this.auth3.logout();
    } catch {}
    try { localStorage.setItem('isLoggedIn', 'false'); } catch {}
    try { localStorage.removeItem('userData'); } catch {}
    this.isLoggedIn = false;
    if (closeOverlay) {
      this.removeTestOverlay();
      this.removeLocationOverlay();
    }
    // Navigate to landing page replacing history so next back exits
    try {
      this.router.navigateByUrl('/landing-page', { replaceUrl: true });
    } catch {
      this.router.navigate(['/landing-page']);
    }
  }

  /**
   * Open the Feedback page pre-selecting a session. Select its first image in
   * ImageStorageService so detail UIs can initialize accordingly.
   */
  async goToSession(session: any) {
    // pick the first image in session and prepare the destination(feedback-page) to load it and 
    // display that first image when the session is selected
     try {
      if (session && session.imageKeys && session.imageKeys.length > 0) {
        const key = session.imageKeys[0];
        if (this.imageStorage && key) {
          // Use filename as the only key
          this.imageStorage.selectImageByKey(key);
        }
      }
    } catch (e) { console.warn('goToSession warning', e); }
    try {
      // Ensure HomePage back handler is removed before naviagting 
      // to feedback-page to keep the logic and behavior of back button is kept inside the home-page
      try { this.removeBackButtonHandler(); } catch (e) { /* ignore */ }

      //build the parameters for the current session to be selected and displayed 
      // in feedback-page with the session.id
      const params: any = {};
      if (session && session.id) params.sessionId = session.id;
      // Navigate to feedback page and include sessionId so feedback page can load the session
      this.router.navigate(['/feedback-page'], { queryParams: params });
    } catch (e) {
      console.warn('Navigation to feedback page failed, falling back', e);
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
   * Get current device/browser location and print it to console.
   */
  async getCurrentLocation(): Promise<void> {
    try {
      if (!('geolocation' in navigator)) {
        console.warn('[HomePage2.getCurrentLocation] Geolocation is not supported on this device/browser.');
        return;
      }

      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos),
          (err) => reject(err),
          {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0
          }
        );
      });

      console.log('[HomePage2.getCurrentLocation] Current location:', {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: new Date(position.timestamp).toISOString()
      });
    } catch (error) {
      const geoError = error as GeolocationPositionError;
      console.error('[HomePage2.getCurrentLocation] Failed to get location:', {
        code: geoError?.code,
        message: geoError?.message || 'Unknown geolocation error'
      });
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
            // Use filename as the only key
            const keys = Array.isArray(stored) ? stored.slice(0, 6).map((item: any) => item.filename || '').filter((k: string) => k) : [];
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

  /** Register a one-page-only back button that exits the app from home. 
   * and if test-overlay is currently append close the overlay before exit app logic from home */
  private registerBackButtonHandler() {
    try {
      this.removeBackButtonHandler();
      // priority 10: high enough to intercept overlay/back behavior on this page
      this.backButtonSub = this.platform.backButton.subscribeWithPriority(10, () => {
        try {
          const overlay = document.getElementById('test-overlay');
          if (overlay) {
            try { this.removeTestOverlay(); } catch (e) {}
            return;
          }
          const locationOverlay = document.getElementById('location-overlay');
          if (locationOverlay) {
            try { this.removeLocationOverlay(); } catch (e) {}
            return;
          }
        } catch (e) {}
        try { App.exitApp(); } catch (e) { console.warn('App.exitApp failed', e); }
      });
    } catch (e) {
      console.warn('[HomePage2] registerBackButtonHandler failed', e);
    }
  }

  /** Remove the test overlay from DOM if present. */
  private removeTestOverlay() {
    try {
      const el = document.getElementById('test-overlay');
      if (el && el.parentElement) el.parentElement.removeChild(el);
    } catch {}
  }

  /** Remove the home-page back handler so other pages can handle back navigation normally, 
   * without exit app logic and behavior */
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
    this.removeLocationOverlay();
  }
  
  openMenu(menuId: string) {
    this.isSidebarOpen = !this.isSidebarOpen;
  }

  closeSidebar() {
    this.isSidebarOpen = false;
  }

  /**
   * Get the localStorage key for storing office location marker data.
   * Scoped to the current user to avoid cross-user data leaks.
   */
  private getOfficeMarkerStorageKey(): string {
    const userId = this.auth3.getCurrentUser()?.uid || this.userID || 'unknown';
    return `office-location-markers-${userId}`;
  }

  /**
   * Save the current office location marker data to localStorage.
   * This provides a fallback cache in case Firestore is unavailable.
   */
  private saveOfficeMarkerDataToLocalStorage(): void {
    try {
      const key = this.getOfficeMarkerStorageKey();
      const dataToStore = JSON.stringify(this.officeLocationMarkerData);
      localStorage.setItem(key, dataToStore);
      console.log('[HomePage2.markerStorage] Marker data saved to localStorage.', {
        markerCount: this.officeLocationMarkerData.length,
        storageKey: key
      });
    } catch (error) {
      console.error('[HomePage2.markerStorage] Failed to save marker data to localStorage.', error);
    }
  }

  /**
   * Load office location marker data from localStorage.
   * Returns empty array if no data is found or if loading fails.
   */
  private loadOfficeMarkerDataFromLocalStorage(): OfficeLocationMarkerData[] {
    try {
      const key = this.getOfficeMarkerStorageKey();
      const storedData = localStorage.getItem(key);
      if (!storedData) {
        console.log('[HomePage2.markerStorage] No cached marker data found in localStorage.');
        return [];
      }
      const parsedData = JSON.parse(storedData) as OfficeLocationMarkerData[];
      console.log('[HomePage2.markerStorage] Marker data loaded from localStorage.', {
        markerCount: parsedData.length
      });
      return Array.isArray(parsedData) ? parsedData : [];
    } catch (error) {
      console.error('[HomePage2.markerStorage] Failed to load marker data from localStorage.', error);
      return [];
    }
  }

  /**
   * Fetch office location marker data from Firestore collection.
   * Falls back to localStorage if Firestore is unavailable.
   */
  private async fetchOfficeLocationMarkerData(): Promise<void> {
    const authedUser = this.auth3.getCurrentUser() ?? await this.auth3.waitForAuthUser(5000).catch(() => null);
    if (!authedUser?.uid) {
      console.warn('[HomePage2.userOfficeLocationMarker] Skipping collection fetch because Firebase auth user is not ready.');
      // Try to load from localStorage as a fallback
      this.officeLocationMarkerData = this.loadOfficeMarkerDataFromLocalStorage();
      return;
    }

    try {
      const markerCollectionRef = collection(this.firestore, 'userOfficeLocationMarker');
      const markerSnapshot = await getDocs(markerCollectionRef);
      const parsedMarkers: OfficeLocationMarkerData[] = [];

      markerSnapshot.forEach((markerDoc) => {
        const payload = (markerDoc.data() as Record<string, unknown>) ?? {};
        const coordinates = this.resolveOfficeMarkerCoordinates(payload);

        if (!coordinates) {
          console.warn('[HomePage2.userOfficeLocationMarker] Skipping document with invalid coordinates.', {
            docId: markerDoc.id,
            payload
          });
          return;
        }

        parsedMarkers.push({
          id: markerDoc.id,
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          payload
        });
      });

      this.officeLocationMarkerData = parsedMarkers;
      // Save to localStorage after successful fetch
      this.saveOfficeMarkerDataToLocalStorage();
      console.log('[HomePage2.userOfficeLocationMarker] Collection data loaded and stored.', {
        totalDocuments: markerSnapshot.size,
        markersStored: parsedMarkers.length,
        markersSkipped: markerSnapshot.size - parsedMarkers.length
      });
    } catch (error) {
      const errorCode = (error as { code?: string } | null)?.code ?? 'unknown';
      if (errorCode === 'permission-denied') {
        console.error('[HomePage2.userOfficeLocationMarker] Permission denied while reading full collection. Check firestore.rules for list/get read access on /userOfficeLocationMarker.', error);
      } else {
        console.error('[HomePage2.userOfficeLocationMarker] Failed to fetch collection data.', error);
      }
      // Fall back to localStorage data if Firestore fetch fails
      this.officeLocationMarkerData = this.loadOfficeMarkerDataFromLocalStorage();
    }
  }

  /**
   * Resolve marker coordinates from the payload object.
   * Supports multiple coordinate field naming conventions.
   */
  private resolveOfficeMarkerCoordinates(payload: Record<string, unknown>): { latitude: number; longitude: number } | null {
    const latitude = payload['latitude'] ?? payload['lat'] ?? null;
    const longitude = payload['longitude'] ?? payload['lng'] ?? null;

    if (typeof latitude === 'number' && typeof longitude === 'number') {
      return { latitude, longitude };
    }

    return null;
  }

  async markUserLocation(map: any) {
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos),
          (err) => reject(err)
        );
      });

      const { latitude, longitude } = position.coords;
      L.marker([latitude, longitude])
        .addTo(map)
        .bindPopup("You are here!")
        .openPopup();
    } catch (error) {
      console.error('Failed to mark user location:', error);
    }
  }

   goNetworkPage() {
    this.router.navigate(['/network-page2']);
    console.log('network page 2');
  }

}

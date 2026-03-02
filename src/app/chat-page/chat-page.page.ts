import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { NavController, Platform } from '@ionic/angular';
import { User } from 'firebase/auth';
import { Auth3Service } from '../services/auth3.service';
import { Firestore, collection, query, where, getDocs } from '@angular/fire/firestore';
import { ImageStorageService } from '../services/image-storage.service';
import { ChatService, Message } from '../services/chat.service';
import { PresenceService } from '../services/presence.service';
import { Subscription } from 'rxjs';
import { App } from '@capacitor/app';
import { Geolocation } from '@capacitor/geolocation';
// Leaflet map library
import * as L from 'leaflet';
@Component({
  selector: 'app-chat-page',
  templateUrl: './chat-page.page.html',
  styleUrls: ['./chat-page.page.scss'],
  standalone: false
})

export class ChatPagePage implements OnInit, OnDestroy {
  private static userSyncTasks: Map<string, Promise<void>> = new Map();
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
  syncStatusState: 'idle' | 'syncing' | 'completed' | 'error' = 'idle';
  // UI: toggles between preview list and active chat conversation
  isChatOpen: boolean = false;
  activeChat: any = null;
  // current chat id and messages
  currentChatId: string | null = null;
  messages: Message[] = [];
  messageText: string = '';
  private messagesSub?: Subscription;
  isSearching = false;
  searchQuery = '';
  // active bottom navigation tab: 'person' | 'people' | 'location' | 'settings'
  activeTab: 'person' | 'people' | 'location' | 'settings' = 'people';
  private map?: L.Map | null = null;
  private userLocationMarker?: L.Marker;
  private readonly fallbackCoordinates = { latitude: 10.324849, longitude: 123.849164 };
  private mapInitAttempts = 0;
  private readonly maxMapInitAttempts = 8;
  private mapResizeTimeoutId?: ReturnType<typeof setTimeout>;
  private markerOverlayElement?: HTMLDivElement;

  // Placeholder search conversation results (simulate as in pasted image)
  searchConversationResults = [
    {
      id: 'u1',
      name: 'Alison Gilchrist',
      lastMessage: '@andrewJ do you like this imgur picture?',
      time: '2:14 PM',
      avatar: null,
      initials: 'AG',
      isOnline: true
    },
    {
      id: 'u2',
      name: 'Ben Holt',
      lastMessage: 'File: Imgur_proposal.pdf',
      time: 'Yesterday',
      avatar: null,
      initials: 'BH',
      isOnline: false
    },
    {
      id: 'u3',
      name: 'Imgur memes',
      lastMessage: 'https://imgur.com/t/funny/ncI25Tb',
      time: '12/22/20',
      avatar: null,
      initials: 'IM',
      isOnline: false
    }
  ];

  // Old mock search results (for other search views)
  mockSearchResults = [
    { id: 'u1', name: 'Demola Andreas', subtitle: 'Online', avatar: 'assets/engIcon.png' },
    { id: 'u2', name: 'Fitted – Tech & Design', subtitle: 'Group chat', avatar: null, initials: 'FTD' },
    { id: 'u3', name: 'Thecla', subtitle: 'Last seen today', avatar: 'assets/engIcon.png' }
  ];

  // dynamic list of users with role 'engineer' from Firestore
  engineers: any[] = [];

  // chat list rendered in the UI (initially seeded with same two sample chats)
  chats: any[] = [
    { id: 'ftd', name: 'Fitted - Tech & Design', avatar: 'assets/engIcon.png', lastMessage: 'Thecla: @Ovo How is it going?', time: '11:11 am', unread: true },
    { id: 'demola', name: 'Demola Andreas', avatar: 'assets/engIcon.png', lastMessage: 'Job Description.docx', time: 'Yesterday', badge: 1 }
  ];

  /** Inject auth, router, and image storage services for navigation and data. */
  constructor(private formBuilder: FormBuilder, private router: Router, private authService: AuthService, private navCtrl: NavController, public auth3: Auth3Service, private imageStorage: ImageStorageService, private platform: Platform, private firestore: Firestore, private chatService: ChatService, private presenceService: PresenceService) {

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
    // Load profile (if available) and ensure userID
    const profile = await this.auth3.getUserProfile().catch(() => null);
    this.firstName = profile?.firstName || this.firstName;
    this.lastName = profile?.lastName || this.lastName;
    this.email = profile?.email || this.email;
    this.userID = this.auth3.getCurrentUser()?.uid || this.userID || (profile && (profile.userID || profile.uid));

    // Start presence service (RTDB -> Firestore sync)
    try { this.presenceService.start(); } catch (e) { console.warn('PresenceService.start failed', e); }
  } catch (err) {
    console.warn('[ChatPage] initialize error', err);
  }
}


  // Additional methods can be added here

  /** Navigate to legacy camera page route. */
  goToHomePage() {
    this.router.navigate(['/home-page2']);
    console.log('camera page');
  }


  onSearchFocus() {
    if (!this.isChatOpen) {
      this.isSearching = true;
      // fetch engineers from Firestore when entering search mode
      this.fetchEngineers().catch(err => console.error('fetchEngineers failed', err));
    }
  }

  onSearchInput(ev: any) {
    this.searchQuery = ev.target.value;
    this.isSearching = this.searchQuery.length > 0;
    // Optionally filter searchConversationResults here if you want dynamic filtering
    // For now, keep static placeholder results as in the pasted image
  }

  clearSearch() {
    this.searchQuery = '';
    this.isSearching = false;
  }

  closeSearch() {
    this.isSearching = false;
    // Optionally clear searchQuery as well:
    // this.searchQuery = '';
  }

  /** Query Firestore for users where role == 'engineer' and populate `engineers` */
  async fetchEngineers(): Promise<void> {
    try {
      const usersCol = collection(this.firestore, 'users');
      const q = query(usersCol, where('role', '==', 'engineer'));
      const snap = await getDocs(q);
      const arr: any[] = [];
      snap.forEach(doc => {
        const data = { id: (doc as any).id, ...(doc.data() as any) };
        arr.push(data);
      });
      this.engineers = arr;
      console.log('[ChatPage] Engineers fetched from Firestore:', this.engineers);
    } catch (err) {
      console.error('[ChatPage] Error fetching engineers:', err);
      this.engineers = [];
    }
  }

  /** Handle selecting an engineer from search results: create chat and subscribe messages */
  async selectEngineer(user: any) {
    console.log('[ChatPage] Engineer selected:', user);
    const currentUid = this.auth3.getCurrentUser()?.uid || this.userID || '';
    if (!currentUid) {
      console.warn('[ChatPage] No current user; cannot create chat');
      return;
    }

    // ensure we don't duplicate in chats list (UI list)
    const exists = this.chats.find(c => c.id === user.id || c.name === user.name);
    if (!exists) {
      this.chats.unshift({ id: user.id, name: user.firstName ? `${user.firstName} ${user.lastName}` : user.name || user.email, avatar: user.photoURL || null, lastMessage: '', time: '', addedFromSearch: true });
    }

    // ensure chat document exists and get deterministic chatId
    const chat = await this.chatService.createOrEnsureChat(currentUid, user.id);
    this.currentChatId = chat.chatId;

    // open conversation view
    this.activeChat = { id: user.id, name: user.firstName ? `${user.firstName} ${user.lastName}` : user.name || user.email, avatar: user.photoURL || null, chatId: chat.chatId };
    this.isChatOpen = true;

    // unsubscribe previous
    try { this.messagesSub?.unsubscribe(); } catch {}

    // subscribe to messages and mark unread incoming messages as read
    this.messagesSub = this.chatService.getMessages(chat.chatId).subscribe(async (msgs) => {
      this.messages = msgs || [];
      const unread = this.messages.filter(m => !m.isRead && m.senderId !== currentUid && m.id);
      for (const m of unread) {
        try { await this.chatService.markMessageAsRead(chat.chatId, m.id!); } catch (e) { console.warn('markMessageAsRead failed', e); }
      }
    });

    console.log('[ChatPage] Opened chat', chat.chatId);
  }

  /** Send a message in the current chat */
  async sendMessage() {
    if (!this.currentChatId) return;
    const senderId = this.auth3.getCurrentUser()?.uid || this.userID || '';
    if (!senderId) return;
    const text = (this.messageText || '').trim();
    if (!text) return;
    try {
      await this.chatService.sendMessage(this.currentChatId, { senderId, text });
      this.messageText = '';
    } catch (e) {
      console.error('sendMessage failed', e);
    }
  }
  
  /** Return initials for a display name to use in avatar fallback. */
  getInitials(name?: string | null): string {
    if (!name) return 'U';
    const parts = name.trim().split(/\s+/).filter(p => p.length > 0);
    const initials = parts.slice(0, 2).map(p => p[0].toUpperCase()).join('');
    return initials || 'U';
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
    console.log('pdf 2 page');
  }

  goNetworkPage() {
    this.router.navigate(['/network-page2']);
    console.log('network page 2');
  }

  /** Navigate to profile page. */
  goToProfilePage() {
    this.router.navigate(['/profile-page']);
    console.log('Navigating to profile page');
  }

  /** Shared logout flow used by overlay button and menu item. */
  async logout(closeOverlay: boolean = false) {
    const currentUid = this.userID || this.auth3.getCurrentUser()?.uid || '';
    if (currentUid) this.clearSyncStateForUser(currentUid);
    this.syncStatusState = 'idle';
    this.syncStatusText = 'Not synced';
    try {
      await this.auth3.logout();
    } catch {}
    try { localStorage.setItem('isLoggedIn', 'false'); } catch {}
    try { localStorage.removeItem('userData'); } catch {}
    this.isLoggedIn = false;
    if (closeOverlay) {
    }
    // Navigate to landing page replacing history so next back exits
    try {
      this.router.navigateByUrl('/landing-page', { replaceUrl: true });
    } catch {
      this.router.navigate(['/landing-page']);
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



  
  openMenu(menuId: string) {
    this.isSidebarOpen = !this.isSidebarOpen;
  }

  openMarkerCreationOverlay(): void {
    if (this.markerOverlayElement) return;

    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.right = '0';
    overlay.style.bottom = '0';
    overlay.style.background = 'rgba(0, 0, 0, 0.45)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '9999';
    overlay.style.padding = '16px';

    const panel = document.createElement('div');
    panel.style.background = '#ffffff';
    panel.style.borderRadius = '14px';
    panel.style.width = '100%';
    panel.style.maxWidth = '360px';
    panel.style.padding = '16px';
    panel.style.boxShadow = '0 12px 30px rgba(0, 0, 0, 0.2)';
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    panel.style.gap = '10px';

    const title = document.createElement('h3');
    title.textContent = 'Create map marker';
    title.style.margin = '0 0 4px';
    title.style.fontSize = '17px';

    const latInput = document.createElement('input');
    latInput.type = 'number';
    latInput.placeholder = 'Latitude (e.g. 10.324849)';
    latInput.step = 'any';
    latInput.style.height = '40px';
    latInput.style.padding = '0 10px';
    latInput.style.border = '1px solid #d6d6d6';
    latInput.style.borderRadius = '8px';

    const lngInput = document.createElement('input');
    lngInput.type = 'number';
    lngInput.placeholder = 'Longitude (e.g. 123.849164)';
    lngInput.step = 'any';
    lngInput.style.height = '40px';
    lngInput.style.padding = '0 10px';
    lngInput.style.border = '1px solid #d6d6d6';
    lngInput.style.borderRadius = '8px';

    const message = document.createElement('div');
    message.style.minHeight = '18px';
    message.style.fontSize = '12px';
    message.style.color = '#d32f2f';

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';
    actions.style.justifyContent = 'flex-end';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.height = '36px';
    cancelBtn.style.padding = '0 14px';
    cancelBtn.style.border = '1px solid #d0d0d0';
    cancelBtn.style.borderRadius = '8px';
    cancelBtn.style.background = '#fff';

    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.textContent = 'Create Marker';
    createBtn.style.height = '36px';
    createBtn.style.padding = '0 14px';
    createBtn.style.border = 'none';
    createBtn.style.borderRadius = '8px';
    createBtn.style.background = '#387ef5';
    createBtn.style.color = '#fff';

    actions.appendChild(cancelBtn);
    actions.appendChild(createBtn);

    panel.appendChild(title);
    panel.appendChild(latInput);
    panel.appendChild(lngInput);
    panel.appendChild(message);
    panel.appendChild(actions);
    overlay.appendChild(panel);

    const dismiss = () => {
      try { document.body.removeChild(overlay); } catch {}
      if (this.markerOverlayElement === overlay) {
        this.markerOverlayElement = undefined;
      }
    };

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) dismiss();
    });

    panel.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    cancelBtn.addEventListener('click', () => dismiss());

    const createMarkerFromInput = async () => {
      const latitude = Number.parseFloat(latInput.value);
      const longitude = Number.parseFloat(lngInput.value);

      if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
        message.textContent = 'Please enter valid numeric latitude and longitude.';
        return;
      }

      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        message.textContent = 'Latitude must be -90..90 and longitude must be -180..180.';
        return;
      }

      if (!this.map) {
        await this.initMap();
      }

      if (!this.map) {
        message.textContent = 'Map is not ready yet. Try again.';
        return;
      }

      L.marker([latitude, longitude])
        .addTo(this.map)
        .bindPopup(`Marker: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`)
        .openPopup();

      this.map.setView([latitude, longitude], 15);
      console.log('[ChatPage.openMarkerCreationOverlay] Custom marker created:', { latitude, longitude });
      dismiss();
    };

    createBtn.addEventListener('click', () => { void createMarkerFromInput(); });
    latInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        lngInput.focus();
      }
    });
    lngInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void createMarkerFromInput();
      }
    });

    document.body.appendChild(overlay);
    this.markerOverlayElement = overlay;
    latInput.focus();
  }

    private clearSyncStateForUser(userId: string): void {
    if (!userId) return;
    try { localStorage.removeItem(this.getSyncStatusStorageKey(userId)); } catch {}
    try { sessionStorage.removeItem(this.getSyncBootstrapDoneKey(userId)); } catch {}
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


  closeSidebar() {
    this.isSidebarOpen = false;
  }

  /** Open the conversation view for a selected chat */
  openChat(chat: any) {
    this.activeChat = chat || { name: 'Chat' };
    this.isChatOpen = true;
    // optional: lock page scroll or add class
    try { document.body.classList.add('chat-open'); } catch {}
  }

  /** Close the conversation view and return to the chat list preview */
  closeChat() {
    this.isChatOpen = false;
    this.activeChat = null;
    try { document.body.classList.remove('chat-open'); } catch {}
  }

  openNewChat() {
    this.router.navigate(['/camera-page2']);
  }

  /** Switch bottom navigation tab and update view state. */
  setNav(tab: 'person' | 'people' | 'location' | 'settings') {
    this.activeTab = tab;
    // ensure the main chat preview is shown when selecting person or people
    if (tab === 'person' || tab === 'people') {
      this.isChatOpen = false;
      this.isSearching = false;
    }
    // selecting location will show the Map view (ensure no chat overlay is open)
    if (tab === 'location') {
      this.isChatOpen = false;
      this.isSearching = false;
      this.handleMapResizeOnReentry();
      this.scheduleMapInitialization();
    }
  }

  private handleMapResizeOnReentry(): void {
    if (!this.map) return;

    try {
      this.map.invalidateSize();
      console.log('[ChatPage.setNav] Map resize triggered on location tab re-entry (immediate).');
    } catch (error) {
      console.warn('[ChatPage.setNav] Immediate map resize failed on re-entry.', error);
    }

    if (this.mapResizeTimeoutId) {
      clearTimeout(this.mapResizeTimeoutId);
    }

    this.mapResizeTimeoutId = setTimeout(() => {
      if (this.activeTab !== 'location' || !this.map) return;
      try {
        this.map.invalidateSize();
        console.log('[ChatPage.setNav] Map resize triggered on location tab re-entry (delayed).');
      } catch (error) {
        console.warn('[ChatPage.setNav] Delayed map resize failed on re-entry.', error);
      }
    }, 180);
  }

  private scheduleMapInitialization(): void {
    this.mapInitAttempts = 0;
    const attemptInit = () => {
      if (this.activeTab !== 'location') return;

      this.mapInitAttempts += 1;
      const mapEl = document.getElementById('map');

      if (mapEl) {
        console.log('[ChatPage.setNav] Location tab active. Initializing map now.');
        void this.initMap();
        return;
      }

      if (this.mapInitAttempts < this.maxMapInitAttempts) {
        console.log('[ChatPage.setNav] Waiting for map container to render before initMap...', {
          attempt: this.mapInitAttempts,
          maxAttempts: this.maxMapInitAttempts
        });
        setTimeout(attemptInit, 75);
      } else {
        console.warn('[ChatPage.setNav] Map container still not found after retries.');
      }
    };

    setTimeout(attemptInit, 0);
  }

  private async getCurrentCoordinates(): Promise<{ latitude: number; longitude: number } | null> {
    console.log('[ChatPage.getCurrentCoordinates] Resolving current coordinates...');
    try {
      const permission = await Geolocation.checkPermissions();
      console.log('[ChatPage.getCurrentCoordinates] Permission status:', permission);
      if (permission.location !== 'granted') {
        await Geolocation.requestPermissions();
        console.log('[ChatPage.getCurrentCoordinates] Requested location permissions');
      }

      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 15000
      });

      console.log('[ChatPage.getCurrentCoordinates] Coordinates fetched via Capacitor:', {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      });

      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };
    } catch (capacitorError) {
      console.warn('[ChatPage.getCurrentCoordinates] Capacitor geolocation failed, trying browser geolocation', capacitorError);
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve(pos),
            (err) => reject(err),
            { enableHighAccuracy: true, timeout: 15000 }
          );
        });

        console.log('[ChatPage.getCurrentCoordinates] Coordinates fetched via browser geolocation:', {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        });

        return {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        };
      } catch (browserError) {
        console.warn('[ChatPage.getCurrentCoordinates] Unable to get current coordinates; using fallback coordinates', {
          fallback: this.fallbackCoordinates,
          capacitorError,
          browserError
        });
        return { ...this.fallbackCoordinates };
      }
    }
  }

  /** Initialize Leaflet map in the `map` element. Safe to call multiple times. */
  private async initMap(): Promise<void> {
    console.log('[ChatPage.initMap] Initializing map...');
    try {
      const coordinates = await this.getCurrentCoordinates();
      console.log('[ChatPage.initMap] Coordinates resolved for map:', coordinates);
      const center: [number, number] = coordinates
        ? [coordinates.latitude, coordinates.longitude]
        : [this.fallbackCoordinates.latitude, this.fallbackCoordinates.longitude];

      if (this.map) {
        console.log('[ChatPage.initMap] Map already initialized. Updating view and marker.');
        // already initialized: invalidate size in case container changed
        this.map.invalidateSize();
        this.map.setView(center, 15);
        await this.markUserLocation(this.map, coordinates);
        return;
      }

      const mapEl = document.getElementById('map');
      if (!mapEl) {
        console.warn('[ChatPage.initMap] Map element not found (#map).');
        return;
      }

      this.map = L.map(mapEl).setView(center, coordinates ? 15 : 13);
      console.log('[ChatPage.initMap] Leaflet map created with center:', center);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(this.map);
      console.log('[ChatPage.initMap] Tile layer added.');

      await this.markUserLocation(this.map, coordinates);
      console.log('[ChatPage.initMap] User location marker handling complete.');
    } catch (err) {
      console.warn('[ChatPage.initMap] Initialization failed', err);
    }
  }

  async markUserLocation(map: L.Map, coordinates?: { latitude: number; longitude: number } | null) {
      console.log('[ChatPage.markUserLocation] Marking user location...', { coordinatesFromCaller: coordinates });
      try {
        const resolvedCoordinates = coordinates ?? await this.getCurrentCoordinates();
        if (!resolvedCoordinates) {
          console.warn('[ChatPage.markUserLocation] No coordinates resolved.');
          return;
        }

        const { latitude, longitude } = resolvedCoordinates;
        console.log('[ChatPage.markUserLocation] Coordinates used for marker:', { latitude, longitude });

        if (this.userLocationMarker) {
          this.userLocationMarker.setLatLng([latitude, longitude]);
          console.log('[ChatPage.markUserLocation] Existing marker updated.');
        } else {
          // this.userLocationMarker = L.marker([latitude, longitude])
          //   .addTo(map)
          //   .bindPopup('You are here!')
          //   .openPopup();
          this.userLocationMarker = L.marker([latitude, longitude], {
  icon: this.userLocationIcon
})
  .addTo(map)
  .bindPopup('You are here!')
  .openPopup();
          console.log('[ChatPage.markUserLocation] New marker created.');
        }

        map.setView([latitude, longitude], 15);
        console.log('[ChatPage.markUserLocation] Map centered on user location.');
      } catch (error) {
        console.error('[ChatPage.markUserLocation] Failed to mark user location:', error);
      }
    }

    // Add once in your class (near other properties)
private readonly userLocationIcon = L.icon({
  iconUrl: 'assets/map/user-marker.png',
  iconRetinaUrl: 'assets/map/marker-icon-2x.png', // optional but recommended
  shadowUrl: 'assets/map/marker-shadow.png',      // optional
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

  ngOnDestroy(): void {
    if (this.markerOverlayElement) {
      try { document.body.removeChild(this.markerOverlayElement); } catch {}
      this.markerOverlayElement = undefined;
    }
    if (this.mapResizeTimeoutId) {
      clearTimeout(this.mapResizeTimeoutId);
      this.mapResizeTimeoutId = undefined;
    }
    try { this.messagesSub?.unsubscribe(); } catch {}
    this.messagesSub = undefined;
    // optional: set offline on destroy if desired
  }
}


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
  private markerSelectionOverlayElement?: HTMLDivElement;
  private mapTapOverlayElement?: HTMLDivElement;

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

  // Test markers (similar to goalTasks) for placing sample markers on the Leaflet map
  testMarkers: Array<{ id: number; name: string; latitude: number; longitude: number }> = [
    { id: 1, name: 'Test Marker A', latitude: 10.324849, longitude: 123.849164 },
    { id: 2, name: 'Test Marker B', latitude: 10.326000, longitude: 123.850000 },
    { id: 3, name: 'Test Marker C', latitude: 10.323500, longitude: 123.847500 },
    { id: 4, name: 'Test Marker D', latitude: 10.327200, longitude: 123.848900 },
    { id: 5, name: 'Test Marker E', latitude: 10.317700, longitude: 123.903700 }
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

    const selectedId = user?.id || user?.uid || user?.userID || user?.email;
    const selectedName = user?.firstName
      ? `${user.firstName} ${user?.lastName || ''}`.trim()
      : (user?.name || user?.email || 'Unknown User');
    const selectedAvatar = user?.photoURL || user?.avatar || null;

    // Ensure selected user appears in chat list and move to top when re-selected.
    const existingIndex = this.chats.findIndex(c => c.id === selectedId || c.name === selectedName);
    const chatPreview = {
      id: selectedId,
      name: selectedName,
      avatar: selectedAvatar,
      lastMessage: user?.lastMessage || '',
      time: user?.time || '',
      addedFromSearch: true
    };

    if (existingIndex >= 0) {
      const existingChat = this.chats[existingIndex];
      this.chats.splice(existingIndex, 1);
      this.chats.unshift({ ...existingChat, ...chatPreview });
    } else {
      this.chats.unshift(chatPreview);
    }

    // Open conversation immediately (UI-first behavior)
    this.activeChat = chatPreview;
    this.isSearching = false;
    this.isChatOpen = true;
    this.messages = [];

    const currentUid = this.auth3.getCurrentUser()?.uid || this.userID || '';
    if (!currentUid || !selectedId) {
      console.warn('[ChatPage] Missing current user or selected user id; opened UI without backend chat binding.');
      this.currentChatId = null;
      return;
    }

    try {
      // ensure chat document exists and get deterministic chatId
      const chat = await this.chatService.createOrEnsureChat(currentUid, selectedId);
      this.activeChat = { ...this.activeChat, chatId: chat.chatId };
      await this.subscribeToChatMessages(chat.chatId, currentUid);
      console.log('[ChatPage] Opened chat', chat.chatId);
    } catch (error) {
      console.error('[ChatPage] Failed to bind backend chat for selected user:', error);
      this.currentChatId = null;
    }
  }

  private async subscribeToChatMessages(chatId: string, currentUid: string): Promise<void> {
    this.currentChatId = chatId;
    try { this.messagesSub?.unsubscribe(); } catch {}

    this.messagesSub = this.chatService.getMessages(chatId).subscribe(async (msgs) => {
      this.messages = msgs || [];
      const unread = this.messages.filter(m => !m.isRead && m.senderId !== currentUid && m.id);
      for (const m of unread) {
        try { await this.chatService.markMessageAsRead(chatId, m.id!); } catch (e) { console.warn('markMessageAsRead failed', e); }
      }
    });
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
    overlay.className = 'map-overlay map-overlay--dim';

    const panel = document.createElement('div');
    panel.className = 'map-overlay-panel';

    const title = document.createElement('h3');
    title.textContent = 'Create map marker';
    title.className = 'map-overlay-title';

    const latInput = document.createElement('input');
    latInput.type = 'number';
    latInput.placeholder = 'Latitude (e.g. 10.324849)';
    latInput.step = 'any';
    latInput.className = 'map-overlay-input';

    const lngInput = document.createElement('input');
    lngInput.type = 'number';
    lngInput.placeholder = 'Longitude (e.g. 123.849164)';
    lngInput.step = 'any';
    lngInput.className = 'map-overlay-input';

    const message = document.createElement('div');
    message.className = 'map-overlay-message';

    const actions = document.createElement('div');
    actions.className = 'map-overlay-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'map-overlay-btn map-overlay-btn--secondary';

    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.textContent = 'Create Marker';
    createBtn.className = 'map-overlay-btn map-overlay-btn--primary';

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

      const customMarker = L.marker([latitude, longitude])
        .addTo(this.map)
        .bindPopup(`Marker: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`)
        .openPopup();
      this.bindMarkerSelectionTrigger(customMarker, 'Marker Selection Overlay');

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

  async openMarkerSelectionOverlay(titleText: string = 'You are here Selection Overlay'): Promise<void> {
    if (this.markerSelectionOverlayElement) return;

    if (!this.engineers.length) {
      try { await this.fetchEngineers(); } catch (err) { console.warn('[ChatPage] fetchEngineers in marker overlay failed', err); }
    }

    const options = (this.engineers.length ? this.engineers : this.searchConversationResults) || [];

    const overlay = document.createElement('div');
    overlay.className = 'marker-selection-overlay';

    const wrap = document.createElement('div');
    wrap.className = 'marker-selection-wrap';

    const panel = document.createElement('div');
    panel.className = 'marker-selection-panel';

    const title = document.createElement('h3');
    title.textContent = titleText;
    title.className = 'marker-selection-title';

    const list = document.createElement('div');
    list.className = 'marker-selection-list';

    if (!options.length) {
      const empty = document.createElement('div');
      empty.textContent = 'No users available.';
      empty.className = 'marker-selection-empty';
      list.appendChild(empty);
    } else {
      for (const option of options) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'marker-selection-item';

        const avatar = document.createElement('div');
        avatar.className = 'marker-selection-avatar';

        const avatarUrl = option?.photoURL || option?.avatar;
        if (avatarUrl) {
          const img = document.createElement('img');
          img.src = avatarUrl;
          img.alt = 'avatar';
          img.className = 'marker-selection-avatar-image';
          avatar.appendChild(img);
        } else {
          const initials = (option?.initials || this.getInitials(option?.firstName ? `${option.firstName} ${option?.lastName || ''}` : option?.name || option?.email || 'U')).toUpperCase();
          const initialText = document.createElement('span');
          initialText.textContent = initials;
          initialText.className = 'marker-selection-avatar-initials';
          avatar.appendChild(initialText);
        }

        const info = document.createElement('div');
        info.className = 'marker-selection-info';

        const name = document.createElement('div');
        name.textContent = option?.firstName
          ? `${option.firstName} ${option?.lastName || ''}`.trim()
          : (option?.name || option?.email || 'Unknown User');
        name.className = 'marker-selection-name';

        const sub = document.createElement('div');
        sub.textContent = option?.email || option?.subtitle || option?.lastMessage || '';
        sub.className = 'marker-selection-sub';

        info.appendChild(name);
        info.appendChild(sub);
        item.appendChild(avatar);
        item.appendChild(info);

        item.addEventListener('click', () => {
          dismiss();
          void this.selectEngineer(option);
        });

        list.appendChild(item);
      }
    }

    const arrow = document.createElement('div');
    arrow.className = 'marker-selection-arrow';

    const dismiss = () => {
      try { document.body.removeChild(overlay); } catch {}
      if (this.markerSelectionOverlayElement === overlay) {
        this.markerSelectionOverlayElement = undefined;
      }
    };

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) dismiss();
    });

    panel.addEventListener('click', (event) => event.stopPropagation());

    panel.appendChild(title);
    panel.appendChild(list);
    wrap.appendChild(panel);
    wrap.appendChild(arrow);
    overlay.appendChild(wrap);

    document.body.appendChild(overlay);
    this.markerSelectionOverlayElement = overlay;
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
  async openChat(chat: any) {
    this.activeChat = chat || { name: 'Chat' };
    this.isChatOpen = true;
    this.isSearching = false;
    this.messages = [];
    // optional: lock page scroll or add class
    try { document.body.classList.add('chat-open'); } catch {}

    const currentUid = this.auth3.getCurrentUser()?.uid || this.userID || '';
    const selectedId = chat?.id || chat?.uid || chat?.userID || chat?.email;

    if (!currentUid) {
      this.currentChatId = null;
      return;
    }

    try {
      // If this chat already has a resolved chatId, just subscribe.
      if (chat?.chatId) {
        await this.subscribeToChatMessages(chat.chatId, currentUid);
        return;
      }

      if (!selectedId) {
        this.currentChatId = null;
        return;
      }

      // Resolve chat and load history for chat-list taps too.
      const ensured = await this.chatService.createOrEnsureChat(currentUid, selectedId);
      this.activeChat = { ...this.activeChat, chatId: ensured.chatId };

      const chatIndex = this.chats.findIndex(c => c.id === selectedId || c.name === chat?.name);
      if (chatIndex >= 0) {
        this.chats[chatIndex] = { ...this.chats[chatIndex], chatId: ensured.chatId };
      }

      await this.subscribeToChatMessages(ensured.chatId, currentUid);
    } catch (error) {
      console.warn('[ChatPage.openChat] Unable to load chat history for selected chat:', error);
      this.currentChatId = null;
    }
  }

  /** Close the conversation view and return to the chat list preview */
  closeChat() {
    try { this.messagesSub?.unsubscribe(); } catch {}
    this.messagesSub = undefined;
    this.currentChatId = null;
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
      this.destroyMapInstance();
    }
    // selecting location will show the Map view (ensure no chat overlay is open)
    if (tab === 'location') {
      this.isChatOpen = false;
      this.isSearching = false;
      this.handleMapResizeOnReentry();
      this.scheduleMapInitialization();
    } else if (tab === 'settings') {
      this.destroyMapInstance();
    }
  }

  private destroyMapInstance(): void {
    if (!this.map) return;
    try {
      this.map.remove();
    } catch (error) {
      console.warn('[ChatPage.destroyMapInstance] Failed to remove map instance cleanly.', error);
    }
    this.map = null;
    this.userLocationMarker = undefined;
  }

  private bindMarkerSelectionTrigger(marker: L.Marker, titleText: string): void {
    marker.off('click');
    marker.off('touchend');

    const openOverlay = () => {
      setTimeout(() => {
        void this.openMarkerSelectionOverlay(titleText);
      }, 0);
    };

    marker.on('click', openOverlay);
    marker.on('touchend', openOverlay);
  }

  private bindMapTapCapture(): void {
    if (!this.map) return;
    this.map.off('click');
    this.map.on('click', (event: L.LeafletMouseEvent) => {
      const latitude = event.latlng.lat;
      const longitude = event.latlng.lng;
      console.log('[ChatPage.mapTap] tapped coordinates:', { latitude, longitude });
      this.openMapTapMarkerOverlay(latitude, longitude);
    });
  }

  private openMapTapMarkerOverlay(initialLatitude: number, initialLongitude: number): void {
    if (!this.map) return;
    if (this.mapTapOverlayElement) return;

    const overlay = document.createElement('div');
    overlay.className = 'map-overlay map-overlay--dim';

    const panel = document.createElement('div');
    panel.className = 'map-overlay-panel';

    const title = document.createElement('h3');
    title.textContent = 'Place marker from tapped position';
    title.className = 'map-overlay-title';

    const latInput = document.createElement('input');
    latInput.type = 'number';
    latInput.placeholder = 'Latitude';
    latInput.step = 'any';
    latInput.value = initialLatitude.toFixed(6);
    latInput.className = 'map-overlay-input';

    const lngInput = document.createElement('input');
    lngInput.type = 'number';
    lngInput.placeholder = 'Longitude';
    lngInput.step = 'any';
    lngInput.value = initialLongitude.toFixed(6);
    lngInput.className = 'map-overlay-input';

    const message = document.createElement('div');
    message.className = 'map-overlay-message';

    const actions = document.createElement('div');
    actions.className = 'map-overlay-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'map-overlay-btn map-overlay-btn--secondary';

    const placeBtn = document.createElement('button');
    placeBtn.type = 'button';
    placeBtn.textContent = 'Place Marker';
    placeBtn.className = 'map-overlay-btn map-overlay-btn--primary';

    actions.appendChild(cancelBtn);
    actions.appendChild(placeBtn);

    panel.appendChild(title);
    panel.appendChild(latInput);
    panel.appendChild(lngInput);
    panel.appendChild(message);
    panel.appendChild(actions);
    overlay.appendChild(panel);

    const dismiss = () => {
      try { document.body.removeChild(overlay); } catch {}
      if (this.mapTapOverlayElement === overlay) {
        this.mapTapOverlayElement = undefined;
      }
    };

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) dismiss();
    });

    panel.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    cancelBtn.addEventListener('click', () => dismiss());

    const placeMarkerFromInput = () => {
      if (!this.map) {
        message.textContent = 'Map is not ready yet. Try again.';
        return;
      }

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

      const tappedMarker = L.marker([latitude, longitude])
        .addTo(this.map)
        .bindPopup(`Marker: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`)
        .openPopup();

      this.bindMarkerSelectionTrigger(tappedMarker, 'Marker Selection Overlay');
      this.map.setView([latitude, longitude], 15);
      console.log('[ChatPage.mapTap] marker placed from overlay:', { latitude, longitude });
      dismiss();
    };

    placeBtn.addEventListener('click', placeMarkerFromInput);
    latInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        lngInput.focus();
      }
    });
    lngInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        placeMarkerFromInput();
      }
    });

    document.body.appendChild(overlay);
    this.mapTapOverlayElement = overlay;
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
      const mapEl = document.getElementById('map');
      if (!mapEl) {
        console.warn('[ChatPage.initMap] Map element not found (#map).');
        return;
      }

      // If map exists but points to an old/detached container (after tab/page navigation), recreate it.
      if (this.map) {
        const existingContainer = (this.map as any)?._container as HTMLElement | undefined;
        if (!existingContainer || existingContainer !== mapEl || !document.body.contains(existingContainer)) {
          console.log('[ChatPage.initMap] Existing map is bound to a stale container. Recreating map instance.');
          this.destroyMapInstance();
        }
      }

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

      this.map = L.map(mapEl).setView(center, coordinates ? 15 : 13);
      console.log('[ChatPage.initMap] Leaflet map created with center:', center);
      // place developer/test markers after map creation
      try { this.placeTestMarkers(); } catch (err) { console.error('[ChatPage.initMap] placeTestMarkers error', err); }

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(this.map);
      console.log('[ChatPage.initMap] Tile layer added.');

      this.bindMapTapCapture();

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
          this.bindMarkerSelectionTrigger(this.userLocationMarker, 'You are here Selection Overlay');
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
          this.bindMarkerSelectionTrigger(this.userLocationMarker, 'You are here Selection Overlay');

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

    /** Place the test markers (from `testMarkers`) onto the currently-initialized map. */
    private placeTestMarkers(): void {
      if (!this.map) return;
      for (const m of this.testMarkers) {
        try {
          const marker = L.marker([m.latitude, m.longitude]).addTo(this.map).bindPopup(`<strong>${m.name}</strong>`);
          // preserve same behavior as other markers: open selection overlay when clicked
          this.bindMarkerSelectionTrigger(marker, m.name);
        } catch (err) {
          console.error('[ChatPage.placeTestMarkers] Failed to add marker', m, err);
        }
      }
    }

  ionViewDidLeave(): void {
    this.destroyMapInstance();
    if (this.markerOverlayElement) {
      try { document.body.removeChild(this.markerOverlayElement); } catch {}
      this.markerOverlayElement = undefined;
    }
    if (this.markerSelectionOverlayElement) {
      try { document.body.removeChild(this.markerSelectionOverlayElement); } catch {}
      this.markerSelectionOverlayElement = undefined;
    }
    if (this.mapTapOverlayElement) {
      try { document.body.removeChild(this.mapTapOverlayElement); } catch {}
      this.mapTapOverlayElement = undefined;
    }
  }

  ngOnDestroy(): void {
    if (this.markerOverlayElement) {
      try { document.body.removeChild(this.markerOverlayElement); } catch {}
      this.markerOverlayElement = undefined;
    }
    if (this.markerSelectionOverlayElement) {
      try { document.body.removeChild(this.markerSelectionOverlayElement); } catch {}
      this.markerSelectionOverlayElement = undefined;
    }
    if (this.mapTapOverlayElement) {
      try { document.body.removeChild(this.mapTapOverlayElement); } catch {}
      this.mapTapOverlayElement = undefined;
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


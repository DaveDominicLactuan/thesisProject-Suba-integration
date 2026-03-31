import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { NavController, Platform } from '@ionic/angular';
import { User } from 'firebase/auth';
import { Auth3Service } from '../services/auth3.service';
import { Firestore, collection, doc, getDoc, query, where, getDocs } from '@angular/fire/firestore';
import { ImageStorageService } from '../services/image-storage.service';
import { Chat, ChatService, Message, TypingState } from '../services/chat.service';
import { PresenceService } from '../services/presence.service';
import { UserPrefetchCacheService } from '../services/user-prefetch-cache.service';
import { Subscription } from 'rxjs';
import { App } from '@capacitor/app';
import { Geolocation } from '@capacitor/geolocation';
// Leaflet map library
import * as L from 'leaflet';

interface OfficeLocationMarkerData {
  id: string;
  latitude: number;
  longitude: number;
  payload: Record<string, unknown>;
}

interface RadiusOption {
  label: string;
  value: number;
}

interface RadiusSquareBounds {
  center: { latitude: number; longitude: number };
  top: { latitude: number; longitude: number };
  bottom: { latitude: number; longitude: number };
  left: { latitude: number; longitude: number };
  right: { latitude: number; longitude: number };
  southWest: { latitude: number; longitude: number };
  northEast: { latitude: number; longitude: number };
}

@Component({
  selector: 'app-chat-page',
  templateUrl: './chat-page.page.html',
  styleUrls: ['./chat-page.page.scss'],
  standalone: false
})

export class ChatPagePage implements OnInit, OnDestroy {
  // --- Chat Options Overlay State ---
  showChatOptionsOverlay = false;
  chatOptionsOverlayY = 0;
  private chatOptionsLongPressTimer: any = null;
  private chatOptionsDragStartY: number | null = null;
  private chatOptionsDragCurrentY: number | null = null;
  private chatOptionsDragActive = false;
  private chatOptionsMinDragToClose = 80;
  private chatOptionsSelectedChat: any = null;
    // Long-press logic for chat-item
    onChatItemPressStart(event: MouseEvent | TouchEvent, chat: any) {
      if (this.chatOptionsLongPressTimer) clearTimeout(this.chatOptionsLongPressTimer);
      this.chatOptionsLongPressTimer = setTimeout(() => {
        this.chatOptionsSelectedChat = chat;
        this.showChatOptionsOverlay = true;
        this.chatOptionsOverlayY = 0;
      }, 420); // 420ms for long-press
    }

    onChatItemPressEnd(event: MouseEvent | TouchEvent) {
      if (this.chatOptionsLongPressTimer) {
        clearTimeout(this.chatOptionsLongPressTimer);
        this.chatOptionsLongPressTimer = null;
      }
    }

    // Overlay drag-to-close logic
    onOverlayDragStart(event: MouseEvent | TouchEvent) {
      event.stopPropagation();
      this.chatOptionsDragActive = true;
      this.chatOptionsDragStartY = this.getEventY(event);
      this.chatOptionsDragCurrentY = 0;
      document.addEventListener('mousemove', this.onOverlayDragMove);
      document.addEventListener('touchmove', this.onOverlayDragMove, { passive: false });
      document.addEventListener('mouseup', this.onOverlayDragEnd);
      document.addEventListener('touchend', this.onOverlayDragEnd);
    }

    onOverlayDragMove = (event: MouseEvent | TouchEvent) => {
      if (!this.chatOptionsDragActive || this.chatOptionsDragStartY === null) return;
      const y = this.getEventY(event);
      const deltaY = y - this.chatOptionsDragStartY;
      this.chatOptionsDragCurrentY = deltaY > 0 ? deltaY : 0;
      this.chatOptionsOverlayY = this.chatOptionsDragCurrentY;
    };

    onOverlayDragEnd = (event: MouseEvent | TouchEvent) => {
      if (!this.chatOptionsDragActive) return;
      this.chatOptionsDragActive = false;
      document.removeEventListener('mousemove', this.onOverlayDragMove);
      document.removeEventListener('touchmove', this.onOverlayDragMove);
      document.removeEventListener('mouseup', this.onOverlayDragEnd);
      document.removeEventListener('touchend', this.onOverlayDragEnd);
      if ((this.chatOptionsDragCurrentY || 0) > this.chatOptionsMinDragToClose) {
        this.closeChatOptionsOverlay();
      } else {
        this.chatOptionsOverlayY = 0;
      }
      this.chatOptionsDragStartY = null;
      this.chatOptionsDragCurrentY = null;
    };

    getEventY(event: MouseEvent | TouchEvent): number {
      if ((event as TouchEvent).touches && (event as TouchEvent).touches.length > 0) {
        return (event as TouchEvent).touches[0].clientY;
      } else if ((event as MouseEvent).clientY !== undefined) {
        return (event as MouseEvent).clientY;
      }
      return 0;
    }

    async closeChatOptionsOverlay(removeSelectedChat: boolean = false): Promise<void> {
      const selectedChat = this.chatOptionsSelectedChat;
      this.showChatOptionsOverlay = false;
      this.chatOptionsOverlayY = 0;
      this.chatOptionsSelectedChat = null;
      this.chatOptionsDragStartY = null;
      this.chatOptionsDragCurrentY = null;
      this.chatOptionsDragActive = false;

      if (!removeSelectedChat || !selectedChat?.chatId) {
        return;
      }

      const currentUid = await this.resolveCurrentUid();
      if (!currentUid) {
        console.warn('[ChatPage] Unable to delete selected chat preview: missing current uid.');
        return;
      }

      try {
        await this.chatService.clearChatForUser(selectedChat.chatId, currentUid);
        this.chats = this.chats.filter((chat) => chat?.chatId !== selectedChat.chatId);

        if (this.currentChatId === selectedChat.chatId) {
          this.closeChat();
        }
      } catch (error) {
        console.error('[ChatPage] Failed to delete selected chat preview:', error);
        alert('Unable to delete this conversation right now. Please try again.');
      }
    }

    // Placeholder logic for options
    onDeleteChatOption() {
      void this.closeChatOptionsOverlay(true);
    }
    onNotifyChatOption() {
      alert('Notify option pressed (placeholder).');
      void this.closeChatOptionsOverlay();
    }

  // --- Map Bottom Sheet State ---
  isMapBottomSheetActive = false;
  mapSheetViewMode: 'detail' | 'list' = 'detail';
  mapSheetAggregatedEngineers: any[] = [];
  selectedMapEngineer: any = null;
  private mapSheetDragStartY: number | null = null;
  private readonly mapSheetDragThreshold = 55;

  toggleMapBottomSheet(): void {
    this.isMapBottomSheetActive = !this.isMapBottomSheetActive;
    console.log(`[ChatPage.mapBottomSheet] Toggled. State: ${this.isMapBottomSheetActive ? 'Active' : 'Inactive'}`);
  }

  onMapSheetDragStart(event: MouseEvent | TouchEvent): void {
    this.mapSheetDragStartY = this.getSheetEventY(event);

    const moveHandler = (moveEvent: MouseEvent | TouchEvent): void => {
      if (this.mapSheetDragStartY === null) return;
      const deltaY = this.mapSheetDragStartY - this.getSheetEventY(moveEvent);
      if (deltaY > this.mapSheetDragThreshold && !this.isMapBottomSheetActive) {
        this.isMapBottomSheetActive = true;
        console.log('[ChatPage.mapBottomSheet] Drag-up activated. State: Active');
        cleanup();
      } else if (deltaY < -this.mapSheetDragThreshold && this.isMapBottomSheetActive) {
        this.isMapBottomSheetActive = false;
        console.log('[ChatPage.mapBottomSheet] Drag-down deactivated. State: Inactive');
        cleanup();
      }
    };

    const upHandler = (): void => {
      this.mapSheetDragStartY = null;
      cleanup();
    };

    const cleanup = (): void => {
      document.removeEventListener('mousemove', moveHandler as EventListener);
      document.removeEventListener('touchmove', moveHandler as EventListener);
      document.removeEventListener('mouseup', upHandler);
      document.removeEventListener('touchend', upHandler);
    };

    document.addEventListener('mousemove', moveHandler as EventListener, { passive: true });
    document.addEventListener('touchmove', moveHandler as EventListener, { passive: true });
    document.addEventListener('mouseup', upHandler, { once: true });
    document.addEventListener('touchend', upHandler, { once: true });
  }

  private getSheetEventY(event: MouseEvent | TouchEvent): number {
    if ('touches' in event && event.touches.length > 0) return event.touches[0].clientY;
    if ('changedTouches' in event && (event as TouchEvent).changedTouches.length > 0) {
      return (event as TouchEvent).changedTouches[0].clientY;
    }
    return (event as MouseEvent).clientY;
  }

  openMapMarkerBottomSheet(markerData: any): void {
    this.mapSheetViewMode = 'detail';
    this.mapSheetAggregatedEngineers = markerData ? [markerData] : [];
    this.selectedMapEngineer = markerData;
    this.isMapBottomSheetActive = true;
    console.log('[ChatPage.mapBottomSheet] Marker clicked. State: Active', { engineer: markerData });
  }

  openChatFromMapSheet(event: MouseEvent): void {
    event.stopPropagation();
    if (!this.selectedMapEngineer) return;

    const selectedId = this.selectedMapEngineer?.id || this.selectedMapEngineer?.uid || this.selectedMapEngineer?.userID || this.selectedMapEngineer?.email;
    if (!selectedId) {
      alert('Unable to open chat for this marker because no linked user account was found.');
      return;
    }

    if (this.selectedMapEngineer) {
      void this.selectEngineer(this.selectedMapEngineer);
    }
  }

  openMapSheetEngineerDetail(engineer: any, event?: Event): void {
    event?.stopPropagation();
    this.selectedMapEngineer = engineer;
    this.mapSheetViewMode = 'detail';
    this.isMapBottomSheetActive = true;
  }

  backToMapSheetList(event?: Event): void {
    event?.stopPropagation();
    if (this.mapSheetAggregatedEngineers.length > 1) {
      this.mapSheetViewMode = 'list';
    }
  }

  getMapSheetEngineerName(engineer: any): string {
    if (!engineer || typeof engineer !== 'object') return 'Unknown User';
    const firstName = typeof engineer.firstName === 'string' ? engineer.firstName.trim() : '';
    const lastName = typeof engineer.lastName === 'string' ? engineer.lastName.trim() : '';
    const fullName = `${firstName} ${lastName}`.trim();
    if (fullName) return fullName;
    if (typeof engineer.name === 'string' && engineer.name.trim()) return engineer.name.trim();
    if (typeof engineer.email === 'string' && engineer.email.trim()) return engineer.email.trim();
    if (typeof engineer.markerTitle === 'string' && engineer.markerTitle.trim()) return engineer.markerTitle.trim();
    return 'Unknown User';
  }

  getMapSheetEngineerSubtitle(engineer: any): string {
    if (!engineer || typeof engineer !== 'object') return '';
    const contact = engineer.phoneNumber || engineer.phone || engineer.contactNumber || engineer.mobile || engineer.mobileNumber || engineer.contact;
    if (typeof contact === 'string' && contact.trim()) return contact.trim();
    if (typeof engineer.email === 'string' && engineer.email.trim()) return engineer.email.trim();
    if (typeof engineer.address === 'string' && engineer.address.trim()) return engineer.address.trim();
    return 'No contact info';
  }

  getMapSheetEngineerDistanceLabel(engineer: any): string {
    const distance = Number(engineer?.distanceFromCenterMeters);
    if (!Number.isFinite(distance) || distance < 0) return '';
    if (distance >= 1000) return `${(distance / 1000).toFixed(2)} km away`;
    return `${Math.round(distance)} m away`;
  }

  getMapSheetEngineerInitials(engineer: any): string {
    return this.getInitials(this.getMapSheetEngineerName(engineer));
  }

  private static userSyncTasks: Map<string, Promise<void>> = new Map();
  userName: string | null = null;
  firstName: string | null = null;
  lastName: string | null = null;
  email: string | null = null;
  phone: string | null = null;
  gender: string | null = null;
  birthday: string | null = null;
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
  // UI: toggles between preview list and active chat conversation
  isChatOpen: boolean = false;
  activeChat: any = null;
  // current chat id and messages
  currentChatId: string | null = null;
  messages: Message[] = [];
  messageText: string = '';
  tappedMessageId: string | null = null;
  private messagesSub?: Subscription;
  private typingSub?: Subscription;
  private typingDebounceTimeoutId?: ReturnType<typeof setTimeout>;
  isOtherUserTyping: boolean = false;
  private readonly typingDebounceMs = 220;
  private userProfileCache: Map<string, any> = new Map();
  isSearching = false;
  searchQuery = '';
  // active bottom navigation tab: 'person' | 'people' | 'location' | 'settings'
  activeTab: 'person' | 'people' | 'location' | 'settings' | 'profile' = 'people';
  private map?: L.Map | null = null;
  private userLocationMarker?: L.Marker;
  private readonly fallbackCoordinates = { latitude: 10.324849, longitude: 123.849164 };
  private mapInitAttempts = 0;
  private readonly maxMapInitAttempts = 8;
  private mapResizeTimeoutId?: ReturnType<typeof setTimeout>;
  private markerOverlayElement?: HTMLDivElement;
  private markerSelectionOverlayElement?: HTMLDivElement;
  private mapTapOverlayElement?: HTMLDivElement;
  private markerSelectionSquare?: L.Rectangle;
  private markerSquareHalfSideMeters = 440;
  isRadiusSelectionOverlayOpen = false;
  readonly markerRadiusOptions: RadiusOption[] = [
    { label: '500m', value: 440 },
    { label: '1km', value: 880 },
    { label: '1.5km', value: 1320 },
    { label: '2km', value: 1760 },
    { label: '2.5km', value: 2200 }
  ];
  selectedRadiusHalfSideMeters = this.markerSquareHalfSideMeters;
  aggregatedRadiusMarkerData: Array<OfficeLocationMarkerData & {
    distanceFromCenterMeters: number;
    associatedUser: any | null;
    resolvedUserId: string | null;
    markerTitle: string;
  }> = [];
  private lastRadiusAggregationBounds?: RadiusSquareBounds;
  private readonly defaultRadiusAggregationCenter = {
    latitude: 10.302051,
    longitude: 123.902243
  };
  private officeLocationMarkerData: OfficeLocationMarkerData[] = [];
  private officeLocationLeafletMarkers: L.Marker[] = [];
  private markerUserProfileMap: Map<L.Marker, any> = new Map();
  private mapRefreshTimerId?: ReturnType<typeof setInterval>;
  private readonly mapRefreshIntervalMs = 30000; // 30 seconds

  private dismissMapTapOverlay(): void {
    if (!this.mapTapOverlayElement) return;
    try { document.body.removeChild(this.mapTapOverlayElement); } catch {}
    this.mapTapOverlayElement = undefined;
  }

  private isElementVisiblyRendered(element: HTMLElement): boolean {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const intersectsViewport = (
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= viewportHeight &&
      rect.left <= viewportWidth
    );

    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      rect.width > 0 &&
      rect.height > 0 &&
      intersectsViewport
    );
  }

  private drawMarkerCenteredSquare(center: L.LatLng, trigger: 'click' | 'touchend' | 'story-item', titleText: string): void {
    if (!this.map) {
      console.warn('[ChatPage.markerSquare] Skipped drawing square because map is not initialized.');
      return;
    }

    const halfSideMeters = this.markerSquareHalfSideMeters;
    const sideMeters = halfSideMeters * 2;

    // Approximate meter-to-degree conversion at the marker latitude.
    const metersPerDegreeLat = 111_320;
    const cosLat = Math.cos((center.lat * Math.PI) / 180);
    const metersPerDegreeLng = Math.max(1, Math.abs(cosLat) * 111_320);
    const deltaLat = halfSideMeters / metersPerDegreeLat;
    const deltaLng = halfSideMeters / metersPerDegreeLng;

    const southWest = L.latLng(center.lat - deltaLat, center.lng - deltaLng);
    const northEast = L.latLng(center.lat + deltaLat, center.lng + deltaLng);
    const squareBounds = L.latLngBounds(southWest, northEast);

    try {
      this.markerSelectionSquare?.remove();
    } catch {}

    this.markerSelectionSquare = L.rectangle(squareBounds, {
      color: '#111111',
      weight: 2,
      fill: false,
      interactive: false
    }).addTo(this.map);

    try { this.markerSelectionSquare.bringToFront(); } catch {}

    const areaSqMeters = sideMeters * sideMeters;
    const areaHectares = areaSqMeters / 10_000;
    const cornerRadiusMeters = Math.sqrt(2) * halfSideMeters;

    console.log('[ChatPage.markerSquare] Square drawn around marker', {
      trigger,
      titleText,
      center: {
        latitude: Number(center.lat.toFixed(6)),
        longitude: Number(center.lng.toFixed(6))
      },
      squareRadiusMeters: halfSideMeters,
      cornerRadiusMeters: Number(cornerRadiusMeters.toFixed(2)),
      sideMeters,
      areaSquareMeters: Number(areaSqMeters.toFixed(2)),
      areaHectares: Number(areaHectares.toFixed(4)),
      bounds: {
        southWest: {
          latitude: Number(southWest.lat.toFixed(6)),
          longitude: Number(southWest.lng.toFixed(6))
        },
        northEast: {
          latitude: Number(northEast.lat.toFixed(6)),
          longitude: Number(northEast.lng.toFixed(6))
        }
      }
    });
  }

  private async ensureMapReadyForLocationTab(maxAttempts: number = 18, delayMs: number = 120): Promise<L.Map | null> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (this.map) {
        return this.map;
      }

      const mapElement = document.getElementById('map');
      if (mapElement) {
        await this.initMap();
        if (this.map) {
          return this.map;
        }
      }

      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), delayMs);
      });
    }

    return this.map ?? null;
  }

  private applyMarkerSelectionOverlayInlineStyles(
    overlay: HTMLDivElement,
    wrap: HTMLDivElement,
    panel: HTMLDivElement,
    list: HTMLDivElement,
    closeBtn: HTMLButtonElement
  ): void {
    const isMobile = window.innerWidth <= 640;

    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(0, 0, 0, 0.14)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '2147483646',
      padding: isMobile ? '12px' : '16px'
    });

    Object.assign(wrap.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      width: '100%',
      maxWidth: isMobile ? '94vw' : '560px'
    });

    Object.assign(panel.style, {
      width: '100%',
      maxWidth: isMobile ? '94vw' : '540px',
      background: '#e8e8e8',
      border: '1px solid #b8b8b8',
      borderRadius: '12px',
      padding: isMobile ? '14px 12px' : '20px 18px 16px',
      boxSizing: 'border-box',
      // maxHeight: isMobile ? 'min(82vh, 500px)' : 'min(80vh, 530px)',
       maxHeight: isMobile ? 'min(82vh, 350px)' : 'min(80vh, 530px)',
      display: 'flex',
      flexDirection: 'column',
      gap: isMobile ? '12px' : '16px',
      boxShadow: '0 8px 20px rgba(0, 0, 0, 0.1)'
    });

    Object.assign(list.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: isMobile ? '10px' : '14px',
      overflowY: 'auto',
      maxHeight: isMobile ? 'min(52vh, 300px)' : 'min(52vh, 340px)',
      paddingRight: '2px'
    });

    Object.assign(closeBtn.style, {
      alignSelf: 'flex-end',
      width: isMobile ? '138px' : '176px',
      height: isMobile ? '120px' : '126px',
      padding: '0 16px',
      border: 'none',
      borderRadius: '10px',
      background: '#4432d8',
      color: '#ffffff',
      fontSize: isMobile ? '1.35rem' : '2rem',
      lineHeight: '1',
      cursor: 'pointer'
    });
  }

  private applyMarkerSelectionItemInlineStyles(
    item: HTMLButtonElement,
    avatar: HTMLDivElement,
    info: HTMLDivElement,
    name: HTMLDivElement,
    sub: HTMLDivElement
  ): void {
    const isMobile = window.innerWidth <= 640;

    Object.assign(item.style, {
      display: 'flex',
      alignItems: 'center',
      gap: isMobile ? '10px' : '14px',
      width: '100%',
      border: 'none',
      borderRadius: '5px',
      // background: '#4fd86f',
      background: 'FCF8F8',
      padding: isMobile ? '8px 10px' : '10px 14px',
      minHeight: isMobile ? '78px' : '92px',
      cursor: 'pointer',
      textAlign: 'left',
      transition: 'transform 0.12s ease, filter 0.12s ease'
    });

    Object.assign(avatar.style, {
      width: isMobile ? '52px' : '64px',
      height: isMobile ? '52px' : '64px',
      minWidth: isMobile ? '52px' : '64px',
      borderRadius: '999px',
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#ffb429'
    });

    Object.assign(info.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '3px',
      minWidth: '0'
    });

    Object.assign(name.style, {
      fontSize: isMobile ? '1.2rem' : '1.9rem',
      lineHeight: '1.5',
      color: '#1f1f1f',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    });

    Object.assign(sub.style, {
      fontSize: isMobile ? '1.25rem' : '1.9rem',
      lineHeight: '1.02',
      color: '#1f1f1f',
      opacity: '0.95',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    });
  }

  private applyMapTapOverlayInlineStyles(
    overlay: HTMLDivElement,
    panel: HTMLDivElement,
    title: HTMLHeadingElement,
    lngInput: HTMLInputElement,
    latInput: HTMLInputElement,
    message: HTMLDivElement,
    actions: HTMLDivElement,
    cancelBtn: HTMLButtonElement,
    placeBtn: HTMLButtonElement
  ): void {
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px',
      zIndex: '2147483647',
      background: 'rgba(0, 0, 0, 0.45)'
    });

    Object.assign(panel.style, {
      background: '#ffffff',
      borderRadius: '14px',
      width: '100%',
      maxWidth: '360px',
      padding: '16px',
      boxShadow: '0 12px 30px rgba(0, 0, 0, 0.2)',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px'
    });

    Object.assign(title.style, {
      margin: '0 0 4px',
      fontSize: '17px'
    });

    const inputStyle: Partial<CSSStyleDeclaration> = {
      height: '40px',
      padding: '0 10px',
      border: '1px solid #d6d6d6',
      borderRadius: '8px'
    };
    Object.assign(lngInput.style, inputStyle);
    Object.assign(latInput.style, inputStyle);

    Object.assign(message.style, {
      minHeight: '18px',
      fontSize: '12px',
      color: '#d32f2f'
    });

    Object.assign(actions.style, {
      display: 'flex',
      gap: '8px',
      justifyContent: 'flex-end'
    });

    Object.assign(cancelBtn.style, {
      height: '36px',
      padding: '0 14px',
      borderRadius: '8px',
      border: '1px solid #d0d0d0',
      background: '#fff'
    });

    Object.assign(placeBtn.style, {
      height: '36px',
      padding: '0 14px',
      borderRadius: '8px',
      border: 'none',
      background: '#387ef5',
      color: '#fff'
    });
  }

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

  // Real-time chat list for the current user
  chats: any[] = [];
  private chatsSub?: Subscription;

  // Test markers (similar to goalTasks) for placing sample markers on the Leaflet map
  testMarkers: Array<{ id: number; name: string; latitude: number; longitude: number }> = [
    { id: 1, name: 'Test Marker A', latitude: 10.324849, longitude: 123.849164 },
    { id: 2, name: 'Test Marker B', latitude: 10.326000, longitude: 123.850000 },
    { id: 3, name: 'Test Marker C', latitude: 10.323500, longitude: 123.847500 },
    { id: 4, name: 'Test Marker D', latitude: 10.327200, longitude: 123.848900 },
    { id: 5, name: 'Test Marker E', latitude: 10.317700, longitude: 123.903700 }
  ];

  // Ensure the stories property is declared and initialized
  stories: any[] = [];

  /** Inject auth, router, and image storage services for navigation and data. */
  constructor(private formBuilder: FormBuilder, private router: Router, private authService: AuthService, private navCtrl: NavController, public auth3: Auth3Service, private imageStorage: ImageStorageService, private platform: Platform, private firestore: Firestore, private chatService: ChatService, private presenceService: PresenceService, private userPrefetchCache: UserPrefetchCacheService) {

  }


ngOnInit(): void {
  console.log('[HomePage2.ngOnInit] ===== PAGE INIT START (ngOnInit called) =====');
  console.log('[HomePage2.ngOnInit] Auth currentUser on ngOnInit:', this.auth3.getCurrentUser()?.uid || 'null');

  const cachedUid = this.resolveCachedUid();
  if (cachedUid) {
    this.refreshCacheWarmStatus(cachedUid);

    const cachedProfile = this.userPrefetchCache.getCachedUserProfile(cachedUid);
    if (cachedProfile) {
      this.firstName = cachedProfile.firstName || this.firstName;
      this.lastName = cachedProfile.lastName || this.lastName;
      this.email = cachedProfile.email || this.email;
    }

    const cachedChats = this.userPrefetchCache.getCachedChats(cachedUid);
    if (cachedChats.length > 0) {
      this.chats = [...cachedChats];
    }

    const cachedEngineers = this.userPrefetchCache.getCachedEngineers(cachedUid);
    if (cachedEngineers.length > 0) {
      this.engineers = [...cachedEngineers];
    }

    this.userPrefetchCache.warmUserDataInBackground(cachedUid, 'chat-page-ngOnInit').finally(() => {
      this.refreshCacheWarmStatus(cachedUid);
    });
  }

  this.initialize();
  this.startUserChatsSubscription().catch((err) => {
    console.warn('[ChatPage.ngOnInit] Unable to start chat list subscription:', err);
  });
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

    if (this.userID) {
      this.refreshCacheWarmStatus(this.userID);
      this.userPrefetchCache.warmUserDataInBackground(this.userID, 'chat-page-initialize').finally(() => {
        this.refreshCacheWarmStatus(this.userID || '');
      });
    }

    if (!this.chatsSub) {
      this.startUserChatsSubscription().catch((err) => {
        console.warn('[ChatPage.initialize] Deferred chat list subscription failed:', err);
      });
    }

    // Start presence service (RTDB -> Firestore sync)
    try { this.presenceService.start(); } catch (e) { console.warn('PresenceService.start failed', e); }
  } catch (err) {
    console.warn('[ChatPage] initialize error', err);
  }
}

private resolveCachedUid(): string {
  const currentUid = this.auth3.getCurrentUser()?.uid || this.userID || '';
  if (currentUid) {
    return currentUid;
  }

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

private async resolveCurrentUid(timeoutMs: number = 8000): Promise<string | null> {
  const directUid = this.auth3.getCurrentUser()?.uid || this.userID || null;
  if (directUid) {
    this.userID = directUid;
    return directUid;
  }

  try {
    const authedUser = await this.auth3.waitForAuthUser(timeoutMs);
    const waitedUid = authedUser?.uid || null;
    if (waitedUid) {
      this.userID = waitedUid;
    }
    return waitedUid;
  } catch (error) {
    console.warn('[ChatPage] Failed to resolve current UID from auth state:', error);
    return null;
  }
}

private async startUserChatsSubscription(): Promise<void> {
  const uid = await this.resolveCurrentUid();
  if (!uid) {
    return;
  }

  try { this.chatsSub?.unsubscribe(); } catch {}

  this.chatsSub = this.chatService.getUserChats(uid).subscribe(async (chats) => {
    const hydratedChats = await this.hydrateChatsForDisplay(chats || [], uid);
    this.chats = hydratedChats;
    this.userPrefetchCache.storeChats(uid, hydratedChats as any);
    this.refreshCacheWarmStatus(uid);

    // Keep the open header in sync when profile/presence changes in Firestore.
    if (this.activeChat?.chatId) {
      const updated = hydratedChats.find((c) => c.chatId === this.activeChat.chatId);
      if (updated) {
        this.activeChat = { ...this.activeChat, ...updated };
      }
    }
  });
}

private resolveTimestampToMillis(timestamp: any): number {
  if (!timestamp) return 0;
  if (typeof timestamp?.toMillis === 'function') return timestamp.toMillis();
  if (typeof timestamp?.seconds === 'number') return timestamp.seconds * 1000;
  if (typeof timestamp === 'number') return timestamp;
  return 0;
}

private composeUserDisplayName(user: any): string {
  if (!user) return '';
  const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();
  return fullName || user?.name || user?.displayName || user?.email || '';
}

private async getUserProfileById(userId: string): Promise<any | null> {
  if (!userId) return null;
  if (this.userProfileCache.has(userId)) {
    return this.userProfileCache.get(userId);
  }

  try {
    const userRef = doc(this.firestore, 'users', userId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      this.userProfileCache.set(userId, null);
      return null;
    }

    const profile = { id: userSnap.id, ...(userSnap.data() as any) };
    this.userProfileCache.set(userId, profile);
    return profile;
  } catch (error) {
    console.warn('[ChatPage] Failed to load user profile for chat participant:', userId, error);
    return null;
  }
}

private async hydrateChatsForDisplay(rawChats: Chat[], currentUid: string): Promise<any[]> {
  const hydrated = await Promise.all(
    (rawChats || []).map(async (chat: any) => {
      const clearedAtMillis = this.resolveTimestampToMillis(chat?.clearedBy?.[currentUid]);
      const lastActivityMillis = this.resolveTimestampToMillis(chat?.timestamp);
      if (clearedAtMillis > 0 && lastActivityMillis <= clearedAtMillis) {
        return null;
      }

      const participants = Array.isArray(chat?.participants) ? chat.participants : [];
      const otherParticipantId = participants.find((participantId: string) => participantId && participantId !== currentUid) || null;
      const otherProfile = otherParticipantId ? await this.getUserProfileById(otherParticipantId) : null;

      const nameFromProfile = this.composeUserDisplayName(otherProfile);
      const avatarFromProfile = otherProfile?.photoURL || otherProfile?.avatar || otherProfile?.avatarUrl || null;

      return {
        ...chat,
        id: otherParticipantId || chat?.chatId,
        otherParticipantId,
        name: chat?.name || nameFromProfile || otherParticipantId || chat?.chatId,
        avatar: chat?.avatar || avatarFromProfile,
        isOnline: Boolean(otherProfile?.isOnline)
      };
    })
  );

  return hydrated.filter((chat) => Boolean(chat)).sort((a, b) => {
    const tA = this.resolveTimestampToMillis(a?.timestamp);
    const tB = this.resolveTimestampToMillis(b?.timestamp);
    return tB - tA;
  });
}

private upsertChatPreview(chatPreview: any): void {
  if (!chatPreview?.chatId) return;
  const existingIndex = this.chats.findIndex((chat) => chat.chatId === chatPreview.chatId);

  if (existingIndex >= 0) {
    const existingChat = this.chats[existingIndex];
    this.chats.splice(existingIndex, 1);
    this.chats.unshift({ ...existingChat, ...chatPreview });
    return;
  }

  this.chats.unshift(chatPreview);
}

private subscribeToTypingState(chatId: string, currentUid: string): void {
  try { this.typingSub?.unsubscribe(); } catch {}

  this.typingSub = this.chatService.observeTyping(chatId).subscribe((typingStates: TypingState[]) => {
    this.isOtherUserTyping = (typingStates || []).some(
      (state) => state.userId !== currentUid && state.isTyping
    );
  });
}

private async updateTypingState(isTyping: boolean): Promise<void> {
  const chatId = this.currentChatId;
  const currentUid = this.auth3.getCurrentUser()?.uid || this.userID || '';
  if (!chatId || !currentUid) return;

  try {
    await this.chatService.setTypingState(chatId, currentUid, isTyping);
  } catch (error) {
    console.warn('[ChatPage] Unable to update typing state:', error);
  }
}

private async resetTypingStateForCurrentUser(): Promise<void> {
  if (this.typingDebounceTimeoutId) {
    clearTimeout(this.typingDebounceTimeoutId);
    this.typingDebounceTimeoutId = undefined;
  }

  await this.updateTypingState(false);
  this.isOtherUserTyping = false;
}

onMessageDraftChange(value: string): void {
  this.messageText = value;
  const hasDraft = (value || '').trim().length > 0;

  if (this.typingDebounceTimeoutId) {
    clearTimeout(this.typingDebounceTimeoutId);
  }

  this.typingDebounceTimeoutId = setTimeout(() => {
    this.updateTypingState(hasDraft).catch((error) => {
      console.warn('[ChatPage] Debounced typing update failed:', error);
    });
  }, hasDraft ? this.typingDebounceMs : 0);
}

onMessageInputBlur(): void {
  this.updateTypingState(false).catch((error) => {
    console.warn('[ChatPage] Failed to clear typing state on blur:', error);
  });
}

isMessageDelivered(message: Message): boolean {
  return Boolean(message?.deliveredAt || message?.timestamp);
}

getMessageStatusLabel(message: Message): 'Sent' | 'Delivered' | 'Read' {
  if (message?.isRead) return 'Read';
  if (this.isMessageDelivered(message)) return 'Delivered';
  return 'Sent';
}


  // Additional methods can be added here
onMsgBubbleTap(message: Message): void {
  this.tappedMessageId = this.tappedMessageId === (message.id ?? null) ? null : (message.id ?? null);
}


  /** Navigate to legacy camera page route. */
  goToHomePage() {
    this.router.navigate(['/home-page2']);
    console.log('camera page');
  }

  async onFindEngineerStoryClick(): Promise<void> {
    console.log('[ChatPage.findEngineerStory] Find Engineer story tapped. Navigating to map tab...');
    this.setNav('location');

    const mapInstance = await this.ensureMapReadyForLocationTab();
    if (!mapInstance) {
      console.warn('[ChatPage.findEngineerStory] Unable to initialize map after switching to location tab.');
      return;
    }

    const coordinates = await this.getCurrentCoordinates();
    if (!coordinates) {
      console.warn('[ChatPage.findEngineerStory] Current coordinates unavailable; square will not be drawn.');
      return;
    }

    const center = L.latLng(coordinates.latitude, coordinates.longitude);
    await this.markUserLocation(mapInstance, coordinates);
    this.drawMarkerCenteredSquare(center, 'story-item', 'Find Engineer Story');

    try {
      mapInstance.setView(center, 16);
    } catch (err) {
      console.warn('[ChatPage.findEngineerStory] Failed to center map view after drawing square.', err);
    }

    console.log('[ChatPage.findEngineerStory] Current location square drawn from story tap.', {
      latitude: Number(center.lat.toFixed(6)),
      longitude: Number(center.lng.toFixed(6))
    });
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
    const cacheUid = this.resolveCachedUid();
    if (cacheUid && this.engineers.length === 0) {
      const cachedEngineers = this.userPrefetchCache.getCachedEngineers(cacheUid);
      if (cachedEngineers.length > 0) {
        this.engineers = [...cachedEngineers];
      }
    }

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
      if (cacheUid) {
        this.userPrefetchCache.storeEngineers(cacheUid, arr);
        this.refreshCacheWarmStatus(cacheUid);
      }
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

    if (!selectedId) {
      console.warn('[ChatPage] Missing selected engineer/user id from search result payload:', user);
      this.currentChatId = null;
      return;
    }

    const currentUid = await this.resolveCurrentUid();
    if (!currentUid) {
      console.warn('[ChatPage] Missing current user uid; cannot bind backend chat yet.');
      this.currentChatId = null;
      return;
    }

    // Open conversation container immediately to match expected UX on tap.
    this.activeChat = {
      id: selectedId,
      otherParticipantId: selectedId,
      name: selectedName,
      avatar: selectedAvatar,
      isOnline: Boolean(user?.isOnline),
      lastMessage: '',
      timestamp: null
    };
    this.isSearching = false;
    this.isChatOpen = true;
    this.messages = [];
    this.isOtherUserTyping = false;
    try { document.body.classList.add('chat-open'); } catch {}

    try {
      // ensure chat document exists and get deterministic chatId
      const chat = await this.chatService.createOrEnsureChat(currentUid, selectedId);
      const selectedProfile = await this.getUserProfileById(selectedId);
      const resolvedName = this.composeUserDisplayName(selectedProfile) || selectedName;
      const resolvedAvatar = selectedProfile?.photoURL || selectedProfile?.avatar || selectedProfile?.avatarUrl || selectedAvatar;

      const chatPreview = {
        chatId: chat.chatId,
        participants: chat.participants,
        id: selectedId,
        otherParticipantId: selectedId,
        name: resolvedName,
        avatar: resolvedAvatar,
        isOnline: Boolean(selectedProfile?.isOnline),
        lastMessage: '',
        timestamp: null
      };

      this.activeChat = chatPreview;
      this.isSearching = false;
      this.isChatOpen = true;
      this.messages = [];
      this.isOtherUserTyping = false;

      this.upsertChatPreview(chatPreview);

      await this.subscribeToChatMessages(chat.chatId, currentUid);
      this.subscribeToTypingState(chat.chatId, currentUid);
      console.log('[ChatPage] Opened chat', chat.chatId);
    } catch (error) {
      console.error('[ChatPage] Failed to bind backend chat for selected user:', error);
      const errorCode = (error as any)?.code || '';
      if (errorCode === 'permission-denied' || errorCode === 'firestore/permission-denied') {
        alert('Chat access is blocked by Firestore security rules. Deploy the updated firestore.rules, then try again.');
      }
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
      await this.updateTypingState(false);
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
    this.cacheWarmStatusText = 'Not synced';
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

  openRadiusSelectionOverlay(): void {
    this.selectedRadiusHalfSideMeters = this.markerSquareHalfSideMeters;
    this.isRadiusSelectionOverlayOpen = true;
  }

  closeRadiusSelectionOverlay(): void {
    this.isRadiusSelectionOverlayOpen = false;
  }

  async confirmRadiusSelection(): Promise<void> {
    const selectedHalfSideMeters = Number(this.selectedRadiusHalfSideMeters);
    if (!Number.isFinite(selectedHalfSideMeters) || selectedHalfSideMeters <= 0) {
      alert('Please select a valid radius size.');
      return;
    }

    this.markerSquareHalfSideMeters = selectedHalfSideMeters;
    this.isRadiusSelectionOverlayOpen = false;
    await this.aggregateMarkersWithinSelectedRadius();
  }

  private resolveRadiusAggregationCenter(): { latitude: number; longitude: number; source: 'selected-engineer' | 'map-center' | 'default-center' } {
    if (this.selectedMapEngineer && typeof this.selectedMapEngineer === 'object') {
      const selectedCenter = this.resolveOfficeMarkerCoordinates(this.selectedMapEngineer as Record<string, unknown>);
      if (selectedCenter) {
        return {
          ...selectedCenter,
          source: 'selected-engineer'
        };
      }
    }

    if (this.map) {
      const mapCenter = this.map.getCenter();
      return {
        latitude: mapCenter.lat,
        longitude: mapCenter.lng,
        source: 'map-center'
      };
    }

    return {
      ...this.defaultRadiusAggregationCenter,
      source: 'default-center'
    };
  }

  private buildRadiusSquareBounds(centerLatitude: number, centerLongitude: number, halfSideMeters: number): RadiusSquareBounds {
    const metersPerDegreeLat = 111_320;
    const cosLat = Math.cos((centerLatitude * Math.PI) / 180);
    const metersPerDegreeLng = Math.max(1, Math.abs(cosLat) * 111_320);

    const deltaLat = halfSideMeters / metersPerDegreeLat;
    const deltaLng = halfSideMeters / metersPerDegreeLng;

    const top = { latitude: centerLatitude + deltaLat, longitude: centerLongitude };
    const bottom = { latitude: centerLatitude - deltaLat, longitude: centerLongitude };
    const left = { latitude: centerLatitude, longitude: centerLongitude - deltaLng };
    const right = { latitude: centerLatitude, longitude: centerLongitude + deltaLng };

    return {
      center: { latitude: centerLatitude, longitude: centerLongitude },
      top,
      bottom,
      left,
      right,
      southWest: { latitude: bottom.latitude, longitude: left.longitude },
      northEast: { latitude: top.latitude, longitude: right.longitude }
    };
  }

  private calculateDistanceMeters(
    startLatitude: number,
    startLongitude: number,
    endLatitude: number,
    endLongitude: number
  ): number {
    const toRadians = (value: number): number => (value * Math.PI) / 180;
    const earthRadiusMeters = 6_371_000;
    const deltaLat = toRadians(endLatitude - startLatitude);
    const deltaLng = toRadians(endLongitude - startLongitude);
    const lat1 = toRadians(startLatitude);
    const lat2 = toRadians(endLatitude);

    const haversine =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
    const arc = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
    return earthRadiusMeters * arc;
  }

  private getOfficeMarkerUserId(marker: OfficeLocationMarkerData): string | null {
    const markerUserIdRaw = marker.payload['userId'] || marker.payload['uid'] || marker.payload['userID'];
    if (typeof markerUserIdRaw !== 'string') return null;
    const trimmed = markerUserIdRaw.trim();
    return trimmed || null;
  }

  private mergeMarkerAndUserForMapSheet(
    marker: OfficeLocationMarkerData & { distanceFromCenterMeters: number; markerTitle: string },
    associatedUser: any,
    resolvedUserId: string | null
  ): any {
    return {
      ...(associatedUser && typeof associatedUser === 'object' ? associatedUser : {}),
      id: associatedUser?.id || associatedUser?.uid || associatedUser?.userID || resolvedUserId || undefined,
      uid: associatedUser?.uid || associatedUser?.id || associatedUser?.userID || resolvedUserId || undefined,
      userID: associatedUser?.userID || associatedUser?.uid || associatedUser?.id || resolvedUserId || undefined,
      markerId: marker.id,
      markerPayload: marker.payload,
      markerTitle: marker.markerTitle,
      latitude: marker.latitude,
      longitude: marker.longitude,
      distanceFromCenterMeters: marker.distanceFromCenterMeters
    };
  }

  private async aggregateMarkersForMapSheet(centerLatitude: number, centerLongitude: number): Promise<any[]> {
    await this.fetchOfficeLocationMarkerData();

    const bounds = this.buildRadiusSquareBounds(centerLatitude, centerLongitude, this.markerSquareHalfSideMeters);
    const markersInsideBounds = this.officeLocationMarkerData.filter((marker) => (
      marker.latitude <= bounds.top.latitude &&
      marker.latitude >= bounds.bottom.latitude &&
      marker.longitude >= bounds.left.longitude &&
      marker.longitude <= bounds.right.longitude
    ));

    const enrichedMarkers = await Promise.all(markersInsideBounds.map(async (marker) => {
      const resolvedUserId = this.getOfficeMarkerUserId(marker);
      const associatedUser = resolvedUserId ? await this.fetchUserProfileByUserId(resolvedUserId) : null;
      return {
        ...marker,
        markerTitle: this.buildOfficeMarkerTitle(marker),
        associatedUser,
        resolvedUserId,
        distanceFromCenterMeters: this.calculateDistanceMeters(
          centerLatitude,
          centerLongitude,
          marker.latitude,
          marker.longitude
        )
      };
    }));

    this.aggregatedRadiusMarkerData = enrichedMarkers;
    this.lastRadiusAggregationBounds = bounds;

    return enrichedMarkers.map((marker) => this.mergeMarkerAndUserForMapSheet(marker, marker.associatedUser, marker.resolvedUserId));
  }

  private async onOfficeMarkerSelectedForMapSheet(marker: L.Marker, titleText: string, trigger: 'click' | 'touchend'): Promise<void> {
    const markerCenter = marker.getLatLng();

    try {
      this.drawMarkerCenteredSquare(markerCenter, trigger, titleText);
    } catch (squareError) {
      console.error('[ChatPage.markerSquare] Failed to draw marker square', {
        trigger,
        titleText,
        squareError
      });
    }

    const markerUserProfile = this.markerUserProfileMap.get(marker) || null;
    const markerFallback = {
      ...(markerUserProfile || {}),
      name: markerUserProfile?.name || titleText,
      markerTitle: titleText,
      latitude: markerCenter.lat,
      longitude: markerCenter.lng
    };

    const aggregatedMapSheetItems = await this.aggregateMarkersForMapSheet(markerCenter.lat, markerCenter.lng);
    this.mapSheetAggregatedEngineers = aggregatedMapSheetItems;

    if (aggregatedMapSheetItems.length > 1) {
      this.selectedMapEngineer = aggregatedMapSheetItems[0];
      this.mapSheetViewMode = 'list';
      this.isMapBottomSheetActive = true;
      console.log('[ChatPage.mapBottomSheet] Marker selected with multiple nearby engineers. Opening list view.', {
        trigger,
        titleText,
        aggregatedCount: aggregatedMapSheetItems.length
      });
      return;
    }

    this.mapSheetViewMode = 'detail';
    this.openMapMarkerBottomSheet(aggregatedMapSheetItems[0] || markerFallback);
    console.log('[ChatPage.mapBottomSheet] Marker selected with single/no nearby engineer. Opening detail view.', {
      trigger,
      titleText,
      aggregatedCount: aggregatedMapSheetItems.length
    });
  }

  async aggregateMarkersWithinSelectedRadius(): Promise<void> {
    const center = this.resolveRadiusAggregationCenter();
    const aggregatedMapSheetItems = await this.aggregateMarkersForMapSheet(center.latitude, center.longitude);

    if (this.map) {
      this.drawMarkerCenteredSquare(L.latLng(center.latitude, center.longitude), 'story-item', 'Radius Selection Area');
    }

    this.mapSheetAggregatedEngineers = aggregatedMapSheetItems;
    if (aggregatedMapSheetItems.length > 1) {
      this.mapSheetViewMode = 'list';
      this.selectedMapEngineer = aggregatedMapSheetItems[0];
      this.isMapBottomSheetActive = true;
    } else if (aggregatedMapSheetItems.length === 1) {
      this.mapSheetViewMode = 'detail';
      this.selectedMapEngineer = aggregatedMapSheetItems[0];
      this.isMapBottomSheetActive = true;
    }

    console.log('[ChatPage.radiusAggregation] Aggregated markers inside selected radius bounds', {
      center,
      centerSource: center.source,
      selectedHalfSideMeters: this.markerSquareHalfSideMeters,
      top: this.lastRadiusAggregationBounds ? {
        latitude: Number(this.lastRadiusAggregationBounds.top.latitude.toFixed(6)),
        longitude: Number(this.lastRadiusAggregationBounds.top.longitude.toFixed(6))
      } : null,
      bottom: this.lastRadiusAggregationBounds ? {
        latitude: Number(this.lastRadiusAggregationBounds.bottom.latitude.toFixed(6)),
        longitude: Number(this.lastRadiusAggregationBounds.bottom.longitude.toFixed(6))
      } : null,
      left: this.lastRadiusAggregationBounds ? {
        latitude: Number(this.lastRadiusAggregationBounds.left.latitude.toFixed(6)),
        longitude: Number(this.lastRadiusAggregationBounds.left.longitude.toFixed(6))
      } : null,
      right: this.lastRadiusAggregationBounds ? {
        latitude: Number(this.lastRadiusAggregationBounds.right.latitude.toFixed(6)),
        longitude: Number(this.lastRadiusAggregationBounds.right.longitude.toFixed(6))
      } : null,
      totalMarkersLoaded: this.officeLocationMarkerData.length,
      aggregatedMarkersCount: this.aggregatedRadiusMarkerData.length,
      aggregatedMarkers: this.aggregatedRadiusMarkerData.map((marker) => ({
        id: marker.id,
        latitude: marker.latitude,
        longitude: marker.longitude,
        distanceFromCenterMeters: Number(marker.distanceFromCenterMeters.toFixed(2)),
        resolvedUserId: marker.resolvedUserId,
        payload: marker.payload
      }))
    });

    alert(`Radius updated to ${this.markerSquareHalfSideMeters}m. Aggregated ${this.aggregatedRadiusMarkerData.length} marker(s) inside the selected area.`);
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

    // document.body.appendChild(overlay);
    this.markerOverlayElement = overlay;
    latInput.focus();
  }

  async openMarkerSelectionOverlay(titleText: string = 'Engineer Selection Overlay'): Promise<void> {
    console.log('[ChatPage.markerSelection] openMarkerSelectionOverlay requested', {
      titleText,
      hasOverlayRef: !!this.markerSelectionOverlayElement,
      engineersCached: this.engineers.length
    });

    if (this.markerSelectionOverlayElement) {
      const isMounted = document.body.contains(this.markerSelectionOverlayElement);
      const isVisible = isMounted && this.isElementVisiblyRendered(this.markerSelectionOverlayElement);
      console.log('[ChatPage.markerSelection] Existing overlay reference detected', { isMounted, isVisible });

      if (isMounted && isVisible) {
        console.log('[ChatPage.markerSelection] Overlay is already open; skipping duplicate render.');
        return;
      }

      try { document.body.removeChild(this.markerSelectionOverlayElement); } catch {}
      this.markerSelectionOverlayElement = undefined;
      console.warn('[ChatPage.markerSelection] Cleared stale overlay reference before rendering a new one.');
    }

    if (!this.engineers.length) {
      try { await this.fetchEngineers(); } catch (err) { console.warn('[ChatPage] fetchEngineers in marker overlay failed', err); }
    }

    const options = (this.engineers.length ? this.engineers : this.searchConversationResults) || [];
    const optionsSource = this.engineers.length ? 'firestore-engineers' : 'placeholder-results';
    console.log('[ChatPage.markerSelection] Preparing overlay options', {
      source: optionsSource,
      count: options.length
    });

    const overlay = document.createElement('div');
    overlay.className = 'marker-selection-overlay';

    const wrap = document.createElement('div');
    wrap.className = 'marker-selection-wrap';

    const panel = document.createElement('div');
    panel.className = 'marker-selection-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', titleText || 'Engineer selection');

    const list = document.createElement('div');
    list.className = 'marker-selection-list';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'marker-selection-close-btn';
    closeBtn.textContent = 'Close';

    this.applyMarkerSelectionOverlayInlineStyles(overlay, wrap, panel, list, closeBtn);

    const dismiss = (reason: 'button' | 'backdrop' | 'selection' = 'button') => {
      console.log('[ChatPage.markerSelection] Closing overlay', { reason });
      try { document.body.removeChild(overlay); } catch {}
      if (this.markerSelectionOverlayElement === overlay) {
        this.markerSelectionOverlayElement = undefined;
      }
    };

    if (!options.length) {
      const empty = document.createElement('div');
      empty.textContent = 'No engineers available.';
      empty.className = 'marker-selection-empty';
      Object.assign(empty.style, {
        textAlign: 'center',
        color: '#636363',
        padding: '24px 12px',
        fontSize: '0.95rem'
      });
      list.appendChild(empty);
    } else {
      for (const [optionIndex, option] of options.entries()) {
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
          Object.assign(img.style, {
            width: '100%',
            height: '100%',
            objectFit: 'cover'
          });
          avatar.appendChild(img);
        } else {
          const initials = (option?.initials || this.getInitials(option?.firstName ? `${option.firstName} ${option?.lastName || ''}` : option?.name || option?.email || 'U')).toUpperCase();
          const initialText = document.createElement('span');
          initialText.textContent = initials;
          initialText.className = 'marker-selection-avatar-initials';
          Object.assign(initialText.style, {
            color: '#1f1f1f',
            fontWeight: '700',
            fontSize: window.innerWidth <= 640 ? '0.95rem' : '1rem'
          });
          avatar.appendChild(initialText);
        }

        const info = document.createElement('div');
        info.className = 'marker-selection-info';

        const name = document.createElement('div');
        const displayName = option?.firstName
          ? `${option.firstName} ${option?.lastName || ''}`.trim()
          : (option?.name || option?.email || 'Unknown User');
        name.textContent = displayName;
        name.className = 'marker-selection-name';

        const sub = document.createElement('div');
        const contact = option?.phoneNumber
          || option?.phone
          || option?.contactNumber
          || option?.mobile
          || option?.mobileNumber
          || option?.telephone
          || option?.tel
          || option?.contact
          || 'Phone Number';
        sub.textContent = contact;
        sub.className = 'marker-selection-sub';

        this.applyMarkerSelectionItemInlineStyles(item, avatar, info, name, sub);

        item.addEventListener('pointerenter', () => {
          item.style.filter = 'brightness(0.98)';
        });
        item.addEventListener('pointerleave', () => {
          item.style.filter = '';
          item.style.transform = '';
        });
        item.addEventListener('pointerdown', () => {
          item.style.transform = 'scale(0.99)';
        });
        item.addEventListener('pointerup', () => {
          item.style.transform = '';
        });

        info.appendChild(name);
        info.appendChild(sub);
        item.appendChild(avatar);
        item.appendChild(info);

        item.addEventListener('click', async () => {
          const selectedId = option?.id || option?.uid || option?.userID || option?.email || 'unknown';
          const selectedPayload = {
            source: optionsSource,
            selectedIndex: optionIndex,
            selectedId,
            selectedName: displayName,
            selectedContact: contact,
            selectedItemData: option
          };

          console.log('[ChatPage.markerSelection] Engineer row tapped', selectedPayload);
          dismiss('selection');

          // Start chat directly from the exact selected marker list item.
          try {
            await this.selectEngineer(option);
            console.log('[ChatPage.markerSelection] Chat start requested from marker selection', {
              selectedId,
              selectedName: displayName,
              selectedIndex: optionIndex,
              source: optionsSource
            });
          } catch (error) {
            console.error('[ChatPage.markerSelection] Failed to start chat from marker selection', {
              selectedId,
              selectedIndex: optionIndex,
              source: optionsSource,
              error
            });
          }
        });

        list.appendChild(item);
      }
    }

    closeBtn.addEventListener('click', () => dismiss('button'));

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) dismiss('backdrop');
    });

    panel.addEventListener('click', (event) => event.stopPropagation());

    panel.appendChild(list);
    panel.appendChild(closeBtn);
    wrap.appendChild(panel);
    overlay.appendChild(wrap);

    // Append the overlay to the body and keep a reference for future checks/removal.
    // document.body.appendChild(overlay);
    this.markerSelectionOverlayElement = overlay;

    const rect = panel.getBoundingClientRect();
    const overlayComputedStyle = window.getComputedStyle(overlay);
    console.log('[ChatPage.markerSelection] Overlay rendered', {
      isMounted: document.body.contains(overlay),
      isVisible: this.isElementVisiblyRendered(overlay),
      optionsCount: options.length,
      panelTop: Math.round(rect.top),
      panelLeft: Math.round(rect.left),
      panelWidth: Math.round(rect.width),
      panelHeight: Math.round(rect.height),
      overlayPosition: overlayComputedStyle.position,
      overlayZIndex: overlayComputedStyle.zIndex,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    });

    try { closeBtn.focus(); } catch {}
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
    this.isOtherUserTyping = false;
    try { document.body.classList.add('chat-open'); } catch {}

    const currentUid = await this.resolveCurrentUid();
    // For chat-list, chatId is always present
    const chatId = chat?.chatId;
    if (!currentUid || !chatId) {
      this.currentChatId = null;
      return;
    }
    try {
      const hydrated = await this.hydrateChatsForDisplay([chat], currentUid);
      if (hydrated.length > 0) {
        this.activeChat = hydrated[0];
      }
      await this.subscribeToChatMessages(chatId, currentUid);
      this.subscribeToTypingState(chatId, currentUid);
    } catch (error) {
      console.warn('[ChatPage.openChat] Unable to load chat history for selected chat:', error);
      this.currentChatId = null;
    }
  }

  /** Close the conversation view and return to the chat list preview */
  closeChat() {
    this.resetTypingStateForCurrentUser().catch(() => {});
    try { this.typingSub?.unsubscribe(); } catch {}
    this.typingSub = undefined;
    try { this.messagesSub?.unsubscribe(); } catch {}
    this.messagesSub = undefined;
    if (this.typingDebounceTimeoutId) {
      clearTimeout(this.typingDebounceTimeoutId);
      this.typingDebounceTimeoutId = undefined;
    }
    this.isOtherUserTyping = false;
    this.currentChatId = null;
    this.isChatOpen = false;
    this.activeChat = null;
    try { document.body.classList.remove('chat-open'); } catch {}
  }

  openNewChat(): void {
    this.isSearching = true; // Activate search mode
    setTimeout(() => {
      const searchInput = document.querySelector('.search-bar input') as HTMLInputElement;
      if (searchInput) {
        searchInput.focus(); // Focus on the search input field
      }
    }, 0);
  }

  /** Switch bottom navigation tab and update view state. */
  setNav(tab: 'person' | 'people' | 'location' | 'settings' | 'profile') {
    if (this.isChatOpen) {
      this.closeChat();
    }

    this.activeTab = tab;

    // Ensure the main chat preview is shown when selecting person or people
    if (tab === 'person' || tab === 'people') {
      this.isSearching = false;
      this.dismissMapTapOverlay();
      this.destroyMapInstance();
      this.stopMapRefreshTimer();
    }

    // Selecting location will show the Map view (ensure no chat overlay is open)
    if (tab === 'location') {
      this.isSearching = false;
      this.handleMapResizeOnReentry();
      this.scheduleMapInitialization();
      // Start periodic map refresh when entering location tab
      this.startMapRefreshTimer();
    } else if (tab === 'settings' || tab === 'profile') {
      this.dismissMapTapOverlay();
      this.destroyMapInstance();
      this.stopMapRefreshTimer();
    }
  }

  private destroyMapInstance(): void {
    if (!this.map) return;
    try {
      this.map.remove();
    } catch (error) {
      console.warn('[ChatPage.destroyMapInstance] Failed to remove map instance cleanly.', error);
    }
    this.markerSelectionSquare = undefined;
    this.map = null;
    this.userLocationMarker = undefined;
    this.officeLocationLeafletMarkers = [];
  }

  private bindMarkerSelectionTrigger(marker: L.Marker, titleText: string): void {
    marker.off('click');
    marker.off('touchend');

    const openOverlay = (trigger: 'click' | 'touchend') => {
      void this.onOfficeMarkerSelectedForMapSheet(marker, titleText, trigger)
        .then(() => {
          console.log('[ChatPage.markerSelection] Marker interaction processed for map sheet', { trigger, titleText });
        })
        .catch((err) => {
          console.error('[ChatPage.markerSelection] Marker interaction failed for map sheet', {
            trigger,
            titleText,
            err
          });
        });
    };

    marker.on('click', () => openOverlay('click'));
    marker.on('touchend', () => openOverlay('touchend'));
  }

  private handleMapTapCoordinates(latitude: number, longitude: number, source: 'click' | 'touchend'): void {
    const roundedLatitude = Number(latitude.toFixed(6));
    const roundedLongitude = Number(longitude.toFixed(6));
    console.log(`[ChatPage.mapTap] ${source} trigger detected:`, {
      latitude: roundedLatitude,
      longitude: roundedLongitude
    });
    this.openMapTapMarkerOverlay(roundedLatitude, roundedLongitude);
  }

  private handleMapTap(event: L.LeafletMouseEvent): void {
    this.handleMapTapCoordinates(event.latlng.lat, event.latlng.lng, 'click');
  }

  private bindMapTapCapture(): void {
    if (!this.map) return;
    console.log('[ChatPage.bindMapTapCapture] Binding click/touch map listeners for tap-marker overlay.');
    this.map.off('click');
    this.map.off('touchend');
    this.map.on('click', (event: L.LeafletMouseEvent) => this.handleMapTap(event));
    this.map.on('touchend', (event: any) => {
      const touchLatLng = event?.latlng;
      if (!touchLatLng) {
        console.warn('[ChatPage.mapTap] touchend detected but no latlng was provided by Leaflet.', event);
        return;
      }
      this.handleMapTapCoordinates(touchLatLng.lat, touchLatLng.lng, 'touchend');
    });
  }

  private openMapTapMarkerOverlay(initialLatitude: number, initialLongitude: number): void {
    console.log('[ChatPage.mapTapOverlay] Triggered for tapped coordinates:', {
      latitude: initialLatitude,
      longitude: initialLongitude
    });
    if (!this.map) {
      console.warn('[ChatPage.mapTapOverlay] Not opened because map is not initialized.');
      return;
    }

    if (this.mapTapOverlayElement) {
      const isMounted = document.body.contains(this.mapTapOverlayElement);
      const isVisible = isMounted && this.isElementVisiblyRendered(this.mapTapOverlayElement);

      if (!isMounted || !isVisible) {
        console.warn('[ChatPage.mapTapOverlay] Overlay state exists but is not visibly rendered. Recreating overlay.', {
          isMounted,
          isVisible
        });
        this.dismissMapTapOverlay();
      } else {
        console.log('[ChatPage.mapTapOverlay] Already open; skipping duplicate trigger.');
        return;
      }
    }

    const overlay = document.createElement('div');
    overlay.className = 'map-overlay map-overlay--dim';

    const panel = document.createElement('div');
    panel.className = 'map-overlay-panel';

    const title = document.createElement('h3');
    title.textContent = 'Place marker from tapped position';
    title.className = 'map-overlay-title';

    const lngInput = document.createElement('input');
    lngInput.type = 'number';
    lngInput.placeholder = 'Longitude (from tap)';
    lngInput.step = 'any';
    lngInput.value = initialLongitude.toFixed(6);
    lngInput.className = 'map-overlay-input';

    const latInput = document.createElement('input');
    latInput.type = 'number';
    latInput.placeholder = 'Latitude (from tap)';
    latInput.step = 'any';
    latInput.value = initialLatitude.toFixed(6);
    latInput.className = 'map-overlay-input';

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
    panel.appendChild(lngInput);
    panel.appendChild(latInput);
    panel.appendChild(message);
    panel.appendChild(actions);
    overlay.appendChild(panel);

    this.applyMapTapOverlayInlineStyles(
      overlay,
      panel,
      title,
      lngInput,
      latInput,
      message,
      actions,
      cancelBtn,
      placeBtn
    );

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

    // Custom icon for markers placed from map tap overlay
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

      console.log('[ChatPage.mapTapOverlay] Place Marker tapped with:', { latitude, longitude });

      const tappedMarker = L.marker([latitude, longitude], { icon: this.tapMarkerIcon })
        .addTo(this.map)
        .bindPopup(`Marker: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`)
        .openPopup();

      this.bindMarkerSelectionTrigger(tappedMarker, 'Marker Selection Overlay');
      this.map.setView([latitude, longitude], 15);
      console.log('[ChatPage.mapTap] marker placed from overlay:', { latitude, longitude });
      dismiss();
    };

    placeBtn.addEventListener('click', placeMarkerFromInput);
    lngInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        latInput.focus();
      }
    });
    latInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        placeMarkerFromInput();
      }
    });

    // document.body.appendChild(overlay);
    this.mapTapOverlayElement = overlay;
    console.log('[ChatPage.mapTapOverlay] Overlay opened successfully.');
    console.log('[ChatPage.mapTapOverlay] Overlay visibility snapshot:', {
      isMounted: document.body.contains(overlay),
      isVisible: this.isElementVisiblyRendered(overlay),
      rect: overlay.getBoundingClientRect().toJSON()
    });
    lngInput.focus();
  }

  // Custom icon for markers placed from map tap overlay
  private readonly tapMarkerIcon = L.icon({
    iconUrl: 'assets/map/tap-marker.png', // Place your custom marker image here
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowUrl: 'assets/map/marker-shadow2.png',
    shadowSize: [41, 41]
  });

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

  private toFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  private resolveOfficeMarkerCoordinates(payload: Record<string, unknown>): { latitude: number; longitude: number } | null {
    const directLatitude = this.toFiniteNumber(payload['latitude'] ?? payload['lat']);
    const directLongitude = this.toFiniteNumber(payload['longitude'] ?? payload['lng'] ?? payload['lon'] ?? payload['long']);

    if (
      directLatitude !== null &&
      directLongitude !== null &&
      Math.abs(directLatitude) <= 90 &&
      Math.abs(directLongitude) <= 180
    ) {
      return { latitude: directLatitude, longitude: directLongitude };
    }

    const nestedLocationCandidates = [payload['location'], payload['officeLocation'], payload['coordinates']];
    for (const locationField of nestedLocationCandidates) {
      if (!locationField || typeof locationField !== 'object') continue;

      const locationRecord = locationField as Record<string, unknown>;
      const nestedLatitude = this.toFiniteNumber(locationRecord['latitude'] ?? locationRecord['lat'] ?? locationRecord['_lat']);
      const nestedLongitude = this.toFiniteNumber(locationRecord['longitude'] ?? locationRecord['lng'] ?? locationRecord['lon'] ?? locationRecord['_long']);

      if (
        nestedLatitude !== null &&
        nestedLongitude !== null &&
        Math.abs(nestedLatitude) <= 90 &&
        Math.abs(nestedLongitude) <= 180
      ) {
        return { latitude: nestedLatitude, longitude: nestedLongitude };
      }
    }

    return null;
  }

  private buildOfficeMarkerTitle(markerData: OfficeLocationMarkerData): string {
    const nameValue = markerData.payload['name'];
    if (typeof nameValue === 'string' && nameValue.trim()) return nameValue.trim();

    const titleValue = markerData.payload['title'];
    if (typeof titleValue === 'string' && titleValue.trim()) return titleValue.trim();

    return `Office Marker ${markerData.id}`;
  }

  private clearOfficeLocationMapMarkers(): void {
    if (!this.officeLocationLeafletMarkers.length) return;

    for (const marker of this.officeLocationLeafletMarkers) {
      try {
        marker.remove();
      } catch {}
      this.markerUserProfileMap.delete(marker);
    }

    this.officeLocationLeafletMarkers = [];
  }

  private async fetchUserProfileByUserId(userId: string): Promise<any> {
    if (!userId) return null;
    
    // Check cache first
    if (this.userProfileCache.has(userId)) {
      console.log('[ChatPage.userProfile] User profile found in cache', { userId });
      return this.userProfileCache.get(userId);
    }

    try {
      console.log('[ChatPage.userProfile] Fetching user profile from Firestore', { userId });
      const userDocRef = doc(this.firestore, 'users', userId);
      const userDocSnapshot = await getDoc(userDocRef);
      
      if (userDocSnapshot.exists()) {
        const userData = userDocSnapshot.data() as any;
        this.userProfileCache.set(userId, userData);
        console.log('[ChatPage.userProfile] User profile fetched and cached', { userId, userData });
        return userData;
      } else {
        console.warn('[ChatPage.userProfile] User document does not exist', { userId });
        return null;
      }
    } catch (error) {
      console.error('[ChatPage.userProfile] Error fetching user profile', { userId, error });
      return null;
    }
  }

  private async fetchOfficeLocationMarkerData(): Promise<void> {
    const authedUser = this.auth3.getCurrentUser() ?? await this.auth3.waitForAuthUser(5000).catch(() => null);
    if (!authedUser?.uid) {
      console.warn('[ChatPage.userOfficeLocationMarker] Skipping collection fetch because Firebase auth user is not ready.');
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
          console.warn('[ChatPage.userOfficeLocationMarker] Skipping document with invalid coordinates.', {
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
      console.log('[ChatPage.userOfficeLocationMarker] Collection data loaded and stored.', {
        totalDocuments: markerSnapshot.size,
        markersStored: parsedMarkers.length,
        markersSkipped: markerSnapshot.size - parsedMarkers.length
      });
    } catch (error) {
      const errorCode = (error as { code?: string } | null)?.code ?? 'unknown';
      if (errorCode === 'permission-denied') {
        console.error('[ChatPage.userOfficeLocationMarker] Permission denied while reading full collection. Check firestore.rules for list/get read access on /userOfficeLocationMarker.', error);
      } else {
        console.error('[ChatPage.userOfficeLocationMarker] Failed to fetch collection data.', error);
      }
      // Fall back to localStorage data if Firestore fetch fails
      this.officeLocationMarkerData = this.loadOfficeMarkerDataFromLocalStorage();
    }
  }

  private renderStoredOfficeLocationMarkers(): void {
    const mapInstance = this.map;
    if (!mapInstance) {
      console.warn('[ChatPage.userOfficeLocationMarker] Render skipped because map is not initialized.');
      return;
    }

    this.clearOfficeLocationMapMarkers();

    if (!this.officeLocationMarkerData.length) {
      console.log('[ChatPage.userOfficeLocationMarker] No stored marker data available for rendering.');
      return;
    }

    for (const markerData of this.officeLocationMarkerData) {
      try {
        const markerTitle = this.buildOfficeMarkerTitle(markerData);
        const marker = L.marker([markerData.latitude, markerData.longitude], { icon: this.testMarkerIcon })
          .addTo(mapInstance)
          .bindPopup(`<strong>${markerTitle}</strong>`);

        // Fetch and cache user profile for this marker's userID
        const locationUserId = (markerData.payload['userId'] || markerData.payload['uid'] || markerData.payload['userID']) as string | undefined;
        if (locationUserId) {
          this.fetchUserProfileByUserId(locationUserId)
            .then((userProfile) => {
              if (userProfile) {
                this.markerUserProfileMap.set(marker, userProfile);
                console.log('[ChatPage.userOfficeLocationMarker] User profile cached for marker', {
                  userId: locationUserId,
                  firstName: userProfile.firstName,
                  lastName: userProfile.lastName
                });
              }
            })
            .catch((err) => {
              console.error('[ChatPage.userOfficeLocationMarker] Failed to fetch user profile', { locationUserId, err });
            });
        }

        this.bindMarkerSelectionTrigger(marker, markerTitle);

        const logMarkerPayload = (trigger: 'click' | 'touchend') => {
          console.log('[ChatPage.userOfficeLocationMarker] Marker tapped.', {
            trigger,
            id: markerData.id,
            latitude: markerData.latitude,
            longitude: markerData.longitude,
            payload: markerData.payload,
            name: markerData.payload['name'],
            title: markerData.payload['title'],
            description: markerData.payload['description'],
            availableTime: markerData.payload['availableTime'],
            unAvailableTime: markerData.payload['unavailableTime'],
            contactInfo: markerData.payload['contactInfo'],
            address: markerData.payload['address'],
            email: markerData.payload['email'],
            locationuserid: markerData.payload['userId'] || markerData.payload['uid'] || markerData.payload['userID']
          });
        };

        marker.on('click', () => logMarkerPayload('click'));
        marker.on('touchend', () => logMarkerPayload('touchend'));
        this.officeLocationLeafletMarkers.push(marker);
      } catch (error) {
        console.error('[ChatPage.userOfficeLocationMarker] Failed to render a marker from stored data.', {
          markerData,
          error
        });
      }
    }

    console.log('[ChatPage.userOfficeLocationMarker] Stored markers rendered on map.', {
      markerCount: this.officeLocationLeafletMarkers.length
    });
  }

  private async loadAndRenderOfficeLocationMarkers(): Promise<void> {
    await this.fetchOfficeLocationMarkerData();
    this.renderStoredOfficeLocationMarkers();
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
      console.log('[ChatPage.markerStorage] Marker data saved to localStorage.', {
        markerCount: this.officeLocationMarkerData.length,
        storageKey: key
      });
    } catch (error) {
      console.error('[ChatPage.markerStorage] Failed to save marker data to localStorage.', error);
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
        console.log('[ChatPage.markerStorage] No cached marker data found in localStorage.');
        return [];
      }
      const parsedData = JSON.parse(storedData) as OfficeLocationMarkerData[];
      console.log('[ChatPage.markerStorage] Marker data loaded from localStorage.', {
        markerCount: parsedData.length
      });
      return Array.isArray(parsedData) ? parsedData : [];
    } catch (error) {
      console.error('[ChatPage.markerStorage] Failed to load marker data from localStorage.', error);
      return [];
    }
  }

  /**
   * Start a periodic timer that refreshes the map and marker data.
   * This ensures the map stays up-to-date even after inactivity or display issues.
   * Only starts one timer; subsequent calls are ignored if timer is already running.
   */
  private startMapRefreshTimer(): void {
    if (this.mapRefreshTimerId) {
      console.log('[ChatPage.mapRefresh] Map refresh timer already running.');
      return;
    }

    this.mapRefreshTimerId = setInterval(async () => {
      console.log('[ChatPage.mapRefresh] Periodic map refresh triggered.');
      try {
        // Fetch latest marker data from Firestore
        await this.fetchOfficeLocationMarkerData();
        // Save to local storage for offline access
        this.saveOfficeMarkerDataToLocalStorage();
        // Re-render on the map
        this.renderStoredOfficeLocationMarkers();
        console.log('[ChatPage.mapRefresh] Map refresh completed successfully.');
      } catch (error) {
        console.error('[ChatPage.mapRefresh] Error during periodic map refresh:', error);
      }
    }, this.mapRefreshIntervalMs);

    console.log('[ChatPage.mapRefresh] Map refresh timer started.', {
      intervalMs: this.mapRefreshIntervalMs
    });
  }

  /**
   * Stop the periodic map refresh timer.
   * Safe to call even if the timer is not running.
   */
  private stopMapRefreshTimer(): void {
    if (this.mapRefreshTimerId) {
      clearInterval(this.mapRefreshTimerId);
      this.mapRefreshTimerId = undefined;
      console.log('[ChatPage.mapRefresh] Map refresh timer stopped.');
    }
  }

  /**
   * Manually trigger a map refresh (fetch, save, and render).
   * Useful for on-demand updates without waiting for the periodic timer.
   */
  async manualMapRefresh(): Promise<void> {
    console.log('[ChatPage.mapRefresh] Manual map refresh triggered.');
    try {
      await this.fetchOfficeLocationMarkerData();
      this.saveOfficeMarkerDataToLocalStorage();
      this.renderStoredOfficeLocationMarkers();
      console.log('[ChatPage.mapRefresh] Manual map refresh completed successfully.');
    } catch (error) {
      console.error('[ChatPage.mapRefresh] Error during manual map refresh:', error);
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
        this.bindMapTapCapture();
        this.map.setView(center, 15);
        await this.markUserLocation(this.map, coordinates);
        await this.loadAndRenderOfficeLocationMarkers();
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
      await this.loadAndRenderOfficeLocationMarkers();
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
  // iconRetinaUrl: 'assets/map/marker-icon-2x.png', // optional but recommended
  shadowUrl: 'assets/map/marker-shadow2.png',      // optional
  iconRetinaUrl: 'assets/user-marker.png', // optional but recommended
  // shadowUrl: 'assets/user-marker.png',      // optional
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

    /** Place the test markers (from `testMarkers`) onto the currently-initialized map, using a custom icon. */
    private readonly testMarkerIcon = L.icon({
      iconUrl: 'assets/map/test-marker.png', // Place your custom marker image here
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowUrl: 'assets/map/marker-shadow2.png',
      shadowSize: [41, 41]
    });

    private placeTestMarkers(): void {
      if (!this.map) return;
      for (const m of this.testMarkers) {
        try {
          const marker = L.marker([m.latitude, m.longitude], { icon: this.testMarkerIcon })
            .addTo(this.map)
            .bindPopup(`<strong>${m.name}</strong>`);
          // preserve same behavior as other markers: open selection overlay when clicked
          this.bindMarkerSelectionTrigger(marker, m.name);
        } catch (err) {
          console.error('[ChatPage.placeTestMarkers] Failed to add marker', m, err);
        }
      }
    }

  ionViewDidLeave(): void {
    this.destroyMapInstance();
    this.stopMapRefreshTimer();
    if (this.markerOverlayElement) {
      try { document.body.removeChild(this.markerOverlayElement); } catch {}
      this.markerOverlayElement = undefined;
    }
    if (this.markerSelectionOverlayElement) {
      try { document.body.removeChild(this.markerSelectionOverlayElement); } catch {}
      this.markerSelectionOverlayElement = undefined;
    }
    this.dismissMapTapOverlay();
  }

  public editProfile() {
    console.log('[ChatPage] Edit Profile triggered');
  }

  ngOnDestroy(): void {
    // Clean up chat subscription
    try { this.chatsSub?.unsubscribe(); } catch {}
    this.chatsSub = undefined;
    this.resetTypingStateForCurrentUser().catch(() => {});
    try { this.typingSub?.unsubscribe(); } catch {}
    this.typingSub = undefined;
    if (this.typingDebounceTimeoutId) {
      clearTimeout(this.typingDebounceTimeoutId);
      this.typingDebounceTimeoutId = undefined;
    }
    if (this.markerOverlayElement) {
      try { document.body.removeChild(this.markerOverlayElement); } catch {}
      this.markerOverlayElement = undefined;
    }
    if (this.markerSelectionOverlayElement) {
      try { document.body.removeChild(this.markerSelectionOverlayElement); } catch {}
      this.markerSelectionOverlayElement = undefined;
    }
    this.dismissMapTapOverlay();
    if (this.mapResizeTimeoutId) {
      clearTimeout(this.mapResizeTimeoutId);
      this.mapResizeTimeoutId = undefined;
    }
    // Stop periodic map refresh timer
    this.stopMapRefreshTimer();
    try { this.messagesSub?.unsubscribe(); } catch {}
    this.messagesSub = undefined;
    // optional: set offline on destroy if desired
  }


}


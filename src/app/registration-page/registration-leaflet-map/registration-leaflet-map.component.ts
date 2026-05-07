import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import * as L from 'leaflet';

export type RegistrationMapCoordinates = {
  latitude: number;
  longitude: number;
};

@Component({
  selector: 'app-registration-leaflet-map',
  templateUrl: './registration-leaflet-map.component.html',
  styleUrls: ['./registration-leaflet-map.component.scss'],
  standalone: false
})
export class RegistrationLeafletMapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() selectedLocation: RegistrationMapCoordinates | null = null;
  @Output() locationSelected = new EventEmitter<RegistrationMapCoordinates>();

  @ViewChild('previewMapContainer', { static: false }) private previewMapContainerRef?: ElementRef<HTMLElement>;
  @ViewChild('pickerMapContainer', { static: false }) private pickerMapContainerRef?: ElementRef<HTMLElement>;

  isPickerOpen = false;
  pendingLocation: RegistrationMapCoordinates | null = null;

  private previewMap: L.Map | null = null;
  private previewMarker?: L.Marker;
  private pickerMap: L.Map | null = null;
  private pickerMarker?: L.Marker;
  private currentLocation: RegistrationMapCoordinates | null = null;

  private readonly fallbackCoordinates: RegistrationMapCoordinates = {
    latitude: 10.324849,
    longitude: 123.849164
  };

  ngAfterViewInit(): void {
    setTimeout(() => {
      void this.initializePreviewMap();
    }, 0);
  }

  ngOnChanges(changes: SimpleChanges): void {
    const selectedLocationChange = changes['selectedLocation'];
    if (!selectedLocationChange) {
      return;
    }

    this.currentLocation = this.selectedLocation
      ? {
          latitude: this.selectedLocation.latitude,
          longitude: this.selectedLocation.longitude
        }
      : null;

    this.syncPreviewMarker();
  }

  ngOnDestroy(): void {
    this.destroyPickerMap();

    if (this.previewMap) {
      this.previewMap.remove();
      this.previewMap = null;
    }
    this.previewMarker = undefined;
  }

  async openPicker(): Promise<void> {
    if (this.isPickerOpen) {
      return;
    }

    this.isPickerOpen = true;
    // Use current location if present, otherwise try stored coords as a fallback
    if (this.currentLocation) {
      this.pendingLocation = {
        latitude: this.currentLocation.latitude,
        longitude: this.currentLocation.longitude
      };
    } else {
      const stored = await this.getStoredCoordinates();
      this.pendingLocation = stored || null;
    }

    setTimeout(() => {
      this.initializePickerMap();
    }, 0);
  }

  closePicker(): void {
    this.isPickerOpen = false;
    this.pendingLocation = null;
    this.destroyPickerMap();
  }

  confirmLocation(): void {
    if (!this.pendingLocation) {
      return;
    }

    this.currentLocation = {
      latitude: this.pendingLocation.latitude,
      longitude: this.pendingLocation.longitude
    };

    this.syncPreviewMarker();
    this.locationSelected.emit({
      latitude: this.currentLocation.latitude,
      longitude: this.currentLocation.longitude
    });

    console.log('[RegistrationLeafletMap] confirmed office location', {
      latitude: this.currentLocation.latitude,
      longitude: this.currentLocation.longitude
    });

    // Persist the confirmed coordinates so they are available as a fallback later
    this.saveCoordinatesToStorage(this.currentLocation);

    this.closePicker();
  }

  get currentLocationText(): string {
    return this.formatLocation(this.currentLocation, 'Tap to choose office location');
  }

  get pendingLocationText(): string {
    return this.formatLocation(this.pendingLocation, 'Tap on the map to place a marker');
  }

  private async initializePreviewMap(): Promise<void> {
    const container = this.previewMapContainerRef?.nativeElement;
    if (!container || this.previewMap) {
      return;
    }

    this.fixLeafletIcons();
    const mapCenter = this.currentLocation || (await this.getInitialCenter());
    this.previewMap = L.map(container, {
      zoomControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
      attributionControl: false
    }).setView([mapCenter.latitude, mapCenter.longitude], this.currentLocation ? 16 : 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(this.previewMap);

    this.syncPreviewMarker();
  }

  /**
   * Determine the initial map center in the following order:
   * 1. `selectedLocation` / `currentLocation`
   * 2. try to get current geolocation
   * 3. try stored coordinates in localStorage
   * 4. fallback coordinates
   */
  private async getInitialCenter(): Promise<RegistrationMapCoordinates> {
    // If an explicit current location is already set, return it
    if (this.currentLocation) {
      return this.currentLocation;
    }

    // Try to get live geolocation
    try {
      const coords = await this.tryGetGeolocation();
      if (coords) {
        // Save for future fallbacks and set as current location so preview marker appears
        this.saveCoordinatesToStorage(coords);
        this.currentLocation = { latitude: coords.latitude, longitude: coords.longitude };
        return coords;
      }
    } catch {
      // ignore and continue to stored check
    }

    // If live geolocation failed, try stored coordinates
    const stored = await this.getStoredCoordinates();
    if (stored) {
      // Also set as currentLocation so preview marker appears
      this.currentLocation = { latitude: stored.latitude, longitude: stored.longitude };
      return stored;
    }

    // As last resort, prompt the user to enable location and use stored/fallback
    const wantPrompt = await this.promptEnableLocation();
    if (wantPrompt) {
      try {
        const coords = await this.tryGetGeolocation();
        if (coords) {
          this.saveCoordinatesToStorage(coords);
          this.currentLocation = { latitude: coords.latitude, longitude: coords.longitude };
          return coords;
        }
      } catch {
        // continue
      }
    }

    return { ...this.fallbackCoordinates };
  }

  /** Attempt to get geolocation once; returns null on failure. */
  private async tryGetGeolocation(): Promise<RegistrationMapCoordinates | null> {
    if (!navigator.geolocation) {
      return null;
    }

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (result) => resolve(result),
          (error) => reject(error),
          { enableHighAccuracy: true, timeout: 12000 }
        );
      });

      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };
    } catch (err) {
      return null;
    }
  }

  private initializePickerMap(): void {
    const container = this.pickerMapContainerRef?.nativeElement;
    if (!container) {
      return;
    }

    this.fixLeafletIcons();

    const center = this.pendingLocation || this.getPreviewCenter() || this.fallbackCoordinates;
    this.pickerMap = L.map(container).setView([center.latitude, center.longitude], 16);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(this.pickerMap);

    if (this.pendingLocation) {
      this.setPickerMarker(this.pendingLocation);
    }

    this.pickerMap.on('click', (event: L.LeafletMouseEvent) => {
      this.pendingLocation = {
        latitude: event.latlng.lat,
        longitude: event.latlng.lng
      };
      this.setPickerMarker(this.pendingLocation);
    });

    setTimeout(() => {
      this.pickerMap?.invalidateSize();
    }, 120);
  }

  private setPickerMarker(location: RegistrationMapCoordinates): void {
    if (!this.pickerMap) {
      return;
    }

    const latLng: [number, number] = [location.latitude, location.longitude];
    if (this.pickerMarker) {
      this.pickerMarker.setLatLng(latLng);
      return;
    }

    this.pickerMarker = L.marker(latLng).addTo(this.pickerMap);
  }

  private syncPreviewMarker(): void {
    if (!this.previewMap) {
      return;
    }

    if (!this.currentLocation) {
      try {
        this.previewMarker?.remove();
      } catch {
        // ignored on cleanup
      }
      this.previewMarker = undefined;
      return;
    }

    const latLng: [number, number] = [this.currentLocation.latitude, this.currentLocation.longitude];

    if (this.previewMarker) {
      this.previewMarker.setLatLng(latLng);
    } else {
      this.previewMarker = L.marker(latLng).addTo(this.previewMap);
    }

    this.previewMap.setView(latLng, 16);
  }

  private getPreviewCenter(): RegistrationMapCoordinates | null {
    if (!this.previewMap) {
      return null;
    }

    const center = this.previewMap.getCenter();
    return {
      latitude: center.lat,
      longitude: center.lng
    };
  }

  private destroyPickerMap(): void {
    try {
      this.pickerMarker?.remove();
    } catch {
      // ignored on cleanup
    }
    this.pickerMarker = undefined;

    if (this.pickerMap) {
      this.pickerMap.remove();
      this.pickerMap = null;
    }
  }

  private formatLocation(location: RegistrationMapCoordinates | null, fallbackText: string): string {
    if (!location) {
      return fallbackText;
    }

    return `Latitude ${location.latitude.toFixed(6)}, Longitude ${location.longitude.toFixed(6)}`;
  }

  private async getCurrentCoordinates(): Promise<RegistrationMapCoordinates> {
    // Backwards compatible wrapper used by older code paths.
    const coords = await this.tryGetGeolocation();
    if (coords) {
      this.saveCoordinatesToStorage(coords);
      this.currentLocation = { latitude: coords.latitude, longitude: coords.longitude };
      return coords;
    }

    const stored = await this.getStoredCoordinates();
    if (stored) {
      this.currentLocation = { latitude: stored.latitude, longitude: stored.longitude };
      return stored;
    }

    // If we couldn't get live coordinates, ask the user if they'd like to enable location.
    const asked = await this.promptEnableLocation();
    if (asked) {
      const retry = await this.tryGetGeolocation();
      if (retry) {
        this.saveCoordinatesToStorage(retry);
        this.currentLocation = { latitude: retry.latitude, longitude: retry.longitude };
        return retry;
      }
    }

    return { ...this.fallbackCoordinates };
  }

  /** Save last-known coords to localStorage for later fallback. */
  private saveCoordinatesToStorage(coords: RegistrationMapCoordinates): void {
    try {
      localStorage.setItem('registration_last_location', JSON.stringify(coords));
    } catch {
      // ignore storage errors
    }
  }

  /** Retrieve stored coords from localStorage, or null if none. */
  private async getStoredCoordinates(): Promise<RegistrationMapCoordinates | null> {
    try {
      const raw = localStorage.getItem('registration_last_location');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.latitude === 'number' && typeof parsed.longitude === 'number') {
        return { latitude: parsed.latitude, longitude: parsed.longitude };
      }
    } catch {
      // ignore parse/storage errors
    }
    return null;
  }

  /** Prompt the user to enable location services and return whether they agreed to try. */
  private async promptEnableLocation(): Promise<boolean> {
    try {
      // Use a confirm prompt to be minimally intrusive in web/cordova contexts
      // If running in a native shell, this could be replaced with a native dialog.
      const userAccepted = confirm(
        'Location access is currently unavailable. Enable location services to center the map on your current location.\n\nClick "OK" to try again or "Cancel" to use a previously stored location (if any) or a default.'
      );
      return !!userAccepted;
    } catch {
      return false;
    }
  }

  private fixLeafletIcons(): void {
    const iconDefault = L.Icon.Default.prototype as { _getIconUrl?: unknown };
    delete iconDefault._getIconUrl;

    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
    });
  }
}

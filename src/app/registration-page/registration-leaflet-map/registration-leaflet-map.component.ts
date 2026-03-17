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

  openPicker(): void {
    if (this.isPickerOpen) {
      return;
    }

    this.isPickerOpen = true;
    this.pendingLocation = this.currentLocation
      ? {
          latitude: this.currentLocation.latitude,
          longitude: this.currentLocation.longitude
        }
      : null;

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

    const mapCenter = this.currentLocation || (await this.getCurrentCoordinates());
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
    if (!navigator.geolocation) {
      return { ...this.fallbackCoordinates };
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
    } catch {
      return { ...this.fallbackCoordinates };
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

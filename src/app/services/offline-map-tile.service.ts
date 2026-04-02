import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import * as L from 'leaflet';

export interface TileCoordinate {
  z: number;
  x: number;
  y: number;
}

export interface TileRange {
  z: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  count: number;
}

export interface TileDownloadProgress {
  total: number;
  completed: number;
  cached: number;
  failed: number;
  percentage: number;
  currentKey?: string;
}

export interface TileDownloadRequest {
  bounds: L.LatLngBounds | L.LatLngBoundsLiteral;
  minZoom: number;
  maxZoom: number;
  urlTemplate: string;
  subdomains?: string[];
  maxTiles?: number;
  concurrency?: number;
  areaName?: string;
  onProgress?: (progress: TileDownloadProgress) => void;
}

export interface TileDownloadSummary {
  total: number;
  downloaded: number;
  cached: number;
  failed: number;
}

export interface OfflineMapAreaMetadata {
  id: string;
  name: string;
  createdAt: string;
  bounds: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
  minZoom: number;
  maxZoom: number;
  totalTiles: number;
  downloadedTiles: number;
  failedTiles: number;
  tileTemplate: string;
}

export interface TileDisplaySource {
  src: string;
  revokeOnLoad?: boolean;
}

const TRANSPARENT_PIXEL_DATA_URL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

@Injectable({
  providedIn: 'root'
})
export class OfflineMapTileService {
  private readonly storageRoot = 'offline-map-tiles-v1';
  private readonly cacheName = 'offline-map-tiles-v1';
  private readonly metadataStorageKey = 'offline_map_areas_v1';
  private readonly webCacheRequestPrefix = 'https://offline-tiles.local';

  private isNativePlatform(): boolean {
    const platform = Capacitor.getPlatform();
    return platform === 'android' || platform === 'ios';
  }

  latLngToTileXY(latitude: number, longitude: number, zoom: number): { x: number; y: number } {
    const latRad = (Math.max(-85.05112878, Math.min(85.05112878, latitude)) * Math.PI) / 180;
    const n = Math.pow(2, zoom);
    const normalizedLng = ((((longitude + 180) % 360) + 360) % 360) - 180;

    const x = Math.floor(((normalizedLng + 180) / 360) * n);
    const y = Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
    );

    return {
      x: Math.max(0, Math.min(n - 1, x)),
      y: Math.max(0, Math.min(n - 1, y))
    };
  }

  boundsToTileRange(boundsInput: L.LatLngBounds | L.LatLngBoundsLiteral, zoom: number): TileRange {
    const bounds = this.toLatLngBounds(boundsInput);
    const northWest = bounds.getNorthWest();
    const southEast = bounds.getSouthEast();

    const nwTile = this.latLngToTileXY(northWest.lat, northWest.lng, zoom);
    const seTile = this.latLngToTileXY(southEast.lat, southEast.lng, zoom);

    const minX = Math.min(nwTile.x, seTile.x);
    const maxX = Math.max(nwTile.x, seTile.x);
    const minY = Math.min(nwTile.y, seTile.y);
    const maxY = Math.max(nwTile.y, seTile.y);

    return {
      z: zoom,
      minX,
      maxX,
      minY,
      maxY,
      count: (maxX - minX + 1) * (maxY - minY + 1)
    };
  }

  listTileCoordinatesForBounds(
    boundsInput: L.LatLngBounds | L.LatLngBoundsLiteral,
    minZoom: number,
    maxZoom: number,
    maxTiles?: number
  ): TileCoordinate[] {
    const bounds = this.toLatLngBounds(boundsInput);
    const tiles: TileCoordinate[] = [];

    for (let z = minZoom; z <= maxZoom; z++) {
      const range = this.boundsToTileRange(bounds, z);
      for (let x = range.minX; x <= range.maxX; x++) {
        for (let y = range.minY; y <= range.maxY; y++) {
          tiles.push({ z, x, y });
          if (maxTiles && tiles.length > maxTiles) {
            throw new Error(
              `Selected bounds and zoom contain ${tiles.length} tiles, which exceeds the limit ${maxTiles}.`
            );
          }
        }
      }
    }

    return tiles;
  }

  buildTileKey(z: number, x: number, y: number): string {
    return `/${z}/${x}/${y}.png`;
  }

  buildTileUrl(
    template: string,
    z: number,
    x: number,
    y: number,
    subdomains: string[] = ['a', 'b', 'c']
  ): string {
    const subdomain = subdomains.length > 0 ? subdomains[(x + y) % subdomains.length] : 'a';
    return template
      .replace('{s}', subdomain)
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y));
  }

  async downloadTilesForBounds(request: TileDownloadRequest): Promise<TileDownloadSummary> {
    const minZoom = Math.floor(request.minZoom);
    const maxZoom = Math.floor(request.maxZoom);
    if (!Number.isFinite(minZoom) || !Number.isFinite(maxZoom) || maxZoom < minZoom) {
      throw new Error('Invalid zoom range.');
    }

    const tileList = this.listTileCoordinatesForBounds(
      request.bounds,
      minZoom,
      maxZoom,
      request.maxTiles
    );

    if (tileList.length === 0) {
      return { total: 0, downloaded: 0, cached: 0, failed: 0 };
    }

    const progress: TileDownloadProgress = {
      total: tileList.length,
      completed: 0,
      cached: 0,
      failed: 0,
      percentage: 0
    };

    // Reduce concurrency on native platforms to prevent filesystem bottlenecks
    let concurrency = Math.max(1, Math.min(request.concurrency ?? 6, 12));
    if (this.isNativePlatform()) {
      // Use only 1-2 concurrent downloads on Android/iOS to avoid blocking the main thread
      concurrency = 1;
    }
    
    const queue = [...tileList];

    const runWorker = async (): Promise<void> => {
      while (queue.length > 0) {
        const tile = queue.shift();
        if (!tile) {
          break;
        }

        const key = this.buildTileKey(tile.z, tile.x, tile.y);
        progress.currentKey = key;

        try {
          const alreadyCached = await this.hasTile(key);
          if (alreadyCached) {
            progress.cached += 1;
          } else {
            const tileUrl = this.buildTileUrl(
              request.urlTemplate,
              tile.z,
              tile.x,
              tile.y,
              request.subdomains
            );
            
            // Add timeout to fetch operation (15 seconds)
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            
            try {
              const response = await fetch(tileUrl, { signal: controller.signal });
              clearTimeout(timeoutId);
              
              if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
              }
              const tileBlob = await response.blob();
              await this.storeTileBlob(key, tileBlob);
            } catch (fetchError) {
              clearTimeout(timeoutId);
              throw fetchError;
            }
          }
        } catch (error) {
          progress.failed += 1;
          console.warn(`[OfflineMapService] Failed to download tile ${progress.currentKey}:`, error);
        } finally {
          progress.completed += 1;
          progress.percentage = Math.round((progress.completed / progress.total) * 100);
          request.onProgress?.({ ...progress });
          
          // Add small delay on native platforms to prevent thread starvation
          if (this.isNativePlatform() && queue.length > 0) {
            await this.delay(50);
          }
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => runWorker()));

    const downloaded = progress.completed - progress.cached - progress.failed;
    await this.persistAreaMetadata({
      id: this.createMetadataId(),
      name: (request.areaName || 'Offline area').trim() || 'Offline area',
      createdAt: new Date().toISOString(),
      bounds: this.toBoundsObject(request.bounds),
      minZoom,
      maxZoom,
      totalTiles: progress.total,
      downloadedTiles: downloaded + progress.cached,
      failedTiles: progress.failed,
      tileTemplate: request.urlTemplate
    });

    return {
      total: progress.total,
      downloaded,
      cached: progress.cached,
      failed: progress.failed
    };
  }

  async resolveTileForDisplay(options: {
    key: string;
    url: string;
    offlineMode: boolean;
  }): Promise<TileDisplaySource | null> {
    const cached = await this.getTileFromStorage(options.key);
    if (cached) {
      return cached;
    }

    if (options.offlineMode) {
      return { src: TRANSPARENT_PIXEL_DATA_URL };
    }

    void this.cacheTileFromNetwork(options.key, options.url);
    return { src: options.url };
  }

  async clearAllTiles(): Promise<void> {
    if (this.isNativePlatform()) {
      try {
        await Filesystem.rmdir({
          path: this.storageRoot,
          directory: Directory.Data,
          recursive: true
        });
      } catch {
        // Ignore missing dir.
      }
    } else if (typeof caches !== 'undefined') {
      await caches.delete(this.cacheName);
    }

    this.saveMetadata([]);
  }

  listOfflineAreas(): OfflineMapAreaMetadata[] {
    return this.readMetadata();
  }

  private async cacheTileFromNetwork(key: string, url: string): Promise<void> {
    try {
      if (await this.hasTile(key)) {
        return;
      }
      const response = await fetch(url);
      if (!response.ok) {
        return;
      }
      const blob = await response.blob();
      await this.storeTileBlob(key, blob);
    } catch {
      // Network cache warm-up should not break map rendering.
    }
  }

  private toLatLngBounds(boundsInput: L.LatLngBounds | L.LatLngBoundsLiteral): L.LatLngBounds {
    if (boundsInput instanceof L.LatLngBounds) {
      return boundsInput;
    }
    return L.latLngBounds(boundsInput);
  }

  private toBoundsObject(boundsInput: L.LatLngBounds | L.LatLngBoundsLiteral): OfflineMapAreaMetadata['bounds'] {
    const bounds = this.toLatLngBounds(boundsInput);
    return {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth()
    };
  }

  private createMetadataId(): string {
    const rand = Math.random().toString(36).slice(2, 8);
    return `offline-area-${Date.now()}-${rand}`;
  }

  private async persistAreaMetadata(area: OfflineMapAreaMetadata): Promise<void> {
    const list = this.readMetadata();
    list.unshift(area);
    this.saveMetadata(list.slice(0, 50));
  }

  private readMetadata(): OfflineMapAreaMetadata[] {
    try {
      const raw = localStorage.getItem(this.metadataStorageKey);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as OfflineMapAreaMetadata[]) : [];
    } catch {
      return [];
    }
  }

  private saveMetadata(metadata: OfflineMapAreaMetadata[]): void {
    try {
      localStorage.setItem(this.metadataStorageKey, JSON.stringify(metadata));
    } catch {
      // Ignore quota errors for metadata only.
    }
  }

  private webCacheRequest(key: string): Request {
    return new Request(`${this.webCacheRequestPrefix}${key}`);
  }

  private storagePathFromKey(key: string): string {
    return `${this.storageRoot}${key}`;
  }

  private async hasTile(key: string): Promise<boolean> {
    if (this.isNativePlatform()) {
      try {
        await Filesystem.stat({
          path: this.storagePathFromKey(key),
          directory: Directory.Data
        });
        return true;
      } catch {
        return false;
      }
    }

    if (typeof caches === 'undefined') {
      return false;
    }

    const cache = await caches.open(this.cacheName);
    const match = await cache.match(this.webCacheRequest(key));
    return Boolean(match);
  }

  private async storeTileBlob(key: string, blob: Blob): Promise<void> {
    if (this.isNativePlatform()) {
      try {
        const data = await this.blobToBase64(blob);
        await Filesystem.writeFile({
          path: this.storagePathFromKey(key),
          directory: Directory.Data,
          data,
          recursive: true
        });
      } catch (error) {
        console.error(`[OfflineMapService] Failed to store tile ${key}:`, error);
        throw error;
      }
      return;
    }

    if (typeof caches === 'undefined') {
      console.warn('[OfflineMapService] Cache API not available on this platform');
      return;
    }

    try {
      const cache = await caches.open(this.cacheName);
      await cache.put(this.webCacheRequest(key), new Response(blob));
    } catch (error) {
      console.error(`[OfflineMapService] Failed to cache tile ${key}:`, error);
      throw error;
    }
  }

  private async getTileFromStorage(key: string): Promise<TileDisplaySource | null> {
    if (this.isNativePlatform()) {
      try {
        const result = await Filesystem.readFile({
          path: this.storagePathFromKey(key),
          directory: Directory.Data
        });

        if (typeof result.data === 'string' && result.data.length > 0) {
          return {
            src: `data:image/png;base64,${result.data}`
          };
        }
      } catch {
        return null;
      }
      return null;
    }

    if (typeof caches === 'undefined') {
      return null;
    }

    const cache = await caches.open(this.cacheName);
    const match = await cache.match(this.webCacheRequest(key));
    if (!match) {
      return null;
    }

    const blob = await match.blob();
    const objectUrl = URL.createObjectURL(blob);
    return {
      src: objectUrl,
      revokeOnLoad: true
    };
  }

  private async blobToBase64(blob: Blob): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      
      // Add timeout to prevent hanging
      const timeoutId = setTimeout(() => {
        reader.abort();
        reject(new Error('Base64 encoding timed out (blob too large?)'));
      }, 10000);
      
      reader.onloadend = () => {
        clearTimeout(timeoutId);
        const result = reader.result;
        if (typeof result !== 'string') {
          reject(new Error('Failed to encode tile blob as base64.'));
          return;
        }

        const commaIndex = result.indexOf(',');
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      };
      reader.onerror = () => {
        clearTimeout(timeoutId);
        reject(reader.error || new Error('FileReader error while encoding tile.'));
      };
      reader.readAsDataURL(blob);
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

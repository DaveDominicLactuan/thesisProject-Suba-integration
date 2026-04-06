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
    console.log('[OfflineMapService.downloadTilesForBounds] METHOD CALLED');
    console.log('[OfflineMapService.downloadTilesForBounds] Request params:', {
      minZoom: request.minZoom,
      maxZoom: request.maxZoom,
      maxTiles: request.maxTiles,
      hasOnProgress: !!request.onProgress
    });

    const minZoom = Math.floor(request.minZoom);
    const maxZoom = Math.floor(request.maxZoom);
    if (!Number.isFinite(minZoom) || !Number.isFinite(maxZoom) || maxZoom < minZoom) {
      throw new Error('Invalid zoom range.');
    }

    console.log('[OfflineMapService.downloadTilesForBounds] Calling listTileCoordinatesForBounds...');
    let tileList: TileCoordinate[] = [];
    try {
      tileList = this.listTileCoordinatesForBounds(
        request.bounds,
        minZoom,
        maxZoom,
        request.maxTiles
      );
      console.log('[OfflineMapService.downloadTilesForBounds] Got tile list:', tileList.length, 'tiles');
    } catch (error) {
      console.error('[OfflineMapService.downloadTilesForBounds] Error listing tiles:', error);
      throw error;
    }

    if (tileList.length === 0) {
      return { total: 0, downloaded: 0, cached: 0, failed: 0 };
    }

    console.log(`[OfflineMapService] Starting download of ${tileList.length} tiles on ${this.isNativePlatform() ? 'NATIVE' : 'WEB'} platform`);
    const isNative = this.isNativePlatform();

    const progress: TileDownloadProgress = {
      total: tileList.length,
      completed: 0,
      cached: 0,
      failed: 0,
      percentage: 0
    };

    // On native: use aggressive sequential processing with timeouts
    // On web: use concurrent for speed
    const useSequentialProcessing = isNative;

    try {
      if (useSequentialProcessing) {
        console.log('[OfflineMapService] Using SEQUENTIAL processing with timeouts for Android stability');
        
        for (let i = 0; i < tileList.length; i++) {
          const tile = tileList[i];
          const key = this.buildTileKey(tile.z, tile.x, tile.y);
          progress.currentKey = key;

          try {
            console.log(`[OfflineMapService] Processing tile ${i + 1}/${tileList.length}: ${key}`);
            
            // On Android, SKIP the hasTile check and always fetch
            // This avoids expensive filesystem stat operations
            // On web, we check cache first for speed
            let alreadyCached = false;
            
            if (!isNative) {
              // Web platform: check if cached (fast)
              try {
                alreadyCached = await this.hasTileWithTimeout(key, 5000);
              } catch (error) {
                console.warn(`[OfflineMapService] hasTile check failed for ${key}`, error);
                alreadyCached = false;
              }
            }
            // On Android: alreadyCached stays false, always fetch

            if (alreadyCached) {
              progress.cached += 1;
              progress.completed += 1;
              console.log(`[OfflineMapService] Tile ${i + 1}/${tileList.length}: cached`);
            } else {
              // Fetch from network (either web or Android)
              const tileUrl = this.buildTileUrl(
                request.urlTemplate,
                tile.z,
                tile.x,
                tile.y,
                request.subdomains
              );

              try {
                console.log(`[OfflineMapService] Fetching tile ${key} from network...`);
                // Shorter timeout on device to fail fast
                const fetchTimeoutMs = isNative ? 20000 : 30000;
                const tileBlob = await this.fetchTileWithTimeout(tileUrl, fetchTimeoutMs);
                console.log(`[OfflineMapService] Downloaded tile ${key}, blob size: ${tileBlob.size} bytes`);
                
                // Fire progress IMMEDIATELY after fetch, before storing (to show UI feedback)
                progress.completed += 1;
                progress.percentage = Math.round((progress.completed / progress.total) * 100);
                try {
                  request.onProgress?.({ ...progress });
                  console.log(`[OfflineMapService] Progress after fetch: ${progress.completed}/${progress.total} (${progress.percentage}%)`);
                } catch (callbackError) {
                  console.error('[OfflineMapService] Progress callback error after fetch:', callbackError);
                }

                // Now attempt to store with aggressive timeout (Cache API is fast, so 3s is plenty)
                console.log(`[OfflineMapService] Storing tile ${key} with 3s timeout (using Cache API)...`);
                try {
                  await this.storeTileBlobWithTimeout(key, tileBlob, isNative ? 3000 : 3000);
                  console.log(`[OfflineMapService] Tile ${i + 1}/${tileList.length}: downloaded and stored successfully`);
                } catch (storeError) {
                  console.warn(`[OfflineMapService] Tile ${i + 1}/${tileList.length} storage failed (after fetch succeeded):`, 
                    storeError instanceof Error ? storeError.message : String(storeError));
                  progress.failed += 1;
                }
              } catch (error) {
                progress.completed += 1;
                progress.failed += 1;
                console.warn(`[OfflineMapService] Tile ${i + 1}/${tileList.length} fetch failed:`, 
                  error instanceof Error ? error.message : String(error));
                
                // Fire progress even on fetch failure
                progress.percentage = Math.round((progress.completed / progress.total) * 100);
                try {
                  request.onProgress?.({ ...progress });
                  console.log(`[OfflineMapService] Progress after fetch failure: ${progress.completed}/${progress.total} (${progress.percentage}%)`);
                } catch (callbackError) {
                  console.error('[OfflineMapService] Progress callback error after fetch failure:', callbackError);
                }
              }
            }
          } catch (error) {
            progress.completed += 1;
            progress.failed += 1;
            console.error(`[OfflineMapService] Unexpected error on tile ${i + 1}:`, error);
            
            // Fire progress even on unexpected error
            progress.percentage = Math.round((progress.completed / progress.total) * 100);
            try {
              request.onProgress?.({ ...progress });
            } catch (callbackError) {
              console.error('[OfflineMapService] Progress callback error after unexpected error:', callbackError);
            }
          }

          // Update progress percentage
          progress.percentage = Math.round((progress.completed / progress.total) * 100);
          
          // Fire final progress callback for this tile
          try {
            request.onProgress?.({ ...progress });
            console.log(`[OfflineMapService] Final progress for tile ${i + 1}: ${progress.completed}/${progress.total} (${progress.percentage}%)`);
          } catch (callbackError) {
            console.error('[OfflineMapService] Final progress callback error:', callbackError);
          }

          // Slightly longer delay after each tile to allow UI updates
          if (i % 3 === 0) {
            await this.delay(50);
          }
        }
      } else {
        // Concurrent: for browser testing (fast but less stable on Android)
        const concurrency = 6;
        const queue = [...tileList];

        const runWorker = async (): Promise<void> => {
          while (queue.length > 0) {
            const tile = queue.shift();
            if (!tile) break;

            const key = this.buildTileKey(tile.z, tile.x, tile.y);
            progress.currentKey = key;

            try {
              const alreadyCached = await this.hasTileWithTimeout(key, 5000);
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

                try {
                  const tileBlob = await this.fetchTileWithTimeout(tileUrl, 30000);
                  await this.storeTileBlobWithRetry(key, tileBlob, 1);
                } catch (error) {
                  progress.failed += 1;
                  console.warn(`[OfflineMapService] Failed to download tile ${key}:`, 
                    error instanceof Error ? error.message : String(error));
                }
              }
            } catch (error) {
              progress.failed += 1;
              console.error(`[OfflineMapService] Unexpected error processing tile:`, error);
            }

            progress.completed += 1;
            progress.percentage = Math.round((progress.completed / progress.total) * 100);
            request.onProgress?.({ ...progress });
          }
        };

        await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
      }
    } catch (error) {
      console.error('[OfflineMapService] Critical error during tile download:', error);
      throw error;
    }

    // Calculate final stats
    const downloaded = progress.total - progress.cached - progress.failed;

    try {
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
    } catch (metaError) {
      console.error('[OfflineMapService] Failed to persist metadata:', metaError);
    }

    console.log('[OfflineMapService] Download complete:', {
      total: progress.total,
      downloaded,
      cached: progress.cached,
      failed: progress.failed
    });

    return {
      total: progress.total,
      downloaded,
      cached: progress.cached,
      failed: progress.failed
    };
  }

  private async hasTileWithTimeout(key: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        console.warn(`[OfflineMapService] hasTile timeout for ${key}`);
        resolve(false); // Assume not cached if timeout
      }, timeoutMs);

      this.hasTile(key).then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      }).catch((error) => {
        clearTimeout(timeoutId);
        console.warn(`[OfflineMapService] hasTile error for ${key}:`, error);
        resolve(false);
      });
    });
  }

  private async fetchTileWithTimeout(url: string, timeoutMs: number): Promise<Blob> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.blob();
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private async storeTileBlobWithRetry(key: string, blob: Blob, maxRetries: number = 1): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.storeTileBlob(key, blob);
        return; // Success
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxRetries - 1) {
          await this.delay(100); // Wait before retry (shorter delay)
        }
      }
    }

    throw lastError || new Error('Failed to store tile after retries');
  }

  private async storeTileBlobWithTimeout(key: string, blob: Blob, timeoutMs: number): Promise<void> {
    try {
      console.log(`[OfflineMapService] storeTileBlobWithTimeout: starting with ${timeoutMs}ms timeout for ${key}`);
      
      const result = await Promise.race([
        this.storeTileBlobWithRetry(key, blob, 1),
        new Promise<void>((_, reject) => {
          setTimeout(() => {
            console.error(`[OfflineMapService] storeTileBlobWithTimeout: TIMEOUT after ${timeoutMs}ms for ${key}`);
            reject(new Error(`Filesystem write timeout after ${timeoutMs}ms for tile ${key}`));
          }, timeoutMs);
        })
      ]);
      
      console.log(`[OfflineMapService] storeTileBlobWithTimeout: successfully stored ${key}`);
      return result;
    } catch (error) {
      console.error(`[OfflineMapService] storeTileBlobWithTimeout failed for ${key}:`, error);
      throw error;
    }
  }

  private async filesystemOperationWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    operationName: string
  ): Promise<T> {
    return Promise.race([
      operation(),
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)),
          timeoutMs
        )
      )
    ]);
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
        // Use timeout to prevent hanging on Android filesystem operations
        await Promise.race([
          Filesystem.stat({
            path: this.storagePathFromKey(key),
            directory: Directory.Data
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('stat timeout')), 2000))
        ]);
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
    // DEVICE OPTIMIZATION: Use Web Cache API for ALL platforms
    // Filesystem is too slow on Android (8-10s per tile); Cache API is instant
    // This dramatically improves download speed on device
    
    if (typeof caches === 'undefined') {
      console.warn('[OfflineMapService] Cache API not available on this platform');
      return;
    }

    try {
      console.log(`[OfflineMapService] Caching tile ${key} (size: ${blob.size} bytes) using Cache API...`);
      const cache = await caches.open(this.cacheName);
      await cache.put(this.webCacheRequest(key), new Response(blob));
      console.log(`[OfflineMapService] Tile ${key} cached successfully via Cache API`);
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
    // Fast, simple base64 encoding without unnecessary complexity
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const commaIndex = result.indexOf(',');
        const base64Data = commaIndex >= 0 ? result.substring(commaIndex + 1) : result;
        resolve(base64Data);
      };
      reader.onerror = () => reject(new Error('Failed to read blob'));
      reader.readAsDataURL(blob);
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
  }
}

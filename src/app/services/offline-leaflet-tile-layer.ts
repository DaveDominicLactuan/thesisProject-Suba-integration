import * as L from 'leaflet';
import { OfflineMapTileService } from './offline-map-tile.service';

const TRANSPARENT_PIXEL_DATA_URL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

export interface OfflineLeafletTileLayerOptions extends L.TileLayerOptions {
  offlineMode?: boolean;
}

export class OfflineLeafletTileLayer extends L.TileLayer {
  declare options: OfflineLeafletTileLayerOptions;

  constructor(
    urlTemplate: string,
    private readonly offlineTileService: OfflineMapTileService,
    options: OfflineLeafletTileLayerOptions = {}
  ) {
    super(urlTemplate, options);
  }

  setOfflineMode(enabled: boolean): void {
    this.options.offlineMode = enabled;
    this.redraw();
  }

  override createTile(
    coords: L.Coords,
    done: L.DoneCallback
  ): HTMLImageElement {
    const tile = document.createElement('img');
    tile.alt = '';
    tile.setAttribute('role', 'presentation');

    const cleanupObjectUrl = (): void => {
      const objectUrl = (tile as any).__offlineObjectUrl as string | undefined;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        (tile as any).__offlineObjectUrl = undefined;
      }
    };

    tile.onload = () => {
      cleanupObjectUrl();
      done(undefined, tile);
    };

    tile.onerror = (event) => {
      cleanupObjectUrl();
      const error = event instanceof ErrorEvent ? event.error : new Error('Tile load error');
      done(error as Error, tile);
    };

    const tileUrl = this.getTileUrl(coords);
    const tileKey = this.offlineTileService.buildTileKey(coords.z, coords.x, coords.y);

    void this.offlineTileService
      .resolveTileForDisplay({
        key: tileKey,
        url: tileUrl,
        offlineMode: this.options.offlineMode === true
      })
      .then((resolved) => {
        if (!resolved?.src) {
          tile.src = this.options.errorTileUrl || TRANSPARENT_PIXEL_DATA_URL;
          return;
        }

        if (resolved.revokeOnLoad) {
          (tile as any).__offlineObjectUrl = resolved.src;
        }

        tile.src = resolved.src;
      })
      .catch(() => {
        tile.src = this.options.errorTileUrl || TRANSPARENT_PIXEL_DATA_URL;
      });

    return tile;
  }
}

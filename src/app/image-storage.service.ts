import { Injectable } from '@angular/core';


export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}


export interface StoredImage {
  original: string;
  withBoxes: string;
  boxes: any[];
  faceDetected: boolean;
  faceData?: any[];
  timestamp: string;
  detectionMessage: string;
  filename?: string; // ✅ Add this
}

@Injectable({
  providedIn: 'root'
})
export class ImageStorageService {

  
    private storedImages: StoredImage[] = [];
    private entryMap: Map<string, StoredImage> = new Map();
  
    // ✅ Add a new image to storage
    addImage(image: StoredImage): void {
      this.storedImages.unshift(image);
      this.entryMap.set(image.original, image);
    }
  
    // ✅ Get all stored images
    getImages(): StoredImage[] {
      return this.storedImages;
    }
  
    // ✅ Clear all stored data
    clearImages(): void {
      this.storedImages = [];
      this.entryMap.clear();
    }
  
    // ✅ Update or insert an entry by image key (e.g. base64)
    setEntryForImage(imageKey: string, entryData: StoredImage): void {
      const index = this.storedImages.findIndex(img => img.original === imageKey);
      if (index !== -1) {
        this.storedImages[index] = entryData;
      } else {
        this.storedImages.unshift(entryData);
      }
      this.entryMap.set(imageKey, entryData);
    }
  
    // ✅ Get an entry by its image key
    getEntryForImage(imageKey: string): StoredImage | undefined {
      return this.entryMap.get(imageKey);
    }
  
    // ✅ Get all image entries as object
    getAllEntries(): { [key: string]: StoredImage } {
      const all: { [key: string]: StoredImage } = {};
      this.entryMap.forEach((value, key) => {
        all[key] = value;
      });
      return all;
    }

}

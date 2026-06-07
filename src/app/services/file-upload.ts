import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Filesystem } from '@capacitor/filesystem';
import { Camera, CameraResultType, CameraSource, Photo } from '@capacitor/camera';
import { from, Observable, switchMap } from 'rxjs';


@Injectable({
  providedIn: 'root'
})
export class FileUpload {

  constructor(private http: HttpClient) { }

  /**
   * Prompts the user to select or capture an image.
   * Returns a promise containing webPath for preview and native path for upload.
   */
  async selectImage(sourceType: 'CAMERA' | 'PHOTOS'): Promise<Photo> {
  // Map your custom string to Capacitor's expected CameraSource
  const source = sourceType === 'CAMERA' ? CameraSource.Camera : CameraSource.Photos;

  return await Camera.getPhoto({
    quality: 90,
    allowEditing: false,
    resultType: CameraResultType.Uri,
    source: source // Forces either Camera or Photo Gallery directly
  });
}


  /**
   * Converts a native file URI (from @capacitor/camera) into a Blob
   * that can be appended to FormData.
   */
  private async getBlobFromNativeUri(nativePath: string): Promise<Blob> {
    // 1. Read the file as base64 raw data from the filesystem
    const readFile = await Filesystem.readFile({
      path: nativePath
    });

    // 2. The raw data is a string. Filesystem plugin requires 'data:...' prefix 
    // to treat it correctly as base64 on some platforms, but for conversion we just need the raw string.
    const base64Data = readFile.data as string;

    // 3. Simple conversion from Base64 string to Blob
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);

    // Assuming JPEG here; you can extract actual mime type from the native path if needed.
    return new Blob([byteArray], { type: 'image/jpeg' });
  }

  /**
   * Main function to handle the entire upload flow.
   */
  // uploadImage(nativePath: string, backendUrl: string): Observable<any> {
  //   // We use RxJS from() to convert the async Blob generation into an Observable flow
  //   return from(this.getBlobFromNativeUri(nativePath)).pipe(
  //     switchMap(blob => {
  //       const formData = new FormData();
  //       // The key 'file' must match the parameter name in your FastAPI endpoint
  //       formData.append('file', blob, 'uploaded_image.jpg');

  //       return this.http.post(backendUrl, formData);
  //     })
  //   );
  // }

  uploadImage(nativePath: string, backendUrl: string): Observable<any> {
  return from(this.getBlobFromNativeUri(nativePath)).pipe(
    switchMap(async (blob) => {
      const formData = new FormData();
      
      // Explicitly construct the file to ensure no metadata pollution
      const file = new File([blob], 'image.jpg', { type: 'image/jpeg' });
      formData.append('file', file);

      // Perform the POST
      return this.http.post(backendUrl, formData).toPromise();
    })
  );
}

}
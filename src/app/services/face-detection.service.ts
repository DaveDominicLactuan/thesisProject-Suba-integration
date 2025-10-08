import { Injectable } from '@angular/core';
import { HttpClient, HttpEvent, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class FaceDetectionService {

   private apiUrl = 'https://kg7zbdg9-8000.asse.devtunnels.ms/api/detect/'; // or use ngrok URL

  constructor(private http: HttpClient) {}

  detectFaces(imageBlob: Blob): Observable<any> {
    const formData = new FormData();
    formData.append('image', imageBlob, 'photo.jpg');

    return this.http.post<any>(this.apiUrl, formData);
  }
}

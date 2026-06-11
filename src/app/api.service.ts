import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { environment } from '../environments/environment';

export interface AnalyzeSessionPayload {
  sessionId: string;
  originals: Array<{
    id: string;
    url: string;
    resized_variants?: any[];
  }>;
}

@Injectable({
  providedIn: 'root'
})
export class ApiService {

private baseUrl = 'https://your-render-url.onrender.com/process-all';

// private baseUrl = 'https://16z6llmg-8000.asse.devtunnels.ms/'

  constructor(private http: HttpClient) {}

  /**
   * Encapsulates raw image binary streams into FormData
   * @param file Blob data grabbed from ionic camera plugin/web file input
   */
  uploadInspection(file: File | Blob, filename: string = 'crack_inspection.jpg'): Observable<any> {
    const formData = new FormData();
    // Key 'file' must exactly match your Python definition: upload_inspection(file: Optional[UploadFile] = File(None))
    formData.append('file', file, filename);

    return this.http.post<any>(`${this.baseUrl}/upload`, formData);
  }

  // analyzeSession(sessionId: string, originals: any[]): Observable<any> {
  //   const payload = {
  //     sessionId: sessionId,
  //     originals: originals
  //   };

  //   // Sent as standard application/json headers automatically by Angular
  //   return this.http.post<any>(`${`${this.baseUrl}/analyze-session`}`, payload);
  // }

  analyzeSession(payload: AnalyzeSessionPayload): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/analyze-session`, payload);
  }



}

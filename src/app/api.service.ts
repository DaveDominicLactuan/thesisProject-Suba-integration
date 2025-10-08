import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { environment } from '../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class ApiService {

    // private baseUrl = 'http://127.0.0.1:8000/api/hello/'; // Your active Ngrok base URL

  //  private baseUrl = environment.apiUrl;

  //https://e5a17b8ab388.ngrok-free.app -> http://localhost:8000 

  constructor(private http: HttpClient) {}


  
  getHelloJson(): Observable<any> {
  return this.http.get('https://743d07fce129.ngrok-free.app/api/hello/');
}




getHelloText(): Observable<any> {
  return this.http.get('https://743d07fce129.ngrok-free.app/api/hello/', {
    responseType: 'text'
  }).pipe(
    map((res: string) => {
      try {
        return JSON.parse(res);
      } catch (e) {
        console.error('Invalid JSON response:', res);
        throw new Error('Failed to parse JSON');
      }
    })
  );
}



getHelloTest(): Observable<any> {
  return this.http.get('https://kg7zbdg9-8000.asse.devtunnels.ms/api/hello/');
}





}

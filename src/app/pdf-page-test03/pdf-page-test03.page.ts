// src/app/pages/pdf-preview/pdf-preview.page.ts
import { Component, ViewChild, ElementRef,OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { PDFDocument } from 'pdf-lib';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Platform, NavController } from '@ionic/angular';
import * as pdfjsLib from 'pdfjs-dist';
import { getDocument } from 'pdfjs-dist';
import { AndroidPermissions } from '@awesome-cordova-plugins/android-permissions/ngx';
import { FileOpener } from '@awesome-cordova-plugins/file-opener/ngx';
import * as pdfMake from 'pdfmake/build/pdfmake';
import * as pdfFonts from 'pdfmake/build/vfs_fonts';
import { File } from '@awesome-cordova-plugins/file/ngx';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ImageStorageService } from '../services/image-storage.service';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import { LocalNotifications } from '@capacitor/local-notifications';

(pdfjsLib as any).GlobalWorkerOptions.workerSrc = `./assets/pdf.worker.min.js`;
(pdfMake as any).vfs = (pdfFonts as { vfs: any }).vfs;


@Component({
  selector: 'app-pdf-page-test03',
  templateUrl: './pdf-page-test03.page.html',
  styleUrls: ['./pdf-page-test03.page.scss'],
  standalone: false
})
export class PdfPageTest03Page {
    @ViewChild('pdfContainer', { static: true }) pdfContainer!: ElementRef<HTMLDivElement>;
    pdfSrc: SafeResourceUrl | null = null;
    private backButtonSub: any; // hardware back handler
    private savedPdfPath: string = ''; // Store the path for opening from notification
    // Images passed via navigation state or history.state
    sessionImages: any[] = [];
  
    constructor(
      private platform: Platform,
      private androidPermissions: AndroidPermissions,
      private fileOpener: FileOpener,
      private file: File,
      private sanitizer: DomSanitizer,
      private route: ActivatedRoute,
      private router: Router,
      private imageStorage: ImageStorageService,
      private navCtrl: NavController,
      ) {}
  
    async ngOnInit() {

      await this.platform.ready();

      console.log('Platform:', this.platform.platforms());

      // Read incoming sessionId from query params and then proceed
      this.route.queryParams.subscribe(async (params) => {
        this.sessionId = params['sessionId'] || null;
        console.log('Received sessionId:', this.sessionId);

        if (this.platform.is('hybrid') && this.platform.is('android')) {
          try {
            const status = await this.androidPermissions.checkPermission(
              this.androidPermissions.PERMISSION.WRITE_EXTERNAL_STORAGE
            );
            if (!status.hasPermission) {
              await this.androidPermissions.requestPermission(
                this.androidPermissions.PERMISSION.WRITE_EXTERNAL_STORAGE
              );
            }
          } catch (err) {
            console.error('Permission check/request failed:', err);
          }
        }

        // Try to obtain passed images from navigation extras or history.state
        try {
          //Attempts to read images passed via Angular Router navigation extras 
          //(this.router.getCurrentNavigation()?.extras?.state). If present, stores them in sessionImages.
          const navImages = this.router.getCurrentNavigation()?.extras?.state as any;
          if (navImages && navImages.images) {
            this.sessionImages = navImages.images;
            console.log('Loaded session images from navigation state:', this.sessionImages.length);
          } else {

            //If navigation extras didn't provide images, check the 
            // browser/history state (window.history.state) for an images property and use it if found.
            const hist = (window as any).history?.state || {};
            if (hist && hist.images) {
              this.sessionImages = hist.images;
              console.log('Loaded session images from history.state:', this.sessionImages.length);

              //load from service by sessionId if navigation or history didn't provide images, attempt 
              //to load a stored sesion, then reads session data and maps image keys to entries with 
              //getEntryForImage, and assigns them to sessionImages
            } else if (this.sessionId) {
              // Try loading the session images from persistent storage by sessionId
              try {
                const s = this.imageStorage.getSession(this.sessionId);
                if (s && Array.isArray(s.imageKeys) && s.imageKeys.length > 0) {
                  const imgs = s.imageKeys.map((k: string) => this.imageStorage.getEntryForImage(k)).filter((x: any) => !!x);
                  this.sessionImages = imgs as any[];
                  console.log('Loaded session images from ImageStorageService:', this.sessionImages.length);
                } else {
                  console.warn('No session entry or no imageKeys for sessionId', this.sessionId);
                }
              } catch (err) {
                console.warn('Failed to load session images from ImageStorageService', err);
              }
            }
          }
        } catch (e) {
          console.warn('Could not read navigation state for images', e);
        }

        // Print session objects for debugging, then preview PDF
        try {
          this.printSessionObjects();
        } catch (e) {
          console.warn('printSessionObjects failed:', e);
        }

        // Now preview PDF (sessionId and sessionImages are available for use inside preview/save)
        this.previewPdf();
      });
    }

  ionViewDidEnter() {
    this.registerBackButtonHandler();
  }

  ionViewWillLeave() {
    this.removeBackButtonHandler();
  }

  private registerBackButtonHandler() {
    try {
      this.removeBackButtonHandler();
      // High priority so this page handles back before Home's exit handler
      this.backButtonSub = this.platform.backButton.subscribeWithPriority(100, () => {
        try {
          this.navCtrl.back();
        } catch (e) {
          try { window.history.back(); } catch (err) { try { this.router.navigateByUrl('/results-dashboard'); } catch (_) { /* noop */ } }
        }
      });
    } catch (e) {
      console.warn('[PdfPageTest03] registerBackButtonHandler failed', e);
    }
  }

  private removeBackButtonHandler() {
    try {
      if (this.backButtonSub && typeof this.backButtonSub.unsubscribe === 'function') {
        try { this.backButtonSub.unsubscribe(); } catch (e) {}
      } else if (this.backButtonSub && typeof this.backButtonSub.remove === 'function') {
        try { this.backButtonSub.remove(); } catch (e) {}
      }
    } catch (e) {}
    this.backButtonSub = null;
  }

    /**
     * Log image extraction/processing result for each session image
     */
    private logImageProcessingResult(index: number, originalExists: boolean, boxedExists: boolean, type?: string, shape?: string, severity?: string): void {
      try {
        console.log(`PDF image ${index} processed — original:${originalExists ? 'yes' : 'no'}, boxed:${boxedExists ? 'yes' : 'no'}, type:${type}, shape:${shape}, severity:${severity}`);
      } catch (err) {
        console.warn('logImageProcessingResult failed', err);
      }
    }

    // store incoming session id if any
    sessionId: string | null = null;
  
    /**
     * Consolidated PDF document definition using pdfMake.
     * This function is called internally by other methods (e.g., `previewPdf`, `generatePdfBlob`) to define the structure and content of the PDF.
     * It dynamically builds the PDF content based on the session images and other data.
     */
     private getDocumentDefinition(): TDocumentDefinitions {
          // Fallback placeholder base64 images
          const imgPlainFallback = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
          const imgBoxFallback = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    
          const content: Content[] = [
            { text: 'Crack', style: 'header', alignment: 'center', margin: [0, 0, 0, 0] },
            { text: 'Damage', style: 'header', alignment: 'center', margin: [0, 0, 0, 0] },
            { text: 'Report', style: 'header', alignment: 'center', margin: [0, 0, 0, 30] }
          ];
    
          // If sessionImages exist, create one section per image
          if (this.sessionImages && this.sessionImages.length > 0) {
            this.sessionImages.forEach((img: any, idx: number) => {
              const i = idx + 1;
              const type = img?.rawPrediction?.type ?? img?.dropdown1 ?? img?.type ?? img?.fileName ?? 'Type';
              const shape = img?.rawPrediction?.shape ?? img?.dropdown2 ?? img?.shape ?? 'Shape';
              const severity = img?.rawPrediction?.severity ?? img?.dropdown3 ?? img?.severity ?? 'Severity';
    
              // Insert descriptive paragraph with values inserted and bolded
              content.push({
                text: [
                  `The crack shown in image ${i} is a `,
                  { text: type, bold: true },
                  ', the shape of the crack is ',
                  { text: shape, bold: true },
                  ' and it is a ',
                  { text: severity, bold: true },
                  ' in severity'
                ],
                alignment: 'justify',
                margin: [0, 0, 0, 20]
              });
    
              // caption text
              content.push({
                text: `Img ${i} without boxes and img ${i} with boxes`,
                alignment: 'center',
                margin: [0, 0, 0, 12],
                fontSize: 12,
                italics: true
              });
    
              const originalImg = img?.original ?? img?.plain ?? imgPlainFallback;
              const withBoxesImg = img?.withBoxes ?? img?.boxed ?? imgBoxFallback;
    
              // Log the result of extracting images for debugging/verification
              this.logImageProcessingResult(i, !!originalImg, !!withBoxesImg, type, shape, severity);
    
              // images as two columns
              content.push({
                columns: [
                  { image: originalImg, width: 250, height: 500, alignment: 'center' },
                  { image: withBoxesImg, width: 250, height: 500, alignment: 'center' }
                ],
                columnGap: 10,
                margin: [0, 0, 0, 20]
              });
            });
          } else {
            // no session images — keep a single placeholder block
            content.push({
              text: [
                'The crack shown in image 1 (increment based of img) is a ',
                { text: '(insert crack type here for image)', bold: true },
                ', the shape of the crack is ',
                { text: '(insert crack shape here)', bold: true },
                ' and it is a ',
                { text: '(insert crack severity here)', bold: true },
                ' in severity'
              ],
              alignment: 'justify',
              margin: [0, 0, 0, 30]
            });
    
            // Log the fallback placeholder usage
            this.logImageProcessingResult(1, true, true, '(placeholder)', '(placeholder)', '(placeholder)');
    
            content.push({ text: 'Img 1 without boxes and img 2 with boxes', alignment: 'center', margin: [0, 0, 0, 20], fontSize: 12, italics: true });
    
            content.push({
              columns: [
                { image: imgPlainFallback, width: 250, alignment: 'center' },
                { image: imgBoxFallback, width: 250, alignment: 'center' }
              ],
              columnGap: 10
            });
          }
    
          return {
            pageSize: 'A4',
            pageMargins: [40, 60, 40, 60],
            content,
            styles: { header: { fontSize: 24, bold: true, color: '#000000' } }
          };
        }
    
     // Generate PDF blob for preview purposes
     // Returns a promise that resolves to a Blob
     // allow for generation of pdf and store in blob
     
    private generatePdfBlob(): Promise<Blob> {

      //Wraps the pdfMake callback-style API in a Promise so callers can await a Blob.
      return new Promise((resolve, reject) => {

        //Builds the PDF object from the consolidated document definition (getDocumentDefinition()).
        try {
          const pdfDoc = pdfMake.createPdf(this.getDocumentDefinition());

          //Calls pdfDoc.getBlob (async callback) and resolves 
          // the outer Promise with the resulting Blob.
          pdfDoc.getBlob((blob: Blob) => resolve(blob));
        } catch (error) {
          reject(error);
        }
      });
    }
  
  
    /**
     * Preview PDF in a canvas element.
     * This function is triggered when the page is initialized and session data is loaded.
     * It generates a PDF using the document definition, renders it, and displays it in the DOM.
     */
    /**
        * Preview PDF in canvas (for web) or render from blob
        */
       async previewPdf() {
         try {
           // Generate the PDF using the current document definition so it matches download behaviour
           const pdfDoc = pdfMake.createPdf(this.getDocumentDefinition());
           const blob: Blob = await new Promise((resolve, reject) => {
             try {
               pdfDoc.getBlob((b: Blob) => resolve(b));
             } catch (err) {
               reject(err);
             }
           });
           const arrayBuffer = await blob.arrayBuffer();
           const pdfBytes = new Uint8Array(arrayBuffer);
           
           const loadingTask = getDocument({ data: pdfBytes });
           const pdf = await loadingTask.promise;
     
           const numPages = pdf.numPages || 1;
           const containerEl = this.pdfContainer.nativeElement as HTMLDivElement;
           containerEl.style.paddingTop = '0px';
           containerEl.innerHTML = '';
   
           // Determine device width once
           const screenWidth = window.innerWidth;
           const canvasWidth = screenWidth * 0.95;
   
           // Render every page. If there are multiple session images, stack
           // the rendered pages vertically in a single tall canvas so the
           // document appears centered and vertically ordered.
           const sessionCount = Array.isArray(this.sessionImages) ? this.sessionImages.length : 0;
           let extraMultiplier;
           if (sessionCount === 2) {
             extraMultiplier = Math.max(1, sessionCount);
           } else if (sessionCount >= 2) {
             extraMultiplier = Math.max(1, sessionCount - 1);
           } else {
             extraMultiplier = 1;
           }
           const outputScale = window.devicePixelRatio || 1;
   
           if (extraMultiplier > 1) {
             // Create one tall canvas that will contain all pages stacked vertically
             // Use the first page to determine per-page pixel dimensions
             const firstPage = await pdf.getPage(1);
             const firstViewport = firstPage.getViewport({ scale: canvasWidth / firstPage.getViewport({ scale: 1.0 }).width });
             const pagePixelWidth = Math.floor(firstViewport.width * outputScale);
             const pagePixelHeight = Math.floor(firstViewport.height * outputScale);
   
             const mainCanvas = document.createElement('canvas');
             const mainCtx = mainCanvas.getContext('2d')!;
             mainCanvas.width = pagePixelWidth;
             mainCanvas.height = pagePixelHeight * extraMultiplier;
   
             // CSS for centered, responsive display
             mainCanvas.style.display = 'block';
             mainCanvas.style.margin = '2px auto 0';
             mainCanvas.style.marginTop = '10px auto 0';
             mainCanvas.style.maxWidth = '95%';
             mainCanvas.style.width = '95%';
             mainCanvas.style.height = 'auto';
   
             // For each page, render into an offscreen canvas and blit into the main canvas
             for (let p = 1; p <= numPages; p++) {
               const page = await pdf.getPage(p);
               const originalViewport = page.getViewport({ scale: 1.0 });
               const scale = canvasWidth / originalViewport.width;
               const viewport = page.getViewport({ scale });
   
               // Offscreen canvas for per-page rendering (pixel-sized)
               const offCanvas = document.createElement('canvas');
               const offCtx = offCanvas.getContext('2d')!;
               offCanvas.width = Math.floor(viewport.width * outputScale);
               offCanvas.height = Math.floor(viewport.height * outputScale);
   
               if (outputScale !== 1) {
                 offCtx.setTransform(outputScale, 0, 0, outputScale, 0, 0);
               }
   
               await page.render({ canvasContext: offCtx, viewport }).promise;
   
               // Compute vertical offset (in pixels) inside main canvas
               const yOffset = (p - 1) * offCanvas.height;
               mainCtx.drawImage(offCanvas, 0, yOffset);
             }
   
             containerEl.appendChild(mainCanvas);
           } else {
             // Single or default behavior: render one canvas per page (existing behavior)
             for (let p = 1; p <= numPages; p++) {
               const page = await pdf.getPage(p);
               const originalViewport = page.getViewport({ scale: 1.0 });
               const scale = canvasWidth / originalViewport.width;
               const viewport = page.getViewport({ scale });
   
               const canvas = document.createElement('canvas');
               const context = canvas.getContext('2d')!;
   
               canvas.width = Math.floor(viewport.width * outputScale);
               canvas.height = Math.floor(viewport.height * outputScale);
   
               // Keep canvas responsive and maintain aspect ratio
               canvas.style.display = 'block';
               canvas.style.margin = '2px auto 0';
               canvas.style.maxWidth = '95%';
               canvas.style.width = '95%';
               canvas.style.height = 'auto';
   
               if (outputScale !== 1) {
                 context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
               }
   
               await page.render({ canvasContext: context, viewport }).promise;
   
               containerEl.appendChild(canvas);
             }
           }
   
           // Safety guard: try to bring the container to the top of the viewport
           // Use a slight delay to allow layout to settle
           setTimeout(() => {
             try {
               // Preferred: bring container into view aligned to the top
               containerEl.scrollIntoView({ behavior: 'auto', block: 'start' });
   
               // If the canvas top is still offscreen, use a window scroll fallback
               const lastEl = containerEl.lastElementChild as HTMLElement | null;
               if (lastEl) {
                 const rect = lastEl.getBoundingClientRect();
                 if (rect.top < 0 || rect.top > window.innerHeight) {
                   const target = Math.max(0, window.scrollY + rect.top);
                   window.scrollTo({ top: target, behavior: 'smooth' });
                 }
               }
             } catch (e) {
               console.warn('Could not automatically align canvas to top:', e);
             }
           }, 50);
         } catch (error) {
           console.error('Error previewing PDF:', error);
         }
       }
  
    /**
     * Open PDF in native viewer (Android) or browser
     */
    async openPDF() {
      if (this.platform.is('hybrid') && this.platform.is('android')) {
        try {
          //Builds a filename using sessionId when available, otherwise uses a default.
          const fileName = this.sessionId ? `sample-${this.sessionId}.pdf` : 'sample.pdf';
          // Save into public Downloads so file managers can see it
          const filePath = await this.savePDF(fileName, true);

          //call FileOpener to open the saved PDF
          await this.fileOpener.open(filePath, 'application/pdf');
          console.log('PDF opened');
        } catch (err) {
          console.error('Open error', err);
        }
      } else {
        console.warn('Open PDF is only available on Android device.');
      }
    }
  
    /**
     * Save PDF to device storage
     */
    /**
     * Save PDF to device. If `usePublicDownloads` is true, attempt to save
     * to the public Downloads folder so the file is visible in file managers.
     */
    private async savePDF(fileName: string, usePublicDownloads = false): Promise<string> {
      try {
        //Generate PDF blob
        const blob = await this.generatePdfBlob();

        // Ensure permission for writing to external storage on older Android versions
        if (this.platform.is('android')) {
          try {
            const status = await this.androidPermissions.checkPermission(this.androidPermissions.PERMISSION.WRITE_EXTERNAL_STORAGE);
            if (!status.hasPermission) {
              await this.androidPermissions.requestPermission(this.androidPermissions.PERMISSION.WRITE_EXTERNAL_STORAGE);
            }
          } catch (permErr) {
            console.warn('Permission check/request failed in savePDF:', permErr);
          }
        }

        const publicDownloadDir = this.getPublicDownloadDirectory();
        const targetDir = usePublicDownloads && publicDownloadDir ? publicDownloadDir : this.file.externalDataDirectory;

        // Attempt to write to the chosen directory. If it fails, fallback to app 
        // external data dir.
        try {
          const fileEntry = await this.file.writeFile(targetDir, fileName, blob, { replace: true });
          // Prefer nativeURL if available
          return fileEntry.nativeURL || (targetDir + fileName);
        } catch (writeErr) {
          console.warn('Write to targetDir failed, falling back to externalDataDirectory:', writeErr);
          const fallbackEntry = await this.file.writeFile(this.file.externalDataDirectory, fileName, blob, { replace: true });
          return fallbackEntry.nativeURL || (this.file.externalDataDirectory + fileName);
        }
      } catch (err) {
        throw new Error(`Failed to save PDF: ${err}`);
      }
    }


     // Returns a best-effort path for the public Downloads directory.
     // Uses the Cordova File plugin's `externalRootDirectory` if present. or null if not available.
    private getPublicDownloadDirectory(): string | null {
      try {
        // some devices expose externalRootDirectory
        if ((this.file as any).externalRootDirectory) {
          return (this.file as any).externalRootDirectory + 'Download/';
        }
        return null;
      } catch (e) {
        return null;
      }
    }
  
  
    /**
     * Download PDF - Native save for Android, browser download for web
     */
    async downloadPDF() {
      if (this.platform.is('hybrid') && this.platform.is('android')) {
        // Android: Save to external storage
        try {
          const fileName = this.sessionId ? `sample-${this.sessionId}.pdf` : 'sample.pdf';
          // Save to public Downloads with fallbacks inside savePDF
          const savedPath = await this.savePDF(fileName, true);
          this.savedPdfPath = savedPath;
          console.log('PDF saved at', this.savedPdfPath);

          // Show success notification
          await this.showDownloadNotification(fileName);
        } catch (err) {
          console.error('Download error', err);
          await this.showErrorNotification('Failed to download PDF');
        }
      } else {
        // Browser: Trigger download
        const fileName = this.sessionId ? `sample-${this.sessionId}.pdf` : 'sample.pdf';
        const pdfDoc = pdfMake.createPdf(this.getDocumentDefinition());
        pdfDoc.download(fileName);
        // Show success message for web
        await this.showDownloadNotification('sample.pdf');
      }
    }

    /**
     * Show notification when PDF is successfully downloaded
     */
    private async showDownloadNotification(fileName: string) {
      try {
        if (this.platform.is('hybrid') && this.platform.is('android')) {
          // Request notification permission first
          const result = await LocalNotifications.requestPermissions();
          
          if (result.display === 'granted') {
            // Schedule notification with action to open PDF
            //with title, body, id and actionTypeId so the user 
            // sees the download success.
            await LocalNotifications.schedule({
              notifications: [
                {
                  title: '✓ PDF Downloaded',
                  body: `${fileName} has been successfully saved.`,
                  id: 1,
                  smallIcon: 'res://icon',
                  largeBody: `Your PDF file "${fileName}" has been downloaded and saved to your device storage.`,
                  autoCancel: true,
                  actionTypeId: 'pdf_download'
                }
              ]
            });

            // Listen for notification tap to open PDF, allow or PDF to be opened from notification
            LocalNotifications.addListener('localNotificationActionPerformed', (notification) => {
              if (notification.notification.id === 1 && this.savedPdfPath) {
                this.openDownloadedPDF();
              }
            });
          }
        } else {
          // Web: Show simple alert
          alert(`✓ ${fileName} has been successfully downloaded!`);
        }
      } catch (err) {
        console.error('Notification error', err);
      }
    }

    /**
     * Show error notification
     */
    private async showErrorNotification(message: string) {
      try {
        if (this.platform.is('hybrid') && this.platform.is('android')) {
          const result = await LocalNotifications.requestPermissions();
          
          if (result.display === 'granted') {
            await LocalNotifications.schedule({
              notifications: [
                {
                  title: '✗ Download Failed',
                  body: message,
                  id: 2,
                  smallIcon: 'res://icon',
                  autoCancel: true
                }
              ]
            });
          }
        } else {
          alert(`✗ ${message}`);
        }
      } catch (err) {
        console.error('Error notification failed', err);
      }
    }

    /**
     * Print the current session objects (sessionId and sessionImages) to the console
     * This helps debugging when entering the page to see what data was passed.
     */
    private printSessionObjects(): void {
      try {
        console.log('--- Session Objects ---');
        console.log('sessionId:', this.sessionId);
        if (this.sessionImages && this.sessionImages.length > 0) {
          console.log(`sessionImages (${this.sessionImages.length}):`);
          this.sessionImages.forEach((img: any, idx: number) => {
            try {
              console.log(` [${idx}]`, img);
            } catch (e) {
              console.log(` [${idx}] <unserializable>`);
            }
          });
        } else {
          console.log('sessionImages: none');
        }
        console.log('-----------------------');
      } catch (err) {
        console.warn('Error while printing session objects:', err);
      }
    }

     // Open the downloaded PDF

    private async openDownloadedPDF() {
      try {
        if (this.savedPdfPath) {
          await this.fileOpener.open(this.savedPdfPath, 'application/pdf');
          console.log('Downloaded PDF opened');
        }
      } catch (err) {
        console.error('Error opening downloaded PDF', err);
      }
    }

    onBack() {
    this.goBack();
  }

  goBack() {
    try {
      // Try to navigate back in app history (preferred) or app level back navigation if from camera , upload or home
      try { this.navCtrl.back(); return; } catch (e) { /* ignore and fallback */ }

      // Fallback to browser history.back when navController isn't effective, 
      // checks the browser history for fallback
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
    
      // Final fallback: navigate to home page
      this.router.navigateByUrl('/home-page');
    } catch (e) {
      try { window.history.back(); } catch (err) { /* no-op */ }
    }
  }

}

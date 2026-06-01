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
  private headerLogoDataUrl: string | null = null;
    // Images passed via navigation state or history.state
    sessionImages: any[] = [];
    showSessionLoadingWindow: boolean = false;
    sessionLoadingMessage: string = 'Fetching S3 images...';
    sessionLoadingDetail: string = 'Preparing session images';
    sessionLoadingCompleted: number = 0;
    sessionLoadingTotal: number = 0;
    sessionLoadingError: string = '';
    sessionLoadingHasError: boolean = false;
    private sessionLoadingWindowTimer: any;
    showPdfGenerationWindow: boolean = false;
    pdfGenerationMessage: string = 'Generating PDF page';
    pdfGenerationDetail: string = 'Please wait while the PDF is being generated';
    private pdfGenerationWindowTimer: any;
  
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
      
      // Retrieve and log session data from sessionStorage for debugging
      this.retrieveAndLogSessionFromStorage();

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

        // Try to obtain passed images from multiple sources (in order of priority):
        // 1. sessionStorage (sorted from feedback-page)
        // 2. Navigation extras state
        // 3. History state
        // 4. ImageStorageService by sessionId
        try {
          // First, try sessionStorage (contains sorted images from feedback-page)
          let imagesLoaded = false;
          try {
            const storedData = sessionStorage.getItem('feedbackPageSession');
            if (storedData) {
              const parsed = JSON.parse(storedData);
              if (parsed.imagePaths && Array.isArray(parsed.imagePaths) && parsed.imagePaths.length > 0) {
                this.sessionImages = parsed.imagePaths;
                console.log('[PDF ngOnInit] Loaded session images from sessionStorage (sorted, descending):', this.sessionImages.length, 'images');
                imagesLoaded = true;
              }
            }
          } catch (e) {
            console.warn('[PDF ngOnInit] Failed to load images from sessionStorage:', e);
          }

          // If sessionStorage didn't provide images, try navigation/history state
          if (!imagesLoaded) {
            //Attempts to read images passed via Angular Router navigation extras 
            //(this.router.getCurrentNavigation()?.extras?.state). If present, stores them in sessionImages.
            const navImages = this.router.getCurrentNavigation()?.extras?.state as any;
            if (navImages && navImages.images) {
              this.sessionImages = navImages.images;
              console.log('Loaded session images from navigation state:', this.sessionImages.length);
              imagesLoaded = true;
            } else {
              //If navigation extras didn't provide images, check the 
              // browser/history state (window.history.state) for an images property and use it if found.
              const hist = (window as any).history?.state || {};
              if (hist && hist.images) {
                this.sessionImages = hist.images;
                console.log('Loaded session images from history.state:', this.sessionImages.length);
                imagesLoaded = true;
              }
            }
          }

          // If still no images, try loading from service by sessionId
          if (!imagesLoaded && this.sessionId) {
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
        } catch (e) {
          console.warn('Could not read images from any source', e);
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
    if (this.sessionLoadingWindowTimer) {
      clearTimeout(this.sessionLoadingWindowTimer);
      this.sessionLoadingWindowTimer = null;
    }
    this.showSessionLoadingWindow = false;
    if (this.pdfGenerationWindowTimer) {
      clearTimeout(this.pdfGenerationWindowTimer);
      this.pdfGenerationWindowTimer = null;
    }
    this.showPdfGenerationWindow = false;
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

  private getPdfGenerationMessage(): string {
    const imageCount = Array.isArray(this.sessionImages) ? this.sessionImages.length : 0;
    return imageCount > 1 ? 'Generating PDF pages' : 'Generating PDF page';
  }

  private async runPdfGenerationWindow<T>(task: () => Promise<T>, minimumDurationMs: number = 350): Promise<T> {
    if (this.pdfGenerationWindowTimer) {
      clearTimeout(this.pdfGenerationWindowTimer);
      this.pdfGenerationWindowTimer = null;
    }

    this.showPdfGenerationWindow = true;
    this.pdfGenerationMessage = this.getPdfGenerationMessage();
    this.pdfGenerationDetail = 'Please wait while the PDF is being generated';

    const startedAt = Date.now();
    let result: T;

    try {
      result = await task();
    } finally {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, minimumDurationMs - elapsed);

      this.pdfGenerationWindowTimer = setTimeout(() => {
        this.showPdfGenerationWindow = false;
        this.pdfGenerationMessage = 'Generating PDF page';
        this.pdfGenerationDetail = 'Please wait while the PDF is being generated';
        this.pdfGenerationWindowTimer = null;
      }, remaining);
    }

    return result;
  }

  /**
   * Retrieve and log session data from sessionStorage for debugging.
   * Uses this data for PDF generation if available.
   * Images are retrieved in descending order as stored.
   */
  private retrieveAndLogSessionFromStorage(): void {
    try {
      const sessionData = sessionStorage.getItem('feedbackPageSession');
      if (sessionData) {
        const parsed = JSON.parse(sessionData);
        console.group('[PdfPageTest03] 📋 Retrieved session from sessionStorage (descending order)');
        console.log('Session ID:', parsed.selectedSessionId);
        console.log('Image count:', parsed.imageCount);
        console.log('Timestamp:', parsed.timestamp);
        if (parsed.imagePaths && Array.isArray(parsed.imagePaths)) {
          console.log('Image order:', parsed.imagePaths.map((img: any, i: number) => `${i}: ${img.filename || 'unnamed'}`).join(', '));
        }
        console.log('Full session data:', parsed);
        console.groupEnd();
      } else {
        console.log('[PdfPageTest03] No session data found in sessionStorage');
      }
    } catch (err) {
      console.warn('[PdfPageTest03] Failed to retrieve session from sessionStorage', err);
    }
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

    /**
     * Calculate dynamic image height based on actual image dimensions
     * Maintains aspect ratio while constraining width to 250
     * If dimensions not available, defaults to 333 (approximately 4:3 ratio with width=250)
     */
    private calculateDynamicImageHeight(img: any): number {
      try {
        // Try to get image dimensions from various possible properties
        const width = img?.width || img?.originalWidth || img?.imgWidth || null;
        const height = img?.height || img?.originalHeight || img?.imgHeight || null;

        // If both dimensions are available and non-zero, calculate proportional height
        if (width && height && width > 0 && height > 0) {
          const aspectRatio = height / width;
          const constrainedWidth = 250;
          const calculatedHeight = Math.round(constrainedWidth * aspectRatio);
          console.log(`[PDF] Calculated height: ${calculatedHeight} (from ${width}x${height}, ratio: ${aspectRatio.toFixed(2)})`);
          // Ensure height is reasonable (between 100 and 600)
          return Math.max(100, Math.min(600, calculatedHeight));
        }

        // Fallback: if no dimensions, use default height of 333 (4:3 aspect ratio with width=250)
        console.log('[PDF] No image dimensions available, using default height of 333');
        return 333;
      } catch (err) {
        console.warn('[PDF] Error calculating image height:', err);
        return 333; // safe fallback
      }
    }

    /**
     * pdfMake requires a real image source; empty strings are invalid.
     * Use the provided fallback whenever the source is missing or blank.
     */
    private normalizePdfImageSource(source: any, fallback: string): string {
      if (typeof source === 'string' && source.trim().length > 0) {
        return source;
      }

      return fallback;
    }

    private async ensureHeaderLogoDataUrl(): Promise<string> {
      if (this.headerLogoDataUrl) {
        return this.headerLogoDataUrl;
      }

      try {
        this.headerLogoDataUrl = await this.ensureImageDataUrl('assets/DamageLogo2.png');
      } catch (err) {
        console.warn('[PDF] Failed to load header logo, using text-only title', err);
        this.headerLogoDataUrl = '';
      }

      return this.headerLogoDataUrl;
    }

    /**
     * Extract original image from image object with multiple property variations
     */
    private extractOriginalImage(img: any): string | null {
      if (!img) return null;

      // Try various property names for original/plain image
      const candidates = [
        img?.original,
        img?.originalImage,
        img?.originalImg,
        img?.plain,
        img?.plainImage,
        img?.image,
        img?.img
      ];

      for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
          console.log('[PDF] Found original image:', candidate.substring(0, 50) + '...');
          return candidate;
        }
      }

      console.warn('[PDF] No original image found. Tried properties:', Object.keys(img).slice(0, 10).join(', '));
      return null;
    }

    /**
     * Extract boxed/with-boxes image from image object with multiple property variations
     */
    private extractBoxedImage(img: any): string | null {
      if (!img) return null;

      // Try various property names for boxed/with-boxes image
      const candidates = [
        img?.withBoxes,
        img?.withBoxesImage,
        img?.withBoxesImg,
        img?.boxed,
        img?.boxedImage,
        img?.boxedImg,
        img?.boxImage,
        img?.detectionImage,
        img?.annotatedImage
      ];

      for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
          console.log('[PDF] Found boxed image:', candidate.substring(0, 50) + '...');
          return candidate;
        }
      }

      console.warn('[PDF] No boxed image found. Tried properties:', Object.keys(img).slice(0, 10).join(', '));
      return null;
    }

    private getPdfFilenameBase(filename: string): string {
      const normalized = (filename || '').toLowerCase().replace(/\\/g, '/');
      const lastPathPart = normalized.split('/').pop() || normalized;
      const queryless = lastPathPart.split('?')[0];
      return queryless.replace(/\.[a-z0-9]+$/i, '');
    }

    private getPdfImageGroupInfo(img: any): { groupIndex: number; isOriginal: boolean; cropIndex: number | null; filename: string } {
      const filename = (img?.filename || img?.fileName || img?.originalS3Key || img?.storagePath || '').toString();
      const base = this.getPdfFilenameBase(filename);
      const match = base.match(/img(\d+)(original|cropped(\d+)?)/i);

      if (!match) {
        return { groupIndex: -1, isOriginal: false, cropIndex: null, filename };
      }

      const groupIndex = Number(match[1]);
      const variant = (match[2] || '').toLowerCase();
      const cropIndex = variant.startsWith('cropped') ? Number(match[3] || 0) : null;

      return {
        groupIndex: Number.isFinite(groupIndex) ? groupIndex : -1,
        isOriginal: variant.startsWith('original'),
        cropIndex: Number.isFinite(cropIndex as number) ? cropIndex : null,
        filename
      };
    }

    private isPdfCroppedImage(img: any): boolean {
      const filename = (img?.filename || img?.fileName || img?.originalS3Key || img?.storagePath || '').toString();
      return /cropped/i.test(filename);
    }

    private getGroupedSessionImagesForPdf(logGroups: boolean = false): any[] {
      const sourceImages = Array.isArray(this.sessionImages) ? [...this.sessionImages] : [];
      const grouped = new Map<number, any[]>();
      const ungrouped: any[] = [];

      for (const img of sourceImages) {
        const info = this.getPdfImageGroupInfo(img);
        if (info.groupIndex < 0) {
          ungrouped.push({ img, info });
          continue;
        }

        const bucket = grouped.get(info.groupIndex) || [];
        bucket.push({ img, info });
        grouped.set(info.groupIndex, bucket);
      }

      const sortedGroupKeys = Array.from(grouped.keys()).sort((a, b) => b - a);
      const sortedImages: any[] = [];

      if (logGroups) {
        console.group('[PDF] Session image groups (reverse img order)');
      }

      for (const groupKey of sortedGroupKeys) {
        const bucket = grouped.get(groupKey) || [];
        bucket.sort((left, right) => {
          if (left.info.isOriginal !== right.info.isOriginal) {
            return left.info.isOriginal ? -1 : 1;
          }

          if (left.info.isOriginal && right.info.isOriginal) {
            return (left.info.filename || '').localeCompare(right.info.filename || '');
          }

          const leftCrop = left.info.cropIndex ?? Number.MAX_SAFE_INTEGER;
          const rightCrop = right.info.cropIndex ?? Number.MAX_SAFE_INTEGER;
          if (leftCrop !== rightCrop) {
            return leftCrop - rightCrop;
          }

          return (left.info.filename || '').localeCompare(right.info.filename || '');
        });

        if (logGroups) {
          console.group(`img${groupKey}`);
          bucket.forEach((entry, index) => {
            const label = entry.info.isOriginal ? 'original' : `cropped${entry.info.cropIndex ?? ''}`;
            console.log(`${index + 1}. ${label}`, entry.info.filename || '(unnamed)', entry.img);
          });
          console.groupEnd();
        }

        sortedImages.push(...bucket.map(entry => entry.img));
      }

      if (ungrouped.length > 0) {
        ungrouped.sort((left, right) => (left.info.filename || '').localeCompare(right.info.filename || ''));
        if (logGroups) {
          console.group('ungrouped');
          ungrouped.forEach((entry, index) => {
            console.log(`${index + 1}.`, entry.info.filename || '(unnamed)', entry.img);
          });
          console.groupEnd();
        }
        sortedImages.push(...ungrouped.map(entry => entry.img));
      }

      if (logGroups) {
        console.groupEnd();
      }

      return sortedImages;
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
          const headerLogo = this.headerLogoDataUrl || '';
    
          const content: Content[] = [];

          // Title appears only once at the beginning of the PDF.
          if (headerLogo) {
            content.push({ image: headerLogo, width: 220, alignment: 'center', margin: [0, 0, 0, 30] });
          }
    
          // If sessionImages exist, create one page per image with page breaks
          const sessionImages = this.getGroupedSessionImagesForPdf();

          if (sessionImages.length > 0) {
            sessionImages.forEach((img: any, idx: number) => {
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
    
              const isCropped = this.isPdfCroppedImage(img);

              // caption text
              content.push({
                text: isCropped ? `Img ${i} original` : `Img ${i} without boxes and img ${i} with boxes`,
                alignment: 'center',
                margin: [0, 0, 0, 12],
                fontSize: 12,
                italics: true
              });

              // Extract images with comprehensive property checking
              const extractedOriginal = this.extractOriginalImage(img);
              const extractedBoxed = isCropped ? null : this.extractBoxedImage(img);
              
              const originalImg = extractedOriginal ? this.normalizePdfImageSource(extractedOriginal, imgPlainFallback) : imgPlainFallback;

              // Log the result of extracting images for debugging/verification
              console.log(`[PDF] Image ${i} extraction - original: ${extractedOriginal ? 'found' : 'FALLBACK'}, boxed: ${isCropped ? 'SKIPPED (cropped image)' : (extractedBoxed ? 'found' : 'FALLBACK')}`);
              this.logImageProcessingResult(i, !!extractedOriginal, !isCropped && !!extractedBoxed, type, shape, severity);

              // Calculate dynamic height based on image dimensions
              const imgHeight = this.calculateDynamicImageHeight(img);

              if (isCropped) {
                const croppedInfoTable: Content = {
                  table: {
                    widths: [92, '*'],
                    body: [
                      [
                        { text: 'Shape:', bold: false, alignment: 'left', margin: [12, 12, 10, 12] as [number, number, number, number] },
                        { text: String(shape), alignment: 'center', margin: [10, 12, 12, 12] as [number, number, number, number] }
                      ],
                      [
                        { text: 'Type:', bold: false, alignment: 'left', margin: [12, 12, 10, 12] as [number, number, number, number] },
                        { text: String(type), alignment: 'center', margin: [10, 12, 12, 12] as [number, number, number, number] }
                      ],
                      [
                        { text: 'Severity:', bold: false, alignment: 'left', margin: [12, 12, 10, 12] as [number, number, number, number] },
                        { text: String(severity), alignment: 'center', margin: [10, 12, 12, 12] as [number, number, number, number] }
                      ]
                    ]
                  },
                  layout: {
                    hLineWidth: (index: number, node: any) => 2,
                    vLineWidth: (index: number, node: any) => 2,
                    hLineColor: () => '#222222',
                    vLineColor: () => '#222222',
                    paddingLeft: () => 0,
                    paddingRight: () => 0,
                    paddingTop: () => 0,
                    paddingBottom: () => 0
                  },
                  margin: [0, 18, 0, 0] as [number, number, number, number]
                };

                content.push(({
                  columns: [
                    { image: originalImg, width: 250, height: imgHeight, alignment: 'center' },
                    { width: '*' as const, stack: [croppedInfoTable], margin: [18, 0, 0, 0] as [number, number, number, number] }
                  ],
                  columnGap: 10,
                  margin: [0, 0, 0, 20] as [number, number, number, number]
                } as Content));
              } else {
                const withBoxesImg = extractedBoxed ? this.normalizePdfImageSource(extractedBoxed, imgBoxFallback) : imgBoxFallback;
                const withBoxesHeight = this.calculateDynamicImageHeight({
                  ...img,
                  width: img?.withBoxesWidth,
                  height: img?.withBoxesHeight
                });

                // images as two columns with dynamic heights
                content.push({
                  columns: [
                    { image: originalImg, width: 250, height: imgHeight, alignment: 'center' },
                    { image: withBoxesImg, width: 250, height: withBoxesHeight, alignment: 'center' }
                  ],
                  columnGap: 10,
                  margin: [0, 0, 0, 20]
                });
              }

              // Add page break after each image section (except the last one)
              if (idx < sessionImages.length - 1) {
                content.push({ text: '', pageBreak: 'after', margin: [0, 0, 0, 0] });
              }
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
     
    private async generatePdfBlob(): Promise<Blob> {

      // Ensure any image sources that are not data URLs are converted
      // to base64 data URLs and their dimensions measured so pdfMake
      // renders them correctly (especially `withBoxes` images).
      const originalSessionImages = this.sessionImages;
      try {
        const sessionImages = this.getGroupedSessionImagesForPdf(true);
        if (Array.isArray(sessionImages) && sessionImages.length > 0) {
          const processed: any[] = [];
          for (const img of sessionImages) {
            try {
              const isCropped = this.isPdfCroppedImage(img);
              const extractedOriginal = this.extractOriginalImage(img);
              const extractedBoxed = isCropped ? null : this.extractBoxedImage(img);

              const originalData = extractedOriginal ? await this.ensureImageDataUrl(extractedOriginal) : null;
              let boxedData = extractedBoxed ? await this.ensureImageDataUrl(extractedBoxed) : null;

              if (isCropped) {
                boxedData = null;
              }

              if (!isCropped && (!boxedData || boxedData.trim().length === 0) && (img?.withBoxesS3Key || img?.withBoxesStoragePath || img?.withBoxesS3Url || img?.withBoxesStorageUrl)) {
                const boxedCandidate = img?.withBoxesS3Key || img?.withBoxesStoragePath || img?.withBoxesS3Url || img?.withBoxesStorageUrl;
                try {
                  const fetchedBoxed = await this.imageStorage.fetchS3ObjectAsDataUrl(boxedCandidate);
                  if (fetchedBoxed) {
                    boxedData = fetchedBoxed;
                  }
                } catch (e) {
                  console.warn('[PDF] Failed to hydrate withBoxes from S3 key', boxedCandidate, e);
                }
              }

              // If boxedData still missing but boxes exist, try to generate an annotated image from the original
              if (!isCropped && (!boxedData || boxedData.trim().length === 0) && img?.boxes && img.boxes.length > 0 && originalData) {
                try {
                  const generated = await this.createWithBoxesDataUrl(originalData, img.boxes);
                  if (generated) {
                    boxedData = generated;
                    // try to persist back to storage so downstream pages can reuse
                    try {
                      const key = img.filename || img.original || img.storagePath || img.originalS3Key || '';
                      if (key) {
                        const existingEntry: any = this.imageStorage.getEntryForImage(key) || {};
                        const mergedEntry: any = {
                          ...existingEntry,
                          withBoxes: generated
                        };
                        await this.imageStorage.setEntryForImage(key, mergedEntry);
                      }
                    } catch (e) {
                      console.warn('[PDF] Failed to persist generated withBoxes for', img.filename, e);
                    }
                  }
                } catch (e) {
                  console.warn('[PDF] createWithBoxesDataUrl failed', e);
                }
              }

              // Measure dimensions if we have data URLs
              const dimsOriginal = originalData ? await this.getImageDimensions(originalData).catch(() => null) : null;
              const dimsBoxed = boxedData ? await this.getImageDimensions(boxedData).catch(() => null) : null;

              const copy = { ...img };
              if (originalData) copy.original = originalData;
              if (boxedData && !isCropped) copy.withBoxes = boxedData;
              if (dimsOriginal) {
                copy.originalWidth = dimsOriginal.width;
                copy.originalHeight = dimsOriginal.height;
              }
              if (dimsBoxed) {
                copy.withBoxesWidth = dimsBoxed.width;
                copy.withBoxesHeight = dimsBoxed.height;
              }

              processed.push(copy);
            } catch (e) {
              console.warn('Failed processing an image for PDF generation', e);
              processed.push(img);
            }
          }

          // Temporarily replace sessionImages used by getDocumentDefinition
          this.sessionImages = processed;
        }

        await this.ensureHeaderLogoDataUrl();

        // Build PDF and return blob
        const pdfDoc = pdfMake.createPdf(this.getDocumentDefinition());
        const blob: Blob = await new Promise((resolve, reject) => {
          try {
            pdfDoc.getBlob((b: Blob) => resolve(b));
          } catch (err) {
            reject(err);
          }
        });

        return blob;
      } finally {
        // Restore original sessionImages to avoid side-effects
        this.sessionImages = originalSessionImages;
      }
    }

    /**
     * Convert a URL/blob/file-like source to a base64 data URL when needed.
     * If source is already a data URL, it's returned unchanged.
     */
    private async ensureImageDataUrl(src: string): Promise<string> {
      try {
        if (!src || typeof src !== 'string') throw new Error('invalid-src');

        // Already a data URL
        if (src.startsWith('data:')) return src;

        // blob: or http(s) or relative path - try fetching
        try {
          const resp = await fetch(src);
          if (!resp.ok) throw new Error('fetch-failed');
          const blob = await resp.blob();
          return await this.blobToDataURL(blob);
        } catch (e) {
          // Fetch may fail for file:// or platform-specific paths. Try fallback: if string contains base64 payload
          const base64Match = src.match(/base64,(.*)$/);
          if (base64Match) return 'data:image/png;base64,' + base64Match[1];
          // As final fallback return the original string so downstream code may still attempt to use it
          return src;
        }
      } catch (err) {
        console.warn('ensureImageDataUrl failed for src:', src, err);
        return src;
      }
    }

    private blobToDataURL(blob: Blob): Promise<string> {
      return new Promise((resolve, reject) => {
        try {
          const reader = new FileReader();
          reader.onloadend = () => {
            resolve(reader.result as string);
          };
          reader.onerror = (e) => reject(e);
          reader.readAsDataURL(blob);
        } catch (e) {
          reject(e);
        }
      });
    }

    private getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
      return new Promise((resolve, reject) => {
        try {
          const img = new Image();
          img.onload = () => {
            resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
          };
          img.onerror = (e) => reject(e);
          img.src = dataUrl;
        } catch (e) {
          reject(e);
        }
      });
    }

    /**
     * Check if a rendered canvas is blank (mostly white/empty pixels)
     * Useful for detecting pages with no content or images
     */
    private isCanvasBlank(canvas: HTMLCanvasElement, threshold: number = 0.95): boolean {
      try {
        const ctx = canvas.getContext('2d');
        if (!ctx) return true;
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        let whitePixels = 0;
        // Check RGBA values - count pixels that are nearly white (R≈255, G≈255, B≈255)
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          if (r > 240 && g > 240 && b > 240) {
            whitePixels++;
          }
        }
        
        const totalPixels = data.length / 4;
        const whitenessRatio = whitePixels / totalPixels;
        
        // Page is blank if more than threshold% is white
        return whitenessRatio > threshold;
      } catch (err) {
        console.warn('[PDF] Error analyzing canvas for blank pages:', err);
        return false;
      }
    }

    /**
     * Check PDF pages for blank content
     * Returns array of page numbers that are blank (1-indexed)
     */
    private async checkBlankPages(pdfBytes: Uint8Array): Promise<number[]> {
      try {
        const loadingTask = getDocument({ data: pdfBytes });
        const pdf = await loadingTask.promise;
        const numPages = pdf.numPages || 0;
        const blankPages: number[] = [];
        const screenWidth = window.innerWidth;
        const canvasWidth = screenWidth * 0.95;
        const outputScale = window.devicePixelRatio || 1;

        for (let p = 1; p <= numPages; p++) {
          try {
            const page = await pdf.getPage(p);
            const originalViewport = page.getViewport({ scale: 1.0 });
            const scale = canvasWidth / originalViewport.width;
            const viewport = page.getViewport({ scale });

            const testCanvas = document.createElement('canvas');
            const testCtx = testCanvas.getContext('2d')!;
            testCanvas.width = Math.floor(viewport.width * outputScale);
            testCanvas.height = Math.floor(viewport.height * outputScale);

            if (outputScale !== 1) {
              testCtx.setTransform(outputScale, 0, 0, outputScale, 0, 0);
            }

            await page.render({ canvasContext: testCtx, viewport }).promise;

            if (this.isCanvasBlank(testCanvas)) {
              blankPages.push(p);
              console.warn(`[PDF] Page ${p} detected as blank`);
            }
          } catch (err) {
            console.warn(`[PDF] Error checking page ${p} for blank content:`, err);
          }
        }

        return blankPages;
      } catch (err) {
        console.warn('[PDF] Error checking blank pages:', err);
        return [];
      }
    }

    // Create an annotated copy of an original data URL by drawing boxes on a canvas.
    private async createWithBoxesDataUrl(originalDataUrl: string, boxes: any[]): Promise<string> {
      return new Promise((resolve) => {
        try {
          const img = new Image();
          img.crossOrigin = 'Anonymous';
          img.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = img.width;
              canvas.height = img.height;
              const ctx = canvas.getContext('2d');
              if (!ctx) return resolve(originalDataUrl);
              ctx.drawImage(img, 0, 0);
              ctx.lineWidth = Math.max(2, Math.round(Math.min(img.width, img.height) * 0.01));
              ctx.strokeStyle = 'rgba(255,0,0,0.9)';
              ctx.fillStyle = 'rgba(255,0,0,0.12)';
              (boxes || []).forEach((b: any) => {
                let x = b.x ?? b.left ?? 0;
                let y = b.y ?? b.top ?? 0;
                let w = b.w ?? b.width ?? b.wid ?? 0;
                let h = b.h ?? b.height ?? b.hei ?? 0;
                if (x <= 1 && y <= 1 && w <= 1 && h <= 1) {
                  x = x * img.width;
                  y = y * img.height;
                  w = w * img.width;
                  h = h * img.height;
                }
                ctx.strokeRect(x, y, w, h);
                ctx.fillRect(x, y, w, h);
              });
              const dataUrl = canvas.toDataURL('image/png');
              resolve(dataUrl);
            } catch (e) {
              console.warn('[PDF] canvas draw failed', e);
              resolve(originalDataUrl);
            }
          };
          img.onerror = () => resolve(originalDataUrl);
          img.src = originalDataUrl;
        } catch (e) {
          console.warn('[PDF] createWithBoxesDataUrl top-level error', e);
          resolve(originalDataUrl);
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
           let containerEl: HTMLDivElement | null = null;

           await this.runPdfGenerationWindow(async () => {
             await this.ensureHeaderLogoDataUrl();
            this.getGroupedSessionImagesForPdf(true);
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

             // Check for blank pages in the background so preview rendering is not blocked.
             void this.checkBlankPages(pdfBytes).then((blankPages) => {
               if (blankPages.length > 0) {
                 console.warn(`[PDF Preview] ${blankPages.length} blank page(s) detected:`, blankPages);
               }
             }).catch((err) => {
               console.warn('[PDF Preview] Blank page scan failed:', err);
             });

             const loadingTask = getDocument({ data: pdfBytes });
             const pdf = await loadingTask.promise;
       
             const numPages = pdf.numPages || 1;
             containerEl = this.pdfContainer.nativeElement as HTMLDivElement;
             containerEl.style.paddingTop = '0px';
             containerEl.style.display = 'flex';
             containerEl.style.flexDirection = 'column';
             containerEl.style.alignItems = 'center';
             containerEl.style.justifyContent = 'flex-start';
             containerEl.style.gap = '12px';
             containerEl.innerHTML = '';
     
             // Determine device width once
             const screenWidth = window.innerWidth;
             const canvasWidth = screenWidth * 0.95;
     
             const outputScale = window.devicePixelRatio || 1;

             // Render each page individually to keep page count and display stable.
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

               const pageWrapper = document.createElement('div');
               pageWrapper.style.display = 'flex';
               pageWrapper.style.width = '100%';
               pageWrapper.style.justifyContent = 'center';
               pageWrapper.style.alignItems = 'center';
               pageWrapper.appendChild(canvas);

               if (outputScale !== 1) {
                 context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
               }

               await page.render({ canvasContext: context, viewport }).promise;

               containerEl.appendChild(pageWrapper);
             }
           }, 350);
   
           // Safety guard: try to bring the container to the top of the viewport
           // Use a slight delay to allow layout to settle
           setTimeout(() => {
             try {
               if (!containerEl) {
                 return;
               }

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
        const blob = await this.runPdfGenerationWindow(() => this.generatePdfBlob(), 350);

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
     * Checks for blank pages before downloading
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
        await this.runPdfGenerationWindow(async () => {
          const pdfDoc = pdfMake.createPdf(this.getDocumentDefinition());
          pdfDoc.download(fileName);
        }, 350);
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
              // Log available properties to help diagnose missing images
              if (img && typeof img === 'object') {
                const props = Object.keys(img).join(', ');
                console.log(` [${idx}] properties:`, props);
              }
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

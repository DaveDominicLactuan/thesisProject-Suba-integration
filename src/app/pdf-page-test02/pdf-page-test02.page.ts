
// src/app/pages/pdf-preview/pdf-preview.page.ts
import { Component, ViewChild, ElementRef,OnInit } from '@angular/core';
import { PDFDocument } from 'pdf-lib';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Platform } from '@ionic/angular';
import * as pdfjsLib from 'pdfjs-dist';
import { getDocument } from 'pdfjs-dist';
import { AndroidPermissions } from '@awesome-cordova-plugins/android-permissions/ngx';
import { FileOpener } from '@awesome-cordova-plugins/file-opener/ngx';
import * as pdfMake from 'pdfmake/build/pdfmake';
import * as pdfFonts from 'pdfmake/build/vfs_fonts';
import { File } from '@awesome-cordova-plugins/file/ngx';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';

(pdfjsLib as any).GlobalWorkerOptions.workerSrc = `./assets/pdf.worker.min.js`;
(pdfMake as any).vfs = (pdfFonts as { vfs: any }).vfs;


@Component({
  selector: 'app-pdf-page-test02',
  templateUrl: './pdf-page-test02.page.html',
  styleUrls: ['./pdf-page-test02.page.scss'],
  standalone: false
})
export class PdfPageTest02Page {
  @ViewChild('pdfContainer', { static: true }) pdfContainer!: ElementRef<HTMLDivElement>;
  pdfSrc: SafeResourceUrl | null = null;
  private backButtonSub: any; // hardware back handler

  constructor(
    private platform: Platform,
    private androidPermissions: AndroidPermissions,
    private fileOpener: FileOpener,
    private file: File,
    private sanitizer: DomSanitizer,
  ) {}

  async ngOnInit() {

    await this.platform.ready();

    console.log('Platform:', this.platform.platforms());

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

  

    // this.generatePdf;
    this.previewPdf();
    }
  }  

  /**
   * Consolidated PDF document definition using pdfMake
   * This is the single source of truth for all PDF content
   */
  private getDocumentDefinition(): TDocumentDefinitions {
    // Placeholder base64 images - replace these with your actual crack images
    const imgPlain = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const imgBox = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const content: Content[] = [
      {
        text: 'Crack',
        style: 'header',
        alignment: 'center',
        margin: [0, 0, 0, 0]
      },
      {
        text: 'Damage',
        style: 'header',
        alignment: 'center',
        margin: [0, 0, 0, 0]
      },
      {
        text: 'Report',
        style: 'header',
        alignment: 'center',
        margin: [0, 0, 0, 30]
      },
      {
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
      },
      {
        text: 'Img 1 without boxes and img 2 with boxes',
        alignment: 'center',
        margin: [0, 0, 0, 20],
        fontSize: 12,
        italics: true
      },
      {
        columns: [
          {
            image: imgPlain,
            width: 250,
            alignment: 'center'
          },
          {
            image: imgBox,
            width: 250,
            alignment: 'center'
          }
        ],
        columnGap: 10
      }
    ];

    return {
      pageSize: 'A4',
      pageMargins: [40, 60, 40, 60],
      content,
      styles: {
        header: {
          fontSize: 24,
          bold: true,
          color: '#000000'
        }
      }
    };
  }

  /**
   * Generate PDF blob for preview purposes
   * Returns a promise that resolves to a Blob
   */
  private generatePdfBlob(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      try {
        const pdfDoc = pdfMake.createPdf(this.getDocumentDefinition());
        pdfDoc.getBlob((blob: Blob) => resolve(blob));
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Generate PDF as base64 for web preview
   * Returns a promise that resolves to base64 string
   */
  private generatePdfBase64(): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const pdfDoc = pdfMake.createPdf(this.getDocumentDefinition());
        pdfDoc.getBase64((base64: string) => resolve(base64));
      } catch (error) {
        reject(error);
      }
    });
  }
  

  /**
   * Preview PDF in canvas (for web) or render from blob
   */
  async previewPdf() {
    try {
      const blob = await this.generatePdfBlob();
      const arrayBuffer = await blob.arrayBuffer();
      const pdfBytes = new Uint8Array(arrayBuffer);
      
      const loadingTask = getDocument({ data: pdfBytes });
      const pdf = await loadingTask.promise;

      const page = await pdf.getPage(1);
      
      // Get device screen dimensions
      const screenWidth = window.innerWidth;
      
      // Set canvas width to 95% of device width
      const canvasWidth = screenWidth * 0.95;
      
      // Get the original viewport to calculate aspect ratio
      const originalViewport = page.getViewport({ scale: 1.0 });
      
      // Calculate scale based on 95% of screen width
      const scale = canvasWidth / originalViewport.width;
      
      // Apply the calculated scale
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({ canvasContext: context, viewport }).promise;

      this.pdfContainer.nativeElement.innerHTML = '';
      this.pdfContainer.nativeElement.appendChild(canvas);
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
        const filePath = await this.savePDF('sample.pdf');
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
  private async savePDF(fileName: string): Promise<string> {
    try {
      const blob = await this.generatePdfBlob();
      const fileEntry = await this.file.writeFile(
        this.file.externalDataDirectory, 
        fileName, 
        blob, 
        { replace: true }
      );
      return this.file.externalDataDirectory + fileName;
    } catch (err) {
      throw new Error(`Failed to save PDF: ${err}`);
    }
  }

    


  /**
   * Preview PDF - Native viewer for Android, inline viewer for web
   */
  async previewPDF2() {
    if (this.platform.is('hybrid') && this.platform.is('android')) {
      // Android: Save to cache and open in native PDF viewer
      try {
        const blob = await this.generatePdfBlob();
        const fileName = 'preview.pdf';
        const fileEntry = await this.file.writeFile(
          this.file.cacheDirectory, 
          fileName, 
          blob, 
          { replace: true }
        );
        console.log('PDF saved for native preview at:', fileEntry.nativeURL);
        await this.fileOpener.open(fileEntry.nativeURL, 'application/pdf');
        console.log('Native PDF preview opened');
      } catch (err) {
        console.error('Error with native PDF preview:', err);
      }
    } else {
      // Browser: Show inline Base64 preview
      try {
        const base64 = await this.generatePdfBase64();
        const pdfBase64 = `data:application/pdf;base64,${base64}`;
        this.pdfSrc = this.sanitizer.bypassSecurityTrustResourceUrl(pdfBase64);
        console.log('Browser PDF preview loaded');
      } catch (err) {
        console.error('Error loading browser PDF preview:', err);
      }
    }
  }

  /**
   * Download PDF - Native save for Android, browser download for web
   */
  async downloadPDF() {
    if (this.platform.is('hybrid') && this.platform.is('android')) {
      // Android: Save to external storage
      try {
        const blob = await this.generatePdfBlob();
        const fileName = 'sample.pdf';
        const fileEntry = await this.file.writeFile(
          this.file.externalDataDirectory, 
          fileName, 
          blob, 
          { replace: true }
        );
        console.log('PDF saved at', fileEntry.nativeURL);
      } catch (err) {
        console.error('Download error', err);
      }
    } else {
      // Browser: Trigger download
      const pdfDoc = pdfMake.createPdf(this.getDocumentDefinition());
      pdfDoc.download('sample.pdf');
    }
  }
}
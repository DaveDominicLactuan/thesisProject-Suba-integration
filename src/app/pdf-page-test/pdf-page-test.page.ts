import { Component, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import * as pdfMake from 'pdfmake/build/pdfmake';
import * as pdfFonts from 'pdfmake/build/vfs_fonts';
import { File } from '@awesome-cordova-plugins/file/ngx';
import { FileOpener } from '@awesome-cordova-plugins/file-opener/ngx';
import { AndroidPermissions } from '@awesome-cordova-plugins/android-permissions/ngx';
import { Platform } from '@ionic/angular';
import { WebView } from '@awesome-cordova-plugins/ionic-webview/ngx';


(pdfMake as any).vfs = (pdfFonts as { vfs: any }).vfs;

@Component({
  selector: 'app-pdf-page-test',
  templateUrl: './pdf-page-test.page.html',
  styleUrls: ['./pdf-page-test.page.scss'],
  standalone: false
})
export class PdfPageTestPage implements OnInit {
  pdfSrc: SafeResourceUrl | null = null;

  constructor(
    private sanitizer: DomSanitizer,
    private file: File,
    private fileOpener: FileOpener,
    private androidPermissions: AndroidPermissions,
    private platform: Platform,
    private webview: WebView
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
    }

    // Show preview immediately
    this.previewPDF();
  }

  private getDocumentDefinition() {
    return {
      content: [
        { text: 'Ionic PDF Example', style: 'header' },
        'This PDF was generated in an Ionic app.',
        { text: 'Enjoy!', style: 'subheader' }
      ],
      styles: {
        header: { fontSize: 22, bold: true },
        subheader: { fontSize: 16, italics: true }
      }
    };
  }

  /** PREVIEW — browser & Android (native file on device) */
  // previewPDF() {
  //   const pdfDoc = pdfMake.createPdf(this.getDocumentDefinition());

  //   if (this.platform.is('hybrid') && this.platform.is('android')) {
  //     // Save to cache and preview
  //     pdfDoc.getBlob((blob) => {
  //       const fileName = 'preview.pdf';
  //       this.file.writeFile(this.file.cacheDirectory, fileName, blob, { replace: true })
  //         .then((fileEntry) => {
  //           const filePath = this.webview.convertFileSrc(fileEntry.nativeURL);
  //           this.pdfSrc = this.sanitizer.bypassSecurityTrustResourceUrl(filePath);
  //           console.log('Android PDF preview path:', filePath);
  //         })
  //         .catch(err => console.error('Error saving preview PDF:', err));
  //     });
  //   } else {
  //     // Browser: Base64 inline preview
  //     pdfDoc.getBase64((base64) => {
  //       const pdfBase64 = `data:application/pdf;base64,${base64}`;
  //       this.pdfSrc = this.sanitizer.bypassSecurityTrustResourceUrl(pdfBase64);
  //     });
  //   }
  // }

  /** PREVIEW — browser & Android (native file on device) */
previewPDF() {
  const pdfDoc = pdfMake.createPdf(this.getDocumentDefinition());

  if (this.platform.is('hybrid') && this.platform.is('android')) {
    // Save to cache, then wrap in Google Docs Viewer
    pdfDoc.getBlob((blob) => {
      const fileName = 'preview.pdf';
      this.file.writeFile(this.file.cacheDirectory, fileName, blob, { replace: true })
        .then((fileEntry) => {
          const localPath = this.webview.convertFileSrc(fileEntry.nativeURL);
          console.log('Local PDF path:', localPath);

          // Google Docs Viewer (requires internet)
          const gviewUrl = `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(localPath)}`;
          console.log('Google Docs Viewer URL:', gviewUrl);

          this.pdfSrc = this.sanitizer.bypassSecurityTrustResourceUrl(gviewUrl);
          console.log('Android PDF preview loaded via Google Docs Viewer');
        })
        .catch(err => console.error('Error saving preview PDF:', err));
    });
  } else {
    // Browser: Base64 inline preview
    pdfDoc.getBase64((base64) => {
      const pdfBase64 = `data:application/pdf;base64,${base64}`;
      this.pdfSrc = this.sanitizer.bypassSecurityTrustResourceUrl(pdfBase64);
      console.log('Browser PDF preview loaded');
    });
  }
}

previewPDF2() {
  const pdfDoc = pdfMake.createPdf(this.getDocumentDefinition());

  if (this.platform.is('hybrid') && this.platform.is('android')) {
    // Save to cache and open in native PDF viewer
    pdfDoc.getBlob((blob) => {
      const fileName = 'preview.pdf';
      this.file.writeFile(this.file.cacheDirectory, fileName, blob, { replace: true })
        .then((fileEntry) => {
          console.log('PDF saved for native preview at:', fileEntry.nativeURL);
          this.fileOpener.open(fileEntry.nativeURL, 'application/pdf')
            .then(() => console.log('Native PDF preview opened'))
            .catch(err => console.error('Error opening native PDF preview:', err));
        })
        .catch(err => console.error('Error saving preview PDF:', err));
    });
  } else {
    // Browser: show inline Base64 preview
    pdfDoc.getBase64((base64) => {
      const pdfBase64 = `data:application/pdf;base64,${base64}`;
      this.pdfSrc = this.sanitizer.bypassSecurityTrustResourceUrl(pdfBase64);
      console.log('Browser PDF preview loaded');
    });
  }
}



/** Fires when PDF iframe finishes loading */
onPDFLoad() {
  console.log('✅ PDF preview successfully loaded in viewer.');
}


  /** DOWNLOAD — Android native / browser */
  downloadPDF() {
    const pdfDoc = pdfMake.createPdf(this.getDocumentDefinition());

    if (this.platform.is('hybrid') && this.platform.is('android')) {
      pdfDoc.getBlob((blob) => {
        const fileName = 'sample.pdf';
        this.file.writeFile(this.file.externalDataDirectory, fileName, blob, { replace: true })
          .then((fileEntry) => {
            console.log('PDF saved at', fileEntry.nativeURL);
          })
          .catch(err => console.error('Download error', err));
      });
    } else {
      pdfDoc.download('sample.pdf');
    }
  }

  /** OPEN — Android only */
  openPDF() {
    if (this.platform.is('hybrid') && this.platform.is('android')) {
      this.savePDF('sample.pdf').then((filePath) => {
        this.fileOpener.open(filePath, 'application/pdf')
          .then(() => console.log('PDF opened'))
          .catch((err) => console.error('Open error', err));
      });
    } else {
      console.warn('Open PDF is only available on Android device.');
    }
  }

  /** SAVE PDF and return path */
  private savePDF(fileName: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const pdfDoc = pdfMake.createPdf(this.getDocumentDefinition());
      pdfDoc.getBlob((blob) => {
        this.file.writeFile(this.file.externalDataDirectory, fileName, blob, { replace: true })
          .then(() => resolve(this.file.externalDataDirectory + fileName))
          .catch((err) => reject(err));
      });
    });
  }
}
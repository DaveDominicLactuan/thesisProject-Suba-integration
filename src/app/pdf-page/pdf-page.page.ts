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
  selector: 'app-pdf-page',
  templateUrl: './pdf-page.page.html',
  styleUrls: ['./pdf-page.page.scss'],
  standalone: false
})
export class PdfPagePage implements OnInit {
  pdfSrc: SafeResourceUrl | null = null;

  constructor(
    private sanitizer: DomSanitizer,
    private file: File,
    private fileOpener: FileOpener,
    private androidPermissions: AndroidPermissions,
    private platform: Platform,
    private webview: WebView
  ) {}

  ngOnInit() {
  // Only safe, non-native setup here
  console.log('ngOnInit called');
  console.log('Platform:', this.platform.platforms());
  console.log('File plugin exists?', !!this.file);
  console.log('FileOpener exists?', !!this.fileOpener);
  console.log('AndroidPermissions exists?', !!this.androidPermissions);
}

// Run native plugin code only after the view is active and the bridge is ready
async ionViewDidEnter() {
  console.log('ionViewDidEnter called');
  console.log('Platform:', this.platform.platforms());

  if (this.platform.is('hybrid') && this.platform.is('android')) {
    try {
      const status = await this.androidPermissions.checkPermission(
        this.androidPermissions.PERMISSION.WRITE_EXTERNAL_STORAGE
      );

      if (!status.hasPermission) {
        const requestStatus = await this.androidPermissions.requestPermission(
          this.androidPermissions.PERMISSION.WRITE_EXTERNAL_STORAGE
        );

        if (!requestStatus.hasPermission) {
          console.warn('WRITE_EXTERNAL_STORAGE permission denied.');
          return; // Stop if permission not granted
        }
      }

      this.previewPDF();
    } catch (err) {
      console.error('Permission check/request failed:', err);
    }
  } else {
    // Browser or iOS testing
    this.previewPDF();
  }
}


//   async ngOnInit() {
//     await this.platform.ready();

//     if (this.platform.is('android')) {
//       this.androidPermissions.checkPermission(this.androidPermissions.PERMISSION.WRITE_EXTERNAL_STORAGE)
//         .then((status) => {
//           if (!status.hasPermission) {
//             this.androidPermissions.requestPermission(this.androidPermissions.PERMISSION.WRITE_EXTERNAL_STORAGE)
//               .then(() => this.previewPDF())
//               .catch(err => console.error('Permission request denied:', err));
//           } else {
//             this.previewPDF();
//           }
//         })
//         .catch(err => console.error('Permission check failed:', err));
//     } else {
//       this.previewPDF();
//     }

//     console.log('Platform:', this.platform.platforms());
// console.log('File plugin exists?', !!this.file);
// console.log('FileOpener exists?', !!this.fileOpener);
// console.log('AndroidPermissions exists?', !!this.androidPermissions);
//   }

//   async ionViewDidEnter() {
//   console.log('Platform:', this.platform.platforms());

//   if (this.platform.is('hybrid') && this.platform.is('android')) {
//     try {
//       const status = await this.androidPermissions.checkPermission(
//         this.androidPermissions.PERMISSION.WRITE_EXTERNAL_STORAGE
//       );
//       if (!status.hasPermission) {
//         await this.androidPermissions.requestPermission(
//           this.androidPermissions.PERMISSION.WRITE_EXTERNAL_STORAGE
//         );
//       }
//       this.previewPDF();
//     } catch (err) {
//       console.error('Permission check/request failed:', err);
//     }
//   } else {
//     // Browser or non-native platforms
//     this.previewPDF();
//   }
// }


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

  private safeFilePath(path: string): string {
    // Only use WebView conversion on device
    if (this.platform.is('cordova') || this.platform.is('capacitor')) {
      return this.webview.convertFileSrc(path);
    }
    // Browser: just return normal path (or empty to avoid errors)
    return path;
  }

  generatePDF() {
  const pdfDoc = pdfMake.createPdf(this.getDocumentDefinition());

  if (this.platform.is('cordova') || this.platform.is('capacitor')) {
    pdfDoc.getBlob((blob) => {
      const fileName = 'sample.pdf';
      const dirPath = this.file.externalDataDirectory;

      this.file.writeFile(dirPath, fileName, blob, { replace: true })
        .then((fileEntry) => {
          console.log('PDF saved at', fileEntry.nativeURL);

          // Open using native file path, not WebView path
          this.fileOpener.open(fileEntry.nativeURL, 'application/pdf')
            .then(() => console.log('PDF opened'))
            .catch(err => console.error('Error opening PDF', err));
        })
        .catch(err => console.error('File write/open error', err));
    });
  } else {
    pdfDoc.download('sample.pdf');
  }
}

// previewPDF() {
//   const pdfDoc = pdfMake.createPdf(this.getDocumentDefinition());

//   if (this.platform.is('cordova') || this.platform.is('capacitor')) {
//     // Base64 preview works in Android WebView
//     pdfDoc.getBase64((base64) => {
//       const pdfBase64 = `data:application/pdf;base64,${base64}`;
//       this.pdfSrc = this.sanitizer.bypassSecurityTrustResourceUrl(pdfBase64);
//     });
//   } else {
//     // Browser preview
//     pdfDoc.getBlob((blob) => {
//       const url = URL.createObjectURL(blob);
//       this.pdfSrc = this.sanitizer.bypassSecurityTrustResourceUrl(url);
//     });
//   }
// }

previewPDF() {
  const pdfDoc = pdfMake.createPdf(this.getDocumentDefinition());

  if (this.platform.is('hybrid') && this.platform.is('android')) {
    // On Android device — save PDF to file and load via WebView
    pdfDoc.getBlob((blob) => {
      const fileName = 'preview.pdf';
      this.file.writeFile(this.file.cacheDirectory, fileName, blob, { replace: true })
        .then((fileEntry) => {
          const filePath = this.webview.convertFileSrc(fileEntry.nativeURL);
          this.pdfSrc = this.sanitizer.bypassSecurityTrustResourceUrl(filePath);
          console.log('Android preview file path:', filePath);
        })
        .catch(err => console.error('Error saving preview PDF:', err));
    });
  } else {
    // Browser or iOS — use Base64 inline
    pdfDoc.getBase64((base64) => {
      const pdfBase64 = `data:application/pdf;base64,${base64}`;
      this.pdfSrc = this.sanitizer.bypassSecurityTrustResourceUrl(pdfBase64);
    });
  }
}


downloadPDF() {
  const pdfDoc = pdfMake.createPdf(this.getDocumentDefinition());

  if (this.platform.is('cordova') || this.platform.is('capacitor')) {
    pdfDoc.getBlob((blob) => {
      const fileName = 'sample.pdf';
      const dirPath = this.file.externalDataDirectory;

      this.file.writeFile(dirPath, fileName, blob, { replace: true })
        .then((fileEntry) => {
          this.fileOpener.open(fileEntry.nativeURL, 'application/pdf')
            .then(() => console.log('PDF opened'))
            .catch(err => console.error('Error opening PDF', err));
        })
        .catch(err => console.error('Download error', err));
    });
  } else {
    pdfDoc.download('sample.pdf');
  }
}


  // generatePDF() {
  //   const pdfDoc = pdfMake.createPdf(this.getDocumentDefinition());

  //   if (this.platform.is('cordova') || this.platform.is('capacitor')) {
  //     pdfDoc.getBlob((blob) => {
  //       this.file.writeFile(this.file.externalDataDirectory, 'sample.pdf', blob, { replace: true })
  //         .then(() => {
  //           const filePath = this.safeFilePath(this.file.externalDataDirectory + 'sample.pdf');
  //           this.fileOpener.open(filePath, 'application/pdf');
  //         })
  //         .catch(err => console.error('File write/open error', err));
  //     });
  //   } else {
  //     pdfDoc.download('sample.pdf');
  //   }
  // }

  // previewPDF() {
  //   const pdfDoc = pdfMake.createPdf(this.getDocumentDefinition());

  //   if (this.platform.is('cordova') || this.platform.is('capacitor')) {
  //     // Base64 preview for Android WebView
  //     pdfDoc.getBase64((base64) => {
  //       const pdfBase64 = `data:application/pdf;base64,${base64}`;
  //       this.pdfSrc = this.sanitizer.bypassSecurityTrustResourceUrl(pdfBase64);
  //     });
  //   } else {
  //     // Browser preview with blob
  //     pdfDoc.getBlob((blob) => {
  //       const url = URL.createObjectURL(blob);
  //       this.pdfSrc = this.sanitizer.bypassSecurityTrustResourceUrl(url);
  //     });
  //   }
  // }

  // downloadPDF() {
  //   const pdfDoc = pdfMake.createPdf(this.getDocumentDefinition());

  //   if (this.platform.is('cordova') || this.platform.is('capacitor')) {
  //     pdfDoc.getBlob((blob) => {
  //       this.file.writeFile(this.file.externalDataDirectory, 'sample.pdf', blob, { replace: true })
  //         .then(() => {
  //           const filePath = this.safeFilePath(this.file.externalDataDirectory + 'sample.pdf');
  //           this.fileOpener.open(filePath, 'application/pdf');
  //         })
  //         .catch(err => console.error('Download error', err));
  //     });
  //   } else {
  //     pdfDoc.download('sample.pdf');
  //   }
  // }
}
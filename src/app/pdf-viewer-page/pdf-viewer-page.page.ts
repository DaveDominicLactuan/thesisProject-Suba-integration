import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Directory, Filesystem } from '@capacitor/filesystem';

@Component({
  selector: 'app-pdf-viewer-page',
  templateUrl: './pdf-viewer-page.page.html',
  styleUrls: ['./pdf-viewer-page.page.scss'],
  standalone: false
})
export class PdfViewerPage implements OnInit {
  pdfSrc: string | undefined;
  isLoading = true;
  private backButtonSub: any; // hardware back handler



  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    
    // Accept a query parameter "src" that can be a data URL (base64) or a blob/object URL
    this.route.queryParamMap.subscribe((params) => {
      const src = params.get('src');
      if (src) {
        this.pdfSrc = src;
      }
    });
  }

  onPdfLoadingStarts(): void {
    this.isLoading = true;
  }

  onPdfLoadingEnds(): void {
    this.isLoading = false;
  }

  /**
   * Saves the currently loaded PDF to the device's Documents folder using Capacitor Filesystem.
   * Supports data URLs (base64) and blob/object URLs.
   */
  async saveToDocuments(): Promise<void> {
    if (!this.pdfSrc) {
      alert('No PDF loaded');
      return;
    }

    try {
      const base64Data = await this.toBase64(this.pdfSrc);
      const fileName = `document_${Date.now()}.pdf`;
      await Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: Directory.Documents,
        recursive: true,
      });
      alert(`Saved to Documents as ${fileName}`);
    } catch (err) {
      console.error('Failed to save PDF', err);
      alert('Failed to save PDF to Documents.');
    }
  }

  /** Converts a data URL or blob/object URL to a base64 string. */
  private async toBase64(src: string): Promise<string> {
    // If a data URL (any variant), take content after the first comma
    if (src.startsWith('data:')) {
      const commaIdx = src.indexOf(',');
      return commaIdx !== -1 ? src.substring(commaIdx + 1) : src;
    }
    // Otherwise fetch the resource and convert blob to base64
    const res = await fetch(src);
    const blob = await res.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        const commaIdx = result.indexOf(',');
        resolve(commaIdx !== -1 ? result.substring(commaIdx + 1) : result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}

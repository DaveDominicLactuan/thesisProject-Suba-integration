import { Component, OnInit } from '@angular/core';
import { PdfService, InvoiceData } from '../services/pdf.service';
import { Directory, Filesystem, Encoding } from '@capacitor/filesystem';
import { Platform } from '@ionic/angular';

type GenerationMethod = 'blob' | 'arraybuffer' | 'datauri' | 'inspection';

@Component({
  selector: 'app-pdf-preview-page',
  templateUrl: './pdf-preview-page.page.html',
  styleUrls: ['./pdf-preview-page.page.scss'],
  standalone: false,
})
export class PdfPreviewPage implements OnInit {
  // PDF source for ng2-pdf-viewer (accepts Blob, ArrayBuffer, or Uint8Array)
  pdfSrc: any = null;
   private backButtonSub: any; // hardware back handler
  
  // Current PDF Blob for download functionality
  currentPdfBlob: Blob | null = null;
  
  // Loading state
  isGenerating = false;
  
  // Current generation method being used
  currentMethod: GenerationMethod = 'blob';
  
  
  // Sample invoice data
  sampleInvoiceData: InvoiceData = {
    invoiceNumber: 'INV-2024-001',
    date: new Date().toLocaleDateString(),
    customerName: 'Sample Customer Inc.',
    items: [
      { description: 'Structural Inspection Service', quantity: 1, price: 500.00 },
      { description: 'Crack Detection Analysis', quantity: 3, price: 150.00 },
      { description: 'Detailed Report Generation', quantity: 1, price: 200.00 }
    ],
    total: 1150.00
  };

  constructor(
    private pdfService: PdfService,
    private platform: Platform
  ) {}

  ngOnInit(): void {
    // Generate default PDF on load using Blob method (recommended)
    this.generatePdf('blob');

    
  }

  /**
   * Generate PDF using different methods to test compatibility
   * @param method - The generation method to use
   */
  generatePdf(method: GenerationMethod): void {
    this.isGenerating = true;
    this.currentMethod = method;
    
    try {
      switch (method) {
        case 'blob':
          // RECOMMENDED: Blob method - best for mobile
          this.currentPdfBlob = this.pdfService.generateInvoicePdf(this.sampleInvoiceData);
          this.pdfSrc = this.currentPdfBlob;
          console.log('PDF generated using Blob method (RECOMMENDED)');
          break;
          
        case 'arraybuffer':
          // Alternative: ArrayBuffer - good for advanced processing
          const arrayBuffer = this.pdfService.generateInvoicePdfAsArrayBuffer(this.sampleInvoiceData);
          this.currentPdfBlob = new Blob([arrayBuffer], { type: 'application/pdf' });
          this.pdfSrc = arrayBuffer;
          console.log('PDF generated using ArrayBuffer method');
          break;
          
        case 'datauri':
          // WARNING: Data URI can crash on large files on mobile
          const dataUri = this.pdfService.generateInvoicePdfAsDataUri(this.sampleInvoiceData);
          // Convert data URI to Blob for consistent download functionality
          this.currentPdfBlob = this.dataUriToBlob(dataUri);
          this.pdfSrc = dataUri;
          console.log('PDF generated using Data URI method (NOT recommended for mobile)');
          break;
          
        case 'inspection':
          // Custom inspection report
          this.currentPdfBlob = this.pdfService.generateInspectionReportPdf({
            projectName: 'Building A - Structural Assessment',
            inspector: `${this.getStoredUserName()} (Inspector)`,
            date: new Date().toLocaleDateString(),
            findings: [
              'All structural elements within acceptable parameters',
              'Minor cosmetic cracks detected on exterior facade',
              'Foundation shows no signs of settling or movement',
              'Recommend routine maintenance check in 12 months'
            ]
          });
          this.pdfSrc = this.currentPdfBlob;
          console.log('PDF generated using Inspection Report template');
          break;
      }
      
      // Small delay to show loading state
      setTimeout(() => {
        this.isGenerating = false;
      }, 300);
      
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert(`Failed to generate PDF using ${method} method. See console for details.`);
      this.isGenerating = false;
    }
  }

  /**
   * Download the current PDF to device
   * Uses Capacitor Filesystem on mobile, standard download on web
   */
  async downloadPdf(): Promise<void> {
    if (!this.currentPdfBlob) {
      alert('No PDF to download. Generate a PDF first.');
      return;
    }

    try {
      const fileName = `invoice_${Date.now()}.pdf`;
      
      if (this.platform.is('capacitor')) {
        // Mobile: Use Capacitor Filesystem
        const base64Data = await this.blobToBase64(this.currentPdfBlob);
        try {
          await Filesystem.writeFile({
            path: fileName,
            data: base64Data,
            directory: Directory.Documents,
            recursive: true,
          });
          alert(`PDF saved to Documents folder as ${fileName}`);
        } catch (writeErr) {
          console.warn('Write to Documents failed, falling back to Cache', writeErr);
          await Filesystem.writeFile({
            path: fileName,
            data: base64Data,
            directory: Directory.Cache,
            recursive: true,
          });
          alert(`PDF saved to Cache folder as ${fileName}`);
        }
      } else {
        // Web: Use standard download
        const url = URL.createObjectURL(this.currentPdfBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        console.log(`PDF downloaded as ${fileName}`);
      }
    } catch (error) {
      console.error('Error downloading PDF:', error);
      alert('Failed to download PDF. See console for details.');
    }
  }

  /**
   * Convert Blob to Base64 string for Capacitor Filesystem
   */
  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Convert Data URI to Blob
   */
  private dataUriToBlob(dataUri: string): Blob {
    const byteString = atob(dataUri.split(',')[1]);
    const mimeString = dataUri.split(',')[0].split(':')[1].split(';')[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    
    return new Blob([ab], { type: mimeString });
  }

  /**
   * Get stored user name from localStorage
   */
  private getStoredUserName(): string {
    try {
      const userData = localStorage.getItem('userData');
      if (userData) {
        const data = JSON.parse(userData);
        return data.firstName && data.lastName 
          ? `${data.firstName} ${data.lastName}` 
          : data.username || 'Unknown User';
      }
    } catch {}
    return 'Unknown User';
  }

  /**
   * Callback when PDF loads successfully
   */
  onPdfLoaded(): void {
    console.log('PDF loaded successfully in viewer');
  }

  /**
   * Callback when PDF fails to load
   */
  onPdfError(error: any): void {
    console.error('PDF viewer error:', error);
    alert('Failed to load PDF in viewer. Try a different generation method.');
  }
}

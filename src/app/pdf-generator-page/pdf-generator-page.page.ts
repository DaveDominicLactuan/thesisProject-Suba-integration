import { Component } from '@angular/core';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Platform } from '@ionic/angular';
import { FileOpener } from '@awesome-cordova-plugins/file-opener/ngx';

@Component({
  selector: 'app-pdf-generator-page',
  templateUrl: './pdf-generator-page.page.html',
  styleUrls: ['./pdf-generator-page.page.scss'],
  standalone: false,
})
export class PdfGeneratorPage {
  isGenerating = false;
  lastGeneratedFile: string | null = null;
  generationLog: string[] = [];
  private backButtonSub: any; // hardware back handler

  constructor(private platform: Platform, private fileOpener: FileOpener) {}

  ngOnInit(): void {
    
  }

  

  /**
   * Main workflow: Generate PDF using pdf-lib, save with Capacitor Filesystem,
   * and open with native file opener
   */
  async generateAndPreviewPdf(): Promise<void> {
    this.isGenerating = true;
    this.generationLog = [];
    this.addLog('🚀 Starting PDF generation...');

    try {
      // Step 1: Create PDF using pdf-lib
      this.addLog('📄 Creating PDF document with pdf-lib...');
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([600, 800]);
      
      // Add some content
      const timesRomanFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
      const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      
      const { width, height } = page.getSize();
      
      // Title
      page.drawText('Hello World', {
        x: 50,
        y: height - 50,
        size: 30,
        font: helveticaBold,
        color: rgb(0, 0.2, 0.6),
      });
      
      // Subtitle
      page.drawText('Generated with pdf-lib', {
        x: 50,
        y: height - 85,
        size: 16,
        font: timesRomanFont,
        color: rgb(0.3, 0.3, 0.3),
      });
      
      // Body text
      const bodyText = `
This PDF was generated on ${new Date().toLocaleString()} using:
  • pdf-lib for PDF creation
  • Capacitor Filesystem for saving
  • Native file opener for preview

This approach is ideal for mobile devices because it:
  ✓ Uses native PDF viewers (better performance)
  ✓ Supports all PDF features
  ✓ Works offline
  ✓ Handles large files efficiently
      `.trim();
      
      const lines = bodyText.split('\n');
      let yPosition = height - 130;
      
      lines.forEach(line => {
        page.drawText(line, {
          x: 50,
          y: yPosition,
          size: 12,
          font: timesRomanFont,
          color: rgb(0, 0, 0),
        });
        yPosition -= 20;
      });
      
      // Footer
      page.drawText('Thesis Project - Structural Inspection System', {
        x: 50,
        y: 40,
        size: 10,
        font: timesRomanFont,
        color: rgb(0.5, 0.5, 0.5),
      });
      
      this.addLog('✅ PDF document created successfully');

      // Step 2: Convert to Uint8Array
      this.addLog('🔄 Converting PDF to Uint8Array...');
      const pdfBytes = await pdfDoc.save();
      this.addLog(`✅ PDF converted (${pdfBytes.length} bytes)`);

      // Step 3: Convert Uint8Array to Base64 (required for Capacitor Filesystem)
      this.addLog('🔄 Converting to Base64 for Capacitor...');
      const base64Data = this.uint8ArrayToBase64(pdfBytes);
      this.addLog('✅ Base64 conversion complete');

      // Step 4: Save to device using Capacitor Filesystem
      const fileName = `pdf_${Date.now()}.pdf`;
      this.addLog(`💾 Saving file as "${fileName}"...`);
      
      const result = await Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: Directory.Cache,
        recursive: true,
      });
      
      this.lastGeneratedFile = fileName;
      this.addLog(`✅ File saved to: ${result.uri}`);

      // Step 5: Open the PDF with native file opener (mobile) or download (web)
      if (this.platform.is('capacitor')) {
        this.addLog('📱 Attempting to open PDF with native viewer...');
        try {
          const fileUri = await Filesystem.getUri({
            directory: Directory.Cache,
            path: fileName,
          });
          this.addLog(`📍 File URI: ${fileUri.uri}`);
          await this.fileOpener.open(fileUri.uri, 'application/pdf');
          this.addLog('✅ Opened in native viewer');
        } catch (openErr: any) {
          this.addLog(`⚠️ Failed to open natively: ${openErr?.message || openErr}`);
          alert('PDF saved to cache, but opening failed. Please open it from your file manager.');
        }
      } else {
        // Web fallback - download the file
        this.addLog('🌐 Running on web - downloading file...');
        this.downloadPdfWeb(pdfBytes, fileName);
        this.addLog('✅ File downloaded');
      }

    } catch (error: any) {
      console.error('PDF generation error:', error);
      this.addLog(`❌ Error: ${error.message || 'Unknown error occurred'}`);
      alert(`Failed to generate PDF: ${error.message || 'Unknown error'}`);
    } finally {
      this.isGenerating = false;
    }
  }

  /**
   * Generate a more complex PDF with inspection report format
   */
  async generateInspectionReport(): Promise<void> {
    this.isGenerating = true;
    this.generationLog = [];
    this.addLog('🚀 Starting inspection report generation...');

    try {
      this.addLog('📄 Creating inspection report PDF...');
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([595, 842]); // A4 size
      
      const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
      
      const { width, height } = page.getSize();
      
      // Header with colored rectangle
      page.drawRectangle({
        x: 0,
        y: height - 80,
        width: width,
        height: 80,
        color: rgb(0.16, 0.5, 0.73),
      });
      
      // Title
      page.drawText('STRUCTURAL INSPECTION REPORT', {
        x: 50,
        y: height - 45,
        size: 24,
        font: helveticaBold,
        color: rgb(1, 1, 1),
      });
      
      // Report metadata
      let yPos = height - 110;
      const metadata = [
        `Report ID: INS-${Date.now()}`,
        `Inspector: ${this.getStoredUserName()}`,
        `Date: ${new Date().toLocaleDateString()}`,
        `Time: ${new Date().toLocaleTimeString()}`,
      ];
      
      page.drawText('Report Information', {
        x: 50,
        y: yPos,
        size: 14,
        font: helveticaBold,
        color: rgb(0, 0, 0),
      });
      yPos -= 25;
      
      metadata.forEach(line => {
        page.drawText(line, {
          x: 50,
          y: yPos,
          size: 11,
          font: helvetica,
          color: rgb(0.2, 0.2, 0.2),
        });
        yPos -= 18;
      });
      
      // Findings section
      yPos -= 20;
      page.drawText('Inspection Findings', {
        x: 50,
        y: yPos,
        size: 14,
        font: helveticaBold,
        color: rgb(0, 0, 0),
      });
      yPos -= 25;
      
      const findings = [
        '1. All structural elements are within acceptable parameters',
        '2. Minor surface cracks detected (non-structural)',
        '3. Concrete strength test results: PASSED',
        '4. No signs of water damage or corrosion',
        '5. Recommend routine maintenance in 6 months',
      ];
      
      findings.forEach(finding => {
        page.drawText(finding, {
          x: 50,
          y: yPos,
          size: 11,
          font: helvetica,
          color: rgb(0, 0, 0),
        });
        yPos -= 20;
      });
      
      // Status indicator
      yPos -= 20;
      page.drawRectangle({
        x: 50,
        y: yPos - 20,
        width: 200,
        height: 30,
        color: rgb(0.13, 0.59, 0.26),
        borderColor: rgb(0.1, 0.4, 0.2),
        borderWidth: 2,
      });
      
      page.drawText('STATUS: APPROVED', {
        x: 70,
        y: yPos - 10,
        size: 12,
        font: helveticaBold,
        color: rgb(1, 1, 1),
      });
      
      // Footer
      page.drawText('Generated by Thesis Project - Structural Inspection System', {
        x: 50,
        y: 30,
        size: 9,
        font: helvetica,
        color: rgb(0.5, 0.5, 0.5),
      });
      
      this.addLog('✅ Inspection report created');

      // Convert and save (same as simple PDF)
      const pdfBytes = await pdfDoc.save();
      this.addLog(`✅ PDF converted (${pdfBytes.length} bytes)`);
      
      const base64Data = this.uint8ArrayToBase64(pdfBytes);
      const fileName = `inspection_report_${Date.now()}.pdf`;
      this.addLog(`💾 Saving report as "${fileName}"...`);
      
      const result = await Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: Directory.Cache,
        recursive: true,
      });
      
      this.lastGeneratedFile = fileName;
      this.addLog(`✅ File saved to: ${result.uri}`);

      // Mobile: notify user and show file location
      if (this.platform.is('capacitor')) {
        this.addLog('📱 Report saved on device');
        this.addLog(`📍 File location: ${result.uri}`);
        alert(`Inspection report saved!\n\nFile: ${fileName}\nLocation: Cache directory`);
      } else {
        this.addLog('🌐 Running on web - downloading file...');
        this.downloadPdfWeb(pdfBytes, fileName);
        this.addLog('✅ File downloaded');
      }

    } catch (error: any) {
      console.error('Report generation error:', error);
      this.addLog(`❌ Error: ${error.message || 'Unknown error occurred'}`);
      alert(`Failed to generate report: ${error.message || 'Unknown error'}`);
    } finally {
      this.isGenerating = false;
    }
  }

  /**
   * Re-open the last generated PDF file
   */
  async reopenLastPdf(): Promise<void> {
    if (!this.lastGeneratedFile) {
      alert('No PDF file has been generated yet.');
      return;
    }

    try {
      this.addLog(`🔄 Reopening "${this.lastGeneratedFile}"...`);
      
      const fileUri = await Filesystem.getUri({
        directory: Directory.Cache,
        path: this.lastGeneratedFile,
      });

      if (this.platform.is('capacitor')) {
        alert(`File location:\n${fileUri.uri}\n\nAccess it from your device's file manager.`);
        this.addLog(`📍 File URI: ${fileUri.uri}`);
      } else {
        alert('Reopen feature is only available on mobile devices.');
      }
    } catch (error: any) {
      console.error('Reopen error:', error);
      this.addLog(`❌ Failed to reopen: ${error.message}`);
      alert(`Failed to reopen PDF: ${error.message}`);
    }
  }

  /**
   * Convert Uint8Array to Base64 string (required for Capacitor Filesystem)
   */
  private uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Download PDF on web (fallback when not running on mobile)
   */
  private downloadPdfWeb(pdfBytes: Uint8Array, fileName: string): void {
    const ab = new ArrayBuffer(pdfBytes.length);
    const view = new Uint8Array(ab);
    view.set(pdfBytes);
    const blob = new Blob([ab], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
          : data.username || 'Unknown Inspector';
      }
    } catch {}
    return 'Unknown Inspector';
  }

  /**
   * Add a log entry with timestamp
   */
  private addLog(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    this.generationLog.push(`[${timestamp}] ${message}`);
    console.log(message);
  }

  /**
   * Clear the generation log
   */
  clearLog(): void {
    this.generationLog = [];
  }
}

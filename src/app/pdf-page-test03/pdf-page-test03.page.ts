
import { Component, ElementRef, ViewChild,OnInit } from '@angular/core';
import html2pdf from 'html2pdf.js';
import * as pdfjsLib from 'pdfjs-dist';
const pdfjsWorker = require('pdfjs-dist/build/pdf.worker.entry');

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

@Component({
  selector: 'app-pdf-page-test03',
  templateUrl: './pdf-page-test03.page.html',
  styleUrls: ['./pdf-page-test03.page.scss'],
  standalone: false
})
export class PdfPageTest03Page {
  @ViewChild('pdfContent') pdfContent!: ElementRef;
  private pdfBlob: Blob | null = null;

  constructor() {}

  async generatePdf() {
    const element = this.pdfContent.nativeElement;

    const options = {
      margin: 10,
      filename: 'document.pdf',
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    // Generate PDF Blob
    this.pdfBlob = await html2pdf().from(element).set(options).outputPdf('blob');

    if (this.pdfBlob) {
      this.previewPdfAllPages(this.pdfBlob);
    }
  }

  async previewPdfAllPages(blob: Blob) {
    const previewDiv = document.getElementById('pdf-preview');
    if (!previewDiv) return;
    previewDiv.innerHTML = ''; // Clear old preview

    const pdfData = new Uint8Array(await blob.arrayBuffer());
    const pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({ canvasContext: context, viewport }).promise;
      previewDiv.appendChild(canvas);

      // Space between pages
      const spacer = document.createElement('div');
      spacer.style.height = '20px';
      previewDiv.appendChild(spacer);
    }
  }

  downloadPdf() {
    if (this.pdfBlob) {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(this.pdfBlob);
      link.download = 'document.pdf';
      link.click();
    }
  }
}


// src/app/pages/pdf-preview/pdf-preview.page.ts
import { Component, ViewChild, ElementRef,OnInit } from '@angular/core';
import { PDFDocument } from 'pdf-lib';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Platform } from '@ionic/angular';
import * as pdfjsLib from 'pdfjs-dist';
import { getDocument } from 'pdfjs-dist';

(pdfjsLib as any).GlobalWorkerOptions.workerSrc = `./assets/pdf.worker.min.js`;




@Component({
  selector: 'app-pdf-page-test02',
  templateUrl: './pdf-page-test02.page.html',
  styleUrls: ['./pdf-page-test02.page.scss'],
  standalone: false
})
export class PdfPageTest02Page {
  @ViewChild('pdfContainer', { static: true }) pdfContainer!: ElementRef<HTMLDivElement>;

  async generatePdf() {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([400, 200]);
    page.drawText('Hello from Ionic + PDF-Lib + PDF.js!', { x: 50, y: 100 });
    return await pdfDoc.save();
  }

  async previewPdf() {
    const pdfBytes = await this.generatePdf();
    const loadingTask = getDocument({ data: pdfBytes });
    const pdf = await loadingTask.promise;

    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1.5 });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: context, viewport }).promise;

    this.pdfContainer.nativeElement.innerHTML = '';
    this.pdfContainer.nativeElement.appendChild(canvas);
  }
}
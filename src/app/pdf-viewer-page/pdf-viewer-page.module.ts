import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { NgxExtendedPdfViewerModule } from 'ngx-extended-pdf-viewer';

import { PdfViewerPageRoutingModule } from './pdf-viewer-page-routing.module';
import { PdfViewerPage } from './pdf-viewer-page.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    NgxExtendedPdfViewerModule,
    PdfViewerPageRoutingModule,
  ],
  declarations: [PdfViewerPage]
})
export class PdfViewerPageModule {}

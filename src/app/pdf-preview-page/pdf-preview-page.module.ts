import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { PdfViewerModule } from 'ng2-pdf-viewer';

import { PdfPreviewPageRoutingModule } from './pdf-preview-page-routing.module';
import { PdfPreviewPage } from './pdf-preview-page.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    PdfViewerModule,
    PdfPreviewPageRoutingModule,
  ],
  declarations: [PdfPreviewPage]
})
export class PdfPreviewPageModule {}

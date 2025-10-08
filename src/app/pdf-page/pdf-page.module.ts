import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { PdfPagePageRoutingModule } from './pdf-page-routing.module';

import { PdfPagePage } from './pdf-page.page';

import { PdfViewerModule } from 'ng2-pdf-viewer';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    PdfPagePageRoutingModule, PdfViewerModule
  ],
  declarations: [PdfPagePage]
})
export class PdfPagePageModule {}

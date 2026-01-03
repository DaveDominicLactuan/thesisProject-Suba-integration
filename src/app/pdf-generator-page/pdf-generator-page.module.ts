import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { PdfGeneratorPageRoutingModule } from './pdf-generator-page-routing.module';
import { PdfGeneratorPage } from './pdf-generator-page.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    PdfGeneratorPageRoutingModule,
  ],
  declarations: [PdfGeneratorPage]
})
export class PdfGeneratorPageModule {}

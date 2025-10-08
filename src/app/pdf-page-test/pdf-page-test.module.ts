import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { PdfPageTestPageRoutingModule } from './pdf-page-test-routing.module';

import { PdfPageTestPage } from './pdf-page-test.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    PdfPageTestPageRoutingModule
  ],
  declarations: [PdfPageTestPage]
})
export class PdfPageTestPageModule {}

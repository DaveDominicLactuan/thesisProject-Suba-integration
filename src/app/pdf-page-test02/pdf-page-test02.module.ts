import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { PdfPageTest02PageRoutingModule } from './pdf-page-test02-routing.module';

import { PdfPageTest02Page } from './pdf-page-test02.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    PdfPageTest02PageRoutingModule
  ],
  declarations: [PdfPageTest02Page]
})
export class PdfPageTest02PageModule {}

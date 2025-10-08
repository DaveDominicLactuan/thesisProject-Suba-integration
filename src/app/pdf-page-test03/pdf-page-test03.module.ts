import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { PdfPageTest03PageRoutingModule } from './pdf-page-test03-routing.module';

import { PdfPageTest03Page } from './pdf-page-test03.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    PdfPageTest03PageRoutingModule
  ],
  declarations: [PdfPageTest03Page]
})
export class PdfPageTest03PageModule {}

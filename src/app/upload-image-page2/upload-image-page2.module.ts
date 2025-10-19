import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { UploadImagePage2PageRoutingModule } from './upload-image-page2-routing.module';

import { UploadImagePage2Page } from './upload-image-page2.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    UploadImagePage2PageRoutingModule
  ],
  declarations: [UploadImagePage2Page]
})
export class UploadImagePage2PageModule {}

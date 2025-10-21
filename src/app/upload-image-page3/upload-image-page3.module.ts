import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { UploadImagePage3PageRoutingModule } from './upload-image-page3-routing.module';

import { UploadImagePage3Page } from './upload-image-page3.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    UploadImagePage3PageRoutingModule
  ],
  declarations: [UploadImagePage3Page]
})
export class UploadImagePage3PageModule {}

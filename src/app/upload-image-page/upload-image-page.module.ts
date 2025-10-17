import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { UploadImagePagePageRoutingModule } from './upload-image-page-routing.module';

import { UploadImagePagePage } from './upload-image-page.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    UploadImagePagePageRoutingModule
  ],
  declarations: [UploadImagePagePage]
})
export class UploadImagePagePageModule {}

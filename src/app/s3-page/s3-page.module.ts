import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { S3PagePageRoutingModule } from './s3-page-routing.module';

import { S3PagePage } from './s3-page.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    S3PagePageRoutingModule
  ],
  declarations: [S3PagePage]
})
export class S3PagePageModule {}

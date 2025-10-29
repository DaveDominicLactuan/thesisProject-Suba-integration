import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { CameraPage2PageRoutingModule } from './camera-page2-routing.module';

import { CameraPage2Page } from './camera-page2.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    CameraPage2PageRoutingModule
  ],
  declarations: [CameraPage2Page]
})
export class CameraPage2PageModule {}

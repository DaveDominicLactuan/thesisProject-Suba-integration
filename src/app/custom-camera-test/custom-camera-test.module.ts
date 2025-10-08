import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { CustomCameraTestPageRoutingModule } from './custom-camera-test-routing.module';

import { CustomCameraTestPage } from './custom-camera-test.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    CustomCameraTestPageRoutingModule
  ],
  declarations: [CustomCameraTestPage]
})
export class CustomCameraTestPageModule {}

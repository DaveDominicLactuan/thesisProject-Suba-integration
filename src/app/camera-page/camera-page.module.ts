import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { CameraPagePageRoutingModule } from './camera-page-routing.module';
import { CameraPagePage } from './camera-page.page';


@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    CameraPagePageRoutingModule
  ],
  declarations: [CameraPagePage]
})
export class CameraPagePageModule {
  constructor() {
    console.log('CameraPagePageModule is being evaluated');
  }
}

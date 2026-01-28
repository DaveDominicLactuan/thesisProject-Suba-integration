import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { HomePage2PageRoutingModule } from './home-page2-routing.module';

import { HomePage2Page } from './home-page2.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    HomePage2PageRoutingModule
  ],
  declarations: [HomePage2Page]
})
export class HomePage2PageModule {}

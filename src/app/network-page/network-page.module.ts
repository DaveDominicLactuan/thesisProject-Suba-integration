import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { NetworkPagePageRoutingModule } from './network-page-routing.module';

import { NetworkPagePage } from './network-page.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    NetworkPagePageRoutingModule
  ],
  declarations: [NetworkPagePage]
})
export class NetworkPagePageModule {}

import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { SessionPagePageRoutingModule } from './session-page-routing.module';

import { SessionPagePage } from './session-page.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    SessionPagePageRoutingModule
  ],
  declarations: [SessionPagePage]
})
export class SessionPagePageModule {}

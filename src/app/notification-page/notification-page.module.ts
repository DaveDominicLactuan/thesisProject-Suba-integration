import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { NotificationPagePageRoutingModule } from './notification-page-routing.module';

import { NotificationPagePage } from './notification-page.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    NotificationPagePageRoutingModule
  ],
  declarations: [NotificationPagePage]
})
export class NotificationPagePageModule {}

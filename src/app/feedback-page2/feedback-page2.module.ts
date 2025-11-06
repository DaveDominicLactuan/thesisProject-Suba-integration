import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { FeedbackPage2PageRoutingModule } from './feedback-page2-routing.module';

import { FeedbackPage2Page } from './feedback-page2.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    FeedbackPage2PageRoutingModule
  ],
  declarations: [FeedbackPage2Page]
})
export class FeedbackPage2PageModule {}

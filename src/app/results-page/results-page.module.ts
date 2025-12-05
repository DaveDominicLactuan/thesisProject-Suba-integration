import { NgModule, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';

import { IonicModule } from '@ionic/angular';

import { ResultsPageRoutingModule } from './results-page-routing.module';

import { ResultsPageComponent } from './results-page.page';

@NgModule({
  imports: [
    CommonModule,
    IonicModule,
    ResultsPageRoutingModule,
  ],
  declarations: [ResultsPageComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class ResultsPageModule {}

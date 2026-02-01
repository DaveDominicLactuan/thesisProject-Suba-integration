import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { BrowseFilePagePageRoutingModule } from './browse-file-page-routing.module';

import { BrowseFilePagePage } from './browse-file-page.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    BrowseFilePagePageRoutingModule
  ],
  declarations: [BrowseFilePagePage]
})
export class BrowseFilePagePageModule {}

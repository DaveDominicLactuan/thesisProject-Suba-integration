import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { OfficeMapMarkerPagePageRoutingModule } from './office-map-marker-page-routing.module';

import { OfficeMapMarkerPagePage } from './office-map-marker-page.page';
import { RegistrationLeafletMapModule } from '../registration-page/registration-leaflet-map/registration-leaflet-map.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    OfficeMapMarkerPagePageRoutingModule,
    RegistrationLeafletMapModule
  ],
  declarations: [OfficeMapMarkerPagePage]
})
export class OfficeMapMarkerPagePageModule {}

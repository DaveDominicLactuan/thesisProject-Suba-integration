import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { RegistrationLeafletMapComponent } from './registration-leaflet-map.component';

@NgModule({
  imports: [CommonModule],
  declarations: [RegistrationLeafletMapComponent],
  exports: [RegistrationLeafletMapComponent]
})
export class RegistrationLeafletMapModule {}
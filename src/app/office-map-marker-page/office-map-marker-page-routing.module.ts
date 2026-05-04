import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { OfficeMapMarkerPagePage } from './office-map-marker-page.page';

const routes: Routes = [
  {
    path: '',
    component: OfficeMapMarkerPagePage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class OfficeMapMarkerPagePageRoutingModule {}

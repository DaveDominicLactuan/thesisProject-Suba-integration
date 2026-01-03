import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { ResultsDashboardRoutingModule } from './results-dashboard-routing.module';
import { ResultsDashboardPage } from './results-dashboard.page';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, ResultsDashboardRoutingModule],
  declarations: [ResultsDashboardPage],
})
export class ResultsDashboardModule {}

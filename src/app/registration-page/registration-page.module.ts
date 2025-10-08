import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { RegistrationPagePageRoutingModule } from './registration-page-routing.module';

import { RegistrationPagePage } from './registration-page.page';
import { ReactiveFormsModule } from '@angular/forms';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule, ReactiveFormsModule,
    RegistrationPagePageRoutingModule
  ],
  declarations: [RegistrationPagePage]
})
export class RegistrationPagePageModule {}

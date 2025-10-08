import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CameraPagePage } from './camera-page.page';

describe('CameraPagePage', () => {
  let component: CameraPagePage;
  let fixture: ComponentFixture<CameraPagePage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(CameraPagePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

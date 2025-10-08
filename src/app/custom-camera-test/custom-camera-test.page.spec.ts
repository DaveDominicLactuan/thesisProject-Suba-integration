import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CustomCameraTestPage } from './custom-camera-test.page';

describe('CustomCameraTestPage', () => {
  let component: CustomCameraTestPage;
  let fixture: ComponentFixture<CustomCameraTestPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(CustomCameraTestPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

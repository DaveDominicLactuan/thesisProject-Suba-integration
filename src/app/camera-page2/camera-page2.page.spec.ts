import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CameraPage2Page } from './camera-page2.page';

describe('CameraPage2Page', () => {
  let component: CameraPage2Page;
  let fixture: ComponentFixture<CameraPage2Page>;

  beforeEach(() => {
    fixture = TestBed.createComponent(CameraPage2Page);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

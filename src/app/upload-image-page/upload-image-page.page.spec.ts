import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UploadImagePagePage } from './upload-image-page.page';

describe('UploadImagePagePage', () => {
  let component: UploadImagePagePage;
  let fixture: ComponentFixture<UploadImagePagePage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(UploadImagePagePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

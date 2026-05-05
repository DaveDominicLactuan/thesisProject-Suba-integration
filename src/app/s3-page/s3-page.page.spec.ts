import { ComponentFixture, TestBed } from '@angular/core/testing';
import { S3PagePage } from './s3-page.page';

describe('S3PagePage', () => {
  let component: S3PagePage;
  let fixture: ComponentFixture<S3PagePage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(S3PagePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PdfPagePage } from './pdf-page.page';

describe('PdfPagePage', () => {
  let component: PdfPagePage;
  let fixture: ComponentFixture<PdfPagePage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(PdfPagePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

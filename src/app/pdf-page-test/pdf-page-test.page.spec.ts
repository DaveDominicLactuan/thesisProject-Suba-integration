import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PdfPageTestPage } from './pdf-page-test.page';

describe('PdfPageTestPage', () => {
  let component: PdfPageTestPage;
  let fixture: ComponentFixture<PdfPageTestPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(PdfPageTestPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

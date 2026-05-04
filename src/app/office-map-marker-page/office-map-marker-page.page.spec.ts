import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OfficeMapMarkerPagePage } from './office-map-marker-page.page';

describe('OfficeMapMarkerPagePage', () => {
  let component: OfficeMapMarkerPagePage;
  let fixture: ComponentFixture<OfficeMapMarkerPagePage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(OfficeMapMarkerPagePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

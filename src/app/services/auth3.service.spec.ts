import { TestBed } from '@angular/core/testing';

import { Auth3Service } from './auth3.service';

describe('Auth3Service', () => {
  let service: Auth3Service;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Auth3Service);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});

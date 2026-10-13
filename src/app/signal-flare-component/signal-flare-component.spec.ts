import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SignalFlareComponent } from './signal-flare-component';

describe('SignalFlareComponent', () => {
  let component: SignalFlareComponent;
  let fixture: ComponentFixture<SignalFlareComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SignalFlareComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SignalFlareComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

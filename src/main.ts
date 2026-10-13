import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { SignalFlareComponent } from './app/signal-flare-component/signal-flare-component';

bootstrapApplication(SignalFlareComponent, appConfig)
  .catch((err) => console.error(err));

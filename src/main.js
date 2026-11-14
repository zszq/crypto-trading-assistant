import { startWhenReady } from './core/startup.js';
import { initAvgPreview } from './features/avgPreview.js';
import { initPrivacyBlur } from './features/privacyBlur.js';
import { initLossAlert } from './features/lossAlert.js';

startWhenReady([initAvgPreview, initPrivacyBlur, initLossAlert]);

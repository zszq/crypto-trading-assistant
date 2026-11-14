import { startWhenReady } from './core/startup.js';
import { initAvgPreview } from './features/avgPreview.js';
import { initPrivacyHide } from './features/privacyHide.js';
import { initLossAlert } from './features/lossAlert.js';

startWhenReady([initAvgPreview, initPrivacyHide, initLossAlert]);

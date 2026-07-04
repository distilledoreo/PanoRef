import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ensureHumanMannequinModel } from './engine/humanMannequinModel';
import './index.css';

void ensureHumanMannequinModel();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

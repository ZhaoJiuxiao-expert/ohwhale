import React from 'react';
import { createRoot } from 'react-dom/client';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';
import './styles.css';
import App from './App.jsx';
import './chat-layout.css';
createRoot(document.getElementById('root')).render(<App/>);

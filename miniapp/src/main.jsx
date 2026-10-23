import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import SupportModal from './components/SupportModal.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <><App /><SupportModal /></>
  </React.StrictMode>
);

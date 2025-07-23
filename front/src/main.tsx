import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/app.css';

// Create root element
const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error('Failed to find the root element');
}

const root = ReactDOM.createRoot(rootElement);

// Render app
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
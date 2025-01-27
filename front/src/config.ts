// src/config.ts
const getServerUrl = () => {
    return localStorage.getItem('SERVER_URL') || window.location.hostname;
};

const getApiPort = () => {
    return localStorage.getItem('API_PORT') || '3000';
};

const isHttps = () => {
    return localStorage.getItem('USE_HTTPS') === 'true' || window.location.protocol === 'https:';
};

const getApiUrl = () => {
    const protocol = isHttps() ? 'https:' : 'http:';
    return `${protocol}//${getServerUrl()}:${getApiPort()}`;
};

const getWsUrl = () => {
    const protocol = isHttps() ? 'wss:' : 'ws:';
    return `${protocol}//${getServerUrl()}:${getApiPort()}`;
};

export const config = {
    apiUrl: getApiUrl(),
    wsUrl: getWsUrl(),
    // Add helper functions for components that need them
    getServerUrl,
    getApiPort,
    isHttps,
};
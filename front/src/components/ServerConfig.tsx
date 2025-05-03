import React, { useState } from 'react';

const ServerConfig = () => {
    const [serverUrl, setServerUrl] = useState(localStorage.getItem('SERVER_URL') || window.location.hostname);
    const [apiPort, setApiPort] = useState(localStorage.getItem('API_PORT') || '443');
    const [useHttps, setUseHttps] = useState(localStorage.getItem('USE_HTTPS') === 'true' || window.location.protocol === 'https:');

    const handleSave = () => {
        // Save to localStorage
        localStorage.setItem('SERVER_URL', serverUrl);
        localStorage.setItem('API_PORT', apiPort);
        localStorage.setItem('USE_HTTPS', useHttps.toString());

        // Show confirmation dialog
        if (window.confirm('Settings saved. Reload page to apply changes?')) {
            window.location.reload();
        }
    };

    return (
        <div className="max-w-lg mx-auto bg-white p-6 rounded-lg shadow-md">
            <div className="mb-4">
                <h2 className="text-xl font-bold mb-4">Server Configuration</h2>
            </div>
            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Server URL
                    </label>
                    <input
                        type="text"
                        value={serverUrl}
                        onChange={(e) => setServerUrl(e.target.value)}
                        className="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="localhost or IP address"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        API Port
                    </label>
                    <input
                        type="text"
                        value={apiPort}
                        onChange={(e) => setApiPort(e.target.value)}
                        className="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="443"
                    />
                </div>
                <div className="flex items-center space-x-2">
                    <input
                        type="checkbox"
                        id="https-toggle"
                        checked={useHttps}
                        onChange={(e) => setUseHttps(e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <label
                        htmlFor="https-toggle"
                        className="text-sm font-medium text-gray-700"
                    >
                        Use HTTPS
                    </label>
                </div>
                <div className="pt-4 flex justify-end space-x-2">
                    <button
                        onClick={handleSave}
                        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                    >
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ServerConfig;
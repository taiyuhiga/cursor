"use client";

import { useState, useEffect } from "react";

type ModelConfig = {
  id: string;
  name: string;
  provider: "openai" | "anthropic" | "google";
  enabled: boolean;
};

const DEFAULT_MODELS: ModelConfig[] = [
  { id: "gemini-3-pro-preview", name: "Gemini 3 Pro", provider: "google", enabled: true },
  { id: "claude-opus-4-5-20251101", name: "Claude Opus 4.5", provider: "anthropic", enabled: true },
  { id: "claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5", provider: "anthropic", enabled: true },
  { id: "gpt-5.2", name: "GPT-5.2", provider: "openai", enabled: true },
  { id: "gpt-5.2-extra-high", name: "GPT-5.2 Extra High", provider: "openai", enabled: true },
];

export function SettingsView() {
  const [activeTab, setActiveTab] = useState<"general" | "models">("models");
  const [apiKeys, setApiKeys] = useState({
    openai: "",
    anthropic: "",
    google: "",
  });
  const [models, setModels] = useState<ModelConfig[]>(DEFAULT_MODELS);

  // Load settings from localStorage
  useEffect(() => {
    const savedKeys = localStorage.getItem("cursor_api_keys");
    if (savedKeys) {
      setApiKeys(JSON.parse(savedKeys));
    }

    const savedModels = localStorage.getItem("cursor_models");
    if (savedModels) {
      setModels(JSON.parse(savedModels));
    }
  }, []);

  const handleSaveKeys = () => {
    localStorage.setItem("cursor_api_keys", JSON.stringify(apiKeys));
    alert("API Keys saved!");
  };

  const toggleModel = (id: string) => {
    const newModels = models.map((m) =>
      m.id === id ? { ...m, enabled: !m.enabled } : m
    );
    setModels(newModels);
    localStorage.setItem("cursor_models", JSON.stringify(newModels));
  };

  return (
    <div className="flex flex-col h-full bg-white text-zinc-800">
      <div className="px-8 py-6 border-b border-zinc-200">
        <h1 className="text-2xl font-semibold">Settings</h1>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-48 border-r border-zinc-200 py-4 flex flex-col gap-1">
          <button
            onClick={() => setActiveTab("general")}
            className={`px-4 py-2 text-left text-sm ${
              activeTab === "general"
                ? "bg-zinc-100 font-medium text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            General
          </button>
          <button
            onClick={() => setActiveTab("models")}
            className={`px-4 py-2 text-left text-sm ${
              activeTab === "models"
                ? "bg-zinc-100 font-medium text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            Models
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8">
          {activeTab === "models" && (
            <div className="max-w-2xl space-y-10">
              {/* API Keys Section */}
              <section>
                <h2 className="text-lg font-medium mb-4">API Keys</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">
                      OpenAI API Key
                    </label>
                    <input
                      type="password"
                      value={apiKeys.openai}
                      onChange={(e) =>
                        setApiKeys({ ...apiKeys, openai: e.target.value })
                      }
                      placeholder="sk-..."
                      className="w-full px-3 py-2 border border-zinc-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">
                      Anthropic API Key
                    </label>
                    <input
                      type="password"
                      value={apiKeys.anthropic}
                      onChange={(e) =>
                        setApiKeys({ ...apiKeys, anthropic: e.target.value })
                      }
                      placeholder="sk-ant-..."
                      className="w-full px-3 py-2 border border-zinc-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">
                      Google API Key
                    </label>
                    <input
                      type="password"
                      value={apiKeys.google}
                      onChange={(e) =>
                        setApiKeys({ ...apiKeys, google: e.target.value })
                      }
                      placeholder="AIza..."
                      className="w-full px-3 py-2 border border-zinc-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <button
                    onClick={handleSaveKeys}
                    className="px-4 py-2 bg-zinc-900 text-white text-sm font-medium rounded-md hover:bg-zinc-800 transition-colors"
                  >
                    Save API Keys
                  </button>
                </div>
              </section>

              {/* Models Toggle Section */}
              <section>
                <h2 className="text-lg font-medium mb-4">Available Models</h2>
                <div className="space-y-2 border border-zinc-200 rounded-lg divide-y divide-zinc-200">
                  {models.map((model) => (
                    <div
                      key={model.id}
                      className="flex items-center justify-between p-3"
                    >
                      <div>
                        <div className="text-sm font-medium text-zinc-900">
                          {model.name}
                        </div>
                        <div className="text-xs text-zinc-500 uppercase">
                          {model.provider}
                        </div>
                      </div>
                      <button
                        onClick={() => toggleModel(model.id)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          model.enabled ? "bg-blue-600" : "bg-zinc-200"
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            model.enabled ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {activeTab === "general" && (
            <div className="text-zinc-500">
              General settings content coming soon...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


package main

import "testing"

func TestGemini38DefaultsAndConfigurationGates(t *testing.T) {
	t.Setenv("AGENT_PROVIDER", "")
	t.Setenv("EXAM_AI_PROVIDER", "")
	t.Setenv("EXAM_GEMINI_MODEL", "")
	a := &API{}
	for name, settings := range map[string]AgentSettings{"agent": a.agentSettings(), "exam": a.examSettings()} {
		if settings.Provider != "gemini" || settings.Model != "gemini-3.8-flash" || settings.URL != "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent" {
			t.Fatalf("%s does not use the requested model: %+v", name, settings)
		}
	}
	if a.agentInfo()["configured"] != false || a.examConfigured() {
		t.Fatal("missing credentials must not be reported as configured")
	}
	a.AIKey = "test-key"
	if a.agentInfo()["configured"] != false || a.examConfigured() {
		t.Fatal("a key alone must not enable external AI")
	}
	a.AllowAI = true
	if a.agentInfo()["configured"] != true || !a.examConfigured() {
		t.Fatal("approved Gemini with a key should be configured")
	}
}

func TestExplicitLocalAndDisabledProvidersRemainAvailable(t *testing.T) {
	for _, provider := range []string{"ollama", "off"} {
		t.Run(provider, func(t *testing.T) {
			t.Setenv("AGENT_PROVIDER", provider)
			t.Setenv("EXAM_AI_PROVIDER", provider)
			t.Setenv("OLLAMA_MODEL", "local-test-model")
			t.Setenv("OLLAMA_URL", "http://127.0.0.1:11434/api/chat")
			a := &API{AIKey: "test-key", AllowAI: true}
			for name, settings := range map[string]AgentSettings{"agent": a.agentSettings(), "exam": a.examSettings()} {
				if settings.Provider != provider || settings.URL != "http://127.0.0.1:11434/api/chat" {
					t.Fatalf("%s ignored explicit provider %s: %+v", name, provider, settings)
				}
			}
			if a.agentInfo()["external"] != false {
				t.Fatal("local or disabled mode must not be presented as external")
			}
			if provider == "off" && (a.agentInfo()["configured"] != false || a.examConfigured()) {
				t.Fatal("explicit off must disable both model features")
			}
		})
	}
}

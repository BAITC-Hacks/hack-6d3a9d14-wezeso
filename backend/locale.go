package main

import (
	"context"
	"strings"
)

type uiLanguageKey struct{}

// Only supported language tags can influence the model instruction.
func withUILanguage(ctx context.Context, language string) context.Context {
	language = strings.ToLower(strings.TrimSpace(strings.Split(language, ",")[0]))
	language = strings.Split(strings.Split(language, ";")[0], "-")[0]
	if language != "kk" {
		language = "ru"
	}
	return context.WithValue(ctx, uiLanguageKey{}, language)
}

func localizedPrompt(ctx context.Context, prompt string) string {
	if ctx.Value(uiLanguageKey{}) == "kk" {
		prompt = strings.ReplaceAll(prompt, "на русском", "на казахском")
		prompt = strings.ReplaceAll(prompt, "На русском", "На казахском")
		prompt += " Все пользовательские пояснения, summary, rationale, unknowns и feedback пиши на казахском языке. Не переводи JSON-ключи, идентификаторы и код."
	}
	return prompt + " Принимай ответы учащегося на казахском и русском языках на равных условиях; язык ответа не влияет на оценку."
}

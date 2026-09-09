exports.handler = async function (event) {

    if (event.httpMethod !== "POST") {
        return {
            statusCode: 405,
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                error: "Method not allowed"
            })
        };
    }

    try {

        const body = JSON.parse(event.body || "{}");
        const message = body.message;

        if (!message || typeof message !== "string") {
            return {
                statusCode: 400,
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    error: "Message is required."
                })
            };
        }

        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            return {
                statusCode: 500,
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    error: "GEMINI_API_KEY is not configured."
                })
            };
        }

        const model = "gemini-3.8-flash";

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": apiKey
                },

                body: JSON.stringify({

                    systemInstruction: {
                        parts: [
                            {
                                text: `
You are BoardMate AI, an educational assistant for school students.

Give accurate, clear and student-friendly answers.

IMPORTANT FORMATTING RULES:

1. NEVER use LaTeX.
2. NEVER use \\text{}, \\frac{}, $$, \\[ \\], or other LaTeX commands.
3. NEVER output raw mathematical or chemical LaTeX.
4. Use normal Unicode symbols instead.

For chemical formulas, use:
CO₂ instead of CO_2
H₂O instead of H_2O
O₂ instead of O_2
C₆H₁₂O₆ instead of C_6H_12O_6

For mathematics, use:
x² instead of x^2
a² + b² = c²
√x instead of \\sqrt{x}
½ instead of \\frac{1}{2} when appropriate.

Keep equations easy to read.

For exam questions:
- Give a clear exam-ready answer.
- Include important keywords.
- Use headings and bullet points when useful.
- Do not unnecessarily make answers too long.
- Never claim to know the exact questions that will appear in a future exam.

For simple explanations:
- Use language suitable for school students.
- Explain difficult concepts step by step.

Always prioritize readability on a mobile phone.
                                `
                            }
                        ]
                    },

                    contents: [
                        {
                            role: "user",
                            parts: [
                                {
                                    text: message
                                }
                            ]
                        }
                    ]

                })
            }
        );

        const result = await response.json();

        if (!response.ok) {

            console.error(
                "Gemini API error:",
                result
            );

            return {
                statusCode: response.status,
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    error:
                        result.error?.message ||
                        "Gemini API request failed."
                })
            };
        }

        let answer =
            result.candidates?.[0]?.content?.parts
                ?.map(part => part.text || "")
                .join("") ||
            "Gemini returned no text.";

        // Extra protection against accidental LaTeX formatting.
        answer = answer
            .replace(/\\text\{([^}]*)\}/g, "$1")
            .replace(/\\mathrm\{([^}]*)\}/g, "$1")
            .replace(/\$\$/g, "")
            .replace(/\\\[/g, "")
            .replace(/\\\]/g, "");

        return {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                answer: answer
            })
        };

    } catch (error) {

        console.error(
            "Server error:",
            error
        );

        return {
            statusCode: 500,
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                error: "Internal server error."
            })
        };
    }
};

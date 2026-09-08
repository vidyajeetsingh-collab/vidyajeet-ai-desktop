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

        const model = "gemini-3.7-flash";

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
                                text:
                                    "You are BoardMate AI, an educational assistant for school students. " +
                                    "Explain concepts clearly and accurately. " +
                                    "Use simple language when appropriate. " +
                                    "For exam questions, provide an exam-ready answer with important keywords. " +
                                    "For difficult concepts, explain step by step. " +
                                    "Never claim to know the exact questions that will appear in a future exam."
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

        const answer =
            result.candidates?.[0]?.content?.parts
                ?.map(part => part.text || "")
                .join("") ||
            "Gemini returned no text.";

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

exports.handler = async function (event) {

    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
    };

    if (event.httpMethod === "OPTIONS") {
        return {
            statusCode: 204,
            headers,
            body: ""
        };
    }

    if (event.httpMethod !== "POST") {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({
                error: "Only POST requests are allowed."
            })
        };
    }

    const requestId =
        Date.now().toString(36) +
        Math.random().toString(36).substring(2, 8);

    try {

        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    error: "GEMINI_API_KEY is missing in Netlify.",
                    requestId
                })
            };
        }

        let body;

        try {
            body = JSON.parse(event.body || "{}");
        } catch {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: "Invalid JSON request.",
                    requestId
                })
            };
        }

        const {
            message = "",
            mode = "chat",
            image = null,
            file = null,
            profile = {}
        } = body;

        if (!message && !image && !file) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: "No question, image, or file was provided.",
                    requestId
                })
            };
        }

        /*
        ============================================================
        BOARDMATE MODEL FALLBACK SYSTEM
        ============================================================

        Primary:
        Gemini 3.8 Flash

        Backup:
        Gemini 3.7 Flash
        Gemini 3.6 Flash
        Gemini 3.5 Flash-Lite
        */

        const models = [
            "gemini-3.8-flash",
            "gemini-3.7-flash",
            "gemini-3.6-flash",
            "gemini-3.5-flash-lite"
        ];

        const retryableStatuses = new Set([
            429,
            500,
            502,
            503,
            504
        ]);

        const sleep = (ms) =>
            new Promise(resolve => setTimeout(resolve, ms));

        /*
        ============================================================
        SYSTEM PROMPT
        ============================================================
        */

        const systemPrompt = `
You are BoardMate AI.

You are an educational AI tutor and exam-preparation assistant.

Student profile:

Class: ${profile.className || "Not specified"}
Board: ${profile.board || "Not specified"}
Subject: ${profile.subject || "Not specified"}
Chapter: ${profile.chapter || "Not specified"}

Your responsibilities:

1. Explain school concepts clearly.
2. Help students prepare for examinations.
3. Generate practice questions.
4. Analyze mistakes.
5. Check student answers.
6. Create study plans.
7. Analyze uploaded questions, images and documents.
8. Create exam-style practice.
9. Adapt difficulty based on performance.

IMPORTANT:

- Never claim to know the exact future board-exam questions.
- Do not invent official exam information.
- Keep explanations appropriate for school students.
- Prefer simple language.
- Use headings and bullet points.
- Show calculation steps for numerical questions.
- Give concise exam-ready answers when requested.
- Identify important keywords.
- Point out common mistakes.
- If an uploaded image is unclear, say what cannot be read rather than inventing it.

MATHEMATICS:

Do NOT use LaTeX.

Use:

x²
x³
√x
½
π
a² + b² = c²

CHEMISTRY:

Use Unicode subscripts:

H₂O
CO₂
O₂
N₂
C₆H₁₂O₆

Do not output raw LaTeX.

For diagrams:
Describe the diagram clearly using labels and structured text.

For examination answers:
Use suitable headings, points, keywords and conclusion where appropriate.

Never unnecessarily make answers extremely long.
`;

        /*
        ============================================================
        MODE INSTRUCTIONS
        ============================================================
        */

        const modeInstructions = {

            chat: `
Answer the student's question accurately.
Explain the concept in a student-friendly way.
`,

            explain: `
Explain the topic from the basic level.
Use simple examples.
Break difficult ideas into small steps.
Assume the student may be learning the topic for the first time.
`,

            exam: `
Give an exam-ready answer.
Identify important keywords.
Use suitable headings and points.
Match the answer length to the likely mark level.
Do not add unrelated information.
`,

            scanner: `
Analyze the uploaded question carefully.

First identify:
1. Subject
2. Topic/chapter
3. Question type

Then provide:

1. Question
2. Given information
3. Required answer
4. Step-by-step solution
5. Final answer
6. Exam-ready answer
7. Common mistake

If there are multiple questions, number them separately.
`,

            answerChecker: `
Act as an AI exam answer checker.

Return:

Score:
Estimated marks:
Correct points:
Missing points:
Incorrect points:
Important keywords:
How to improve:
Model exam answer:

Be fair.
Focus on correctness, relevance, concepts and important points.
`,

            practice: `
Create practice questions for the selected class, board and subject.

Include:
Easy
Medium
Hard

For each question provide:
Question
Difficulty
Marks

Do not immediately reveal answers unless requested.
`,

            adaptive: `
Act as an adaptive practice engine.

If the student is struggling:
- simplify the next question
- focus on the weak concept
- give a small conceptual step

If the student is doing well:
- increase difficulty
- introduce application questions
- use multi-step questions

Create the next useful practice question.
`,

            simulator: `
Create a complete exam simulation.

Include:
Sections
Questions
Marks
Difficulty
Suggested time

Do not reveal answers unless the student asks for evaluation.

This is practice and is not an official board paper.
`,

            notes: `
Analyze the uploaded notes or document.

Create:

1. Important concepts
2. Key definitions
3. Important formulas
4. Important facts
5. MCQs
6. Short questions
7. Long questions
8. Revision points

Stay faithful to the uploaded material.
`,

            weakTopics: `
Analyze the student's performance data.

Identify:

Strong topics
Weak topics
Frequently wrong concepts
Priority topics
Suggested practice order

Give a practical improvement strategy.
`,

            studyPlan: `
Create a realistic study plan based on:

Class
Board
Subject
Available time
Exam date
Weak topics

Include daily tasks and revision.

Do not create an impossible schedule.
`,

            mistakes: `
Create a revision session based on questions the student previously got wrong.

Focus on:
- Original concept
- Why the mistake happened
- Similar question
- Slightly different question
- Final revision tip
`,

            visual: `
Explain the concept using visual-learning methods.

If a diagram would help:
- explain what the diagram should contain
- give labels
- explain each labelled part
- explain how the parts relate

Do not claim an image was generated if only text was returned.
`
        };

        const instruction =
            modeInstructions[mode] ||
            modeInstructions.chat;

        const prompt = `
${instruction}

Student request:

${message || "Analyze the uploaded material."}
`;

        const parts = [
            {
                text: prompt
            }
        ];

        /*
        ============================================================
        IMAGE SUPPORT
        ============================================================
        */

        if (image && image.data) {

            if (!image.mimeType) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "Image MIME type is missing.",
                        requestId
                    })
                };
            }

            parts.push({
                inlineData: {
                    mimeType: image.mimeType,
                    data: image.data
                }
            });
        }

        /*
        ============================================================
        FILE / PDF SUPPORT
        ============================================================
        */

        if (file && file.data) {

            if (!file.mimeType) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "File MIME type is missing.",
                        requestId
                    })
                };
            }

            parts.push({
                inlineData: {
                    mimeType: file.mimeType,
                    data: file.data
                }
            });
        }

        /*
        ============================================================
        GEMINI REQUEST
        ============================================================
        */

        async function callGemini(model) {

            const url =
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

            const response = await fetch(url, {

                method: "POST",

                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": apiKey
                },

                body: JSON.stringify({

                    systemInstruction: {
                        parts: [
                            {
                                text: systemPrompt
                            }
                        ]
                    },

                    contents: [
                        {
                            role: "user",
                            parts
                        }
                    ],

                    generationConfig: {

                        maxOutputTokens: 8192,

                        thinkingConfig: {
                            thinkingLevel: "medium"
                        }

                    }

                })

            });

            const result = await response.json();

            return {
                response,
                result
            };
        }

        /*
        ============================================================
        MODEL FALLBACK ENGINE
        ============================================================
        */

        let finalResult = null;
        let successfulModel = null;
        let lastError = null;

        for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {

            const model = models[modelIndex];

            console.log(
                `[BoardMate] ${requestId} trying ${model}`
            );

            /*
            Retry each model up to 2 times.
            */

            for (let attempt = 0; attempt < 2; attempt++) {

                try {

                    const { response, result } =
                        await callGemini(model);

                    /*
                    SUCCESS
                    */

                    if (response.ok) {

                        finalResult = result;
                        successfulModel = model;

                        console.log(
                            `[BoardMate] ${requestId} success with ${model}`
                        );

                        break;
                    }

                    lastError =
                        result?.error?.message ||
                        `Gemini returned HTTP ${response.status}`;

                    console.error(
                        `[BoardMate] ${requestId} ${model} HTTP ${response.status}:`,
                        lastError
                    );

                    /*
                    NON-RETRYABLE ERROR

                    Example:
                    400
                    401
                    403
                    404
                    */

                    if (!retryableStatuses.has(response.status)) {

                        return {
                            statusCode: response.status,
                            headers,
                            body: JSON.stringify({
                                error: lastError,
                                model,
                                requestId
                            })
                        };
                    }

                    /*
                    RETRYABLE ERROR

                    Wait:

                    attempt 0 → ~1 second
                    attempt 1 → ~2 seconds
                    */

                    if (attempt < 1) {

                        const delay =
                            1000 * Math.pow(2, attempt) +
                            Math.floor(Math.random() * 300);

                        console.log(
                            `[BoardMate] ${requestId} retrying ${model} in ${delay}ms`
                        );

                        await sleep(delay);
                    }

                } catch (error) {

                    lastError =
                        error?.message ||
                        "Unknown network error.";

                    console.error(
                        `[BoardMate] ${requestId} network error with ${model}:`,
                        lastError
                    );

                    if (attempt < 1) {

                        const delay =
                            1000 * Math.pow(2, attempt) +
                            Math.floor(Math.random() * 300);

                        await sleep(delay);
                    }
                }
            }

            /*
            If successful, stop trying other models.
            */

            if (successfulModel) {
                break;
            }

            /*
            Otherwise automatically move to
            the next model.
            */

            console.log(
                `[BoardMate] ${requestId} switching from ${model}`
            );
        }

        /*
        ============================================================
        ALL MODELS FAILED
        ============================================================
        */

        if (!successfulModel || !finalResult) {

            return {
                statusCode: 503,
                headers,
                body: JSON.stringify({

                    error:
                        "All BoardMate AI models are temporarily unavailable. Please try again shortly.",

                    requestId,

                    details:
                        lastError || "No model returned a response."

                })
            };
        }

        /*
        ============================================================
        EXTRACT ANSWER
        ============================================================
        */

        let answer = "";

        const candidates =
            finalResult?.candidates || [];

        if (candidates.length > 0) {

            const responseParts =
                candidates[0]?.content?.parts || [];

            answer = responseParts
                .map(part => part.text || "")
                .join("")
                .trim();
        }

        if (!answer) {

            console.error(
                `[BoardMate] ${requestId} Gemini returned no text`
            );

            return {
                statusCode: 502,
                headers,
                body: JSON.stringify({
                    error:
                        "Gemini returned no usable answer.",
                    requestId,
                    model: successfulModel
                })
            };
        }

        /*
        ============================================================
        CLEAN MARKDOWN / LATEX
        ============================================================
        */

        answer = answer

            .replace(
                /\\text\{([^{}]*)\}/g,
                "$1"
            )

            .replace(
                /\\mathrm\{([^{}]*)\}/g,
                "$1"
            )

            .replace(
                /\\mathbf\{([^{}]*)\}/g,
                "$1"
            )

            .replace(
                /\$\$/g,
                ""
            )

            .replace(
                /\\\[/g,
                ""
            )

            .replace(
                /\\\]/g,
                ""
            )

            .trim();

        /*
        ============================================================
        SUCCESS RESPONSE
        ============================================================
        */

        return {

            statusCode: 200,

            headers: {
                ...headers,
                "Cache-Control": "no-store"
            },

            body: JSON.stringify({

                success: true,

                answer,

                mode,

                model: successfulModel,

                requestId

            })

        };

    } catch (error) {

        console.error(
            "BoardMate server error:",
            error
        );

        return {

            statusCode: 500,

            headers,

            body: JSON.stringify({

                error:
                    "BoardMate AI server error: " +
                    (error?.message || "Unknown error."),

                requestId

            })

        };
    }
};            502,
            503,
            504
        ]);

        const sleep = (ms) =>
            new Promise(resolve => setTimeout(resolve, ms));

        /*
        ============================================================
        SYSTEM PROMPT
        ============================================================
        */

        const systemPrompt = `
You are BoardMate AI.

You are an educational AI tutor and exam-preparation assistant.

Student profile:

Class: ${profile.className || "Not specified"}
Board: ${profile.board || "Not specified"}
Subject: ${profile.subject || "Not specified"}
Chapter: ${profile.chapter || "Not specified"}

Your responsibilities:

1. Explain school concepts clearly.
2. Help students prepare for examinations.
3. Generate practice questions.
4. Analyze mistakes.
5. Check student answers.
6. Create study plans.
7. Analyze uploaded questions, images and documents.
8. Create exam-style practice.
9. Adapt difficulty based on performance.

IMPORTANT:

- Never claim to know the exact future board-exam questions.
- Do not invent official exam information.
- Keep explanations appropriate for school students.
- Prefer simple language.
- Use headings and bullet points.
- Show calculation steps for numerical questions.
- Give concise exam-ready answers when requested.
- Identify important keywords.
- Point out common mistakes.
- If an uploaded image is unclear, say what cannot be read rather than inventing it.

MATHEMATICS:

Do NOT use LaTeX.

Use:

x²
x³
√x
½
π
a² + b² = c²

CHEMISTRY:

Use Unicode subscripts:

H₂O
CO₂
O₂
N₂
C₆H₁₂O₆

Do not output raw LaTeX.

For diagrams:
Describe the diagram clearly using labels and structured text.

For examination answers:
Use suitable headings, points, keywords and conclusion where appropriate.

Never unnecessarily make answers extremely long.
`;

        /*
        ============================================================
        MODE INSTRUCTIONS
        ============================================================
        */

        const modeInstructions = {

            chat: `
Answer the student's question accurately.
Explain the concept in a student-friendly way.
`,

            explain: `
Explain the topic from the basic level.
Use simple examples.
Break difficult ideas into small steps.
Assume the student may be learning the topic for the first time.
`,

            exam: `
Give an exam-ready answer.
Identify important keywords.
Use suitable headings and points.
Match the answer length to the likely mark level.
Do not add unrelated information.
`,

            scanner: `
Analyze the uploaded question carefully.

First identify:
1. Subject
2. Topic/chapter
3. Question type

Then provide:

1. Question
2. Given information
3. Required answer
4. Step-by-step solution
5. Final answer
6. Exam-ready answer
7. Common mistake

If there are multiple questions, number them separately.
`,

            answerChecker: `
Act as an AI exam answer checker.

Return:

Score:
Estimated marks:
Correct points:
Missing points:
Incorrect points:
Important keywords:
How to improve:
Model exam answer:

Be fair.
Focus on correctness, relevance, concepts and important points.
`,

            practice: `
Create practice questions for the selected class, board and subject.

Include:
Easy
Medium
Hard

For each question provide:
Question
Difficulty
Marks

Do not immediately reveal answers unless requested.
`,

            adaptive: `
Act as an adaptive practice engine.

If the student is struggling:
- simplify the next question
- focus on the weak concept
- give a small conceptual step

If the student is doing well:
- increase difficulty
- introduce application questions
- use multi-step questions

Create the next useful practice question.
`,

            simulator: `
Create a complete exam simulation.

Include:
Sections
Questions
Marks
Difficulty
Suggested time

Do not reveal answers unless the student asks for evaluation.

This is practice and is not an official board paper.
`,

            notes: `
Analyze the uploaded notes or document.

Create:

1. Important concepts
2. Key definitions
3. Important formulas
4. Important facts
5. MCQs
6. Short questions
7. Long questions
8. Revision points

Stay faithful to the uploaded material.
`,

            weakTopics: `
Analyze the student's performance data.

Identify:

Strong topics
Weak topics
Frequently wrong concepts
Priority topics
Suggested practice order

Give a practical improvement strategy.
`,

            studyPlan: `
Create a realistic study plan based on:

Class
Board
Subject
Available time
Exam date
Weak topics

Include daily tasks and revision.

Do not create an impossible schedule.
`,

            mistakes: `
Create a revision session based on questions the student previously got wrong.

Focus on:
- Original concept
- Why the mistake happened
- Similar question
- Slightly different question
- Final revision tip
`,

            visual: `
Explain the concept using visual-learning methods.

If a diagram would help:
- explain what the diagram should contain
- give labels
- explain each labelled part
- explain how the parts relate

Do not claim an image was generated if only text was returned.
`
        };

        const instruction =
            modeInstructions[mode] ||
            modeInstructions.chat;

        const prompt = `
${instruction}

Student request:

${message || "Analyze the uploaded material."}
`;

        const parts = [
            {
                text: prompt
            }
        ];

        /*
        ============================================================
        IMAGE SUPPORT
        ============================================================
        */

        if (image && image.data) {

            if (!image.mimeType) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "Image MIME type is missing.",
                        requestId
                    })
                };
            }

            parts.push({
                inlineData: {
                    mimeType: image.mimeType,
                    data: image.data
                }
            });
        }

        /*
        ============================================================
        FILE / PDF SUPPORT
        ============================================================
        */

        if (file && file.data) {

            if (!file.mimeType) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "File MIME type is missing.",
                        requestId
                    })
                };
            }

            parts.push({
                inlineData: {
                    mimeType: file.mimeType,
                    data: file.data
                }
            });
        }

        /*
        ============================================================
        GEMINI REQUEST
        ============================================================
        */

        async function callGemini(model) {

            const url =
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

            const response = await fetch(url, {

                method: "POST",

                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": apiKey
                },

                body: JSON.stringify({

                    systemInstruction: {
                        parts: [
                            {
                                text: systemPrompt
                            }
                        ]
                    },

                    contents: [
                        {
                            role: "user",
                            parts
                        }
                    ],

                    generationConfig: {

                        maxOutputTokens: 8192,

                        thinkingConfig: {
                            thinkingLevel: "medium"
                        }

                    }

                })

            });

            const result = await response.json();

            return {
                response,
                result
            };
        }

        /*
        ============================================================
        MODEL FALLBACK ENGINE
        ============================================================
        */

        let finalResult = null;
        let successfulModel = null;
        let lastError = null;

        for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {

            const model = models[modelIndex];

            console.log(
                `[BoardMate] ${requestId} trying ${model}`
            );

            /*
            Retry each model up to 2 times.
            */

            for (let attempt = 0; attempt < 2; attempt++) {

                try {

                    const { response, result } =
                        await callGemini(model);

                    /*
                    SUCCESS
                    */

                    if (response.ok) {

                        finalResult = result;
                        successfulModel = model;

                        console.log(
                            `[BoardMate] ${requestId} success with ${model}`
                        );

                        break;
                    }

                    lastError =
                        result?.error?.message ||
                        `Gemini returned HTTP ${response.status}`;

                    console.error(
                        `[BoardMate] ${requestId} ${model} HTTP ${response.status}:`,
                        lastError
                    );

                    /*
                    NON-RETRYABLE ERROR

                    Example:
                    400
                    401
                    403
                    404
                    */

                    if (!retryableStatuses.has(response.status)) {

                        return {
                            statusCode: response.status,
                            headers,
                            body: JSON.stringify({
                                error: lastError,
                                model,
                                requestId
                            })
                        };
                    }

                    /*
                    RETRYABLE ERROR

                    Wait:

                    attempt 0 → ~1 second
                    attempt 1 → ~2 seconds
                    */

                    if (attempt < 1) {

                        const delay =
                            1000 * Math.pow(2, attempt) +
                            Math.floor(Math.random() * 300);

                        console.log(
                            `[BoardMate] ${requestId} retrying ${model} in ${delay}ms`
                        );

                        await sleep(delay);
                    }

                } catch (error) {

                    lastError =
                        error?.message ||
                        "Unknown network error.";

                    console.error(
                        `[BoardMate] ${requestId} network error with ${model}:`,
                        lastError
                    );

                    if (attempt < 1) {

                        const delay =
                            1000 * Math.pow(2, attempt) +
                            Math.floor(Math.random() * 300);

                        await sleep(delay);
                    }
                }
            }

            /*
            If successful, stop trying other models.
            */

            if (successfulModel) {
                break;
            }

            /*
            Otherwise automatically move to
            the next model.
            */

            console.log(
                `[BoardMate] ${requestId} switching from ${model}`
            );
        }

        /*
        ============================================================
        ALL MODELS FAILED
        ============================================================
        */

        if (!successfulModel || !finalResult) {

            return {
                statusCode: 503,
                headers,
                body: JSON.stringify({

                    error:
                        "All BoardMate AI models are temporarily unavailable. Please try again shortly.",

                    requestId,

                    details:
                        lastError || "No model returned a response."

                })
            };
        }

        /*
        ============================================================
        EXTRACT ANSWER
        ============================================================
        */

        let answer = "";

        const candidates =
            finalResult?.candidates || [];

        if (candidates.length > 0) {

            const responseParts =
                candidates[0]?.content?.parts || [];

            answer = responseParts
                .map(part => part.text || "")
                .join("")
                .trim();
        }

        if (!answer) {

            console.error(
                `[BoardMate] ${requestId} Gemini returned no text`
            );

            return {
                statusCode: 502,
                headers,
                body: JSON.stringify({
                    error:
                        "Gemini returned no usable answer.",
                    requestId,
                    model: successfulModel
                })
            };
        }

        /*
        ============================================================
        CLEAN MARKDOWN / LATEX
        ============================================================
        */

        answer = answer

            .replace(
                /\\text\{([^{}]*)\}/g,
                "$1"
            )

            .replace(
                /\\mathrm\{([^{}]*)\}/g,
                "$1"
            )

            .replace(
                /\\mathbf\{([^{}]*)\}/g,
                "$1"
            )

            .replace(
                /\$\$/g,
                ""
            )

            .replace(
                /\\\[/g,
                ""
            )

            .replace(
                /\\\]/g,
                ""
            )

            .trim();

        /*
        ============================================================
        SUCCESS RESPONSE
        ============================================================
        */

        return {

            statusCode: 200,

            headers: {
                ...headers,
                "Cache-Control": "no-store"
            },

            body: JSON.stringify({

                success: true,

                answer,

                mode,

                model: successfulModel,

                requestId

            })

        };

    } catch (error) {

        console.error(
            "BoardMate server error:",
            error
        );

        return {

            statusCode: 500,

            headers,

            body: JSON.stringify({

                error:
                    "BoardMate AI server error: " +
                    (error?.message || "Unknown error."),

                requestId

            })

        };
    }
};

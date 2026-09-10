exports.handler = async function (event) {
    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
    };

    // CORS preflight
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

    try {
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    error: "GEMINI_API_KEY is missing in Netlify."
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
                    error: "Invalid JSON request."
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

        if (
            !message &&
            !image &&
            !file
        ) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: "No question, image, or file was provided."
                })
            };
        }

        const model = "gemini-3.8-flash";

        /*
         * ---------------------------------------------------------
         * BOARDMATE SYSTEM INSTRUCTION
         * ---------------------------------------------------------
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
7. Analyze uploaded questions/images/documents.
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

MATHEMATICS FORMATTING:

Do NOT use LaTeX.

Use:

x²
x³
√x
½
π
a² + b² = c²

Do not output:

\\\\frac{}
\\\\sqrt{}
\\\\text{}
$$
\\\\[
\\\\]

CHEMISTRY:

Use Unicode subscripts:

H₂O
CO₂
O₂
N₂
C₆H₁₂O₆

Do not output raw LaTeX.

For diagrams:

Describe the diagram clearly using labels and simple structured text.

For examination answers:

Use:
- Definition
- Key points
- Explanation
- Example
- Conclusion

only when appropriate.

Never unnecessarily make answers extremely long.
`;

        /*
         * ---------------------------------------------------------
         * MODE-SPECIFIC INSTRUCTIONS
         * ---------------------------------------------------------
         */

        const modeInstructions = {

            chat: `
Answer the student's question accurately.
Explain the concept in a student-friendly way.
`,

            explain: `
Explain the topic from basic level.
Use simple examples.
Break difficult ideas into small steps.
Assume the student may be learning the topic for the first time.
`,

            exam: `
Give an exam-ready answer.
Identify important keywords.
Use suitable headings and points.
If the question appears to have a mark level, match the answer length.
Do not unnecessarily add unrelated information.
`,

            scanner: `
Analyze the uploaded question carefully.

First identify:
- Subject
- Topic/chapter
- Question type

Then provide:
1. Question
2. Given information
3. Required answer
4. Step-by-step solution
5. Final answer
6. Exam-ready answer
7. Common mistake

If the image contains multiple questions, number them separately.
`,

            answerChecker: `
Act as an AI exam answer checker.

Evaluate the student's answer.

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
Do not give marks merely because the answer is long.
Focus on correctness, relevance, concepts and important points.
`,

            practice: `
Create practice questions for the selected class, board and subject.

Adapt the difficulty according to the student's performance.

Include:
- Easy
- Medium
- Hard

For each question provide:
Question
Difficulty
Marks

Do not immediately reveal answers unless requested.
`,

            adaptive: `
Act as an adaptive practice engine.

Analyze the student's previous performance.

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

            exam: `
Create a board-style examination practice set.

Include appropriate combinations of:
MCQs
Short-answer questions
Long-answer questions
Case/source-based questions
Numericals
Diagram-based questions where appropriate.

Clearly show marks.
Do not claim the generated paper is an official or predicted paper.
`,

            simulator: `
Create a complete exam simulation.

Include:
- Sections
- Questions
- Marks
- Difficulty
- Suggested time

Do not reveal answers unless the student asks for evaluation.
`,

            notes: `
Analyze the uploaded notes/document.

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
- Strong topics
- Weak topics
- Frequently wrong concepts
- Priority topics
- Suggested practice order

Give a practical improvement strategy.
`,

            studyPlan: `
Create a realistic study plan based on:
- Class
- Board
- Subject
- Available time
- Exam date
- Weak topics

Include daily tasks and revision.
Do not create an impossible schedule.
`,

            mistakes: `
Create a revision session based on questions the student previously got wrong.

Focus on:
- The original concept
- Why the mistake happened
- A similar question
- A slightly different question
- Final revision tip
`,

            visual: `
Explain the concept using visual-learning methods.

If a diagram would help:
- Explain what the diagram should contain
- Give labels
- Explain each labelled part
- Explain how the parts relate

Do not claim that an image was generated if only text was returned.
`
        };

        const instruction =
            modeInstructions[mode] ||
            modeInstructions.chat;

        /*
         * ---------------------------------------------------------
         * USER PROMPT
         * ---------------------------------------------------------
         */

        let prompt = `
${instruction}

Student request:

${message || "Analyze the uploaded material."}
`;

        /*
         * ---------------------------------------------------------
         * GEMINI CONTENT PARTS
         * ---------------------------------------------------------
         */

        const parts = [
            {
                text: prompt
            }
        ];

        /*
         * IMAGE INPUT
         *
         * Expected:
         * {
         *   mimeType: "image/jpeg",
         *   data: "BASE64..."
         * }
         */

        if (image && image.data) {

            if (!image.mimeType) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "Image MIME type is missing."
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
         * FILE INPUT
         *
         * Supports PDF and other supported inline media.
         */

        if (file && file.data) {

            if (!file.mimeType) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "File MIME type is missing."
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
         * ---------------------------------------------------------
         * GEMINI API REQUEST
         * ---------------------------------------------------------
         */

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
                        temperature: 0.6,
                        maxOutputTokens: 8192
                    }
                })
            }
        );

        const result = await response.json();

        /*
         * ---------------------------------------------------------
         * GEMINI ERROR
         * ---------------------------------------------------------
         */

        if (!response.ok) {

            console.error(
                "Gemini API error:",
                JSON.stringify(result, null, 2)
            );

            return {
                statusCode: response.status,
                headers,
                body: JSON.stringify({
                    error:
                        result?.error?.message ||
                        "Gemini API request failed."
                })
            };
        }

        /*
         * ---------------------------------------------------------
         * EXTRACT RESPONSE
         * ---------------------------------------------------------
         */

        let answer = "";

        const candidates = result?.candidates || [];

        if (candidates.length > 0) {

            const responseParts =
                candidates[0]?.content?.parts || [];

            answer = responseParts
                .map(part => part.text || "")
                .join("")
                .trim();
        }

        /*
         * ---------------------------------------------------------
         * EMPTY RESPONSE
         * ---------------------------------------------------------
         */

        if (!answer) {

            console.error(
                "Gemini returned no text:",
                JSON.stringify(result, null, 2)
            );

            return {
                statusCode: 502,
                headers,
                body: JSON.stringify({
                    error:
                        "Gemini returned no usable answer."
                })
            };
        }

        /*
         * ---------------------------------------------------------
         * CLEAN FORMATTING
         * ---------------------------------------------------------
         */

        answer = answer
            .replace(/\\text\{([^{}]*)\}/g, "$1")
            .replace(/\\mathrm\{([^{}]*)\}/g, "$1")
            .replace(/\\mathbf\{([^{}]*)\}/g, "$1")
            .replace(/\$\$/g, "")
            .replace(/\\\[/g, "")
            .replace(/\\\]/g, "")
            .trim();

        /*
         * ---------------------------------------------------------
         * SUCCESS
         * ---------------------------------------------------------
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
                model
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
                    (error?.message || "Unknown error")
            })
        };
    }
};

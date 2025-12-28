"use server";

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/prisma";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash-lite", // This is the current free-tier workhorse
  generationConfig: { responseMimeType: "application/json" },
});

/* -----------------------------------------------
   SAFE GENERATE WITH RETRIES
------------------------------------------------ */
async function safeGenerate(prompt, retries = 3) {
  try {
    // This will now hit the 2.5-flash-lite model
    return await model.generateContent(prompt);
  } catch (err) {
    // If it's a 404, it means the model name is still wrong
    if (err.status === 404) {
      throw new Error("Model name is outdated. Try 'gemini-2.5-flash-lite'.");
    }

    // If it's a 429, wait a bit longer (30 seconds)
    if (retries > 0 && err.status === 429) {
      console.log("Quota hit. Waiting 30s...");
      await new Promise((res) => setTimeout(res, 30000));
      return safeGenerate(prompt, retries - 1);
    }
    throw err;
  }
}

export async function generateQuiz() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
    select: { industry: true, skills: true },
  });

  if (!user) throw new Error("User not found");

  const prompt = `Create 10 technical interview MCQs for ${user.industry}. Return JSON with "questions" array containing question, options, correctAnswer, and explanation.`;

  try {
    const result = await safeGenerate(prompt);
    const quiz = JSON.parse(result.response.text()); // Pure JSON due to config
    return quiz.questions;
  } catch (error) {
    console.error("Quiz Error:", error);
    return [
      {
        question: "Fallback question...",
        options: ["A", "B", "C", "D"],
        correctAnswer: "A",
        explanation: "Error fallback",
      },
    ];
  }
}

/* -----------------------------------------------
   2) SAVE QUIZ RESULT
------------------------------------------------ */
export async function saveQuizResult(questions, answers, score) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });

  if (!user) throw new Error("User not found");

  const questionResults = questions.map((q, index) => ({
    question: q.question,
    answer: q.correctAnswer,
    userAnswer: answers[index],
    isCorrect: q.correctAnswer === answers[index],
    explanation: q.explanation,
  }));

  const wrongAnswers = questionResults.filter((q) => !q.isCorrect);

  let improvementTip = null;

  if (wrongAnswers.length > 0) {
    const wrongQuestionsText = wrongAnswers
      .map((q) => `- ${q.question}`)
      .join("\n");

    const improvementPrompt = `
      The user is learning ${user.industry}. They struggled with these topics:
      ${wrongQuestionsText}

      Based on these topics, provide a single, encouraging improvement tip.
      Focus on the core concepts they should master next.
      
      Return the response in this JSON format:
      {
        "tip": "your one-to-two sentence tip here"
      }
    `;

    try {
      const tipResult = await safeGenerate(improvementPrompt);
      const jsonResponse = JSON.parse(tipResult.response.text());
      improvementTip = jsonResponse.tip;
    } catch (error) {
      console.error("Error generating improvement tip:", error);
      improvementTip =
        "Keep practicing your technical skills to build confidence!";
    }
  }

  try {
    const assessment = await db.assessment.create({
      data: {
        userId: user.id,
        quizScore: score,
        questions: questionResults,
        category: "Technical",
        improvementTip,
      },
    });

    return assessment;
  } catch (error) {
    console.error("Error saving quiz result:", error);
    throw new Error("Failed to save quiz result");
  }
}

/* -----------------------------------------------
   3) GET ASSESSMENTS
------------------------------------------------ */
export async function getAssessments() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });

  if (!user) throw new Error("User not found");

  try {
    const assessments = await db.assessment.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });

    return assessments;
  } catch (error) {
    console.error("Error fetching assessments:", error);
    throw new Error("Failed to fetch assessments");
  }
}

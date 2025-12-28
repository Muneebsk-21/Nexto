"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ✅ Use supported model
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash-lite", // This is the current free-tier workhorse
  generationConfig: { responseMimeType: "application/json" },
});
// Map AI strings to Prisma enums
const demandLevelMap = {
  High: "HIGH",
  Medium: "MEDIUM",
  Low: "LOW",
};

const marketOutlookMap = {
  Positive: "POSITIVE",
  Neutral: "NEUTRAL",
  Negative: "NEGATIVE",
};

export const generateAIInsights = async (industry) => {
  const prompt = `
  Analyze the ${industry} industry and return strictly valid JSON like this:
  {
    "salaryRanges": [
      { "role": "string", "min": number, "max": number, "median": number, "location": "string" }
    ],
    "growthRate": number,
    "demandLevel": "HIGH" | "MEDIUM" | "LOW",
    "topSkills": ["string"],
    "marketOutlook": "POSITIVE" | "NEUTRAL" | "NEGATIVE",
    "keyTrends": ["string"],
    "recommendedSkills": ["string"]
  }
  IMPORTANT: Return ONLY JSON. No markdown, no backticks, no extra text.
  `;

  try {
    const result = await model.generateContent(prompt);
    let text = result.response.text().trim();

    // Remove code fences if AI adds them
    text = text.replace(/```json|```/g, "").trim();

    const parsed = JSON.parse(text);

    // Map enums to Prisma values
    parsed.demandLevel = demandLevelMap[parsed.demandLevel] || "MEDIUM";
    parsed.marketOutlook = marketOutlookMap[parsed.marketOutlook] || "NEUTRAL";

    return parsed;
  } catch (error) {
    console.error("Error generating AI insights:", error);
    throw new Error("Failed to generate AI insights: " + error.message);
  }
};

export async function getIndustryInsights() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
    include: { industryInsight: true },
  });

  if (!user) throw new Error("User not found");

  // CHECK IF DATA IS MISSING OR EXPIRED
  const isExpired =
    user.industryInsight &&
    new Date() >= new Date(user.industryInsight.nextUpdate);

  if (!user.industryInsight || isExpired) {
    const insights = await generateAIInsights(user.industry);

    // Use upsert so it updates the existing record instead of failing
    const industryInsight = await db.industryInsight.upsert({
      where: {
        // Ensure 'industry' is marked as @unique in your Prisma schema
        industry: user.industry,
      },
      update: {
        salaryRanges: insights.salaryRanges,
        growthRate: insights.growthRate,
        demandLevel: insights.demandLevel,
        topSkills: insights.topSkills,
        marketOutlook: insights.marketOutlook,
        keyTrends: insights.keyTrends,
        recommendedSkills: insights.recommendedSkills,
        nextUpdate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        lastUpdate: new Date.now()
      },
      create: {
        industry: user.industry,
        salaryRanges: insights.salaryRanges,
        growthRate: insights.growthRate,
        demandLevel: insights.demandLevel,
        topSkills: insights.topSkills,
        marketOutlook: insights.marketOutlook,
        keyTrends: insights.keyTrends,
        recommendedSkills: insights.recommendedSkills,
        nextUpdate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        lastUpdated: new Date(),
        users: {
          connect: {
            id: user.id,
          },
        },
      },
    });

    return industryInsight;
  }

  return user.industryInsight;
}
